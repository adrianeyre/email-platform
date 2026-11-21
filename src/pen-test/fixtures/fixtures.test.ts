import Handlebars from "handlebars";
import { asc } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiKeys,
  configurations,
  emailPartKinds,
  emailParts,
  messageAttachments,
  messageStatuses,
  messages,
  settings,
  templates,
  users,
} from "../../lib/schema.js";
import { builtInEmails } from "../../templates/built-in-emails.js";
import type { BlockType } from "../../templates/design/model.js";
import {
  hasContainerRuntime,
  startProbeWorld,
  warnIfSkipped,
  type ProbeWorld,
} from "../probes/probe-world.js";
import {
  applications,
  deriveFixtureCredentials,
  type Application,
  fixtureDomain,
  penTestFixtureIds,
  planFixtures,
  plannedBlockKinds,
} from "./fixture-plan.js";
import { loadPenTestFixtures } from "./load-fixtures.js";

/** Every Block kind there is: TypeScript refuses this object if a kind is added and not named here. */
const everyBlockKind = {
  text: true,
  button: true,
  image: true,
  divider: true,
  spacer: true,
  html: true,
  social: true,
  columns: true,
} satisfies Record<BlockType, true>;

const now = new Date("2026-11-20T10:48:00Z");
const plan = planFixtures(now);

describe("the pen-test fixture plan (E2, #88)", () => {
  it("covers every Message status, Block kind and Header and Footer kind", () => {
    expect(new Set(plan.messages.map((message) => message.status))).toEqual(
      new Set(messageStatuses),
    );
    expect(plannedBlockKinds()).toEqual(new Set(Object.keys(everyBlockKind)));
    expect(new Set(plan.parts.map((part) => part.kind))).toEqual(
      new Set(emailPartKinds),
    );
  });

  it("has Messages in every status, with and without an Idempotency-Key, from both Applications", () => {
    for (const application of applications) {
      for (const status of messageStatuses) {
        const sent = plan.messages.filter(
          (message) =>
            message.application === application && message.status === status,
        );
        expect(
          sent.some((message) => message.idempotencyKey !== null),
          `${application} ${status} with a key`,
        ).toBe(true);
        expect(
          sent.some((message) => message.idempotencyKey === null),
          `${application} ${status} without a key`,
        ).toBe(true);
      }
    }
  });

  it("has the 15 Built-in emails with their Header, Footer and Configuration, and a Wizzaroo Message for each", () => {
    const builtIns = plan.templates.filter(
      (template) => template.application === "wizzaroo",
    );
    expect(builtIns.map((template) => template.slug)).toEqual(
      builtInEmails.map((email) => email.slug),
    );
    for (const template of builtIns) {
      expect(template.headerId).toBe(penTestFixtureIds.parts.header);
      expect(template.footerId).toBe(penTestFixtureIds.parts.footer);
      expect(template.configurationId).toBe(
        penTestFixtureIds.configurations.wizzaroo,
      );
      expect(
        plan.messages.filter((message) => message.templateId === template.id),
      ).toHaveLength(1);
    }
  });

  it("puts a working-looking link that leads nowhere in every Wizzaroo Message whose email has one, kept in the body only while it is queued", () => {
    const withLinks = plan.messages.filter((message) => message.link !== null);
    expect(withLinks.map((message) => message.templateSlug)).toEqual([
      "wizzaroo-confirm-your-email-address",
      "wizzaroo-reset-your-password",
      "wizzaroo-teacher-invite",
      "wizzaroo-parent-invite",
      "wizzaroo-family-device-signed-in",
      "wizzaroo-family-join-request",
    ]);
    for (const message of withLinks) {
      expect(message.link).toMatch(
        /^https:\/\/wizzaroo\.pen-test\.invalid\/[a-z]+\?token=pen-test-/u,
      );
    }
    for (const message of withLinks.filter(
      (item) => item.status === "queued",
    )) {
      // Handlebars escapes the link's "=" in HTML, as it does for every real Wizzaroo link.
      expect(message.html).toContain(
        Handlebars.escapeExpression(message.link ?? ""),
      );
      expect(message.text).toContain(message.link);
    }
  });

  it("keeps a body only on a queued Message, as the platform does once one is sent or has failed (#116)", () => {
    for (const message of plan.messages) {
      expect(
        message.html === null && message.text === null,
        `${message.id} ${message.status}`,
      ).toBe(message.status !== "queued");
    }
  });

  it("uses only synthetic addresses, which can't be delivered", () => {
    const addresses = plan.messages.flatMap((message) => [
      ...message.to,
      ...message.cc,
      ...message.bcc,
      ...(message.replyTo === null ? [] : [message.replyTo]),
    ]);
    for (const address of [
      ...addresses,
      ...plan.users.map((user) => user.email),
    ]) {
      expect(address.endsWith(`.${fixtureDomain}`)).toBe(true);
    }
  });

  it("names every fixture by a fixed id, so loading on another day keeps every id", () => {
    const later = planFixtures(new Date("2027-01-01T00:00:00Z"));
    const ids = (from: typeof plan) => [
      ...from.users.map((user) => user.id),
      ...from.apiKeys.map((key) => key.id),
      ...from.templates.map((template) => template.id),
      ...from.messages.map((message) => message.id),
    ];
    expect(ids(later)).toEqual(ids(plan));
    expect(new Set(ids(plan)).size).toBe(ids(plan).length);
  });

  it("derives every credential from the seed, and the same seed gives the same ones", () => {
    const seed = "a synthetic seed of at least thirty-two characters";
    expect(deriveFixtureCredentials(seed)).toEqual(
      deriveFixtureCredentials(seed),
    );
    expect(deriveFixtureCredentials(`${seed}!`).passwords.victim).not.toBe(
      deriveFixtureCredentials(seed).passwords.victim,
    );
    expect(() => deriveFixtureCredentials("short")).toThrow("at least 32");
    expect(JSON.stringify(plan)).not.toContain(
      deriveFixtureCredentials(seed).passwords.victim,
    );
  });
});

