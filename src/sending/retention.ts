import { and, eq, inArray, isNotNull, lt, or } from "drizzle-orm";
import type { Database } from "../lib/database.js";
import { messageAttachments, messages } from "../lib/schema.js";
import { readSettings } from "../settings/settings-store.js";

const dayMs = 86_400_000;

/**
 * The longest a Message keeps its body (HTML, text and attachments), whatever Retention is (pen test D2, #147; ADR
 * 0012). The worker drops it once a Message is sent or has finally failed; this bounds one left queued, by a stopped
 * worker or a lost job, so the working links in it don't last as long as Retention does. Every account link Wizzaroo
 * sends is dead well before this.
 */
export const messageBodyMaxDays = 7;

/** The error a Message gets when it is still queued once its body is dropped. It is never sent after. */
export const bodyDroppedError = `Not sent within ${String(messageBodyMaxDays)} days, so its body was dropped`;

export interface RetentionSummary {
  deletedMessages: number;
  cutoff: Date;
  /** Messages older than `messageBodyMaxDays` that still held a body, and no longer do. */
  droppedBodies: number;
  bodyCutoff: Date;
}

export const applyRetention = async (
  database: Database,
  now: Date,
): Promise<RetentionSummary> => {
  const { logRetentionDays } = await readSettings(database);
  const cutoff = new Date(now.getTime() - logRetentionDays * dayMs);
  const bodyCutoff = new Date(now.getTime() - messageBodyMaxDays * dayMs);
  return database.transaction(async (transaction) => {
    const deleted = await transaction
      .delete(messages)
      .where(lt(messages.createdAt, cutoff))
      .returning({ id: messages.id });
    const old = lt(messages.createdAt, bodyCutoff);
    const failedUnsent = await transaction
      .update(messages)
      .set({
        html: null,
        text: null,
        status: "failed",
        error: bodyDroppedError,
      })
      .where(and(old, eq(messages.status, "queued")))
      .returning({ id: messages.id });
    const stripped = await transaction
      .update(messages)
      .set({ html: null, text: null })
      .where(and(old, or(isNotNull(messages.html), isNotNull(messages.text))))
      .returning({ id: messages.id });
    const oldIds = transaction
      .select({ id: messages.id })
      .from(messages)
      .where(old);
    const withAttachments = await transaction
      .delete(messageAttachments)
      .where(inArray(messageAttachments.messageId, oldIds))
      .returning({ messageId: messageAttachments.messageId });
    const dropped = new Set([
      ...failedUnsent.map((row) => row.id),
      ...stripped.map((row) => row.id),
      ...withAttachments.map((row) => row.messageId),
    ]);
    return {
      deletedMessages: deleted.length,
      cutoff,
      droppedBodies: dropped.size,
      bodyCutoff,
    };
  });
};
