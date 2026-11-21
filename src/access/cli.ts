import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import type { Database } from "../lib/database.js";
import { and, eq, inArray, isNull, notExists } from "drizzle-orm";
import { configurations, emailParts, templates } from "../lib/schema.js";
import { findOrCreateApplication } from "./applications.js";
import {
  builtInConfiguration,
  builtInEmails,
  builtInParts,
  toPartBody,
  toTemplateBody,
} from "../templates/built-in-emails.js";
import {
  forgetSmtpPassword,
  resealSmtpPassword,
  SmtpPasswordUnreadableError,
} from "../settings/settings-store.js";
import { createApiKey } from "./api-keys.js";
import { createUser } from "./users.js";

export class CliCommandRefusedError extends Error {
  override name = "CliCommandRefusedError";
}

export type ReadPassword = (prompt: string) => Promise<string>;

export const usage = [
  "Commands:",
  "  user:create <email>    create a user; prompts for the password",
  "  apikey:create <name> [--application <name>]",
  "                         create an API key for an application (made if new; the key's name if left out) and print it once",
  "  templates:add-built-ins [--application <name>]",
  "                         add the built-in header, footer, configuration and emails that are not there yet,",
  "                         and give them all to the application, so its API keys can change them and send from them",
  "  templates:update-built-ins [--application <name>]",
  "                         replace the built-in header, footer, configuration and emails with this version's",
  "  smtp-password:reseal   after changing ENCRYPTION_KEY: prompts for the old key, and seals the saved SMTP password",
  "                         again under ENCRYPTION_KEY",
  "  smtp-password:forget   remove the saved SMTP password, when the key it was saved under is lost; enter it again",
  "                         under Delivery",
].join("\n");

const encryptionKeyBytes = 32;

/** The rotation path for ENCRYPTION_KEY (#167): reseal the saved SMTP password under it, or forget it. */
const runSmtpPasswordCommand = async (
  database: Database,
  command: "reseal" | "forget",
  readPassword: ReadPassword,
  encryptionKey: Buffer | undefined,
): Promise<string> => {
  if (command === "forget") {
    await forgetSmtpPassword(database);
    return "Removed the saved SMTP password. Enter it again under Delivery.";
  }
  if (encryptionKey === undefined) {
    throw new CliCommandRefusedError("Set ENCRYPTION_KEY to the new key");
  }
  const oldKey = Buffer.from(
    await readPassword(
      "The ENCRYPTION_KEY the SMTP password was saved under: ",
    ),
    "base64",
  );
  if (oldKey.length !== encryptionKeyBytes) {
    throw new CliCommandRefusedError(
      `The old key must be ${String(encryptionKeyBytes)} bytes encoded as base64`,
    );
  }
  try {
    const outcome = await resealSmtpPassword(database, oldKey, encryptionKey);
    return {
      resealed: "Sealed the saved SMTP password again under ENCRYPTION_KEY.",
      "already-sealed":
        "The saved SMTP password already opens with ENCRYPTION_KEY; nothing changed.",
      "none-saved": "No SMTP password is saved; nothing changed.",
    }[outcome];
  } catch (error) {
    if (error instanceof SmtpPasswordUnreadableError) {
      throw new CliCommandRefusedError(
        "The old key can't open the saved SMTP password either; nothing changed",
      );
    }
    throw error;
  }
};

/** The value after `--application`, and the arguments without it. */
const readApplicationOption = (
  args: readonly string[],
): { application: string | undefined; rest: string[] } => {
  const index = args.indexOf("--application");
  if (index === -1) {
    return { application: undefined, rest: [...args] };
  }
  const application = args[index + 1];
  if (application === undefined || application.trim() === "") {
    throw new CliCommandRefusedError("Give --application a name");
  }
  return {
    application,
    rest: args.filter((_arg, at) => at !== index && at !== index + 1),
  };
};

