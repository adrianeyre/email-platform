import { createTransport } from "nodemailer";
import type { SmtpSettings } from "../settings/settings-store.js";

export interface OutgoingEmail {
  from: string;
  to: readonly string[];
  cc: readonly string[];
  bcc: readonly string[];
  replyTo: string | undefined;
  subject: string;
  html: string | undefined;
  text: string | undefined;
  attachments: readonly {
    filename: string;
    contentType: string;
    content: Buffer;
  }[];
}

export interface DeliveryResult {
  providerMessageId: string;
}

export type SendEmail = (
  smtp: SmtpSettings,
  email: OutgoingEmail,
) => Promise<DeliveryResult>;

const connectionTimeoutMs = 30_000;

export const sendEmailOverSmtp: SendEmail = async (smtp, email) => {
  const transport = createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    connectionTimeout: connectionTimeoutMs,
    greetingTimeout: connectionTimeoutMs,
    socketTimeout: connectionTimeoutMs,
    ...(smtp.username === undefined
      ? {}
      : { auth: { user: smtp.username, pass: smtp.password ?? "" } }),
  });
  try {
    const info = await transport.sendMail({
      from: email.from,
      to: [...email.to],
      cc: [...email.cc],
      bcc: [...email.bcc],
      ...(email.replyTo === undefined ? {} : { replyTo: email.replyTo }),
      subject: email.subject,
      ...(email.html === undefined ? {} : { html: email.html }),
      ...(email.text === undefined ? {} : { text: email.text }),
      attachments: email.attachments.map((attachment) => ({
        filename: attachment.filename,
        contentType: attachment.contentType,
        content: attachment.content,
      })),
    });
    return { providerMessageId: info.messageId };
  } finally {
    transport.close();
  }
};

export const isPermanentSmtpFailure = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const responseCode: unknown = Reflect.get(error, "responseCode");
  return typeof responseCode === "number" && responseCode >= 500;
};
