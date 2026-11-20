import { randomBytes } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { Database } from "../lib/database.js";
import { RejectedRequestError } from "../lib/http.js";
import { apiKeys, type ApiKeyRow } from "../lib/schema.js";
import { generateSecret, hashSecret, isSecretMatch } from "../lib/secrets.js";

const apiKeyPrefix = "ek";
const apiKeyPattern = /^ek_([0-9a-f]{16})_(.+)$/;
const lookupIdBytes = 8;

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export const summariseApiKey = (key: ApiKeyRow): ApiKeySummary => ({
  id: key.id,
  name: key.name,
  prefix: `${apiKeyPrefix}_${key.lookupId}_…`,
  lastUsedAt: key.lastUsedAt,
  createdAt: key.createdAt,
});

export const createApiKey = async (
  database: Database,
  name: string,
): Promise<{ apiKey: ApiKeySummary; secret: string }> => {
  const trimmed = name.trim();
  if (trimmed === "") {
    throw new RejectedRequestError(
      422,
      "validation_failed",
      "Give the API key a name",
    );
  }
  const lookupId = randomBytes(lookupIdBytes).toString("hex");
  const secret = `${apiKeyPrefix}_${lookupId}_${generateSecret()}`;
  const [row] = await database
    .insert(apiKeys)
    .values({ name: trimmed, lookupId, secretHash: hashSecret(secret) })
    .returning();
  if (row === undefined) {
    throw new Error("The API key was not created");
  }
  return { apiKey: summariseApiKey(row), secret };
};

export const listApiKeys = async (
  database: Database,
): Promise<ApiKeySummary[]> =>
  (await database.select().from(apiKeys).orderBy(desc(apiKeys.createdAt))).map(
    summariseApiKey,
  );

export const deleteApiKey = async (
  database: Database,
  id: string,
): Promise<boolean> =>
  (
    await database
      .delete(apiKeys)
      .where(eq(apiKeys.id, id))
      .returning({ id: apiKeys.id })
  ).length > 0;

const unauthenticated = (message: string) =>
  new RejectedRequestError(401, "unauthenticated", message);

export const authenticateApiKey = async (
  database: Database,
  authorization: string | undefined,
): Promise<ApiKeyRow> => {
  const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? "")?.[1];
  if (token === undefined) {
    throw unauthenticated(
      "Send an API key as a Bearer token in the Authorization header",
    );
  }
  const lookupId = apiKeyPattern.exec(token)?.[1];
  const [row] =
    lookupId === undefined
      ? []
      : await database
          .select()
          .from(apiKeys)
          .where(eq(apiKeys.lookupId, lookupId));
  if (row === undefined || !isSecretMatch(token, row.secretHash)) {
    throw unauthenticated("The API key is not valid");
  }
  await database
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id));
  return row;
};
