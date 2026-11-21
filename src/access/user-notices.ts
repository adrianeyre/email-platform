import { notInArray } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { Database } from "../lib/database.js";
import type { SignedInUser } from "../lib/http.js";
import type { JobQueue } from "../lib/jobs.js";
import { users } from "../lib/schema.js";
import { acceptMessage } from "../sending/accept-message.js";

export interface UserNoticeParts {
  database: Database;
  jobs: JobQueue;
  appUrl: URL;
}

export interface UserNotice {
  /** The signed-in User who made the change: they are not told. */
  actor: SignedInUser;
  /** What happened, such as "added the User a@example.com". */
  change: string;
  subject: string;
  /** Other Users not to tell, such as the one just added. */
  skipUserIds?: readonly string[];
}

/**
 * Emails every other User when a User adds or deletes a User or mints an API Key, so that a change made through one
 * stolen session raises an alarm with someone else (pen test A2, #125). Each notice is a Message of its own, queued
 * through the normal send path with no Application: it shows in the Logs to Users, as a test send does, and no API
 * Key can read it. It is sent from the default from address; when none is set, or queueing fails, the change still
 * stands and the failure is logged, because refusing to add a User over a missing notice would lock an operator out.
 */
export const noticeOtherUsers = async (
  { database, jobs, appUrl }: UserNoticeParts,
  log: FastifyBaseLogger,
  { actor, change, subject, skipUserIds = [] }: UserNotice,
): Promise<void> => {
  const recipients = await database
    .select({ email: users.email })
    .from(users)
    .where(notInArray(users.id, [actor.userId, ...skipUserIds]));
  const text = [
    `${actor.email} ${change} on the email platform at ${appUrl.origin}, at ${new Date().toISOString()}.`,
    "",
    `If you did not expect this, sign in, undo it, and ask ${actor.email} to change their password: someone else may be using their session.`,
  ].join("\n");
  for (const recipient of recipients) {
    try {
      await acceptMessage(
        { database, jobs },
        { to: [recipient.email], subject, text },
      );
    } catch (error) {
      log.warn({ err: error }, "access.user-notice.not-queued");
      return;
    }
  }
};
