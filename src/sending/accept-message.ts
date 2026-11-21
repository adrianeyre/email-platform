import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import addressparser from "nodemailer/lib/addressparser";
import type { Database } from "../lib/database.js";
import {
  isUniqueViolation,
  RejectedRequestError,
  ValidationFailedError,
  type CallingApiKey,
  type FieldError,
} from "../lib/http.js";
import type { JobQueue } from "../lib/jobs.js";
import {
  configurations,
  messageAttachments,
  messages,
  type MessageRow,
} from "../lib/schema.js";
import {
  checkRequiredVariables,
  htmlToText,
  RenderedContentTooLongError,
  renderTemplate,
  TemplateRenderFailedError,
} from "../templates/render.js";
import {
  loadTemplate,
  loadTemplateByName,
  loadTemplateBySlug,
} from "../templates/template-routes.js";
import { templateContentWithParts } from "../templates/part-routes.js";
import {
  formatFromAddress,
  loadTemplateConfiguration,
} from "../templates/configuration-routes.js";
import { readSettings } from "../settings/settings-store.js";
import {
  checkRecipientCount,
  countSend,
  recipientsPerKeyPerMinute,
  type SendAllowance,
} from "./send-limit.js";

export const maxMessageBytes = 25 * 1024 * 1024;

/**
 * The most attachments one Message may have (pen test S1, #150). They are stored in one INSERT of four parameters
 * each, so this also keeps it far below Postgres's 65,535 parameters, which 16,384 attachments broke with a 500.
 */
export const maxAttachments = 100;
export const maxAttachmentFilenameLength = 255;
export const maxAttachmentContentTypeLength = 255;

/*
 * One MIME type, RFC 2045's `type/subtype` with optional `; name=value` parameters: tokens of printable ASCII other
 * than its specials, and a value either a token or a quoted string. No control character, CR and LF among them, can be
 * in it, so it can't add a header to the attachment's part. Only the parameters' whitespace can repeat, and it can't
 * be read two ways, so the pattern is linear.
 */
const mimeToken = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";
const mimeQuoted = String.raw`"(?:[^"\\\p{Cc}]|\\[^\p{Cc}])*"`;
const mimeTypePattern = new RegExp(
  `^${mimeToken}/${mimeToken}(?:[ \\t]*;[ \\t]*${mimeToken}=(?:${mimeToken}|${mimeQuoted}))*[ \\t]*$`,
  "u",
);

/** Whether a contentType is one MIME type an attachment may have. A multipart type is a container, never one file. */
export const isAttachmentContentType = (contentType: string): boolean =>
  mimeTypePattern.test(contentType) &&
  !contentType.toLowerCase().startsWith("multipart/");

export interface AttachmentInput {
  filename: string;
  contentType?: string;
  content: string;
}

export interface SendRequest {
  from?: string;
  to: readonly string[];
  cc?: readonly string[];
  bcc?: readonly string[];
  replyTo?: string;
  subject?: string;
  html?: string;
  text?: string;
  templateId?: string;
  templateName?: string;
  templateSlug?: string;
  variables?: Readonly<Record<string, unknown>>;
  attachments?: readonly AttachmentInput[];
}

export interface AcceptParts {
  database: Database;
  jobs: JobQueue;
}

export interface AcceptedMessage {
  message: MessageRow;
  isRepeat: boolean;
  /** Where the sending API Key stands against its send limit, when this send was counted. */
  allowance?: SendAllowance;
}

/** A repeated Idempotency-Key whose request differs from the first's (pen test S2, #135). */
export class IdempotencyKeyReusedError extends RejectedRequestError {
  override name = "IdempotencyKeyReusedError";

  constructor() {
    super(
      409,
      "idempotency_key_reused",
      "This Idempotency-Key was sent before with a different request. Send a new key for a different message",
    );
  }
}

/** JSON with every object's keys in order, so the same request written in another key order reads the same. */
const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "object" && item !== null && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).toSorted(([a], [b]) => (a < b ? -1 : 1)),
        )
      : item,
  );

/**
 * The SHA-256 of a send request, kept with a Message sent with an Idempotency-Key so a repeat can be told from a
 * different request. A left-out cc, bcc or attachments list is the same request as an empty one.
 */
