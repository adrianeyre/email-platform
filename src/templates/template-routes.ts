import { asc, eq, like, or } from "drizzle-orm";
import { Type, type Static } from "typebox";
import type { Database } from "../lib/database.js";
import {
  findViolatedConstraint,
  isUniqueViolation,
  NotFoundError,
  RejectedRequestError,
  ValidationFailedError,
  type Server,
} from "../lib/http.js";
import { templates, type TemplateRow } from "../lib/schema.js";
import { composeHtml } from "./compose.js";
import { loadTemplateConfiguration } from "./configuration-routes.js";
import { loadTemplateParts } from "./part-routes.js";
import {
  normaliseVariableNames,
  renderTemplate,
  TemplateRenderFailedError,
} from "./render.js";
import {
  findSlugProblem,
  firstFreeSlug,
  maxSlugLength,
  slugify,
} from "./slug.js";

const variablesRecord = Type.Record(Type.String(), Type.Unknown());

const templateBody = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200 }),
    slug: Type.Optional(
      Type.String({
        maxLength: maxSlugLength,
        description:
          "What applications send it by as templateSlug: 1 to 100 lowercase letters, numbers and hyphens (^[a-z0-9-]+$), with no spaces, such as order-shipped. Unique. Left out, a new template's slug is made from its name and an existing template keeps its slug",
        examples: ["order-shipped"],
      }),
    ),
    subject: Type.String({ minLength: 1 }),
    html: Type.String(),
    text: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    variables: Type.Optional(Type.Array(Type.String())),
    sampleVariables: Type.Optional(variablesRecord),
    headerId: Type.Optional(
      Type.Union([Type.String({ format: "uuid" }), Type.Null()], {
        description: "The Header shown above this Template's content",
      }),
    ),
    footerId: Type.Optional(
      Type.Union([Type.String({ format: "uuid" }), Type.Null()], {
        description: "The Footer shown below this Template's content",
      }),
    ),
    configurationId: Type.Optional(
      Type.Union([Type.String({ format: "uuid" }), Type.Null()], {
        description:
          "The Configuration this Template is sent with: a send without a from address uses its from name and address",
      }),
    ),
    design: Type.Optional(
      Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()], {
        description:
          "The visual designer's blocks. Sending uses only html, so leave this out (or null) when html is written by hand",
      }),
    ),
  },
  { additionalProperties: false },
);

type TemplateBody = Static<typeof templateBody>;

const idParams = Type.Object({ id: Type.String({ format: "uuid" }) });

export const loadTemplate = async (
  database: Database,
  id: string,
): Promise<TemplateRow> => {
  const [row] = await database
    .select()
    .from(templates)
    .where(eq(templates.id, id));
  if (row === undefined) {
    throw new NotFoundError("The template");
  }
  return row;
};

export const loadTemplateByName = async (
  database: Database,
  name: string,
): Promise<TemplateRow> => {
  const [row] = await database
    .select()
    .from(templates)
    .where(eq(templates.name, name.trim()));
  if (row === undefined) {
    throw new NotFoundError(`The template "${name.trim()}"`);
  }
  return row;
};

export const loadTemplateBySlug = async (
  database: Database,
  slug: string,
): Promise<TemplateRow> => {
  const [row] = await database
    .select()
    .from(templates)
    .where(eq(templates.slug, slug));
  if (row === undefined) {
    throw new NotFoundError(`The template "${slug}"`);
  }
  return row;
};

/** Refuses a slug that breaks the rule, with a message saying what is allowed. */
const checkSlug = (slug: string | undefined) => {
  const problem = slug === undefined ? undefined : findSlugProblem(slug);
  if (problem !== undefined) {
    throw new ValidationFailedError([{ field: "slug", message: problem }]);
  }
};

/** The first free slug made from the name, such as order-shipped or order-shipped-2, for a template that gave none. */
export const findFreeSlug = async (
  database: Database,
  name: string,
): Promise<string> => {
  const base = slugify(name);
  const rows = await database
    .select({ slug: templates.slug })
    .from(templates)
    .where(
      or(
        eq(templates.slug, base),
        like(templates.slug, `${base.slice(0, 80)}-%`),
      ),
    );
  const taken = new Set(rows.map((row) => row.slug));
  return firstFreeSlug(base, (candidate) => taken.has(candidate));
};

const toTemplateValues = (body: TemplateBody) => ({
  name: body.name.trim(),
  subject: body.subject,
  html: body.html,
  text: body.text === undefined || body.text === "" ? null : body.text,
  variables: normaliseVariableNames(body.variables ?? []),
  sampleVariables: body.sampleVariables ?? {},
  design: body.design ?? null,
  headerId: body.headerId ?? null,
  footerId: body.footerId ?? null,
  configurationId: body.configurationId ?? null,
});

