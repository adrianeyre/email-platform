import { lt } from "drizzle-orm";
import type { Database } from "../lib/database.js";
import { messages } from "../lib/schema.js";
import { readSettings } from "../settings/settings-store.js";

const dayMs = 86_400_000;

export const applyRetention = async (
  database: Database,
  now: Date,
): Promise<{ deletedMessages: number; cutoff: Date }> => {
  const { logRetentionDays } = await readSettings(database);
  const cutoff = new Date(now.getTime() - logRetentionDays * dayMs);
  const deleted = await database
    .delete(messages)
    .where(lt(messages.createdAt, cutoff))
    .returning({ id: messages.id });
  return { deletedMessages: deleted.length, cutoff };
};
