import { eq } from "drizzle-orm";
import type { Database } from "../lib/database.js";
import {
  isUniqueViolation,
  RejectedRequestError,
  ValidationFailedError,
  type FieldError,
} from "../lib/http.js";
import type { JobQueue } from "../lib/jobs.js";
import {
  messageAttachments,
  messages,
  type MessageRow,
} from "../lib/schema.js";
import {
  checkRequiredVariables,
  htmlToText,
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

export const maxMessageBytes = 25 * 1024 * 1024;

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
}

const base64Pattern = /^[A-Za-z0-9+/\r\n]*={0,2}$/;

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
        throw new ValidationFailedError([
          {
            field: templateField,
            message: `The template does not render: ${error.message}`,
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

const findByIdempotencyKey = async (
  database: Database,
  idempotencyKey: string,
): Promise<MessageRow | undefined> => {
  const [row] = await database
    .select()
    .from(messages)
    .where(eq(messages.idempotencyKey, idempotencyKey));
  return row;
};

export const acceptMessage = async (
  { database, jobs }: AcceptParts,
  request: SendRequest,
  idempotencyKey?: string,
): Promise<AcceptedMessage> => {
  if (idempotencyKey !== undefined) {
    const existing = await findByIdempotencyKey(database, idempotencyKey);
    if (existing !== undefined) {
      return { message: existing, isRepeat: true };
    }
  }
  const { content, configurationFrom } = await buildContent(database, request);
  // The request's from address wins, then the Template's Configuration, then the default in Delivery.
  const from =
    request.from ??
    configurationFrom ??
    (await readSettings(database)).defaultFrom;
  if (from === null) {
    throw new ValidationFailedError([
      {
        field: "from",
        message: "Send a from address or set a default one in Settings",
      },
    ]);
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
    const message = await database.transaction(async (transaction) => {
      const [row] = await transaction
        .insert(messages)
        .values({
          ...content,
          from,
          to: [...request.to],
          cc: [...(request.cc ?? [])],
          bcc: [...(request.bcc ?? [])],
          replyTo: request.replyTo ?? null,
          idempotencyKey: idempotencyKey ?? null,
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
      return row;
    });
    return { message, isRepeat: false };
  } catch (error) {
    if (idempotencyKey !== undefined && isUniqueViolation(error)) {
      const existing = await findByIdempotencyKey(database, idempotencyKey);
      if (existing !== undefined) {
        return { message: existing, isRepeat: true };
      }
    }
    throw error;
  }
};
