import type { Database } from "../lib/database.js";
import { messages } from "../lib/schema.js";
import type { OutgoingEmail } from "../sending/delivery.js";

/**
 * Records a test send from Delivery as a Message of its own, sent or failed, with no Application (pen test I2a, #164).
 * A test send goes to the provider there and then, outside the queue, so without this its recipient was recorded
 * nowhere; now it shows in the Logs to every User, as a User notice does, and no API Key can read it.
 */
export const recordTestSend = async (
  database: Database,
  email: OutgoingEmail,
  outcome: { providerMessageId: string } | { error: string },
): Promise<void> => {
  await database.insert(messages).values({
    applicationId: null,
    from: email.from,
    to: [...email.to],
    subject: email.subject,
    html: email.html ?? null,
    text: email.text ?? null,
    attempts: 1,
    ...("error" in outcome
      ? { status: "failed", error: outcome.error }
      : {
          status: "sent",
          providerMessageId: outcome.providerMessageId,
          sentAt: new Date(),
        }),
  });
};