export const fingerprintRequest = (request: SendRequest): string =>
  createHash("sha256")
    .update(
      canonicalJson({
        ...request,
        cc: request.cc ?? [],
        bcc: request.bcc ?? [],
        attachments: request.attachments ?? [],
      }),
    )
    .digest("hex");

/**
 * The first Message for a repeated Idempotency-Key, when the request is the same. A Message stored before
 * fingerprints were kept has none, and is answered as a repeat whatever the request, as it was then: such Messages
 * leave with Retention.
 */
const replayOrRefuse = (
  existing: MessageRow,
  fingerprint: string,
): AcceptedMessage => {
  if (
    existing.requestFingerprint !== null &&
    existing.requestFingerprint !== fingerprint
  ) {
    throw new IdempotencyKeyReusedError();
  }
  return { message: existing, isRepeat: true };
};

/** Control characters, NUL, CR and LF among them: none belongs in an address. */
const controlCharacter = /\p{Cc}/u;
const plainAddress = /^[^\s@]+@[^\s@]+$/u;

/**
 * Whether an entry is exactly one mailbox, such as `ada@example.com` or `"Lovelace, Ada" <ada@example.com>`. Nodemailer
 * reads an entry as an address list, so a list or a group in one entry would reach every address in it, past the
 * recipient cap and unseen by the log (pen test S1, #134). It is parsed here the way Nodemailer will parse it.
 */
const isOneMailbox = (entry: string): boolean => {
  if (controlCharacter.test(entry)) {
    return false;
  }
  const [item, ...more] = addressparser(entry);
  return (
    item !== undefined &&
    more.length === 0 &&
    !("group" in item) &&
    plainAddress.test(item.address)
  );
};

/** Refuses any to, cc or bcc entry that isn't exactly one mailbox. */
const checkRecipients = (request: SendRequest) => {
  const problems = (["to", "cc", "bcc"] as const).flatMap((field) =>
    (request[field] ?? []).flatMap((entry, index) =>
      isOneMailbox(entry)
        ? []
        : [
            {
              field: `${field}.${String(index)}`,
              message: `Send one address in each ${field} entry, such as "Ada <ada@example.com>"; a list or group of addresses isn't accepted`,
            },
          ],
    ),
  );
  if (problems.length > 0) {
    throw new ValidationFailedError(problems);
  }
};

const base64Pattern = /^[A-Za-z0-9+/\r\n]*={0,2}$/;

/** Refuses too many attachments, or one whose filename or contentType is too long or whose contentType isn't one type. */
const checkAttachments = (attachments: readonly AttachmentInput[]) => {
  if (attachments.length > maxAttachments) {
    throw new ValidationFailedError([
      {
        field: "attachments",
        message: `Send at most ${String(maxAttachments)} attachments`,
      },
    ]);
  }
  const problems = attachments.flatMap(
    ({ filename, contentType }, index): FieldError[] => [
      ...(filename.length > maxAttachmentFilenameLength
        ? [
            {
              field: `attachments.${String(index)}.filename`,
              message: `A filename may have at most ${String(maxAttachmentFilenameLength)} characters`,
            },
          ]
        : []),
      ...(contentType === undefined ||
      (contentType.length <= maxAttachmentContentTypeLength &&
        isAttachmentContentType(contentType))
        ? []
        : [
            {
              field: `attachments.${String(index)}.contentType`,
              message: `Send one MIME type of at most ${String(maxAttachmentContentTypeLength)} characters, such as application/pdf or text/plain; charset=utf-8`,
            },
          ]),
    ],
  );
  if (problems.length > 0) {
    throw new ValidationFailedError(problems);
  }
};

const decodeAttachments = (attachments: readonly AttachmentInput[]) => {
  const problems: FieldError[] = [];
  const decoded = attachments.map((attachment, index) => {
    if (!base64Pattern.test(attachment.content)) {
      problems.push({
        field: `attachments.${String(index)}.content`,
        message: `Attachment "${attachment.filename}" is not base64`,
      });
    }
    return {
      filename: attachment.filename,
      contentType: attachment.contentType ?? "application/octet-stream",
      content: Buffer.from(attachment.content, "base64"),
    };
  });
  if (problems.length > 0) {
    throw new ValidationFailedError(problems);
  }
  return decoded;
};

