import { asc, eq } from "drizzle-orm";
import { Type, type Static } from "typebox";
import { applicationIdField, chooseOwner } from "../access/applications.js";
import type { Database } from "../lib/database.js";
import {
  isUniqueViolation,
  NotFoundError,
  RejectedRequestError,
  ValidationFailedError,
  type Server,
} from "../lib/http.js";
import {
  configurations,
  templates,
  type ConfigurationRow,
} from "../lib/schema.js";

const configurationBody = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200 }),
    fromEmail: Type.String({
      format: "email",
      maxLength: 320,
      description:
        "The address Templates using this Configuration are sent from, such as no-reply@example.com. Its Application's API Keys may send from it",
    }),
    fromName: Type.Optional(
      Type.String({
        maxLength: 200,
        description:
          'The name shown with the address, such as "Wizzaroo". Leave it empty to send with the address alone',
      }),
    ),
    applicationId: applicationIdField,
  },
  { additionalProperties: false },
);

type ConfigurationBody = Static<typeof configurationBody>;

const idParams = Type.Object({ id: Type.String({ format: "uuid" }) });

/** Characters a display name can use without quotes (RFC 5322 atext and spaces). */
const plainDisplayName = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~ ]+$/u;

/**
 * The from address for a Configuration: `Wizzaroo <no-reply@example.com>`, with the name quoted when it needs to be,
 * or the address alone when there is no name.
 */
export const formatFromAddress = ({
  fromEmail,
  fromName,
}: Pick<ConfigurationRow, "fromEmail" | "fromName">): string => {
  const name = fromName.replace(/[\r\n]+/gu, " ").trim();
  if (name === "") {
    return fromEmail;
  }
  const displayName = plainDisplayName.test(name)
    ? name
    : `"${name.replace(/["\\]/gu, "\\$&")}"`;
  return `${displayName} <${fromEmail}>`;
};

export const loadConfiguration = async (
  database: Database,
  id: string,
): Promise<ConfigurationRow> => {
  const [row] = await database
    .select()
    .from(configurations)
    .where(eq(configurations.id, id));
  if (row === undefined) {
    throw new NotFoundError("The configuration");
  }
  return row;
};

/** Checks that a Template's Configuration exists, and returns it. */
export const loadTemplateConfiguration = async (
  database: Database,
  configurationId: string | null | undefined,
): Promise<ConfigurationRow | undefined> => {
  if (configurationId === null || configurationId === undefined) {
    return undefined;
  }
  const [row] = await database
    .select()
    .from(configurations)
    .where(eq(configurations.id, configurationId));
  if (row === undefined) {
    throw new ValidationFailedError([
      {
        field: "configurationId",
        message: "There is no configuration with this ID",
      },
    ]);
  }
  return row;
};

const toValues = (body: ConfigurationBody) => ({
  name: body.name.trim(),
  fromEmail: body.fromEmail.trim(),
  fromName: (body.fromName ?? "").trim(),
});

const rethrowDuplicate = (error: unknown, name: string): never => {
  if (isUniqueViolation(error)) {
    throw new RejectedRequestError(
      409,
      "configuration_name_taken",
      `A configuration called "${name.trim()}" already exists`,
    );
  }
  throw error;
};

/** Lists the Templates that use a Configuration, for its page. */
const usedBy = async (database: Database, id: string) =>
  database
    .select({ id: templates.id, name: templates.name })
    .from(templates)
    .where(eq(templates.configurationId, id))
    .orderBy(asc(templates.name));

export const registerConfigurationRoutes = (
  server: Server,
  { database }: { database: Database },
): void => {
  server.get(
    "/configurations",
    { schema: { summary: "List configurations", tags: ["Configurations"] } },
    async () => ({
      configurations: await database
        .select()
        .from(configurations)
        .orderBy(asc(configurations.name)),
    }),
  );

  server.get(
    "/configurations/:id",
    {
      schema: {
        summary: "Read a configuration",
        tags: ["Configurations"],
        params: idParams,
      },
    },
    async (request) => ({
      ...(await loadConfiguration(database, request.params.id)),
      usedBy: await usedBy(database, request.params.id),
    }),
  );

  server.post(
    "/configurations",
    {
      schema: {
        summary: "Create a configuration",
        tags: ["Configurations"],
        body: configurationBody,
      },
    },
    async (request, reply) => {
      const owner = await chooseOwner(
        database,
        request.apiKey,
        request.body.applicationId,
      );
      try {
        const [row] = await database
          .insert(configurations)
          .values({ ...toValues(request.body), ...owner })
          .returning();
        return await reply.code(201).send(row);
      } catch (error) {
        return rethrowDuplicate(error, request.body.name);
      }
    },
  );

  server.put(
    "/configurations/:id",
    {
      schema: {
        summary: "Replace a configuration",
        description:
          "Every Template using this configuration sends with the new one straight away.",
        tags: ["Configurations"],
        params: idParams,
        body: configurationBody,
      },
    },
    async (request) => {
      const owner = await chooseOwner(
        database,
        request.apiKey,
        request.body.applicationId,
      );
      try {
        const [row] = await database
          .update(configurations)
          .set({ ...toValues(request.body), ...owner, updatedAt: new Date() })
          .where(eq(configurations.id, request.params.id))
          .returning();
        if (row === undefined) {
          throw new NotFoundError("The configuration");
        }
        return row;
      } catch (error) {
        return rethrowDuplicate(error, request.body.name);
      }
    },
  );

  server.delete(
    "/configurations/:id",
    {
      schema: {
        summary: "Delete a configuration",
        description:
          "Templates using it are sent from the request's from address or the default one.",
        tags: ["Configurations"],
        params: idParams,
      },
    },
    async (request) => {
      const deleted = await database
        .delete(configurations)
        .where(eq(configurations.id, request.params.id))
        .returning({ id: configurations.id });
      if (deleted.length === 0) {
        throw new NotFoundError("The configuration");
      }
      return {};
    },
  );
};
