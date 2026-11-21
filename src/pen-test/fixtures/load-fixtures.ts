/**
 * Loads the pen-test fixtures (pen test E2, #88) into a database: the plan in `fixture-plan.ts`, with its credentials
 * derived from the seed. Loading again puts every fixture back as the plan has it, by id, whatever a probe did to it,
 * and gives the same rows: a password hash or sealed SMTP password that still matches is kept rather than made again
 * with a new salt. It doesn't remove rows a probe added, other than one that took a fixture's unique name or slug.
 */
import { and, eq, inArray, ne, notInArray, or } from "drizzle-orm";
import type { Database } from "../../lib/database.js";
import {
  apiKeys,
  applications,
  configurations,
  emailParts,
  messageAttachments,
  messages,
  settings,
  templates,
  users,
} from "../../lib/schema.js";
import {
  decryptValue,
  encryptValue,
  hashPassword,
  hashSecret,
  isPasswordMatch,
} from "../../lib/secrets.js";
import {
  deriveFixtureCredentials,
  fixtureApplications,
  planFixtures,
  type Application,
  type FixturePlan,
} from "./fixture-plan.js";

export interface LoadFixturesOptions {
  seed: string;
  encryptionKey: Buffer;
  now?: Date;
  /** Where the deployment's SMTP sink answers, when it isn't the plan's `mailpit:1025`, as in the gated run. */
  smtp?: { host: string; port: number };
}

export interface LoadedFixtures {
  plan: FixturePlan;
  summary: string;
}

const isSealedValueOf = (
  encryptionKey: Buffer,
  sealed: string | null | undefined,
  value: string,
): boolean => {
  if (sealed === null || sealed === undefined) {
    return false;
  }
  try {
    return decryptValue(encryptionKey, sealed) === value;
  } catch {
    return false;
  }
};

