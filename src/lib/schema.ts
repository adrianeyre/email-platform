import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { defaultFromAddress } from "../settings/default-from.js";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const messageStatuses = ["queued", "sent", "failed"] as const;
export type MessageStatus = (typeof messageStatuses)[number];

/**
 * Who made or last changed a row, kept as a bare ID with no foreign key so the record outlives the User or API Key it
 * names: deleting a User or revoking a leaked key is exactly when it is needed (pen test A2 #125, K1 #132).
 */
const madeBy = (name: string) => uuid(name);

/**
 * A request-rate token bucket kept on its owner's row (pen test I2a, #162): what is left of its burst, and when that was
 * last worked out. Both null until the first request counted, which finds the burst full.
 */
const requestBucket = () => ({
  requestTokens: doublePrecision("request_tokens"),
  requestTokensAt: timestamp("request_tokens_at", { withTimezone: true }),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
  /** The User who added this one. Null when the CLI made it, or it was made before this was recorded. */
  createdByUserId: madeBy("created_by_user_id"),
  /** The User's `/app` requests (pen test I2a, #162), counted across the deployment. */
  ...requestBucket(),
  /** The User's test sends (#164): the start of their current one-hour window and how many they made in it. */
  testSendWindowStartedAt: timestamp("test_send_window_started_at", {
    withTimezone: true,
  }),
  testSendWindowCount: integer("test_send_window_count").notNull().default(0),
});

export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    /** When the session was last used, written at most every few minutes: an idle session is refused (pen test A1, #143). */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

/**
 * What a sign-in or step-up throttle knows about one key (an address, an address and an email, or a User): the times of
 * its counted tries or failures in the last 15 minutes, oldest first, and for an address what is left of its burst.
 */
export interface ThrottleState {
  times: number[];
  tokens?: number;
  at?: number;
}

/**
 * The sign-in and step-up throttles (pen test A1, #142), in Postgres so every api process counts against one figure and
 * a restart forgets nothing. A row is deleted once its 15-minute window has passed with nothing in it.
 */
export const throttleKeys = pgTable(
  "throttle_keys",
  {
    key: text("key").primaryKey(),
    state: jsonb("state").$type<ThrottleState>().notNull(),
    /** When the row's last try or failure leaves its window, after which it can be deleted. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("throttle_keys_expires_at_idx").on(table.expiresAt)],
);

/**
 * An Application: one system that sends through the platform, such as Wizzaroo. Its API Keys can change only its own
 * Templates, Headers and Footers, send only from its Configurations' addresses (or the default), and read only its
 * Messages (ADR 0009).
 */
export const applications = pgTable("applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  createdAt: createdAt(),
});

/** The Application that owns a row: null when a User made it for no Application, so no API Key can change it. */
const ownedBy = () =>
  uuid("application_id").references(() => applications.id, {
    onDelete: "set null",
  });

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** The Application the key acts for. An Application that has keys can't be deleted. */
  applicationId: uuid("application_id")
    .notNull()
    .references(() => applications.id, { onDelete: "restrict" }),
  lookupId: text("lookup_id").notNull().unique(),
  secretHash: text("secret_hash").notNull(),
  /** Written at most once a minute, so a key's every call is not a write on its row (pen test K1, #133). */
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  /**
   * The key's send limit (pen test K1, #133): the start of its current one-minute window and the recipient addresses
   * it has sent to in it. Kept on the key's row so every api process counts against one figure.
   */
  sendWindowStartedAt: timestamp("send_window_started_at", {
    withTimezone: true,
  }),
  sendWindowRecipients: integer("send_window_recipients").notNull().default(0),
  /** The key's other `/v1` requests (pen test I2a, #162), counted on its row across the deployment. */
  ...requestBucket(),
  /** The key's Template previews (#162): the start of its current one-minute window and how many it made in it. */
  previewWindowStartedAt: timestamp("preview_window_started_at", {
    withTimezone: true,
  }),
  previewWindowCount: integer("preview_window_count").notNull().default(0),
  createdAt: createdAt(),
  /** The User who minted it. Null when the CLI made it, or it was made before this was recorded. */
  createdByUserId: madeBy("created_by_user_id"),
});

