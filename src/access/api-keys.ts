import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "../lib/database.js";
import { RejectedRequestError } from "../lib/http.js";
import {
  apiKeys,
  applications,
  users,
  type ApiKeyRow,
  type ApplicationRow,
} from "../lib/schema.js";
import { generateSecret, hashSecret, isSecretMatch } from "../lib/secrets.js";
import { findOrCreateApplication } from "./applications.js";

const apiKeyPrefix = "ek";
const apiKeyPattern = /^ek_([0-9a-f]{16})_(.+)$/;
const lookupIdBytes = 8;
const lastUsedAtIntervalMs = 60_000;

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  /** The Application the key acts for (ADR 0009). */
  applicationId: string;
  applicationName: string;
  lastUsedAt: Date | null;
  createdAt: Date;
  /** The User who minted it: null when the CLI made it or it is older than the record (pen test A2, #125). */
  createdByUserId: string | null;
  /** That User's email, while they exist. */
  createdByEmail: string | null;
}

export const summariseApiKey = (
  key: ApiKeyRow,
  application: Pick<ApplicationRow, "name">,
  createdByEmail: string | null,
): ApiKeySummary => ({
  id: key.id,
  name: key.name,
  prefix: `${apiKeyPrefix}_${key.lookupId}_…`,
  applicationId: key.applicationId,
  applicationName: application.name,
  lastUsedAt: key.lastUsedAt,
  createdAt: key.createdAt,
  createdByUserId: key.createdByUserId,
  createdByEmail,
});

/**
 * Makes a key for the Application with this name, made when there is none yet. With no Application named, the key
 * gets a new one named after itself, so a new key can change nothing that already exists until a User says so.
 * `createdBy` is the signed-in User minting it; the CLI gives none.
 */
export const createApiKey = async (
  database: Database,
  name: string,
  applicationName?: string,
  createdBy?: { userId: string; email: string },
): Promise<{ apiKey: ApiKeySummary; secret: string }> => {
  const trimmed = name.trim();
  if (trimmed === "") {
    throw new RejectedRequestError(
      422,
      "validation_failed",
      "Give the API key a name",
    );
  }
  const application = await findOrCreateApplication(
    database,
    applicationName === undefined || applicationName.trim() === ""
      ? trimmed
      : applicationName,
  );
  const lookupId = randomBytes(lookupIdBytes).toString("hex");
  const secret = `${apiKeyPrefix}_${lookupId}_${generateSecret()}`;
  const [row] = await database
    .insert(apiKeys)
    .values({
      name: trimmed,
      applicationId: application.id,
      lookupId,
      secretHash: hashSecret(secret),
      createdByUserId: createdBy?.userId ?? null,
    })
    .returning();
  if (row === undefined) {
    throw new Error("The API key was not created");
  }
  return {
    apiKey: summariseApiKey(row, application, createdBy?.email ?? null),
    secret,
  };
};

export const listApiKeys = async (
  database: Database,
): Promise<ApiKeySummary[]> =>
  (
    await database
      .select({
        key: apiKeys,
        applicationName: applications.name,
        createdByEmail: users.email,
      })
      .from(apiKeys)
      .innerJoin(applications, eq(applications.id, apiKeys.applicationId))
      .leftJoin(users, eq(users.id, apiKeys.createdByUserId))
      .orderBy(desc(apiKeys.createdAt))
  ).map((row) =>
    summariseApiKey(row.key, { name: row.applicationName }, row.createdByEmail),
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
  // Written at most once a minute (the PRD's request-rate policy), so a key's every call is not a write on its row. The
  // database's clock writes and guards it, so every api process agrees; the check before it only saves a query.
  if (
    row.lastUsedAt === null ||
    Date.now() - row.lastUsedAt.getTime() >= lastUsedAtIntervalMs
  ) {
    await database
      .update(apiKeys)
      .set({ lastUsedAt: sql`now()` })
      .where(
        and(
          eq(apiKeys.id, row.id),
          or(
            isNull(apiKeys.lastUsedAt),
            lt(apiKeys.lastUsedAt, sql`now() - interval '1 minute'`),
          ),
        ),
      );
  }
  return row;
};
