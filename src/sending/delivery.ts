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
    // Credentials only ever cross TLS: without `secure`, STARTTLS is required whenever there is AUTH, so a server that
    // doesn't offer it, or a network that strips it, fails the send before the credentials are sent (pen test I5,
    // #186). With no username there is no AUTH, and a server with no TLS, such as Mailpit in development, still works.
    ...(smtp.username === undefined
      ? {}
      : {
          auth: { user: smtp.username, pass: smtp.password ?? "" },
          requireTLS: true,
        }),
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