/** Refuses a Template whose Header, Footer or Configuration is missing, or that does not render with them. */
const checkTemplate = async (database: Database, body: TemplateBody) => {
  await loadTemplateConfiguration(database, body.configurationId);
  const { header, footer } = await loadTemplateParts(database, body);
  renderOrReject(
    {
      subject: body.subject,
      text: body.text,
      html: composeHtml(
        { subject: body.subject, html: body.html, design: body.design ?? null },
        header,
        footer,
      ),
    },
    body.sampleVariables ?? {},
  );
};

const isSlugTaken = (error: unknown) =>
  findViolatedConstraint(error) === "templates_slug_unique";

const rethrowDuplicate = (
  error: unknown,
  { name, slug }: { name: string; slug: string },
): never => {
  if (isSlugTaken(error)) {
    throw new RejectedRequestError(
      409,
      "template_slug_taken",
      `A template with the slug "${slug}" already exists`,
    );
  }
  if (isUniqueViolation(error)) {
    throw new RejectedRequestError(
      409,
      "template_name_taken",
      `A template called "${name.trim()}" already exists`,
    );
  }
  throw error;
};

/** How many times a made-up slug is tried again when another template takes it at the same moment. */
const slugAttempts = 3;

const renderOrReject = (
  content: Parameters<typeof renderTemplate>[0],
  variables: Record<string, unknown>,
) => {
  try {
    return renderTemplate(content, variables);
  } catch (error) {
    if (error instanceof TemplateRenderFailedError) {
      throw new ValidationFailedError([
        {
          field: "html",
          message: `The template does not render: ${error.message}`,
        },
      ]);
    }
    throw error;
  }
};

export const registerTemplateRoutes = (
  server: Server,
  { database }: { database: Database },
): void => {
  server.get(
    "/templates",
    { schema: { summary: "List templates", tags: ["Templates"] } },
    async () => ({
      templates: await database
        .select()
        .from(templates)
        .orderBy(asc(templates.name)),
    }),
  );

  server.get(
    "/templates/:id",
    {
      schema: {
        summary: "Read a template",
        tags: ["Templates"],
        params: idParams,
      },
    },
    async (request) => loadTemplate(database, request.params.id),
  );

  server.post(
    "/templates",
    {
      schema: {
        summary: "Create a template",
        tags: ["Templates"],
        body: templateBody,
      },
    },
    async (request, reply) => {
      const { body } = request;
      checkSlug(body.slug);
      await checkTemplate(database, body);
      for (let attempt = 1; ; attempt += 1) {
        const slug = body.slug ?? (await findFreeSlug(database, body.name));
        try {
          const [row] = await database
            .insert(templates)
            .values({ ...toTemplateValues(body), slug })
            .returning();
          return await reply.code(201).send(row);
        } catch (error) {
          if (
            body.slug === undefined &&
            attempt < slugAttempts &&
            isSlugTaken(error)
          ) {
            continue;
          }
          return rethrowDuplicate(error, { name: body.name, slug });
        }
      }
    },
  );

  server.put(
    "/templates/:id",
    {
      schema: {
        summary: "Replace a template",
        tags: ["Templates"],
        params: idParams,
        body: templateBody,
      },
    },
    async (request) => {
      const { body } = request;
      checkSlug(body.slug);
      await checkTemplate(database, body);
      try {
        const [row] = await database
          .update(templates)
          .set({
            ...toTemplateValues(body),
            ...(body.slug === undefined ? {} : { slug: body.slug }),
            updatedAt: new Date(),
          })
          .where(eq(templates.id, request.params.id))
          .returning();
        if (row === undefined) {
          throw new NotFoundError("The template");
        }
        return row;
      } catch (error) {
        return rethrowDuplicate(error, {
          name: body.name,
          slug: body.slug ?? "",
        });
      }
    },
  );

  server.delete(
    "/templates/:id",
    {
      schema: {
        summary: "Delete a template",
        tags: ["Templates"],
        params: idParams,
      },
    },
    async (request) => {
      const deleted = await database
        .delete(templates)
        .where(eq(templates.id, request.params.id))
        .returning({ id: templates.id });
      if (deleted.length === 0) {
        throw new NotFoundError("The template");
      }
      return {};
    },
  );

  server.post(
    "/templates/preview",
    {
      schema: {
        summary: "Render template content without saving it",
        tags: ["Templates"],
        body: Type.Object({
          subject: Type.String(),
          html: Type.String(),
          text: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          variables: Type.Optional(variablesRecord),
          design: Type.Optional(
            Type.Union([
              Type.Record(Type.String(), Type.Unknown()),
              Type.Null(),
            ]),
          ),
          headerId: Type.Optional(
            Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
          ),
          footerId: Type.Optional(
            Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
          ),
        }),
      },
    },
    async (request) => {
      const { header, footer } = await loadTemplateParts(
        database,
        request.body,
      );
      return renderOrReject(
        {
          ...request.body,
          html: composeHtml(
            {
              subject: request.body.subject,
              html: request.body.html,
              design: request.body.design ?? null,
            },
            header,
            footer,
          ),
        },
        request.body.variables ?? {},
      );
    },
  );
};
