/**
 * The pen-test fixtures (pen test E2, #88): the synthetic world a pen-test round probes, as data only. Every id is
 * fixed, so a probe, a findings note or a finding names a fixture by its handle or id, never by a credential. Every
 * credential is derived from the fixture seed, so the plan itself holds none, and every value is made up: addresses
 * end in `.invalid`, so nothing in them can ever be delivered, and Wizzaroo's links lead nowhere.
 *
 * The loader, `load-fixtures.ts`, writes this plan to a database. `docs/pen-test/fixtures.md` names each fixture.
 */
import { createHmac } from "node:crypto";
import {
  messageStatuses,
  type EmailPartKind,
  type MessageStatus,
} from "../../lib/schema.js";
import { composeHtml } from "../../templates/compose.js";
import {
  builtInConfiguration,
  builtInEmails,
  builtInParts,
  toPartBody,
  toTemplateBody,
} from "../../templates/built-in-emails.js";
import {
  createButtonBlock,
  createColumnsBlock,
  createDesign,
  createDividerBlock,
  createHtmlBlock,
  createImageBlock,
  createSocialBlock,
  createSpacerBlock,
  createTextBlock,
  type Block,
  type Design,
} from "../../templates/design/model.js";
import { renderDesignHtml } from "../../templates/design/render-html.js";
import { renderTemplate } from "../../templates/render.js";

const dayMs = 86_400_000;

/** A fixed id: `7e57` ("test"), then the kind of fixture, then its number. */
const fixtureId = (kind: number, index: number): string =>
  `7e570000-0000-4000-8000-${kind.toString(16).padStart(4, "0")}${index.toString(16).padStart(8, "0")}`;

export const userHandles = ["victim", "colleague"] as const;
export type UserHandle = (typeof userHandles)[number];

/** The keys a tester holds; `deleted` was deleted, so it is in no row, but its secret is still derived. */
export const apiKeyHandles = ["wizzaroo", "secondApp", "deleted"] as const;
export type ApiKeyHandle = (typeof apiKeyHandles)[number];
export const liveApiKeyHandles = ["wizzaroo", "secondApp"] as const;

export const applications = ["wizzaroo", "second-app"] as const;
export type Application = (typeof applications)[number];

/** Each Application's row: its keys, Templates, Headers, Footers, Configurations and Messages name it (ADR 0009). */
export const fixtureApplications: Record<
  Application,
  { id: string; name: string }
> = {
  wizzaroo: { id: fixtureId(8, 1), name: "Wizzaroo" },
  "second-app": { id: fixtureId(8, 2), name: "Second app" },
};

/** Where every fixture address lives. `.invalid` is reserved (RFC 2606), so no email to it is ever delivered. */
export const fixtureDomain = "pen-test.invalid";
export const wizzarooLinkOrigin = `https://wizzaroo.${fixtureDomain}`;

export const fixtureUsers: Record<
  UserHandle,
  { id: string; email: string; purpose: string }
> = {
  victim: {
    id: fixtureId(1, 1),
    email: `victim@users.${fixtureDomain}`,
    purpose:
      "The User whose session is stolen: A1 and A2 take it over, change their password and see what survives",
  },
  colleague: {
    id: fixtureId(1, 2),
    email: `colleague@users.${fixtureDomain}`,
    purpose:
      "The victim's colleague: a second User for one User to delete, and the account a spray or a guess aims at",
  },
};

export const fixtureApiKeys: Record<
  ApiKeyHandle,
  {
    id: string;
    name: string;
    lookupId: string;
    application: Application;
    isDeleted: boolean;
    purpose: string;
  }
> = {
  wizzaroo: {
    id: fixtureId(2, 1),
    name: "Wizzaroo",
    lookupId: "7e57000000000001",
    application: "wizzaroo",
    isDeleted: false,
    purpose:
      "Wizzaroo's key: sends the Built-in emails and owns the Messages holding Wizzaroo's links",
  },
  secondApp: {
    id: fixtureId(2, 2),
    name: "Second app",
    lookupId: "7e57000000000002",
    application: "second-app",
    isDeleted: false,
    purpose:
      "A second Application's key: the one that should not reach Wizzaroo's Templates, Messages or from address",
  },
  deleted: {
    id: fixtureId(2, 3),
    name: "Deleted key",
    lookupId: "7e57000000000003",
    application: "second-app",
    isDeleted: true,
    purpose:
      "A key a User deleted: every /v1 route should refuse it straight away",
  },
};

export const fixturePartIds: Record<EmailPartKind, string> = {
  header: fixtureId(3, 1),
  footer: fixtureId(3, 2),
};

