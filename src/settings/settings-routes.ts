import { Type } from "typebox";
import type { Database } from "../lib/database.js";
import { countTestSend } from "../access/request-limits.js";
import {
  getSignedInUser,
  RejectedRequestError,
  type Server,
  ValidationFailedError,
} from "../lib/http.js";
import { rateLimitHeaders } from "../lib/rate-limit.js";
import type { OutgoingEmail, SendEmail } from "../sending/delivery.js";
import {
  classifySendFailure,
  describeSendFailureForLog,
} from "../sending/send-failure.js";
import { recordTestSend } from "./test-send-record.js";
import {
  readSettings,
  readSmtpSettings,
  SmtpPasswordRequiredError,
  SmtpPasswordUnreadableError,
  toPublicSettings,
  updateSettings,
} from "./settings-store.js";

export interface SettingsRouteParts {
  database: Database;
  encryptionKey: Buffer;
  sendEmail: SendEmail;
}

const nullableText = Type.Union([Type.String(), Type.Null()]);

/** The saved SMTP settings, or a 409 naming ENCRYPTION_KEY when the saved password won't open with it (#167). */
const readTestSmtpSettings = (
  ...args: Parameters<typeof readSmtpSettings>
): ReturnType<typeof readSmtpSettings> => {
  try {
    return readSmtpSettings(...args);
  } catch (error) {
    if (error instanceof SmtpPasswordUnreadableError) {
      throw new RejectedRequestError(
        409,
        "smtp_password_unreadable",
        error.message,
      );
    }
    throw error;
  }
};

export const registerSettingsRoutes = (
  server: Server,
  { database, encryptionKey, sendEmail }: SettingsRouteParts,
): void => {
  server.get("/settings", async () =>
    toPublicSettings(await readSettings(database), encryptionKey),
  );

  server.put(
    "/settings",
    {
      schema: {
        body: Type.Object(
          {
            smtpHost: Type.Optional(nullableText),
            smtpPort: Type.Optional(
              Type.Integer({ minimum: 1, maximum: 65_535 }),
            ),
            smtpSecure: Type.Optional(Type.Boolean()),
            smtpUsername: Type.Optional(nullableText),
            smtpPassword: Type.Optional(nullableText),
            defaultFrom: Type.Optional(nullableText),
            logRetentionDays: Type.Optional(
              Type.Integer({ minimum: 1, maximum: 3650 }),
            ),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request) => {
      try {
        return toPublicSettings(
          await updateSettings(database, encryptionKey, request.body),
          encryptionKey,
        );
      } catch (error) {
        if (error instanceof SmtpPasswordRequiredError) {
          throw new ValidationFailedError([
            { field: "smtpPassword", message: error.message },
          ]);
        }
        throw error;
      }
    },
  );

  server.post(
    "/settings/test",
    {
      schema: {
        body: Type.Object({ to: Type.String({ format: "email" }) }),
      },
    },
    async (request, reply) => {
      const row = await readSettings(database);
      const smtp = readTestSmtpSettings(row, encryptionKey);
      if (smtp === undefined) {
        throw new RejectedRequestError(
          409,
          "smtp_not_configured",
          "Set the SMTP host before sending a test email",
        );
      }
      if (row.defaultFrom === null) {
        throw new RejectedRequestError(
          409,
          "default_from_missing",
          "Set the default from address before sending a test email",
        );
      }
      // Only a try that reaches the provider is counted, against the User's test sends (pen test I2a, #164).
      void reply.headers(
        rateLimitHeaders(
          await countTestSend(database, getSignedInUser(request).userId),
        ),
      );
      const email: OutgoingEmail = {
        from: row.defaultFrom,
        to: [request.body.to],
        cc: [],
        bcc: [],
        replyTo: undefined,
        subject: "Test email",
        html: undefined,
        text: "Your SMTP settings work: this test email was delivered.",
        attachments: [],
      };
      let providerMessageId: string;
      try {
        ({ providerMessageId } = await sendEmail(smtp, email));
      } catch (error) {
        // Told by its class only, as a Message's error is: the provider's reply or Node's network error would tell a
        // User which internal hosts and ports answer, and how (pen test I5, #184). The server log keeps the codes.
        const { summary } = classifySendFailure(error);
        request.log.warn(
          { smtp: describeSendFailureForLog(error) },
          "settings.test_send.failed",
        );
        await recordTestSend(database, email, { error: summary });
        throw new RejectedRequestError(
          502,
          "smtp_failed",
          `The test email was not sent: ${summary}`,
        );
      }
      await recordTestSend(database, email, { providerMessageId });
      return { providerMessageId };
    },
  );
};
