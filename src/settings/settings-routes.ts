import { Type } from "typebox";
import type { Database } from "../lib/database.js";
import {
  describeError,
  RejectedRequestError,
  type Server,
} from "../lib/http.js";
import type { SendEmail } from "../sending/delivery.js";
import {
  readSettings,
  readSmtpSettings,
  toPublicSettings,
  updateSettings,
} from "./settings-store.js";

export interface SettingsRouteParts {
  database: Database;
  encryptionKey: Buffer;
  sendEmail: SendEmail;
}

const nullableText = Type.Union([Type.String(), Type.Null()]);

export const registerSettingsRoutes = (
  server: Server,
  { database, encryptionKey, sendEmail }: SettingsRouteParts,
): void => {
  server.get("/settings", async () =>
    toPublicSettings(await readSettings(database)),
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
    async (request) =>
      toPublicSettings(
        await updateSettings(database, encryptionKey, request.body),
      ),
  );

  server.post(
    "/settings/test",
    {
      schema: {
        body: Type.Object({ to: Type.String({ format: "email" }) }),
      },
    },
    async (request) => {
      const row = await readSettings(database);
      const smtp = readSmtpSettings(row, encryptionKey);
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
      try {
        const result = await sendEmail(smtp, {
          from: row.defaultFrom,
          to: [request.body.to],
          cc: [],
          bcc: [],
          replyTo: undefined,
          subject: "Test email",
          html: undefined,
          text: "Your SMTP settings work: this test email was delivered.",
          attachments: [],
        });
        return { providerMessageId: result.providerMessageId };
      } catch (error) {
        throw new RejectedRequestError(
          502,
          "smtp_failed",
          `The SMTP provider refused the test email: ${describeError(error)}`,
        );
      }
    },
  );
};