export const fixtureConfigurationIds = {
  wizzaroo: fixtureId(4, 1),
  secondApp: fixtureId(4, 2),
} as const;

const builtInTemplateId = (index: number) => fixtureId(5, index + 1);
export const secondAppTemplateId = fixtureId(5, 0x101);
export const secondAppTemplateSlug = "second-app-order-shipped";

/** The Built-in emails' Template ids, by slug, such as `wizzaroo-reset-your-password`. */
export const fixtureBuiltInTemplateIds: Readonly<Record<string, string>> =
  Object.fromEntries(
    builtInEmails.map((email, index) => [email.slug, builtInTemplateId(index)]),
  );

/* ---------- Credentials, derived from the seed ---------- */

const derive = (seed: string, purpose: string, characters: number): string =>
  createHmac("sha256", seed)
    .update(`email-platform-pen-test:${purpose}`)
    .digest("base64url")
    .slice(0, characters);

export interface FixtureCredentials {
  passwords: Record<UserHandle, string>;
  apiKeys: Record<ApiKeyHandle, string>;
  smtpPassword: string;
}

/** Every credential of every fixture, from the seed: the same seed always gives the same credentials. */
export const deriveFixtureCredentials = (seed: string): FixtureCredentials => {
  if (seed.trim().length < 32) {
    throw new Error("The fixture seed must be at least 32 characters");
  }
  const passwords = Object.fromEntries(
    userHandles.map((handle) => [
      handle,
      derive(seed, `password:${handle}`, 24),
    ]),
  );
  const apiKeys = Object.fromEntries(
    apiKeyHandles.map((handle) => [
      handle,
      `ek_${fixtureApiKeys[handle].lookupId}_${derive(seed, `api-key:${handle}`, 32)}`,
    ]),
  );
  return {
    passwords: {
      victim: passwords.victim ?? "",
      colleague: passwords.colleague ?? "",
    },
    apiKeys: {
      wizzaroo: apiKeys.wizzaroo ?? "",
      secondApp: apiKeys.secondApp ?? "",
      deleted: apiKeys.deleted ?? "",
    },
    smtpPassword: derive(seed, "smtp-password", 24),
  };
};

/* ---------- Templates, Headers, Footers and Configurations ---------- */

/** Block ids are random when a design is made, so each is given a fixed one, and loading again gives the same rows. */
const withFixedBlockIds = (design: Design, prefix: string): Design => {
  let counter = 0;
  const next = () => {
    counter += 1;
    return `${prefix}-${String(counter)}`;
  };
  const fix = (block: Block): Block =>
    block.type === "columns"
      ? {
          ...block,
          id: next(),
          columns: block.columns.map((column) => ({
            ...column,
            id: next(),
            blocks: column.blocks.map((leaf) => ({ ...leaf, id: next() })),
          })),
        }
      : block.type === "social"
        ? {
            ...block,
            id: next(),
            links: block.links.map((link) => ({ ...link, id: next() })),
          }
        : { ...block, id: next() };
  return { ...design, blocks: design.blocks.map(fix) };
};

const toJson = (design: Design): Record<string, unknown> =>
  Object.fromEntries(Object.entries(design));

export interface PartPlan {
  id: string;
  application: Application;
  kind: EmailPartKind;
  name: string;
  html: string;
  design: Record<string, unknown>;
  sampleVariables: Record<string, unknown>;
}

export const planParts = (): PartPlan[] =>
  builtInParts.map((part) => {
    const body = toPartBody({
      ...part,
      design: withFixedBlockIds(part.design, `part-${part.kind}`),
    });
    return {
      id: fixturePartIds[part.kind],
      application: "wizzaroo",
      kind: part.kind,
      name: body.name,
      html: body.html,
      design: toJson(body.design),
      sampleVariables: body.sampleVariables,
    };
  });

export interface ConfigurationPlan {
  id: string;
  application: Application;
  name: string;
  fromEmail: string;
  fromName: string;
}

export const planConfigurations = (): ConfigurationPlan[] => [
  {
    id: fixtureConfigurationIds.wizzaroo,
    application: "wizzaroo",
    name: builtInConfiguration.name,
    fromEmail: builtInConfiguration.fromEmail,
    fromName: builtInConfiguration.fromName,
  },
  {
    id: fixtureConfigurationIds.secondApp,
    application: "second-app",
    name: "Second app",
    fromEmail: `orders@second-app.${fixtureDomain}`,
    fromName: "Second app",
  },
];

export interface TemplatePlan {
  id: string;
  application: Application;
  name: string;
  slug: string;
  subject: string;
  html: string;
  text: string | null;
  variables: string[];
  sampleVariables: Record<string, unknown>;
  design: Record<string, unknown>;
  headerId: string | null;
  footerId: string | null;
  configurationId: string | null;
}

