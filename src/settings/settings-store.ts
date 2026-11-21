import { eq } from "drizzle-orm";
import type { Database } from "../lib/database.js";
import { settings, type SettingsRow } from "../lib/schema.js";
import { decryptValue, encryptValue } from "../lib/secrets.js";
import { SendSettingsError } from "../sending/send-failure.js";

export { defaultFromAddress } from "./default-from.js";

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
  /** A password is saved, but this server's ENCRYPTION_KEY can't open it (#167). */
  isSmtpPasswordUnreadable: boolean;
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

/** What a refusal says when the saved SMTP password won't open: the variable to look at, and the two ways back. */
export const smtpPasswordUnreadableMessage =
  "The saved SMTP password can't be read with ENCRYPTION_KEY: enter it again under Delivery, or start with the key it was saved under";

/** The saved SMTP password was sealed under another ENCRYPTION_KEY, or is damaged (#167). */
export class SmtpPasswordUnreadableError extends SendSettingsError {
  override name = "SmtpPasswordUnreadableError";
}

const openSmtpPassword = (encryptionKey: Buffer, sealed: string): string => {
  try {
    return decryptValue(encryptionKey, sealed);
  } catch (error) {
    throw new SmtpPasswordUnreadableError(smtpPasswordUnreadableMessage, {
      cause: error,
    });
  }
};

const isUnreadable = (encryptionKey: Buffer, sealed: string | null) => {
  if (sealed === null) {
    return false;
  }
  try {
    openSmtpPassword(encryptionKey, sealed);
    return false;
  } catch {
    return true;
  }
};

export const toPublicSettings = (
  row: SettingsRow,
  encryptionKey: Buffer,
): PublicSettings => ({
  smtpHost: row.smtpHost,
  smtpPort: row.smtpPort,
  smtpSecure: row.smtpSecure,
  smtpUsername: row.smtpUsername,
  hasSmtpPassword: row.smtpPasswordEncrypted !== null,
  isSmtpPasswordUnreadable: isUnreadable(
    encryptionKey,
    row.smtpPasswordEncrypted,
  ),
  defaultFrom: row.defaultFrom,
  logRetentionDays: row.logRetentionDays,
  updatedAt: row.updatedAt,
});

/** The saved SMTP password was kept while the host or port it is sent to changed (#185). */
export class SmtpPasswordRequiredError extends Error {
  override name = "SmtpPasswordRequiredError";

  constructor() {
    super(
      "Enter the SMTP password again: changing the host or port doesn't keep the saved one",
    );
  }
}

/**
 * Whether `change` would send the saved SMTP password to another host or port than it was saved for. The password
 * is write-only, so a User who could repoint the provider and keep it would have it sent to a server of their own in
 * the AUTH exchange (pen test I5, #185): repointing it asks for the password again, or for none.
 */
const isSavedPasswordRepointed = (
  current: SettingsRow,
  change: SettingsChange,
): boolean => {
  if (
    current.smtpPasswordEncrypted === null ||
    change.smtpPassword !== undefined
  ) {
    return false;
  }
  const host =
    change.smtpHost === undefined
      ? current.smtpHost
      : (emptyToNull(change.smtpHost) ?? null);
  const port = change.smtpPort ?? current.smtpPort;
  // With no host left, the password goes nowhere.
  return (
    host !== null &&
    (host.toLowerCase() !== current.smtpHost?.toLowerCase() ||
      port !== current.smtpPort)
  );
};

export const updateSettings = async (
  database: Database,
  encryptionKey: Buffer,
  change: SettingsChange,
): Promise<SettingsRow> => {
  await readSettings(database);
  const password = change.smtpPassword;
  return database.transaction(async (transaction) => {
    // Locked, so no other save changes the host or the password between this check and the update.
    const [current] = await transaction
      .select()
      .from(settings)
      .where(eq(settings.id, 1))
      .for("update");
    if (current !== undefined && isSavedPasswordRepointed(current, change)) {
      throw new SmtpPasswordRequiredError();
    }
    const [row] = await transaction
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
  });
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
            : openSmtpPassword(encryptionKey, row.smtpPasswordEncrypted),
      };

const readSealedSmtpPassword = async (
  database: Database,
): Promise<string | null> => {
  const [row] = await database
    .select({ sealed: settings.smtpPasswordEncrypted })
    .from(settings)
    .where(eq(settings.id, 1));
  return row?.sealed ?? null;
};

/**
 * Refuses to go on when a saved SMTP password won't open with `encryptionKey`, naming ENCRYPTION_KEY. The api and
 * worker call it at boot, so a changed key stops them there rather than failing every Message later (#167).
 */
export const checkSmtpPasswordOpens = async (
  database: Database,
  encryptionKey: Buffer,
): Promise<void> => {
  if (isUnreadable(encryptionKey, await readSealedSmtpPassword(database))) {
    throw new Error(
      "ENCRYPTION_KEY can't open the saved SMTP password. Start with the key it was saved under, or reseal it with `cli smtp-password:reseal` (docs/operations/backups-and-restore.md#changing-encryption_key)",
    );
  }
};

/**
 * Opens the saved SMTP password with `oldKey` and seals it again with `newKey`: the rotation path for ENCRYPTION_KEY
 * (#167). Answers what it did; refuses, changing nothing, when `oldKey` can't open it either.
 */
export const resealSmtpPassword = async (
  database: Database,
  oldKey: Buffer,
  newKey: Buffer,
): Promise<"resealed" | "already-sealed" | "none-saved"> => {
  const sealed = await readSealedSmtpPassword(database);
  if (sealed === null) {
    return "none-saved";
  }
  if (!isUnreadable(newKey, sealed)) {
    return "already-sealed";
  }
  const password = openSmtpPassword(oldKey, sealed);
  await database
    .update(settings)
    .set({
      smtpPasswordEncrypted: encryptValue(newKey, password),
      updatedAt: new Date(),
    })
    .where(eq(settings.id, 1));
  return "resealed";
};

/** Removes the saved SMTP password, for when the key it was sealed under is lost: enter it again under Delivery. */
export const forgetSmtpPassword = async (database: Database): Promise<void> => {
  await database
    .update(settings)
    .set({ smtpPasswordEncrypted: null, updatedAt: new Date() })
    .where(eq(settings.id, 1));
};
