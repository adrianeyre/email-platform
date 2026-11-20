import { and, asc, eq, inArray, or } from "drizzle-orm";
import { Type, type Static } from "typebox";
import type { Database } from "../lib/database.js";
import {
  isUniqueViolation,
  NotFoundError,
  RejectedRequestError,
  ValidationFailedError,
  type Server,
} from "../lib/http.js";
import {
  emailParts,
  templates,
  type EmailPartKind,
  type EmailPartRow,
  type TemplateRow,
} from "../lib/schema.js";
import { composeHtml } from "./compose.js";
import { renderTemplate, TemplateRenderFailedError } from "./render.js";

const variablesRecord = Type.Record(Type.String(), Type.Unknown());

const partBody = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200 }),
    html: Type.String(),
    design: Type.Optional(
      Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()], {
        description: "The visual designer's blocks, when it was made there",
      }),
    ),
    sampleVariables: Type.Optional(variablesRecord),
  },
  { additionalProperties: false },
);

type PartBody = Static<typeof partBody>;

const idParams = Type.Object({ id: Type.String({ format: "uuid" }) });

const labels: Record<EmailPartKind, string> = {
  header: "header",
  footer: "footer",
};

export const loadPart = async (
  database: Database,
  kind: EmailPartKind,
  id: string,
): Promise<EmailPartRow> => {
  const [row] = await database
    .select()
    .from(emailParts)
    .where(and(eq(emailParts.id, id), eq(emailParts.kind, kind)));
  if (row === undefined) {
    throw new NotFoundError(`The ${labels[kind]}`);
  }
  return row;
};

/** Checks that a Template's Header and Footer exist and are of the right kind, and returns them. */
export const loadTemplateParts = async (
  database: Database,
  {
    headerId,
    footerId,
  }: { headerId?: string | null; footerId?: string | null },
): Promise<{
  header: EmailPartRow | undefined;
  footer: EmailPartRow | undefined;
}> => {
  const ids = [headerId, footerId].filter(
    (id): id is string => id !== null && id !== undefined,
  );
  const rows =
    ids.length === 0
      ? []
      : await database
          .select()
          .from(emailParts)
          .where(inArray(emailParts.id, ids));
  const find = (
    id: string | null | undefined,
    kind: EmailPartKind,
    field: string,
  ) => {
    if (id === null || id === undefined) {
      return undefined;
    }
    const row = rows.find((item) => item.id === id && item.kind === kind);
    if (row === undefined) {
      throw new ValidationFailedError([
        { field, message: `There is no ${labels[kind]} with this ID` },
      ]);
    }
    return row;
  };
  return {
    header: find(headerId, "header", "headerId"),
    footer: find(footerId, "footer", "footerId"),
  };
};

/** A Template's subject, text and HTML with its Header and Footer around it, ready to render. */
export const templateContentWithParts = async (
  database: Database,
  template: Pick<
    TemplateRow,
    "subject" | "html" | "text" | "design" | "headerId" | "footerId"
  >,
) => {
  const { header, footer } = await loadTemplateParts(database, template);
  return {
    subject: template.subject,
    text: template.text,
    html: composeHtml(template, header, footer),
  };
};

const rejectUnrenderable = (
  html: string,
  variables: Record<string, unknown>,
) => {
  try {
    renderTemplate({ subject: "", html }, variables);
  } catch (error) {
    if (error instanceof TemplateRenderFailedError) {
      throw new ValidationFailedError([
        { field: "html", message: `It does not render: ${error.message}` },
      ]);
    }
    throw error;
  }
};

const toValues = (body: PartBody) => ({
  name: body.name.trim(),
  html: body.html,
  design: body.design ?? null,
  sampleVariables: body.sampleVariables ?? {},
});

/** Lists the Templates that use a Header or Footer, for its page. */
const usedBy = async (database: Database, id: string) =>
  database
    .select({ id: templates.id, name: templates.name })
    .from(templates)
    .where(or(eq(templates.headerId, id), eq(templates.footerId, id)))
    .orderBy(asc(templates.name));

const registerPartRoutes = (
  server: Server,
  database: Database,
  kind: EmailPartKind,
  path: string,
  tag: string,
) => {
  const label = labels[kind];
  const rethrowDuplicate = (error: unknown, name: string): never => {
    if (isUniqueViolation(error)) {
      throw new RejectedRequestError(
        409,
        `${kind}_name_taken`,
        `A ${label} called "${name.trim()}" already exists`,
      );
    }
    throw error;
  };

  server.get(
    path,
    { schema: { summary: `List ${label}s`, tags: [tag] } },
    async () => ({
      [`${kind}s`]: await database
        .select()
        .from(emailParts)
        .where(eq(emailParts.kind, kind))
        .orderBy(asc(emailParts.name)),
    }),
  );

  server.get(
    `${path}/:id`,
    { schema: { summary: `Read a ${label}`, tags: [tag], params: idParams } },
    async (request) => ({
      ...(await loadPart(database, kind, request.params.id)),
      usedBy: await usedBy(database, request.params.id),
    }),
  );

  server.post(
    path,
    { schema: { summary: `Create a ${label}`, tags: [tag], body: partBody } },
    async (request, reply) => {
      rejectUnrenderable(request.body.html, request.body.sampleVariables ?? {});
      try {
        const [row] = await database
          .insert(emailParts)
          .values({ ...toValues(request.body), kind })
          .returning();
        return await reply.code(201).send(row);
      } catch (error) {
        return rethrowDuplicate(error, request.body.name);
      }
    },
  );

  server.put(
    `${path}/:id`,
    {
      schema: {
        summary: `Replace a ${label}`,
        description: `Every Template using this ${label} sends with the new one straight away.`,
        tags: [tag],
        params: idParams,
        body: partBody,
      },
    },
    async (request) => {
      rejectUnrenderable(request.body.html, request.body.sampleVariables ?? {});
      try {
        const [row] = await database
          .update(emailParts)
          .set({ ...toValues(request.body), updatedAt: new Date() })
          .where(
            and(
              eq(emailParts.id, request.params.id),
              eq(emailParts.kind, kind),
            ),
          )
          .returning();
        if (row === undefined) {
          throw new NotFoundError(`The ${label}`);
        }
        return row;
      } catch (error) {
        return rethrowDuplicate(error, request.body.name);
      }
    },
  );

  server.delete(
    `${path}/:id`,
    {
      schema: {
        summary: `Delete a ${label}`,
        description: `Templates using it are sent without a ${label}.`,
        tags: [tag],
        params: idParams,
      },
    },
    async (request) => {
      const deleted = await database
        .delete(emailParts)
        .where(
          and(eq(emailParts.id, request.params.id), eq(emailParts.kind, kind)),
        )
        .returning({ id: emailParts.id });
      if (deleted.length === 0) {
        throw new NotFoundError(`The ${label}`);
      }
      return {};
    },
  );
};

export const registerHeaderAndFooterRoutes = (
  server: Server,
  { database }: { database: Database },
): void => {
  registerPartRoutes(server, database, "header", "/headers", "Headers");
  registerPartRoutes(server, database, "footer", "/footers", "Footers");
};