export const loadPenTestFixtures = async (
  database: Database,
  options: LoadFixturesOptions,
): Promise<LoadedFixtures> => {
  const plan = planFixtures(options.now ?? new Date());
  const credentials = deriveFixtureCredentials(options.seed);

  await database.transaction(async (transaction) => {
    for (const user of plan.users) {
      const password = credentials.passwords[user.handle];
      const [existing] = await transaction
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, user.id));
      const passwordHash =
        existing !== undefined &&
        (await isPasswordMatch(password, existing.passwordHash))
          ? existing.passwordHash
          : await hashPassword(password);
      await transaction
        .delete(users)
        .where(and(eq(users.email, user.email), ne(users.id, user.id)));
      const values = {
        email: user.email,
        passwordHash,
        createdAt: user.createdAt,
      };
      await transaction
        .insert(users)
        .values({ id: user.id, ...values })
        .onConflictDoUpdate({ target: users.id, set: values });
    }

    for (const application of Object.values(fixtureApplications)) {
      // An Application a probe made with a fixture's name goes, its keys with it, so the fixture can have the name.
      const taken = and(
        eq(applications.name, application.name),
        ne(applications.id, application.id),
      );
      await transaction
        .delete(apiKeys)
        .where(
          inArray(
            apiKeys.applicationId,
            transaction
              .select({ id: applications.id })
              .from(applications)
              .where(taken),
          ),
        );
      await transaction.delete(applications).where(taken);
      await transaction
        .insert(applications)
        .values({ ...application, createdAt: plan.anchor })
        .onConflictDoUpdate({
          target: applications.id,
          set: { name: application.name, createdAt: plan.anchor },
        });
    }
    const applicationId = (application: Application) =>
      fixtureApplications[application].id;
    const liveKeyOf = (application: Application) =>
      plan.apiKeys.find(
        (key) => key.application === application && !key.isDeleted,
      )?.id ?? null;

    for (const key of plan.apiKeys) {
      await transaction
        .delete(apiKeys)
        .where(or(eq(apiKeys.id, key.id), eq(apiKeys.lookupId, key.lookupId)));
      if (!key.isDeleted) {
        await transaction.insert(apiKeys).values({
          id: key.id,
          applicationId: applicationId(key.application),
          name: key.name,
          lookupId: key.lookupId,
          secretHash: hashSecret(credentials.apiKeys[key.handle]),
          lastUsedAt: null,
          createdAt: key.createdAt,
        });
      }
    }

    for (const part of plan.parts) {
      await transaction
        .delete(emailParts)
        .where(
          and(
            eq(emailParts.kind, part.kind),
            eq(emailParts.name, part.name),
            ne(emailParts.id, part.id),
          ),
        );
      const values = {
        applicationId: applicationId(part.application),
        kind: part.kind,
        name: part.name,
        html: part.html,
        design: part.design,
        sampleVariables: part.sampleVariables,
        createdAt: plan.anchor,
        updatedAt: plan.anchor,
      };
      await transaction
        .insert(emailParts)
        .values({ id: part.id, ...values })
        .onConflictDoUpdate({ target: emailParts.id, set: values });
    }

    for (const configuration of plan.configurations) {
      await transaction
        .delete(configurations)
        .where(
          and(
            eq(configurations.name, configuration.name),
            ne(configurations.id, configuration.id),
          ),
        );
      const values = {
        applicationId: applicationId(configuration.application),
        name: configuration.name,
        fromEmail: configuration.fromEmail,
        fromName: configuration.fromName,
        createdAt: plan.anchor,
        updatedAt: plan.anchor,
      };
      await transaction
        .insert(configurations)
        .values({ id: configuration.id, ...values })
        .onConflictDoUpdate({ target: configurations.id, set: values });
    }

    for (const template of plan.templates) {
      await transaction
        .delete(templates)
        .where(
          and(
            or(
              eq(templates.name, template.name),
              eq(templates.slug, template.slug),
            ),
            ne(templates.id, template.id),
          ),
        );
      const values = {
        applicationId: applicationId(template.application),
        name: template.name,
        slug: template.slug,
        subject: template.subject,
        html: template.html,
        text: template.text,
        variables: template.variables,
        sampleVariables: template.sampleVariables,
        design: template.design,
        headerId: template.headerId,
        footerId: template.footerId,
        configurationId: template.configurationId,
        createdAt: plan.anchor,
        updatedAt: plan.anchor,
      };
      await transaction
        .insert(templates)
        .values({ id: template.id, ...values })
        .onConflictDoUpdate({ target: templates.id, set: values });
    }

    const idempotencyKeys = plan.messages.flatMap((message) =>
      message.idempotencyKey === null ? [] : [message.idempotencyKey],
    );
    const messageIds = plan.messages.map((message) => message.id);
    // A probe's own Message that took a fixture's Idempotency-Key goes, so the fixture can have it back.
    await transaction
      .delete(messages)
      .where(
        and(
          inArray(messages.idempotencyKey, idempotencyKeys),
          notInArray(messages.id, messageIds),
        ),
      );
    await transaction
      .delete(messageAttachments)
      .where(inArray(messageAttachments.messageId, messageIds));
    for (const message of plan.messages) {
      const values = {
        applicationId: applicationId(message.application),
        apiKeyId: liveKeyOf(message.application),
        createdAt: message.createdAt,
        templateId: message.templateId,
        from: message.from,
        to: message.to,
        cc: message.cc,
        bcc: message.bcc,
        replyTo: message.replyTo,
        subject: message.subject,
        html: message.html,
        text: message.text,
        status: message.status,
        providerMessageId: message.providerMessageId,
        error: message.error,
        attempts: message.attempts,
        sentAt: message.sentAt,
        idempotencyKey: message.idempotencyKey,
      };
      await transaction
        .insert(messages)
        .values({ id: message.id, ...values })
        .onConflictDoUpdate({ target: messages.id, set: values });
      if (message.attachments.length > 0) {
        await transaction.insert(messageAttachments).values(
          message.attachments.map((attachment) => ({
            ...attachment,
            messageId: message.id,
          })),
        );
      }
    }

    const [current] = await transaction
      .select({ sealed: settings.smtpPasswordEncrypted })
      .from(settings)
      .where(eq(settings.id, 1));
    const sealed = isSealedValueOf(
      options.encryptionKey,
      current?.sealed,
      credentials.smtpPassword,
    )
      ? (current?.sealed ?? null)
      : encryptValue(options.encryptionKey, credentials.smtpPassword);
    const settingsValues = {
      smtpHost: options.smtp?.host ?? plan.settings.smtpHost,
      smtpPort: options.smtp?.port ?? plan.settings.smtpPort,
      smtpSecure: plan.settings.smtpSecure,
      smtpUsername: plan.settings.smtpUsername,
      smtpPasswordEncrypted: sealed,
      defaultFrom: plan.settings.defaultFrom,
      logRetentionDays: plan.settings.logRetentionDays,
      updatedAt: plan.anchor,
    };
    await transaction
      .insert(settings)
      .values({ id: 1, ...settingsValues })
      .onConflictDoUpdate({ target: settings.id, set: settingsValues });
  });

  const liveKeys = plan.apiKeys.filter((key) => !key.isDeleted).length;
  const summary = [
    `Loaded the pen-test fixtures for ${plan.anchor.toISOString().slice(0, 10)}:`,
    `${String(Object.keys(fixtureApplications).length)} Applications,`,
    `${String(plan.users.length)} Users,`,
    `${String(liveKeys)} API Keys and ${String(plan.apiKeys.length - liveKeys)} deleted one,`,
    `${String(plan.templates.length)} Templates,`,
    `${String(plan.parts.length)} Headers and Footers,`,
    `${String(plan.configurations.length)} Configurations and`,
    `${String(plan.messages.length)} Messages.`,
    "Their credentials come from the seed, and none is printed.",
  ].join(" ");
  return { plan, summary };
};