export const runCliCommand = async (
  database: Database,
  args: readonly string[],
  readPassword: ReadPassword,
  /** ENCRYPTION_KEY, which the `smtp-password:reseal` command seals under. */
  encryptionKey?: Buffer,
): Promise<string> => {
  const { application, rest } = readApplicationOption(args);
  const [command, value] = rest;
  if (
    command === "smtp-password:reseal" ||
    command === "smtp-password:forget"
  ) {
    return runSmtpPasswordCommand(
      database,
      command === "smtp-password:reseal" ? "reseal" : "forget",
      readPassword,
      encryptionKey,
    );
  }
  if (command === "user:create" && value !== undefined) {
    const password = await readPassword("Password: ");
    if (
      process.stdin.isTTY &&
      (await readPassword("Repeat password: ")) !== password
    ) {
      throw new CliCommandRefusedError("The passwords do not match");
    }
    try {
      const user = await createUser(database, value, password);
      return `Created user ${user.email}`;
    } catch (error) {
      throw new CliCommandRefusedError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  if (command === "apikey:create" && value !== undefined) {
    const { apiKey, secret } = await createApiKey(database, value, application);
    return `Created API key "${apiKey.name}". Store it now; it is not shown again:\n${secret}`;
  }
  if (command === "templates:add-built-ins") {
    return withBuiltInsGivenTo(
      database,
      application,
      await addBuiltInTemplates(database),
    );
  }
  if (command === "templates:update-built-ins") {
    return withBuiltInsGivenTo(
      database,
      application,
      await updateBuiltInTemplates(database),
    );
  }
  throw new CliCommandRefusedError(usage);
};

/** Adds the built-in Headers and Footers that are missing, and returns every built-in part's ID by kind and name. */
const ensureBuiltInParts = async (database: Database, isReplacing: boolean) => {
  for (const part of builtInParts) {
    const values = { ...toPartBody(part), kind: part.kind };
    const insert = database.insert(emailParts).values(values);
    await (isReplacing
      ? insert.onConflictDoUpdate({
          target: [emailParts.kind, emailParts.name],
          set: {
            html: values.html,
            design: values.design,
            updatedAt: new Date(),
          },
        })
      : insert.onConflictDoNothing({
          target: [emailParts.kind, emailParts.name],
        }));
  }
  const rows = await database
    .select({ id: emailParts.id, kind: emailParts.kind, name: emailParts.name })
    .from(emailParts);
  return (kind: "header" | "footer", name: string) =>
    rows.find((row) => row.kind === kind && row.name === name)?.id ?? null;
};

/** Adds the built-in Configuration when it is missing, or replaces its from address, and returns its ID. */
const ensureBuiltInConfiguration = async (
  database: Database,
  isReplacing: boolean,
): Promise<string | null> => {
  const values = { ...builtInConfiguration };
  const insert = database.insert(configurations).values(values);
  await (isReplacing
    ? insert.onConflictDoUpdate({
        target: configurations.name,
        set: {
          fromEmail: values.fromEmail,
          fromName: values.fromName,
          updatedAt: new Date(),
        },
      })
    : insert.onConflictDoNothing({ target: configurations.name }));
  const [row] = await database
    .select({ id: configurations.id })
    .from(configurations)
    .where(eq(configurations.name, values.name));
  return row?.id ?? null;
};

const builtInTemplateValues = (
  findPart: (kind: "header" | "footer", name: string) => string | null,
  configurationId: string | null,
) =>
  builtInEmails.map((email) =>
    toTemplateBody(email, {
      headerId: findPart("header", email.headerName),
      footerId: findPart("footer", email.footerName),
      configurationId,
    }),
  );

/** Renames built-in emails added before their "Wizzaroo - " prefix, keeping their IDs, unless the new name is taken. */
const renamePreviousBuiltIns = async (database: Database) => {
  for (const email of builtInEmails) {
    await database
      .update(templates)
      .set({ name: email.name })
      .where(
        and(
          eq(templates.name, email.previousName),
          notExists(
            database
              .select({ id: templates.id })
              .from(templates)
              .where(eq(templates.name, email.name)),
          ),
        ),
      );
  }
};

/**
 * Adds the built-in Header, Footer and Configuration, then each built-in email as a Template using them, skipping any whose name or
 * slug is taken, so it can run again safely.
 */
export const addBuiltInTemplates = async (
  database: Database,
): Promise<string> => {
  await renamePreviousBuiltIns(database);
  const findPart = await ensureBuiltInParts(database, false);
  const configurationId = await ensureBuiltInConfiguration(database, false);
  const added = await database
    .insert(templates)
    .values(builtInTemplateValues(findPart, configurationId))
    .onConflictDoNothing()
    .returning({ name: templates.name });
  // Built-in emails added before there were Configurations get the built-in one too.
  await database
    .update(templates)
    .set({ configurationId })
    .where(
      and(
        inArray(
          templates.name,
          builtInEmails.map((email) => email.name),
        ),
        isNull(templates.configurationId),
      ),
    );
  const skipped = builtInEmails.length - added.length;
  return [
    `Added ${String(added.length)} built-in email templates${added.length === 0 ? "" : `: ${added.map((row) => row.name).join(", ")}`}.`,
    ...(skipped === 0
      ? []
      : [`Skipped ${String(skipped)} whose name or slug is already used.`]),
  ].join("\n");
};

/**
 * Replaces the built-in Header, Footer, Configuration and emails with this version's, keeping their IDs, and adds any missing. Each
 * built-in email gets its slug unless another template already has it; a missing one whose slug is taken is skipped.
 */
export const updateBuiltInTemplates = async (
  database: Database,
): Promise<string> => {
  await renamePreviousBuiltIns(database);
  const findPart = await ensureBuiltInParts(database, true);
  const configurationId = await ensureBuiltInConfiguration(database, true);
  const skipped: string[] = [];
  for (const values of builtInTemplateValues(findPart, configurationId)) {
    const [existing] = await database
      .select({ id: templates.id, slug: templates.slug })
      .from(templates)
      .where(eq(templates.name, values.name));
    const [slugOwner] = await database
      .select({ id: templates.id })
      .from(templates)
      .where(eq(templates.slug, values.slug));
    if (existing === undefined) {
      if (slugOwner === undefined) {
        await database.insert(templates).values(values);
      } else {
        skipped.push(values.name);
      }
      continue;
    }
    await database
      .update(templates)
      .set({
        slug:
          slugOwner === undefined || slugOwner.id === existing.id
            ? values.slug
            : existing.slug,
        subject: values.subject,
        html: values.html,
        text: values.text,
        variables: values.variables,
        sampleVariables: values.sampleVariables,
        design: values.design,
        headerId: values.headerId,
        footerId: values.footerId,
        configurationId: values.configurationId,
        updatedAt: new Date(),
      })
      .where(eq(templates.id, existing.id));
  }
  return [
    `Updated ${String(builtInParts.length)} built-in headers and footers and ${String(builtInEmails.length - skipped.length)} built-in email templates.`,
    ...(skipped.length === 0
      ? []
      : [
          `Skipped ${String(skipped.length)} whose slug another template uses: ${skipped.join(", ")}.`,
        ]),
  ].join("\n");
};

/** Gives the built-in Header, Footer, Configuration and emails to the Application named, when one is, made if new. */
const withBuiltInsGivenTo = async (
  database: Database,
  applicationName: string | undefined,
  report: string,
): Promise<string> => {
  if (applicationName === undefined) {
    return report;
  }
  const application = await findOrCreateApplication(database, applicationName);
  const owner = { applicationId: application.id };
  await database
    .update(emailParts)
    .set(owner)
    .where(
      inArray(
        emailParts.name,
        builtInParts.map((part) => part.name),
      ),
    );
  await database
    .update(configurations)
    .set(owner)
    .where(eq(configurations.name, builtInConfiguration.name));
  await database
    .update(templates)
    .set(owner)
    .where(
      inArray(
        templates.name,
        builtInEmails.map((email) => email.name),
      ),
    );
  return `${report}\nGave them to the application "${application.name}": its API keys can change them and send from ${builtInConfiguration.fromEmail}.`;
};

export const readPasswordFromTerminal: ReadPassword = async (prompt) => {
  let isMuted = false;
  const output = new Writable({
    write: (chunk: Buffer, _encoding, callback) => {
      if (!isMuted) {
        process.stdout.write(chunk);
      }
      callback();
    },
  });
  const terminal = createInterface({
    input: process.stdin,
    output,
    terminal: process.stdin.isTTY,
  });
  try {
    const answer = terminal.question(prompt);
    isMuted = process.stdin.isTTY;
    const password = await answer;
    if (process.stdin.isTTY) {
      process.stdout.write("\n");
    }
    return password;
  } finally {
    terminal.close();
  }
};
