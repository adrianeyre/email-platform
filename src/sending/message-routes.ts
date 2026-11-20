import { and, count, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { Type } from "typebox";
import type { Database } from "../lib/database.js";
import { NotFoundError, type Server } from "../lib/http.js";
import type { JobQueue } from "../lib/jobs.js";
import { messages, type MessageRow } from "../lib/schema.js";
import { acceptMessage } from "./accept-message.js";

export interface MessageRouteParts {
  database: Database;
  jobs: JobQueue;
}

const emailAddress = Type.String({ minLength: 3, maxLength: 320 });
const idParams = Type.Object({ id: Type.String({ format: "uuid" }) });
const pageSize = 50;

const sendBody = Type.Object(
  {
    from: Type.Optional(
      Type.String({
        minLength: 3,
        maxLength: 320,
        description:
          "Optional. Left out, a template's Configuration gives the from address, then the default from address in Delivery",
      }),
    ),
    to: Type.Array(emailAddress, { minItems: 1, maxItems: 50 }),
    cc: Type.Optional(Type.Array(emailAddress, { maxItems: 50 })),
    bcc: Type.Optional(Type.Array(emailAddress, { maxItems: 50 })),
    replyTo: Type.Optional(emailAddress),
    subject: Type.Optional(Type.String({ maxLength: 998 })),
    html: Type.Optional(Type.String()),
    text: Type.Optional(Type.String()),
    templateId: Type.Optional(Type.String({ format: "uuid" })),
    templateName: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 200,
        description:
          "Send the template with this name instead of templateId, so an application can use the same name in every install",
      }),
    ),
    templateSlug: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 100,
        description:
          "Send the template with this slug, such as order-shipped, instead of templateId or templateName. A slug stays the same when the template is renamed, so it is the steadiest way for an application to name a template",
        examples: ["order-shipped"],
      }),
    ),
    variables: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    attachments: Type.Optional(
      Type.Array(
        Type.Object({
          filename: Type.String({ minLength: 1 }),
          contentType: Type.Optional(Type.String()),
          content: Type.String({ description: "Base64-encoded content" }),
        }),
      ),
    ),
  },
  { additionalProperties: false },
);

const sendHeaders = Type.Object({
  "idempotency-key": Type.Optional(
    Type.String({ minLength: 1, maxLength: 255 }),
  ),
});

export const summariseMessage = (message: MessageRow) => ({
  id: message.id,
  createdAt: message.createdAt,
  templateId: message.templateId,
  from: message.from,
  to: message.to,
  cc: message.cc,
  bcc: message.bcc,
  replyTo: message.replyTo,
  subject: message.subject,
  status: message.status,
  providerMessageId: message.providerMessageId,
  error: message.error,
  attempts: message.attempts,
  sentAt: message.sentAt,
});

const loadMessage = async (database: Database, id: string) => {
  const [row] = await database
    .select()
    .from(messages)
    .where(eq(messages.id, id));
  if (row === undefined) {
    throw new NotFoundError("The message");
  }
  return row;
};

export const registerSendRoutes = (
  server: Server,
  parts: MessageRouteParts,
): void => {
  server.post(
    "/messages",
    {
      schema: {
        summary: "Send an email",
        description:
          "Queues an email for the SMTP provider. Send one of templateSlug, templateName or templateId with variables, or subject with html and/or text. The from address is the request's from, else the template's Configuration's from name and address, else the default from address in Delivery. A repeated Idempotency-Key returns the first message instead of sending again.",
        tags: ["Messages"],
        body: sendBody,
        headers: sendHeaders,
      },
    },
    async (request, reply) => {
      const { message, isRepeat } = await acceptMessage(
        parts,
        request.body,
        request.headers["idempotency-key"],
      );
      return reply.code(isRepeat ? 200 : 202).send(summariseMessage(message));
    },
  );

  server.get(
    "/messages/:id",
    {
      schema: {
        summary: "Read a message's status",
        tags: ["Messages"],
        params: idParams,
      },
    },
    async (request) =>
      summariseMessage(await loadMessage(parts.database, request.params.id)),
  );
};

export const registerLogRoutes = (
  server: Server,
  parts: MessageRouteParts,
): void => {
  server.get(
    "/messages",
    {
      schema: {
        querystring: Type.Object({
          search: Type.Optional(Type.String()),
          status: Type.Optional(
            Type.Union([
              Type.Literal("queued"),
              Type.Literal("sent"),
              Type.Literal("failed"),
            ]),
          ),
          after: Type.Optional(Type.String({ format: "date-time" })),
          before: Type.Optional(Type.String({ format: "date-time" })),
          page: Type.Optional(Type.Integer({ minimum: 1 })),
        }),
      },
    },
    async (request) => {
      const { search, status, after, before } = request.query;
      const page = request.query.page ?? 1;
      const conditions: SQL[] = [];
      if (search !== undefined && search.trim() !== "") {
        const pattern = `%${search.trim().replace(/[\\%_]/g, "\\$&")}%`;
        conditions.push(
          sql`(${messages.subject} ilike ${pattern} or array_to_string(${messages.to} || ${messages.cc} || ${messages.bcc}, ' ') ilike ${pattern} or ${messages.from} ilike ${pattern})`,
        );
      }
      if (status !== undefined) {
        conditions.push(eq(messages.status, status));
      }
      if (after !== undefined) {
        conditions.push(gte(messages.createdAt, new Date(after)));
      }
      if (before !== undefined) {
        conditions.push(lt(messages.createdAt, new Date(before)));
      }
      const where = and(...conditions);
      const [rows, [total]] = await Promise.all([
        parts.database
          .select()
          .from(messages)
          .where(where)
          .orderBy(desc(messages.createdAt), desc(messages.id))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        parts.database.select({ total: count() }).from(messages).where(where),
      ]);
      return {
        messages: rows.map(summariseMessage),
        page,
        pageSize,
        total: total?.total ?? 0,
      };
    },
  );

  server.get(
    "/messages/:id",
    { schema: { params: idParams } },
    async (request) => {
      const message = await loadMessage(parts.database, request.params.id);
      return {
        ...summariseMessage(message),
        html: message.html,
        text: message.text,
      };
    },
  );

  server.post(
    "/templates/:id/test",
    {
      schema: {
        params: idParams,
        body: Type.Object({
          to: emailAddress,
          variables: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
        }),
      },
    },
    async (request, reply) => {
      const { message } = await acceptMessage(parts, {
        to: [request.body.to],
        templateId: request.params.id,
        variables: request.body.variables ?? {},
      });
      return reply.code(202).send(summariseMessage(message));
    },
  );
};
