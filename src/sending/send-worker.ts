import { eq } from "drizzle-orm";
import type { Database } from "../lib/database.js";
import { describeError } from "../lib/http.js";
import { messageAttachments, messages } from "../lib/schema.js";
import { readSettings, readSmtpSettings } from "../settings/settings-store.js";
import { isPermanentSmtpFailure, type SendEmail } from "./delivery.js";

export interface SendWorkerParts {
  database: Database;
  encryptionKey: Buffer;
  sendEmail: SendEmail;
}

export interface RetryState {
  retryCount: number;
  retryLimit: number;
}

export type SendOutcome = "sent" | "failed" | "skipped";

export class SmtpNotConfiguredError extends Error {
  override name = "SmtpNotConfiguredError";
}

export class SendWillBeRetriedError extends Error {
  override name = "SendWillBeRetriedError";
}

export const sendQueuedMessage = async (
  { database, encryptionKey, sendEmail }: SendWorkerParts,
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
    const isFinal =
      isPermanentSmtpFailure(error) || retry.retryCount >= retry.retryLimit;
    await database.transaction(async (transaction) => {
      await transaction
        .update(messages)
        .set({
          attempts,
          error: describeError(error),
          ...(isFinal ? { status: "failed" } : {}),
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
    throw new SendWillBeRetriedError(describeError(error), { cause: error });
  }
};
