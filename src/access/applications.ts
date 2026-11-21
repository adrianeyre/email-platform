import { asc, count, eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { Type } from "typebox";
import type { Database } from "../lib/database.js";
import {
  isUniqueViolation,
  NotFoundError,
  RejectedRequestError,
  ValidationFailedError,
  type CallingApiKey,
  type Server,
  type SignedInUser,
} from "../lib/http.js";
import { apiKeys, applications, type ApplicationRow } from "../lib/schema.js";

/** The `applicationId` field of a Template, Header, Footer or Configuration body. */
export const applicationIdField = Type.Optional(
  Type.Union([Type.String({ format: "uuid" }), Type.Null()], {
    description:
      "The Application that owns it: only that Application's API Keys can change or delete it. An API Key always makes and keeps its own Application's, so leave this out (or send its own Application's ID). Null means no Application: only Users can change it",
  }),
);

const nameBody = Type.Object(
  { name: Type.String({ minLength: 1, maxLength: 200 }) },
  { additionalProperties: false },
);

const idParams = Type.Object({ id: Type.String({ format: "uuid" }) });

const checkName = (name: string): string => {
  const trimmed = name.trim();
  if (trimmed === "") {
    throw new ValidationFailedError([
      { field: "name", message: "Give the application a name" },
    ]);
  }
  return trimmed;
};

const rethrowDuplicate = (error: unknown, name: string): never => {
  if (isUniqueViolation(error)) {
    throw new RejectedRequestError(
      409,
      "application_name_taken",
      `An application called "${name.trim()}" already exists`,
    );
  }
  throw error;
};

/** The Application with this name, made when there is none yet. */
export const findOrCreateApplication = async (
  database: Database,
  name: string,
): Promise<ApplicationRow> => {
  const trimmed = checkName(name);
  await database
    .insert(applications)
    .values({ name: trimmed })
    .onConflictDoNothing({ target: applications.name });
  const [row] = await database
    .select()
    .from(applications)
    .where(eq(applications.name, trimmed));
  if (row === undefined) {
    throw new Error("The application was not created");
  }
  return row;
};

/**
 * Who owns a Template, Header, Footer or Configuration being made or replaced. An API Key always makes and keeps its
 * own Application's. A User chooses: an Application's ID, null for none, or (on a replace) nothing, to keep the owner.
 */
export const chooseOwner = async (
  database: Database,
  caller: CallingApiKey | null,
  requested: string | null | undefined,
): Promise<{ applicationId?: string | null }> => {
  if (caller !== null) {
    if (requested !== undefined && requested !== caller.applicationId) {
      throw new ValidationFailedError([
        {
          field: "applicationId",
          message:
            "An API Key can only make and change its own Application's templates, headers and footers",
        },
      ]);
    }
    return { applicationId: caller.applicationId };
  }
  if (requested === undefined || requested === null) {
    return requested === null ? { applicationId: null } : {};
  }
  const [row] = await database
    .select({ id: applications.id })
    .from(applications)
    .where(eq(applications.id, requested));
  if (row === undefined) {
    throw new ValidationFailedError([
      {
        field: "applicationId",
        message: "There is no application with this ID",
      },
    ]);
  }
  return { applicationId: requested };
};

/**
 * The condition that limits a change or delete to the caller's own rows: an API Key reaches only its Application's,
 * so another Application's row (or one owned by none) answers 404 like an unknown ID. A User reaches every row.
 */
export const ownedByCaller = (
  column: PgColumn,
  caller: CallingApiKey | null,
): SQL | undefined =>
  caller === null ? undefined : eq(column, caller.applicationId);

/**
 * Who is making or changing a Template, Header or Footer, to record on it (pen test K1, #132): the API Key on `/v1`,
 * else the signed-in User on `/app`.
 */
export const changedBy = (caller: {
  apiKey: CallingApiKey | null;
  user: SignedInUser | null;
}): { updatedByApiKeyId: string | null; updatedByUserId: string | null } => ({
  updatedByApiKeyId: caller.apiKey?.apiKeyId ?? null,
  updatedByUserId:
    caller.apiKey === null ? (caller.user?.userId ?? null) : null,
});

export const registerApplicationRoutes = (
  server: Server,
  { database }: { database: Database },
): void => {
  server.get("/applications", async () => ({
    applications: await database
      .select({
        id: applications.id,
        name: applications.name,
        createdAt: applications.createdAt,
        apiKeys: count(apiKeys.id),
      })
      .from(applications)
      .leftJoin(apiKeys, eq(apiKeys.applicationId, applications.id))
      .groupBy(applications.id)
      .orderBy(asc(applications.name)),
  }));

  server.post(
    "/applications",
    { schema: { body: nameBody } },
    async (request, reply) => {
      try {
        const [row] = await database
          .insert(applications)
          .values({ name: checkName(request.body.name) })
          .returning();
        return await reply.code(201).send(row);
      } catch (error) {
        return rethrowDuplicate(error, request.body.name);
      }
    },
  );

  server.put(
    "/applications/:id",
    { schema: { params: idParams, body: nameBody } },
    async (request) => {
      try {
        const [row] = await database
          .update(applications)
          .set({ name: checkName(request.body.name) })
          .where(eq(applications.id, request.params.id))
          .returning();
        if (row === undefined) {
          throw new NotFoundError("The application");
        }
        return row;
      } catch (error) {
        return rethrowDuplicate(error, request.body.name);
      }
    },
  );

  server.delete(
    "/applications/:id",
    { schema: { params: idParams } },
    async (request) => {
      const [keys] = await database
        .select({ total: count() })
        .from(apiKeys)
        .where(eq(apiKeys.applicationId, request.params.id));
      if ((keys?.total ?? 0) > 0) {
        throw new RejectedRequestError(
          409,
          "application_has_api_keys",
          "Delete this application's API keys first",
        );
      }
      // Its Templates, Headers, Footers, Configurations and Messages stay, owned by no Application.
      const deleted = await database
        .delete(applications)
        .where(eq(applications.id, request.params.id))
        .returning({ id: applications.id });
      if (deleted.length === 0) {
        throw new NotFoundError("The application");
      }
      return {};
    },
  );
};
