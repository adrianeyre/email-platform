import { and, count, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { Type } from "typebox";
import type { Database } from "../lib/database.js";
import {
  largeBodyLimit,
  NotFoundError,
  type CallingApiKey,
  type Server,
} from "../lib/http.js";
import type { JobQueue } from "../lib/jobs.js";
import { messages, type MessageRow } from "../lib/schema.js";
import { maxSubjectLength } from "../templates/render.js";
import {
  acceptMessage,
  maxAttachmentContentTypeLength,
  maxAttachmentFilenameLength,
  maxAttachments,
} from "./accept-message.js";
import { rateLimitHeaders } from "../lib/rate-limit.js";

export interface MessageRouteParts {
  database: Database;
  jobs: JobQueue;
}

const emailAddress = Type.String({ minLength: 3, maxLength: 320 });
const idParams = Type.Object({ id: Type.String({ format: "uuid" }) });
const pageSize = 50;

/**
 * The last page the Logs list asks for: its offset, (page - 1) × 50, stays an exact integer well inside Postgres's
 * bigint, so a page past it is refused by the schema instead of failing in Postgres (pen test D1, #157).
 */
export const maxLogPage = Math.floor(Number.MAX_SAFE_INTEGER / pageSize);

/**
 * A Logs date filter: a date-time in the years 1000 to 2999, which Postgres's timestamptz holds whatever the offset.
 * The year 0000, which ISO 8601 allows and Postgres doesn't, is refused by the schema (pen test D1, #157).
 */
const logDate = Type.String({ format: "date-time", pattern: "^[12]\\d{3}-" });

const sendBody = Type.Object(
  {
    from: Type.Optional(
      Type.String({
        minLength: 3,
        maxLength: 320,
        description:
          "Optional. Left out, a template's Configuration gives the from address, then the default from address in Delivery. Whichever it is, it must be an address one of the API key's Application's Configurations names, or the default from address; any other is refused with 422",
      }),
    ),
    to: Type.Array(emailAddress, { minItems: 1, maxItems: 50 }),
    cc: Type.Optional(Type.Array(emailAddress, { maxItems: 50 })),
    bcc: Type.Optional(Type.Array(emailAddress, { maxItems: 50 })),
    replyTo: Type.Optional(emailAddress),
    subject: Type.Optional(
      Type.String({
        maxLength: maxSubjectLength,
        description:
          "Raw content's subject, up to 998 characters. A template's subject is held to the same 998 once rendered with the variables, or the send is refused with 422",
      }),
    ),
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
          filename: Type.String({
            minLength: 1,
            maxLength: maxAttachmentFilenameLength,
          }),
          contentType: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: maxAttachmentContentTypeLength,
              description:
                "One MIME type, such as application/pdf or text/plain; charset=utf-8. Left out, it is application/octet-stream. Anything else, a multipart type among them, is refused with 422",
            }),
          ),
          content: Type.String({ description: "Base64-encoded content" }),
        }),
        { maxItems: maxAttachments },
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

/** A Message by ID. An API Key finds only its own Application's; any other answers 404, as an unknown ID does. */
const loadMessage = async (
  database: Database,
  id: string,
  caller: CallingApiKey | null,
) => {
  const [row] = await database
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.id, id),
        caller === null
          ? undefined
          : eq(messages.applicationId, caller.applicationId),
      ),
    );
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
      bodyLimit: largeBodyLimit,
      schema: {
        summary: "Send an email",
        description:
          "Queues an email for the SMTP provider. Send one of templateSlug, templateName or templateId with variables, or subject with html and/or text. The from address is the request's from, else the template's Configuration's from name and address, else the default from address in Delivery; it must be one the API key's Application may send from (one of its Configurations' addresses, or the default), or the send is refused with 422. Each to, cc and bcc entry is one address, such as \"Ada <ada@example.com>\"; a list or group in one entry is refused with 422. A template is rendered with the variables within a bound: a rendered subject over 998 characters, HTML or text over 1,000,000, a subject, HTML or text holding more than 50,000 characters of Handlebars expressions, or a render doing more work than one may, is refused with 422 on the template field. Up to 100 attachments, each with a filename of 1 to 255 characters and an optional contentType of one MIME type of up to 255; anything else is refused with 422. A repeated Idempotency-Key from the same Application with the same request returns its first message with 200 instead of sending again, and with a different request is refused with 409; another Application's key is never found. An API key may send to a limited number of recipient addresses (to, cc and bcc together) a minute: RateLimit-Limit, RateLimit-Remaining and RateLimit-Reset report it, and a send past it is refused with 429 and Retry-After.",
        tags: ["Messages"],
        body: sendBody,
        headers: sendHeaders,
      },
    },
    async (request, reply) => {
      // A refusal's RateLimit headers, like its body and Retry-After, are the error handler's.
      const { message, isRepeat, allowance } = await acceptMessage(
        parts,
        request.body,
        request.headers["idempotency-key"],
        request.apiKey ?? undefined,
      );
      if (allowance !== undefined) {
        reply.headers(rateLimitHeaders(allowance));
      }
      return reply.code(isRepeat ? 200 : 202).send(summariseMessage(message));
    },
  );

  server.get(
    "/messages/:id",
    {
      schema: {
        summary: "Read a message's status",
        description:
          "Only a message the API key's own Application sent can be read; any other answers 404, as an unknown ID does.",
        tags: ["Messages"],
        params: idParams,
      },
    },
    async (request) =>
      summariseMessage(
        await loadMessage(parts.database, request.params.id, request.apiKey),
      ),
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
          after: Type.Optional(logDate),
          before: Type.Optional(logDate),
          page: Type.Optional(
            Type.Integer({ minimum: 1, maximum: maxLogPage }),
          ),
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
      const message = await loadMessage(
        parts.database,
        request.params.id,
        request.apiKey,
      );
      // Only a queued Message keeps its body: the worker drops it once the Message is sent or has finally failed (#116).
      const isBodyKept = message.status === "queued";
      return {
        ...summariseMessage(message),
        isBodyKept,
        html: isBodyKept ? message.html : null,
        text: isBodyKept ? message.text : null,
      };
    },
  );

  server.post(
    "/templates/:id/test",
    {
      // A test send carries the Template's sample variables, which are as large as the Template allows.
      bodyLimit: largeBodyLimit,
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