warnIfSkipped("src/pen-test/fixtures/fixtures.test.ts");

describe.skipIf(!hasContainerRuntime)(
  "loading the pen-test fixtures into a real Postgres (E2, #88)",
  () => {
    let world: ProbeWorld;

    const dumpRows = async () => ({
      users: await world.database.select().from(users).orderBy(asc(users.id)),
      apiKeys: await world.database
        .select()
        .from(apiKeys)
        .orderBy(asc(apiKeys.id)),
      emailParts: await world.database
        .select()
        .from(emailParts)
        .orderBy(asc(emailParts.id)),
      configurations: await world.database
        .select()
        .from(configurations)
        .orderBy(asc(configurations.id)),
      templates: await world.database
        .select()
        .from(templates)
        .orderBy(asc(templates.id)),
      messages: await world.database
        .select()
        .from(messages)
        .orderBy(asc(messages.id)),
      attachments: await world.database
        .select()
        .from(messageAttachments)
        .orderBy(asc(messageAttachments.id)),
      settings: await world.database.select().from(settings),
    });

    beforeAll(async () => {
      world = await startProbeWorld({ hasMailpit: false });
    }, 300_000);

    afterAll(async () => {
      await world.stop();
    });

    it("gives the same rows when loaded twice", async () => {
      const options = {
        seed: world.seed,
        encryptionKey: world.encryptionKey,
        now,
      };
      await loadPenTestFixtures(world.database, options);
      const first = await dumpRows();
      await loadPenTestFixtures(world.database, options);
      const second = await dumpRows();

      expect(second).toEqual(first);
      expect(first.users).toHaveLength(2);
      expect(first.apiKeys.map((key) => key.id)).toEqual([
        penTestFixtureIds.apiKeys.wizzaroo,
        penTestFixtureIds.apiKeys.secondApp,
      ]);
      expect(first.templates).toHaveLength(16);
      expect(first.messages).toHaveLength(plan.messages.length);
      expect(first.attachments).toHaveLength(1);
    });

    it("records the Application each key, Template, Header, Footer, Configuration and Message belongs to (ADR 0009)", async () => {
      await world.reloadFixtures();
      const rows = await dumpRows();
      const idOf = (application: "wizzaroo" | "second-app") =>
        application === "wizzaroo"
          ? penTestFixtureIds.applications.wizzaroo
          : penTestFixtureIds.applications.secondApp;
      const owners = (items: { id: string; applicationId: string | null }[]) =>
        Object.fromEntries(items.map((item) => [item.id, item.applicationId]));
      const planned = (items: { id: string; application: Application }[]) =>
        Object.fromEntries(
          items.map((item) => [item.id, idOf(item.application)]),
        );
      const live = world.plan.apiKeys.filter((key) => !key.isDeleted);
      expect(owners(rows.apiKeys)).toEqual(planned(live));
      expect(owners(rows.templates)).toEqual(planned(world.plan.templates));
      expect(owners(rows.emailParts)).toEqual(planned(world.plan.parts));
      expect(owners(rows.configurations)).toEqual(
        planned(world.plan.configurations),
      );
      expect(owners(rows.messages)).toEqual(planned(world.plan.messages));
      expect(new Set(rows.messages.map((message) => message.apiKeyId))).toEqual(
        new Set([
          penTestFixtureIds.apiKeys.wizzaroo,
          penTestFixtureIds.apiKeys.secondApp,
        ]),
      );
    });

    it("puts back what a probe changed, and keeps no deleted key", async () => {
      await world.database
        .update(messages)
        .set({ subject: "changed by a probe" });
      await world.database.delete(templates);
      await world.database.insert(apiKeys).values({
        id: penTestFixtureIds.apiKeys.deleted,
        name: "brought back by a probe",
        applicationId: penTestFixtureIds.applications.secondApp,
        lookupId: "7e57000000000003",
        secretHash: "0",
      });
      await world.reloadFixtures();

      const rows = await dumpRows();
      expect(rows.templates).toHaveLength(16);
      expect(rows.messages.map((message) => message.subject)).not.toContain(
        "changed by a probe",
      );
      expect(rows.apiKeys.map((key) => key.id)).not.toContain(
        penTestFixtureIds.apiKeys.deleted,
      );
    });

    it("signs in as each fixture User with the password derived from the seed", async () => {
      for (const handle of ["victim", "colleague"] as const) {
        const me = await world.request(
          { user: handle },
          { method: "GET", url: "/app/me" },
        );
        expect(me.json()).toMatchObject({
          userId: penTestFixtureIds.users[handle],
        });
      }
    });
  },
);