const buildContent = async (
  database: Database,
  request: SendRequest,
): Promise<{
  content: {
    templateId: string | null;
    subject: string;
    html: string | null;
    text: string | null;
  };
  /** The from address of the Template's Configuration, when it has one. */
  configurationFrom: string | undefined;
}> => {
  const templateFields = (
    ["templateId", "templateName", "templateSlug"] as const
  ).filter((field) => request[field] !== undefined);
  const [templateField, ...extraTemplateFields] = templateFields;
  if (extraTemplateFields.length > 0) {
    throw new ValidationFailedError(
      extraTemplateFields.map((field) => ({
        field,
        message:
          "Send only one of templateId, templateName or templateSlug, not more",
      })),
    );
  }
  if (templateField !== undefined) {
    const rawFields = (["subject", "html", "text"] as const).filter(
      (field) => request[field] !== undefined,
    );
    if (rawFields.length > 0) {
      throw new ValidationFailedError(
        rawFields.map((field) => ({
          field,
          message: `Send either ${templateField} or ${field}, not both`,
        })),
      );
    }
    const template =
      request.templateSlug !== undefined
        ? await loadTemplateBySlug(database, request.templateSlug)
        : request.templateName !== undefined
          ? await loadTemplateByName(database, request.templateName)
          : await loadTemplate(database, request.templateId ?? "");
    const variables = request.variables ?? {};
    const missing = checkRequiredVariables(template.variables, variables);
    if (missing.length > 0) {
      throw new ValidationFailedError(missing);
    }
    const configuration = await loadTemplateConfiguration(
      database,
      template.configurationId,
    );
    try {
      const rendered = renderTemplate(
        await templateContentWithParts(database, template),
        variables,
      );
      return {
        content: { templateId: template.id, ...rendered },
        configurationFrom:
          configuration === undefined
            ? undefined
            : formatFromAddress(configuration),
      };
    } catch (error) {
      if (error instanceof TemplateRenderFailedError) {
        // A rendered subject over 998 characters, or HTML or text over 1,000,000, is refused before it is stored
        // (pen test S1, #152; S3, #137).
        throw new ValidationFailedError([
          {
            field: templateField,
            message:
              error instanceof RenderedContentTooLongError
                ? error.message
                : `The template does not render: ${error.message}`,
          },
        ]);
      }
      throw error;
    }
  }
  const problems: FieldError[] = [];
  if (request.subject === undefined || request.subject.trim() === "") {
    problems.push({
      field: "subject",
      message: "Send a subject or a templateId",
    });
  }
  if (request.html === undefined && request.text === undefined) {
    problems.push({
      field: "html",
      message: "Send html, text or a templateId",
    });
  }
  if (problems.length > 0) {
    throw new ValidationFailedError(problems);
  }
  return {
    content: {
      templateId: null,
      subject: request.subject ?? "",
      html: request.html ?? null,
      text:
        request.text ??
        (request.html === undefined ? null : htmlToText(request.html)),
    },
    configurationFrom: undefined,
  };
};

/** An Idempotency-Key is the sending Application's own: another Application's Message with the same key is not found. */
const findByIdempotencyKey = async (
  database: Database,
  idempotencyKey: string,
  sender: CallingApiKey | undefined,
): Promise<MessageRow | undefined> => {
  const [row] = await database
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.idempotencyKey, idempotencyKey),
        sender === undefined
          ? isNull(messages.applicationId)
          : eq(messages.applicationId, sender.applicationId),
      ),
    );
  return row;
};

/** Every address in a from header, lowercased, read the way Nodemailer reads it when it sends. */
const readFromAddresses = (from: string): string[] =>
  addressparser(from, { flatten: true }).map((item) =>
    item.address.trim().toLowerCase(),
  );

/**
 * Refuses a from address the sending Application may not use (ADR 0009): every address in it must be one of its
 * Configurations' or the default from address. It is checked after the from is resolved, so another Application's
 * Template or Configuration can't be used to send as that Application either.
 */
