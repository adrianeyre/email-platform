import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import type { Database } from "../lib/database.js";
import { and, eq, inArray, isNull, notExists } from "drizzle-orm";
import { configurations, emailParts, templates } from "../lib/schema.js";
import {
  builtInConfiguration,
  builtInEmails,
  builtInParts,
  toPartBody,
  toTemplateBody,
} from "../templates/built-in-emails.js";
import { createApiKey } from "./api-keys.js";
import { createUser } from "./users.js";

export class CliCommandRefusedError extends Error {
  override name = "CliCommandRefusedError";
}

export type ReadPassword = (prompt: string) => Promise<string>;

export const usage = [
  "Commands:",
  "  user:create <email>    create a user; prompts for the password",
  "  apikey:create <name>   create an API key and print it once",
  "  templates:add-built-ins     add the built-in header, footer, configuration and emails that are not there yet",
  "  templates:update-built-ins  replace the built-in header, footer, configuration and emails with this version's",
].join("\n");

export const runCliCommand = async (
  database: Database,
  args: readonly string[],
  readPassword: ReadPassword,
): Promise<string> => {
  const [command, value] = args;
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
    const { apiKey, secret } = await createApiKey(database, value);
    return `Created API key "${apiKey.name}". Store it now; it is not shown again:\n${secret}`;
  }
  if (command === "templates:add-built-ins") {
    return addBuiltInTemplates(database);
  }
  if (command === "templates:update-built-ins") {
    return updateBuiltInTemplates(database);
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
