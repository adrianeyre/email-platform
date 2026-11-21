import { eq } from "drizzle-orm";
import type { Database } from "../lib/database.js";
import { messageAttachments, messages } from "../lib/schema.js";
import { readSettings, readSmtpSettings } from "../settings/settings-store.js";
import type { SendEmail } from "./delivery.js";
import { classifySendFailure, SendSettingsError } from "./send-failure.js";

export interface SendWorkerParts {
  database: Database;
  encryptionKey: Buffer;
  sendEmail: SendEmail;
  /** Told of each failed try, for the server's own log: the Message keeps only the failure's class (#173). */
  onSendFailed?: (messageId: string, error: unknown) => void;
}

export interface RetryState {
  retryCount: number;
  retryLimit: number;
}

export type SendOutcome = "sent" | "failed" | "skipped";

export class SmtpNotConfiguredError extends SendSettingsError {
  override name = "SmtpNotConfiguredError";
}

export class SendWillBeRetriedError extends Error {
  override name = "SendWillBeRetriedError";
}

/**
 * What a Message stops keeping once it is sent or has finally failed: its body. Nothing reads the body after the
 * provider has it, and a failed Message is never sent again, so keeping it would only keep the links in it (#116).
 * Its attachments go too, in the same transaction.
 */
const droppedBody = { html: null, text: null } as const;

export const sendQueuedMessage = async (
  { database, encryptionKey, sendEmail, onSendFailed }: SendWorkerParts,
  messageId: string,
  retry: RetryState,
): Promise<SendOutcome> => {
  const [message] = await database
    .select()
    .from(messages)
    .where(eq(messages.id, messageId));
  if (message?.status !== "queued") {
    return "skipped";
  }
  const attempts = message.attempts + 1;
  try {
    const smtp = readSmtpSettings(await readSettings(database), encryptionKey);
    if (smtp === undefined) {
      throw new SmtpNotConfiguredError(
        "No SMTP provider is configured: set one in Settings",
      );
    }
    const attachments = await database
      .select()
      .from(messageAttachments)
      .where(eq(messageAttachments.messageId, message.id));
    const result = await sendEmail(smtp, {
      from: message.from,
      to: message.to,
      cc: message.cc,
      bcc: message.bcc,
      replyTo: message.replyTo ?? undefined,
      subject: message.subject,
      html: message.html ?? undefined,
      text: message.text ?? undefined,
      attachments,
    });
    await database.transaction(async (transaction) => {
      await transaction
        .update(messages)
        .set({
          ...droppedBody,
          status: "sent",
          attempts,
          error: null,
          providerMessageId: result.providerMessageId,
          sentAt: new Date(),
        })
        .where(eq(messages.id, message.id));
      await transaction
        .delete(messageAttachments)
        .where(eq(messageAttachments.messageId, message.id));
    });
    return "sent";
  } catch (error) {
    onSendFailed?.(message.id, error);
    // The Message keeps the failure's class, never the provider's reply or Node's network error (#173, #184).
    const failure = classifySendFailure(error);
    const isFinal = failure.isPermanent || retry.retryCount >= retry.retryLimit;
    await database.transaction(async (transaction) => {
      await transaction
        .update(messages)
        .set({
          attempts,
          error: failure.summary,
          ...(isFinal ? { ...droppedBody, status: "failed" } : {}),
        })
        .where(eq(messages.id, message.id));
      if (isFinal) {
        await transaction
          .delete(messageAttachments)
          .where(eq(messageAttachments.messageId, message.id));
      }
    });
    if (isFinal) {
      return "failed";
    }
    throw new SendWillBeRetriedError(failure.summary, { cause: error });
  }
};