export const settings = pgTable(
  "settings",
  {
    id: integer("id").primaryKey().default(1),
    smtpHost: text("smtp_host"),
    smtpPort: integer("smtp_port").notNull().default(587),
    smtpSecure: boolean("smtp_secure").notNull().default(false),
    smtpUsername: text("smtp_username"),
    smtpPasswordEncrypted: text("smtp_password_encrypted"),
    defaultFrom: text("default_from").default(defaultFromAddress),
    logRetentionDays: integer("log_retention_days").notNull().default(90),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [check("settings_single_row", sql`${table.id} = 1`)],
);

export const emailPartKinds = ["header", "footer"] as const;
export type EmailPartKind = (typeof emailPartKinds)[number];

/** A Header or Footer: content shared by Templates, above or below their own. */
export const emailParts = pgTable(
  "email_parts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: emailPartKinds }).notNull(),
    name: text("name").notNull(),
    applicationId: ownedBy(),
    html: text("html").notNull(),
    design: jsonb("design").$type<Record<string, unknown>>(),
    sampleVariables: jsonb("sample_variables")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** The API Key that last made or changed it, when one did. */
    updatedByApiKeyId: madeBy("updated_by_api_key_id"),
    /** The User who last made or changed it, when one did. Both are null for the CLI and for rows older than this. */
    updatedByUserId: madeBy("updated_by_user_id"),
  },
  (table) => [
    unique("email_parts_kind_name_unique").on(table.kind, table.name),
    check("email_parts_kind_check", sql`${table.kind} in ('header', 'footer')`),
  ],
);

/** A Configuration: settings shared by Templates, such as the address they are sent from. */
export const configurations = pgTable("configurations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  /** The Application whose API Keys may send from this address. */
  applicationId: ownedBy(),
  fromEmail: text("from_email").notNull(),
  fromName: text("from_name").notNull().default(""),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const templates = pgTable("templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  /** What applications send it by: lowercase letters, numbers and hyphens, such as "order-shipped". */
  slug: text("slug").notNull().unique(),
  applicationId: ownedBy(),
  subject: text("subject").notNull(),
  html: text("html").notNull(),
  text: text("text"),
  variables: text("variables").array().notNull().default([]),
  sampleVariables: jsonb("sample_variables")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  /** The visual designer's blocks, when the HTML was made in it. Sending uses only the HTML. */
  design: jsonb("design").$type<Record<string, unknown>>(),
  /** Shown above the Template's content when it is sent. */
  headerId: uuid("header_id").references(() => emailParts.id, {
    onDelete: "set null",
  }),
  /** Shown below the Template's content when it is sent. */
  footerId: uuid("footer_id").references(() => emailParts.id, {
    onDelete: "set null",
  }),
  /** Sends from its address when the request gives no from address. */
  configurationId: uuid("configuration_id").references(
    () => configurations.id,
    { onDelete: "set null" },
  ),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow() /** The API Key that last made or changed it, when one did. */,
  updatedByApiKeyId: madeBy("updated_by_api_key_id"),
  /** The User who last made or changed it, when one did. Both are null for the CLI and for rows older than this. */
  updatedByUserId: madeBy("updated_by_user_id"),
});

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: createdAt(),
    /** The Application that sent it: only its API Keys can read it. Null when a User sent it from the UI. */
    applicationId: ownedBy(),
    /** The API Key that sent it, while that key exists. */
    apiKeyId: uuid("api_key_id").references(() => apiKeys.id, {
      onDelete: "set null",
    }),
    templateId: uuid("template_id").references(() => templates.id, {
      onDelete: "set null",
    }),
    from: text("from").notNull(),
    to: text("to").array().notNull(),
    cc: text("cc").array().notNull().default([]),
    bcc: text("bcc").array().notNull().default([]),
    replyTo: text("reply_to"),
    subject: text("subject").notNull(),
    html: text("html"),
    text: text("text"),
    status: text("status", { enum: messageStatuses })
      .notNull()
      .default("queued"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** Unique within the Application that sent it, so one Application's key never finds another's Message. */
    idempotencyKey: text("idempotency_key"),
    /**
     * The SHA-256 of the request that sent it, when it had an Idempotency-Key, so the key repeated with another body
     * is refused (pen test S2, #135). Null for a Message stored before it was kept.
     */
    requestFingerprint: text("request_fingerprint"),
  },
  (table) => [
    unique("messages_application_idempotency_key_unique").on(
      table.applicationId,
      table.idempotencyKey,
    ),
    index("messages_created_at_idx").on(table.createdAt),
    index("messages_status_idx").on(table.status),
  ],
);

export const messageAttachments = pgTable(
  "message_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    content: bytea("content").notNull(),
  },
  (table) => [index("message_attachments_message_id_idx").on(table.messageId)],
);

export type ApplicationRow = typeof applications.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type SettingsRow = typeof settings.$inferSelect;
export type TemplateRow = typeof templates.$inferSelect;
export type EmailPartRow = typeof emailParts.$inferSelect;
export type ConfigurationRow = typeof configurations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
