import { eq } from "drizzle-orm";
import type { Database } from "../lib/database.js";
import { settings, type SettingsRow } from "../lib/schema.js";
import { decryptValue, encryptValue } from "../lib/secrets.js";

export { defaultFromAddress } from "./default-from.js";
export { defaultSmtpHost } from "./default-smtp.js";

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  username: string | undefined;
  password: string | undefined;
}

export interface PublicSettings {
  smtpHost: string | null;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string | null;
  hasSmtpPassword: boolean;
  defaultFrom: string | null;
  logRetentionDays: number;
  updatedAt: Date;
}

export interface SettingsChange {
  smtpHost?: string | null;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUsername?: string | null;
  smtpPassword?: string | null;
  defaultFrom?: string | null;
  logRetentionDays?: number;
}

const emptyToNull = (value: string | null | undefined) =>
  value === undefined
    ? undefined
    : value === null || value.trim() === ""
      ? null
      : value.trim();

export const readSettings = async (
  database: Database,
): Promise<SettingsRow> => {
  const [row] = await database
    .select()
    .from(settings)
    .where(eq(settings.id, 1));
  if (row !== undefined) {
    return row;
  }
  const [created] = await database
    .insert(settings)
    .values({ id: 1 })
    .onConflictDoNothing()
    .returning();
  return created ?? readSettings(database);
};

export const toPublicSettings = (row: SettingsRow): PublicSettings => ({
  smtpHost: row.smtpHost,
  smtpPort: row.smtpPort,
  smtpSecure: row.smtpSecure,
  smtpUsername: row.smtpUsername,
  hasSmtpPassword: row.smtpPasswordEncrypted !== null,
  defaultFrom: row.defaultFrom,
  logRetentionDays: row.logRetentionDays,
  updatedAt: row.updatedAt,
});

export const updateSettings = async (
  database: Database,
  encryptionKey: Buffer,
  change: SettingsChange,
): Promise<SettingsRow> => {
  await readSettings(database);
  const password = change.smtpPassword;
  const [row] = await database
    .update(settings)
    .set({
      smtpHost: emptyToNull(change.smtpHost),
      smtpPort: change.smtpPort,
      smtpSecure: change.smtpSecure,
      smtpUsername: emptyToNull(change.smtpUsername),
      smtpPasswordEncrypted:
        password === undefined
          ? undefined
          : password === null || password === ""
            ? null
            : encryptValue(encryptionKey, password),
      defaultFrom: emptyToNull(change.defaultFrom),
      logRetentionDays: change.logRetentionDays,
      updatedAt: new Date(),
    })
    .where(eq(settings.id, 1))
    .returning();
  if (row === undefined) {
    throw new Error("The settings were not saved");
  }
  return row;
};

export const readSmtpSettings = (
  row: SettingsRow,
  encryptionKey: Buffer,
): SmtpSettings | undefined =>
  row.smtpHost === null
    ? undefined
    : {
        host: row.smtpHost,
        port: row.smtpPort,
        secure: row.smtpSecure,
        username: row.smtpUsername ?? undefined,
        password:
          row.smtpPasswordEncrypted === null
            ? undefined
            : decryptValue(encryptionKey, row.smtpPasswordEncrypted),
      };