/** The second Application's own Template, designed with one Block of every kind, so a probe meets each kind. */
const secondAppDesign = (): Design => {
  const columns = createColumnsBlock(2);
  const [left, right] = columns.columns;
  const designed = createDesign([
    createTextBlock("<h1>Your order {{orderNumber}} has shipped</h1>"),
    createImageBlock(),
    createButtonBlock("Track your parcel", "{{trackingUrl}}"),
    createDividerBlock(),
    createSpacerBlock(16),
    createHtmlBlock("<p>Thanks for shopping with the second app.</p>"),
    createSocialBlock(["website"]),
    {
      ...columns,
      columns: [
        ...(left === undefined
          ? []
          : [{ ...left, blocks: [createTextBlock("<p>Order</p>")] }]),
        ...(right === undefined
          ? []
          : [
              { ...right, blocks: [createTextBlock("<p>{{orderNumber}}</p>")] },
            ]),
      ],
    },
  ]);
  return withFixedBlockIds(designed, "second-app");
};

export const planTemplates = (): TemplatePlan[] => {
  const wizzaroo = builtInEmails.map((email, index): TemplatePlan => {
    const body = toTemplateBody(
      {
        ...email,
        design: withFixedBlockIds(email.design, `built-in-${String(index)}`),
      },
      {
        headerId: fixturePartIds.header,
        footerId: fixturePartIds.footer,
        configurationId: fixtureConfigurationIds.wizzaroo,
      },
    );
    return {
      ...body,
      id: builtInTemplateId(index),
      application: "wizzaroo",
      design: toJson(body.design),
    };
  });
  const design = secondAppDesign();
  const secondApp: TemplatePlan = {
    id: secondAppTemplateId,
    application: "second-app",
    name: "Second app - Order shipped",
    slug: secondAppTemplateSlug,
    subject: "Your order {{orderNumber}} has shipped",
    html: renderDesignHtml(design, { title: "Your order has shipped" }),
    text: null,
    variables: ["orderNumber", "trackingUrl"],
    sampleVariables: {
      orderNumber: "SA-0001",
      trackingUrl: `https://second-app.${fixtureDomain}/track/SA-0001`,
    },
    design: toJson(design),
    headerId: null,
    footerId: null,
    configurationId: fixtureConfigurationIds.secondApp,
  };
  return [...wizzaroo, secondApp];
};

/** Every Block kind a Template in the plan uses, columns' own Blocks included. */
export const plannedBlockKinds = (): Set<string> => {
  const kinds = new Set<string>();
  const visit = (blocks: readonly unknown[]) => {
    for (const block of blocks) {
      if (typeof block !== "object" || block === null) {
        continue;
      }
      const type: unknown = Reflect.get(block, "type");
      if (typeof type === "string") {
        kinds.add(type);
      }
      const columns: unknown = Reflect.get(block, "columns");
      if (Array.isArray(columns)) {
        for (const column of columns) {
          const inner: unknown =
            typeof column === "object" && column !== null
              ? Reflect.get(column, "blocks")
              : undefined;
          visit(Array.isArray(inner) ? inner : []);
        }
      }
    }
  };
  for (const template of [...planTemplates(), ...planParts()]) {
    const blocks: unknown = template.design.blocks;
    visit(Array.isArray(blocks) ? blocks : []);
  }
  return kinds;
};

/* ---------- Messages ---------- */

