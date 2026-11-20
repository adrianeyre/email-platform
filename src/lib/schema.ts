import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
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

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
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
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  lookupId: text("lookup_id").notNull().unique(),
  secretHash: text("secret_hash").notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: createdAt(),
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
    .defaultNow(),
});

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: createdAt(),
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
    idempotencyKey: text("idempotency_key").unique(),
  },
  (table) => [
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

export type UserRow = typeof users.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type SettingsRow = typeof settings.$inferSelect;
export type TemplateRow = typeof templates.$inferSelect;
export type EmailPartRow = typeof emailParts.$inferSelect;
export type ConfigurationRow = typeof configurations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