const checkSenderMayUseFrom = async (
  database: Database,
  sender: CallingApiKey,
  from: string,
  defaultFrom: string | null,
) => {
  const owned = await database
    .select({ fromEmail: configurations.fromEmail })
    .from(configurations)
    .where(eq(configurations.applicationId, sender.applicationId));
  const allowed = new Set([
    ...owned.map((row) => row.fromEmail.trim().toLowerCase()),
    ...(defaultFrom === null ? [] : readFromAddresses(defaultFrom)),
  ]);
  const addresses = readFromAddresses(from);
  if (
    addresses.length === 0 ||
    addresses.some((address) => address === "" || !allowed.has(address))
  ) {
    throw new ValidationFailedError([
      {
        field: "from",
        message:
          "This API key's application can't send from this address. Send from an address one of its Configurations names, or the default from address",
      },
    ]);
  }
};

/**
 * Stores a Message and queues it. `sender` is the API Key sending it, which may send only from its Application's
 * addresses and finds only its Application's Idempotency-Keys; a User's test send from the UI has none.
 */
export const acceptMessage = async (
  { database, jobs }: AcceptParts,
  request: SendRequest,
  idempotencyKey?: string,
  sender?: CallingApiKey,
): Promise<AcceptedMessage> => {
  const fingerprint =
    idempotencyKey === undefined ? null : fingerprintRequest(request);
  if (idempotencyKey !== undefined && fingerprint !== null) {
    const existing = await findByIdempotencyKey(
      database,
      idempotencyKey,
      sender,
    );
    if (existing !== undefined) {
      return replayOrRefuse(existing, fingerprint);
    }
  }
  checkRecipients(request);
  checkAttachments(request.attachments ?? []);
  const recipients =
    request.to.length + (request.cc?.length ?? 0) + (request.bcc?.length ?? 0);
  if (sender !== undefined) {
    checkRecipientCount(recipients, recipientsPerKeyPerMinute);
  }
  const { content, configurationFrom } = await buildContent(database, request);
  const { defaultFrom } = await readSettings(database);
  // The request's from address wins, then the Template's Configuration, then the default in Delivery.
  const from = request.from ?? configurationFrom ?? defaultFrom;
  if (from === null) {
    throw new ValidationFailedError([
      {
        field: "from",
        message: "Send a from address or set a default one in Settings",
      },
    ]);
  }
  if (sender !== undefined) {
    await checkSenderMayUseFrom(database, sender, from, defaultFrom);
  }
  const attachments = decodeAttachments(request.attachments ?? []);
  const totalBytes = attachments.reduce(
    (sum, attachment) => sum + attachment.content.length,
    Buffer.byteLength(content.html ?? "") +
      Buffer.byteLength(content.text ?? ""),
  );
  if (totalBytes > maxMessageBytes) {
    throw new RejectedRequestError(
      413,
      "message_too_large",
      "The message is larger than the 25 MB limit",
    );
  }
  try {
    return await database.transaction(async (transaction) => {
      // Counted with the Message stored, so a send refused or failed below counts nothing. A User's test send from
      // the UI has no key and isn't counted here.
      const allowance =
        sender === undefined
          ? undefined
          : await countSend(
              transaction,
              sender.apiKeyId,
              recipients,
              recipientsPerKeyPerMinute,
            );
      const [row] = await transaction
        .insert(messages)
        .values({
          ...content,
          applicationId: sender?.applicationId ?? null,
          apiKeyId: sender?.apiKeyId ?? null,
          from,
          to: [...request.to],
          cc: [...(request.cc ?? [])],
          bcc: [...(request.bcc ?? [])],
          replyTo: request.replyTo ?? null,
          idempotencyKey: idempotencyKey ?? null,
          requestFingerprint: fingerprint,
        })
        .returning();
      if (row === undefined) {
        throw new Error("The message was not stored");
      }
      if (attachments.length > 0) {
        await transaction.insert(messageAttachments).values(
          attachments.map((attachment) => ({
            ...attachment,
            messageId: row.id,
          })),
        );
      }
      await jobs.enqueue(transaction, "send-message", { messageId: row.id });
      return {
        message: row,
        isRepeat: false,
        ...(allowance === undefined ? {} : { allowance }),
      };
    });
  } catch (error) {
    if (
      idempotencyKey !== undefined &&
      fingerprint !== null &&
      isUniqueViolation(error)
    ) {
      const existing = await findByIdempotencyKey(
        database,
        idempotencyKey,
        sender,
      );
      if (existing !== undefined) {
        return replayOrRefuse(existing, fingerprint);
      }
    }
    throw error;
  }
};