export interface AttachmentPlan {
  id: string;
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface MessagePlan {
  id: string;
  /** Who sent it: the loader records the Application and its live key as the Message's sender (ADR 0009). */
  application: Application;
  templateId: string | null;
  templateSlug: string | null;
  status: MessageStatus;
  idempotencyKey: string | null;
  createdAt: Date;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo: string | null;
  subject: string;
  /** The rendered body, while the Message is queued. The platform drops it once it is sent or has failed (#116). */
  html: string | null;
  text: string | null;
  providerMessageId: string | null;
  error: string | null;
  attempts: number;
  sentAt: Date | null;
  /** The account link the Message carries, when it is a Wizzaroo email that has one. */
  link: string | null;
  attachments: AttachmentPlan[];
}

/** How long ago each Wizzaroo Message was made, in days. Two are past the 90-day Retention, to be swept. */
const wizzarooAges = [0, 0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 91, 120];

const synthesiseVariables = (
  samples: Record<string, unknown>,
  recipient: string,
  handle: string,
): { variables: Record<string, unknown>; link: string | null } => {
  let link: string | null = null;
  const variables = Object.fromEntries(
    Object.entries(samples).map(([name, value]) => {
      if (name === "email") {
        return [name, recipient];
      }
      if (name.endsWith("Url") && typeof value === "string") {
        const path = new URL(value).pathname;
        link = `${wizzarooLinkOrigin}${path}?token=pen-test-${handle}-not-a-real-token`;
        return [name, link];
      }
      if (typeof value === "string" && value.includes("@example.")) {
        return [name, value.replace(/@example\.[a-z]+/u, `@${fixtureDomain}`)];
      }
      return [name, value];
    }),
  );
  return { variables, link };
};

const formatFrom = ({ fromName, fromEmail }: ConfigurationPlan) =>
  `${fromName} <${fromEmail}>`;

/** The rendered email as the log keeps it: whole while queued, without its body once sent or failed (#116). */
const keptAs = (
  status: MessageStatus,
  rendered: { subject: string; html: string; text: string },
) => (status === "queued" ? rendered : { ...rendered, html: null, text: null });

/** Fills in the delivery fields a Message in each status has. */
const statusFields = (status: MessageStatus, createdAt: Date, id: string) => {
  switch (status) {
    case "sent":
      return {
        providerMessageId: `<${id}@mailpit.${fixtureDomain}>`,
        error: null,
        attempts: 1,
        sentAt: new Date(createdAt.getTime() + 2_000),
      };
    case "failed":
      return {
        providerMessageId: null,
        error:
          "550 5.1.1 The pen-test fixture's mailbox does not exist (synthetic)",
        attempts: 4,
        sentAt: null,
      };
    case "queued":
      return {
        providerMessageId: null,
        error: null,
        attempts: 0,
        sentAt: null,
      };
  }
};

/**
 * The Messages: one per Built-in email from Wizzaroo, each with its link, and one per status, with and without an
 * Idempotency-Key, from the second Application. Statuses cycle, so Wizzaroo has Messages in every status too.
 */
export const planMessages = (anchor: Date): MessagePlan[] => {
  const templates = planTemplates();
  const parts = planParts();
  const header = parts.find((part) => part.kind === "header");
  const footer = parts.find((part) => part.kind === "footer");
  const [wizzarooConfiguration, secondAppConfiguration] = planConfigurations();
  if (
    wizzarooConfiguration === undefined ||
    secondAppConfiguration === undefined
  ) {
    throw new Error("The plan has no Configurations");
  }
  const at = (daysAgo: number, minute: number) =>
    new Date(anchor.getTime() - daysAgo * dayMs + minute * 60_000);

  const wizzaroo = builtInEmails.map((email, index): MessagePlan => {
    const template = templates.find((item) => item.slug === email.slug);
    if (template === undefined) {
      throw new Error(`The plan has no Template for ${email.slug}`);
    }
    const id = fixtureId(6, index + 1);
    const recipient = `parent${String(index + 1)}@families.${fixtureDomain}`;
    const handle = email.slug.replace(/^wizzaroo-/u, "");
    const { variables, link } = synthesiseVariables(
      email.sampleVariables,
      recipient,
      handle,
    );
    const rendered = renderTemplate(
      {
        subject: template.subject,
        text: template.text,
        html: composeHtml(template, header, footer),
      },
      variables,
    );
    const status = messageStatuses[index % messageStatuses.length] ?? "sent";
    const createdAt = at(wizzarooAges[index] ?? 0, index);
    return {
      id,
      application: "wizzaroo",
      templateId: template.id,
      templateSlug: template.slug,
      status,
      idempotencyKey:
        index % 2 === 0 ? `wizzaroo-${handle}-${String(index + 1)}` : null,
      createdAt,
      from: formatFrom(wizzarooConfiguration),
      to: [recipient],
      cc: [],
      bcc: [],
      replyTo: null,
      ...keptAs(status, rendered),
      ...statusFields(status, createdAt, id),
      link,
      attachments: [],
    };
  });

  const secondAppTemplate = templates.find(
    (template) => template.id === secondAppTemplateId,
  );
  if (secondAppTemplate === undefined) {
    throw new Error("The plan has no second-app Template");
  }
  const secondApp = messageStatuses.flatMap((status, statusIndex) =>
    [true, false].map((hasKey, keyIndex): MessagePlan => {
      const index = statusIndex * 2 + keyIndex;
      const id = fixtureId(6, 0x101 + index);
      const orderNumber = `SA-${String(1001 + index)}`;
      const createdAt = at(index * 7, 30 + index);
      const rendered = renderTemplate(
        {
          subject: secondAppTemplate.subject,
          html: secondAppTemplate.html,
          text: null,
        },
        {
          orderNumber,
          trackingUrl: `https://second-app.${fixtureDomain}/track/${orderNumber}`,
        },
      );
      const isQueued = status === "queued";
      return {
        id,
        application: "second-app",
        templateId: secondAppTemplate.id,
        templateSlug: secondAppTemplate.slug,
        status,
        idempotencyKey: hasKey ? `second-app-order-${orderNumber}` : null,
        createdAt,
        from: formatFrom(secondAppConfiguration),
        to: [`customer${String(index + 1)}@customers.${fixtureDomain}`],
        cc: index === 0 ? [`warehouse@second-app.${fixtureDomain}`] : [],
        bcc: index === 0 ? [`audit@second-app.${fixtureDomain}`] : [],
        replyTo: index === 0 ? `help@second-app.${fixtureDomain}` : null,
        ...keptAs(status, rendered),
        ...statusFields(status, createdAt, id),
        link: null,
        // A queued Message keeps its attachments until it is sent; the worker deletes them once it is.
        attachments:
          isQueued && hasKey
            ? [
                {
                  id: fixtureId(7, 1),
                  filename: `invoice-${orderNumber}.txt`,
                  contentType: "text/plain",
                  content: Buffer.from(
                    `Synthetic invoice for ${orderNumber}. Nothing here is real.\n`,
                  ),
                },
              ]
            : [],
      };
    }),
  );
  return [...wizzaroo, ...secondApp];
};

/* ---------- Settings ---------- */

export interface SettingsPlan {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string | null;
  defaultFrom: string;
  logRetentionDays: number;
}

/**
 * Settings pointing at the deployment's Mailpit (E1). Its SMTP password comes from the seed and is sealed. There is no
 * username, so no AUTH: Mailpit has no TLS, and credentials are only ever sent over TLS (pen test I5, #186).
 */
export const plannedSettings: SettingsPlan = {
  smtpHost: "mailpit",
  smtpPort: 1025,
  smtpSecure: false,
  smtpUsername: null,
  defaultFrom: `Pen-test platform <no-reply@platform.${fixtureDomain}>`,
  logRetentionDays: 90,
};

/* ---------- The whole plan ---------- */

export interface UserPlan {
  handle: UserHandle;
  id: string;
  email: string;
  createdAt: Date;
}

export interface ApiKeyPlan {
  handle: ApiKeyHandle;
  id: string;
  application: Application;
  name: string;
  lookupId: string;
  isDeleted: boolean;
  createdAt: Date;
}

export interface FixturePlan {
  anchor: Date;
  users: UserPlan[];
  apiKeys: ApiKeyPlan[];
  parts: PartPlan[];
  configurations: ConfigurationPlan[];
  templates: TemplatePlan[];
  messages: MessagePlan[];
  settings: SettingsPlan;
}

/** Midnight UTC on the day given, so loading twice in one day gives the same rows. */
export const fixtureAnchor = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export const planFixtures = (now: Date): FixturePlan => {
  const anchor = fixtureAnchor(now);
  const createdBefore = (days: number) =>
    new Date(anchor.getTime() - days * dayMs);
  return {
    anchor,
    users: userHandles.map((handle, index) => ({
      handle,
      ...fixtureUsers[handle],
      createdAt: createdBefore(400 - index),
    })),
    apiKeys: apiKeyHandles.map((handle, index) => ({
      handle,
      id: fixtureApiKeys[handle].id,
      application: fixtureApiKeys[handle].application,
      name: fixtureApiKeys[handle].name,
      lookupId: fixtureApiKeys[handle].lookupId,
      isDeleted: fixtureApiKeys[handle].isDeleted,
      createdAt: createdBefore(300 - index),
    })),
    parts: planParts(),
    configurations: planConfigurations(),
    templates: planTemplates(),
    messages: planMessages(anchor),
    settings: plannedSettings,
  };
};

/** The fixtures' ids by handle, for probes and findings to name. */
export const penTestFixtureIds = {
  applications: {
    wizzaroo: fixtureApplications.wizzaroo.id,
    secondApp: fixtureApplications["second-app"].id,
  },
  users: {
    victim: fixtureUsers.victim.id,
    colleague: fixtureUsers.colleague.id,
  },
  apiKeys: {
    wizzaroo: fixtureApiKeys.wizzaroo.id,
    secondApp: fixtureApiKeys.secondApp.id,
    deleted: fixtureApiKeys.deleted.id,
  },
  parts: fixturePartIds,
  configurations: fixtureConfigurationIds,
  builtInTemplates: fixtureBuiltInTemplateIds,
  secondAppTemplate: secondAppTemplateId,
};
