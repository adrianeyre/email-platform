import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfig, lintFromString } from "@redocly/openapi-core";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { count, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PgBoss } from "pg-boss";
import {
  GenericContainer,
  getContainerRuntimeClient,
  Wait,
  type StartedTestContainer,
} from "testcontainers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiKey } from "./access/api-keys.js";
import { CliCommandRefusedError, runCliCommand } from "./access/cli.js";
import { createUser } from "./access/users.js";
import { buildHttpServer } from "./api/http-server.js";
import {
  migrateDatabase,
  migrationsFolder,
  openDatabase,
  type Database,
} from "./lib/database.js";
import type { Server } from "./lib/http.js";
import {
  buildJobQueue,
  createJobBoss,
  createJobQueues,
  sendMessageRetryLimit,
} from "./lib/jobs.js";
import {
  apiKeys,
  configurations,
  messageAttachments,
  messages,
  settings,
  templates,
  users,
} from "./lib/schema.js";
import { sendEmailOverSmtp } from "./sending/delivery.js";
import { defaultFromAddress } from "./settings/settings-store.js";
import { applyRetention } from "./sending/retention.js";
import {
  sendQueuedMessage,
  SendWillBeRetriedError,
} from "./sending/send-worker.js";

const hasContainerRuntime = await getContainerRuntimeClient().then(
  () => true,
  () => false,
);

if (!hasContainerRuntime) {
  console.warn(
    "SKIPPED src/integration.test.ts: no container runtime, so the app was not exercised end to end",
  );
}

const encryptionKey = Buffer.alloc(32, 7);
const ownerEmail = "owner@example.com";
const ownerPassword = "a long enough password";
const dayMs = 86_400_000;

interface MailpitSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

interface MailpitMessage {
  From: { Name: string; Address: string };
  Subject: string;
  Text: string;
  HTML: string;
  Attachments: { FileName: string }[];
}

const isMailpitSummaryList = (
  value: unknown,
): value is { messages: MailpitSummary[] } =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray(Reflect.get(value, "messages"));

const isMailpitMessage = (value: unknown): value is MailpitMessage =>
  typeof value === "object" && value !== null && "Subject" in value;

describe.skipIf(!hasContainerRuntime)("the email app", () => {
  let postgres: StartedPostgreSqlContainer;
  let mailpit: StartedTestContainer;
  let database: Database;
  let boss: PgBoss;
  let server: Server;
  let mailpitApi: string;
  let smtpPort: number;
  let sessionCookie: string;
  let apiKey: string;

  const sendParts = () => ({
    database,
    encryptionKey,
    sendEmail: sendEmailOverSmtp,
  });

  const app = (
    method: "GET" | "POST" | "PUT" | "DELETE",
    url: string,
    payload?: object,
  ) =>
    server.inject({
      method,
      url,
      headers: { cookie: `session=${sessionCookie}` },
      ...(payload === undefined ? {} : { payload }),
    });

  const api = (
    method: "GET" | "POST",
    url: string,
    payload?: object,
    headers: Record<string, string> = {},
  ) =>
    server.inject({
      method,
      url,
      headers: { authorization: `Bearer ${apiKey}`, ...headers },
      ...(payload === undefined ? {} : { payload }),
    });

  const listMail = async (): Promise<MailpitSummary[]> => {
    const body: unknown = await (
      await fetch(`${mailpitApi}/api/v1/messages`)
    ).json();
    return isMailpitSummaryList(body) ? body.messages : [];
  };

  const readMail = async (id: string): Promise<MailpitMessage> => {
    const body: unknown = await (
      await fetch(`${mailpitApi}/api/v1/message/${id}`)
    ).json();
    if (!isMailpitMessage(body)) {
      throw new Error("Mailpit returned something unexpected");
    }
    return body;
  };

  const configureSmtp = async (port: number) => {
    const response = await app("PUT", "/app/settings", {
      smtpHost: mailpit.getHost(),
      smtpPort: port,
      smtpSecure: false,
      smtpUsername: "mailer",
      smtpPassword: "smtp-secret-password",
      defaultFrom: "App <app@example.com>",
    });
    expect(response.statusCode, response.body).toBe(200);
  };

  const sendAndDeliver = async (payload: object) => {
    const accepted = await api("POST", "/v1/messages", payload);
    expect(accepted.statusCode, accepted.body).toBe(202);
    const id = accepted.json<{ id: string }>().id;
    const outcome = await sendQueuedMessage(sendParts(), id, {
      retryCount: 0,
      retryLimit: sendMessageRetryLimit,
    });
    return { id, outcome };
  };

  beforeAll(async () => {
    [postgres, mailpit] = await Promise.all([
      new PostgreSqlContainer("postgres:18-alpine").start(),
      new GenericContainer("axllent/mailpit:v1.33.1")
        .withEnvironment({
          MP_SMTP_AUTH_ACCEPT_ANY: "true",
          MP_SMTP_AUTH_ALLOW_INSECURE: "true",
        })
        .withExposedPorts(1025, 8025)
        .withWaitStrategy(Wait.forListeningPorts())
        .start(),
    ]);
    mailpitApi = `http://${mailpit.getHost()}:${String(mailpit.getMappedPort(8025))}`;
    smtpPort = mailpit.getMappedPort(1025);
    database = openDatabase(postgres.getConnectionUri());
    await migrateDatabase(database);
    boss = createJobBoss(postgres.getConnectionUri());
    await boss.start();
    await createJobQueues(boss);
    server = await buildHttpServer({
      database,
      jobs: buildJobQueue(boss),
      appUrl: new URL("http://email.test"),
      encryptionKey,
      sendEmail: sendEmailOverSmtp,
      uiDirectory: undefined,
      isLogging: false,
    });
    await createUser(database, ownerEmail, ownerPassword);
    const signIn = await server.inject({
      method: "POST",
      url: "/auth/sign-in",
      payload: { email: ownerEmail, password: ownerPassword },
    });
    sessionCookie =
      signIn.cookies.find((cookie) => cookie.name === "session")?.value ?? "";
    apiKey = (await createApiKey(database, "Integration tests")).secret;
  }, 300_000);

  afterAll(async () => {
    await server.close();
    await boss.stop({ graceful: false });
    await database.$client.end();
    await Promise.all([postgres.stop(), mailpit.stop()]);
  });

  beforeEach(async () => {
    await fetch(`${mailpitApi}/api/v1/messages`, { method: "DELETE" });
  });

  describe("health and API reference", () => {
    it("reports a healthy database", async () => {
      const response = await server.inject({ method: "GET", url: "/health" });
      expect(response.json()).toEqual({ status: "ok", database: "ok" });
    });

    it("documents only the public API, and the document is valid OpenAPI", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/docs/json",
      });
      const document = response.json<{ paths: Record<string, unknown> }>();
      expect(Object.keys(document.paths).toSorted()).toEqual([
        "/v1/footers",
        "/v1/footers/{id}",
        "/v1/headers",
        "/v1/headers/{id}",
        "/v1/messages",
        "/v1/messages/{id}",
        "/v1/templates",
        "/v1/templates/preview",
        "/v1/templates/{id}",
      ]);
      const problems = await lintFromString({
        source: JSON.stringify(document),
        config: await createConfig({ extends: ["minimal"] }),
      });
      expect(
        problems.filter((problem) => problem.severity === "error"),
      ).toEqual([]);
    });
  });

  describe("signing in (#77)", () => {
    it("refuses the UI API without a session", async () => {
      const response = await server.inject({ method: "GET", url: "/app/me" });
      expect(response.statusCode).toBe(401);
    });

    it("signs in with a CLI-created user and stores only a password hash", async () => {
      const me = await app("GET", "/app/me");
      const [row] = await database
        .select()
        .from(users)
        .where(eq(users.email, ownerEmail));
      expect(me.json()).toMatchObject({ email: ownerEmail });
      expect(row?.passwordHash).toMatch(/^scrypt\$/);
      expect(row?.passwordHash).not.toContain(ownerPassword);
    });

    it("rejects a wrong password and blocks after 10 failures", async () => {
      await createUser(database, "target@example.com", "another long password");
      const attempt = () =>
        server.inject({
          method: "POST",
          url: "/auth/sign-in",
          payload: { email: "target@example.com", password: "wrong" },
        });
      for (let index = 0; index < 10; index += 1) {
        expect((await attempt()).statusCode).toBe(401);
      }
      expect((await attempt()).statusCode).toBe(429);
    });

    it("signs out by deleting the session", async () => {
      const signIn = await server.inject({
        method: "POST",
        url: "/auth/sign-in",
        payload: { email: ownerEmail, password: ownerPassword },
      });
      const cookie = `session=${signIn.cookies.find((item) => item.name === "session")?.value ?? ""}`;
      await server.inject({
        method: "POST",
        url: "/auth/sign-out",
        headers: { cookie },
      });
      const me = await server.inject({
        method: "GET",
        url: "/app/me",
        headers: { cookie },
      });
      expect(me.statusCode).toBe(401);
    });

    it("adds and removes users, but not the signed-in one", async () => {
      const added = await app("POST", "/app/users", {
        email: "Friend@Example.com",
        password: "friend password long",
      });
      const short = await app("POST", "/app/users", {
        email: "short@example.com",
        password: "short",
      });
      const me = await app("GET", "/app/me");
      const deleteSelf = await app(
        "DELETE",
        `/app/users/${me.json<{ userId: string }>().userId}`,
      );
      const deleteFriend = await app(
        "DELETE",
        `/app/users/${added.json<{ id: string }>().id}`,
      );
      expect(added.statusCode).toBe(201);
      expect(added.json()).toMatchObject({ email: "friend@example.com" });
      expect(short.statusCode).toBe(422);
      expect(deleteSelf.statusCode).toBe(409);
      expect(deleteFriend.statusCode).toBe(200);
    });

    it("changes the password only with the current one", async () => {
      const wrong = await app("PUT", "/app/me/password", {
        currentPassword: "not it",
        newPassword: "a brand new password",
      });
      const right = await app("PUT", "/app/me/password", {
        currentPassword: ownerPassword,
        newPassword: ownerPassword,
      });
      expect(wrong.statusCode).toBe(422);
      expect(right.statusCode).toBe(200);
    });
  });

  describe("the CLI (#77)", () => {
    it("creates the first user and an API key", async () => {
      const created = await runCliCommand(
        database,
        ["user:create", "Cli@Example.com"],
        () => Promise.resolve("cli user password"),
      );
      const key = await runCliCommand(
        database,
        ["apikey:create", "Cli app"],
        () => Promise.resolve(""),
      );
      const signIn = await server.inject({
        method: "POST",
        url: "/auth/sign-in",
        payload: { email: "cli@example.com", password: "cli user password" },
      });
      expect(created).toBe("Created user cli@example.com");
      expect(key).toMatch(
        /^Created API key "Cli app"[\s\S]*\nek_[0-9a-f]{16}_/,
      );
      expect(signIn.statusCode).toBe(200);
    });

    it("refuses a duplicate user, a short password and unknown commands", async () => {
      const run = (args: string[], password = "cli user password") =>
        runCliCommand(database, args, () => Promise.resolve(password));
      await expect(run(["user:create", "cli@example.com"])).rejects.toThrow(
        "A user with the email cli@example.com exists",
      );
      await expect(
        run(["user:create", "new@example.com"], "short"),
      ).rejects.toThrow("at least 12 characters");
      await expect(run(["workspace:create", "x"])).rejects.toThrow(
        CliCommandRefusedError,
      );
    });
  });

  describe("API keys (#77)", () => {
    it("shows a key once, stores it hashed and stops accepting it when deleted", async () => {
      const created = await app("POST", "/app/api-keys", { name: "Shop" });
      const { secret, apiKey: summary } = created.json<{
        secret: string;
        apiKey: { id: string; prefix: string };
      }>();
      const [row] = await database
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.id, summary.id));
      const listed = await app("GET", "/app/api-keys");
      const accepted = await server.inject({
        method: "GET",
        url: "/v1/templates",
        headers: { authorization: `Bearer ${secret}` },
      });
      await app("DELETE", `/app/api-keys/${summary.id}`);
      const afterDelete = await server.inject({
        method: "GET",
        url: "/v1/templates",
        headers: { authorization: `Bearer ${secret}` },
      });

      expect(secret).toMatch(/^ek_[0-9a-f]{16}_/);
      expect(row?.secretHash).not.toContain(secret);
      expect(JSON.stringify(listed.json())).not.toContain(secret);
      expect(accepted.statusCode).toBe(200);
      expect(afterDelete.statusCode).toBe(401);
    });

    it("refuses the public API without a key", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/v1/templates",
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe("settings (#75)", () => {
    it("starts with no-reply@adrianeyre.co.uk as the default from address", async () => {
      const read = await app("GET", "/app/settings");
      expect(read.json()).toMatchObject({ defaultFrom: defaultFromAddress });
      expect(defaultFromAddress).toBe("no-reply@adrianeyre.co.uk");
    });

    it("refuses a test email before an SMTP host is set", async () => {
      const response = await app("POST", "/app/settings/test", {
        to: "me@example.com",
      });
      expect(response.statusCode).toBe(409);
    });

    it("stores the SMTP password encrypted, never returns it, and sends a test email", async () => {
      await configureSmtp(smtpPort);
      const read = await app("GET", "/app/settings");
      const [row] = await database.select().from(settings);
      const test = await app("POST", "/app/settings/test", {
        to: "me@example.com",
      });

      expect(read.json()).toMatchObject({
        smtpHost: mailpit.getHost(),
        hasSmtpPassword: true,
        defaultFrom: "App <app@example.com>",
      });
      expect(read.body).not.toContain("smtp-secret-password");
      expect(row?.smtpPasswordEncrypted).not.toContain("smtp-secret-password");
      expect(test.statusCode, test.body).toBe(200);
      expect((await listMail()).map((mail) => mail.Subject)).toEqual([
        "Test email",
      ]);
    });

    it("keeps the saved password when a change leaves it out", async () => {
      await app("PUT", "/app/settings", { logRetentionDays: 30 });
      const read = await app("GET", "/app/settings");
      expect(read.json()).toMatchObject({
        hasSmtpPassword: true,
        logRetentionDays: 30,
      });
    });
  });

  describe("headers and footers", () => {
    it("puts a template between its header and footer when it is previewed, and follows changes to them", async () => {
      const header = await app("POST", "/app/headers", {
        name: "Brand",
        html: "<p>HEADER {{name}}</p>",
      });
      const footer = await app("POST", "/app/footers", {
        name: "Legal",
        html: "<!doctype html><html><body><p>FOOTER</p></body></html>",
      });
      const wrongKind = await app("POST", "/app/templates", {
        name: "Wrong kind",
        subject: "Hi",
        html: "<p>x</p>",
        headerId: footer.json<{ id: string }>().id,
      });
      const template = await app("POST", "/app/templates", {
        name: "Framed",
        subject: "Hi",
        html: "<html><body><p>BODY</p></body></html>",
        headerId: header.json<{ id: string }>().id,
        footerId: footer.json<{ id: string }>().id,
      });
      const headerId = header.json<{ id: string }>().id;
      const preview = async () =>
        (
          await app("POST", "/app/templates/preview", {
            subject: "Hi",
            html: "<html><body><p>BODY</p></body></html>",
            headerId,
            footerId: footer.json<{ id: string }>().id,
            variables: { name: "Ada" },
          })
        ).json<{ html: string }>().html;
      const before = await preview();
      await app("PUT", `/app/headers/${headerId}`, {
        name: "Brand",
        html: "<p>NEW HEADER</p>",
      });
      const after = await preview();
      const read = await app("GET", `/app/headers/${headerId}`);
      const duplicate = await app("POST", "/app/headers", {
        name: "Brand",
        html: "<p>x</p>",
      });
      const asFooter = await app("GET", `/app/footers/${headerId}`);
      await app("DELETE", `/app/headers/${headerId}`);
      const templateAfterDelete = await app(
        "GET",
        `/app/templates/${template.json<{ id: string }>().id}`,
      );

      expect(header.statusCode).toBe(201);
      expect(wrongKind.statusCode).toBe(422);
      expect(template.statusCode).toBe(201);
      expect(before).toMatch(/HEADER Ada<\/p>\s*<p>BODY<\/p><p>FOOTER<\/p>/u);
      expect(after).toContain("<p>NEW HEADER</p>");
      expect(read.json()).toMatchObject({
        kind: "header",
        usedBy: [{ name: "Framed" }],
      });
      expect(duplicate.statusCode).toBe(409);
      expect(asFooter.statusCode).toBe(404);
      expect(templateAfterDelete.json()).toMatchObject({ headerId: null });
      await app(
        "DELETE",
        `/app/templates/${template.json<{ id: string }>().id}`,
      );
      await app("DELETE", `/app/footers/${footer.json<{ id: string }>().id}`);
    });
  });

  describe("templates (#78)", () => {
    it("creates, previews, updates and deletes a template", async () => {
      const created = await app("POST", "/app/templates", {
        name: "Order shipped",
        subject: "Order {{orderId}} shipped",
        html: "<p>Hi {{name}}, order {{orderId}} is on its way.</p>",
        variables: ["orderId", "name", "name"],
        sampleVariables: { orderId: "A1", name: "Ada" },
      });
      const id = created.json<{ id: string }>().id;
      const duplicate = await app("POST", "/app/templates", {
        name: "Order shipped",
        subject: "x",
        html: "x",
      });
      const preview = await app("POST", "/app/templates/preview", {
        subject: "Hi {{name}}",
        html: "<p>{{name}} &amp; co</p>",
        variables: { name: "<Ada>" },
      });
      const updated = await app("PUT", `/app/templates/${id}`, {
        name: "Order shipped",
        subject: "Your order {{orderId}}",
        html: "<p>On its way</p>",
        text: "On its way, {{name}}",
        variables: ["orderId"],
      });
      const removed = await app("DELETE", `/app/templates/${id}`);
      const afterDelete = await app("GET", `/app/templates/${id}`);

      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({
        slug: "order-shipped",
        variables: ["name", "orderId"],
      });
      expect(duplicate.statusCode).toBe(409);
      expect(preview.json()).toEqual({
        subject: "Hi <Ada>",
        html: "<p>&lt;Ada&gt; &amp; co</p>",
        text: "<Ada> & co",
      });
      expect(updated.json()).toMatchObject({
        subject: "Your order {{orderId}}",
        text: "On its way, {{name}}",
        variables: ["orderId"],
      });
      expect(removed.statusCode).toBe(200);
      expect(afterDelete.statusCode).toBe(404);
    });

    it("keeps the visual design with a template until the HTML is replaced without one", async () => {
      const design = { version: 1, settings: {}, blocks: [] };
      const created = await app("POST", "/app/templates", {
        name: "Designed",
        subject: "Hi",
        html: "<p>Hi</p>",
        design,
      });
      const id = created.json<{ id: string }>().id;
      const read = await app("GET", `/app/templates/${id}`);
      const replaced = await app("PUT", `/app/templates/${id}`, {
        name: "Designed",
        subject: "Hi",
        html: "<p>By hand</p>",
      });

      expect(read.json()).toMatchObject({ design });
      expect(replaced.json()).toMatchObject({ design: null });
      await app("DELETE", `/app/templates/${id}`);
    });

    it("gives each template a unique slug that can be edited", async () => {
      const first = await app("POST", "/app/templates", {
        name: "Receipt",
        subject: "Hi",
        html: "<p>Hi</p>",
      });
      const second = await app("POST", "/app/templates", {
        name: "Receipt!",
        subject: "Hi",
        html: "<p>Hi</p>",
      });
      const chosen = await app("POST", "/app/templates", {
        name: "Chosen",
        slug: "my-chosen-slug-1",
        subject: "Hi",
        html: "<p>Hi</p>",
      });
      const invalid = await app("POST", "/app/templates", {
        name: "Invalid",
        slug: "Has Spaces",
        subject: "Hi",
        html: "<p>Hi</p>",
      });
      const taken = await app("POST", "/app/templates", {
        name: "Another",
        slug: "receipt",
        subject: "Hi",
        html: "<p>Hi</p>",
      });
      const firstId = first.json<{ id: string }>().id;
      const renamed = await app("PUT", `/app/templates/${firstId}`, {
        name: "Receipt",
        slug: "paid-receipt",
        subject: "Hi",
        html: "<p>Hi</p>",
      });
      const kept = await app("PUT", `/app/templates/${firstId}`, {
        name: "Receipt renamed",
        subject: "Hi",
        html: "<p>Hi</p>",
      });
      const clash = await app("PUT", `/app/templates/${firstId}`, {
        name: "Receipt renamed",
        slug: "receipt-2",
        subject: "Hi",
        html: "<p>Hi</p>",
      });
      const badUpdate = await app("PUT", `/app/templates/${firstId}`, {
        name: "Receipt renamed",
        slug: "UPPER",
        subject: "Hi",
        html: "<p>Hi</p>",
      });

      expect(first.json()).toMatchObject({ slug: "receipt" });
      expect(second.json()).toMatchObject({ slug: "receipt-2" });
      expect(chosen.json()).toMatchObject({ slug: "my-chosen-slug-1" });
      expect(invalid.statusCode).toBe(422);
      expect(invalid.json()).toMatchObject({
        error: "validation_failed",
        errors: [{ field: "slug" }],
      });
      expect(invalid.json<{ message: string }>().message).toContain(
        "lowercase letters, numbers and hyphens",
      );
      expect(taken.statusCode).toBe(409);
      expect(taken.json()).toEqual({
        error: "template_slug_taken",
        message: 'A template with the slug "receipt" already exists',
      });
      expect(renamed.json()).toMatchObject({ slug: "paid-receipt" });
      expect(kept.json()).toMatchObject({
        name: "Receipt renamed",
        slug: "paid-receipt",
      });
      expect(clash.statusCode).toBe(409);
      expect(clash.json()).toMatchObject({ error: "template_slug_taken" });
      expect(badUpdate.statusCode).toBe(422);
      for (const response of [first, second, chosen]) {
        await app(
          "DELETE",
          `/app/templates/${response.json<{ id: string }>().id}`,
        );
      }
    });

    it("refuses a template that does not render", async () => {
      const response = await app("POST", "/app/templates", {
        name: "Broken",
        subject: "Hi",
        html: "{{#if}}",
      });
      expect(response.statusCode).toBe(422);
    });
  });

  describe("configurations", () => {
    it("creates, reads, updates and deletes a configuration, which templates can use", async () => {
      const created = await app("POST", "/app/configurations", {
        name: " Shop ",
        fromEmail: "shop@example.com",
        fromName: "The Shop",
      });
      const id = created.json<{ id: string }>().id;
      const duplicate = await app("POST", "/app/configurations", {
        name: "Shop",
        fromEmail: "other@example.com",
      });
      const badAddress = await app("POST", "/app/configurations", {
        name: "Broken",
        fromEmail: "not an address",
      });
      const template = await app("POST", "/app/templates", {
        name: "Shop receipt",
        subject: "Receipt",
        html: "<p>Paid</p>",
        configurationId: id,
      });
      const missing = await app("POST", "/app/templates", {
        name: "Missing configuration",
        subject: "Hi",
        html: "<p>Hi</p>",
        configurationId: "6d1f2c1e-2f7a-4f7e-9d2a-0c1d2e3f4a5b",
      });
      const updated = await app("PUT", `/app/configurations/${id}`, {
        name: "Shop",
        fromEmail: "orders@example.com",
        fromName: "",
      });
      const read = await app("GET", `/app/configurations/${id}`);
      const list = await app("GET", "/app/configurations");
      const publicApi = await api("GET", "/v1/configurations");
      const removed = await app("DELETE", `/app/configurations/${id}`);
      const templateId = template.json<{ id: string }>().id;
      const templateAfterDelete = await app(
        "GET",
        `/app/templates/${templateId}`,
      );
      const removedAgain = await app("DELETE", `/app/configurations/${id}`);

      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({
        name: "Shop",
        fromEmail: "shop@example.com",
        fromName: "The Shop",
      });
      expect(duplicate.statusCode).toBe(409);
      expect(duplicate.json()).toEqual({
        error: "configuration_name_taken",
        message: 'A configuration called "Shop" already exists',
      });
      expect(badAddress.statusCode).toBe(422);
      expect(badAddress.json()).toMatchObject({
        errors: [{ field: "fromEmail" }],
      });
      expect(template.json()).toMatchObject({ configurationId: id });
      expect(missing.statusCode).toBe(422);
      expect(missing.json()).toMatchObject({
        errors: [{ field: "configurationId" }],
      });
      expect(updated.json()).toMatchObject({
        fromEmail: "orders@example.com",
        fromName: "",
      });
      expect(read.json()).toMatchObject({
        usedBy: [{ id: templateId, name: "Shop receipt" }],
      });
      expect(list.json()).toMatchObject({ configurations: [{ id }] });
      expect(publicApi.statusCode).toBe(404);
      expect(removed.statusCode).toBe(200);
      expect(templateAfterDelete.json()).toMatchObject({
        configurationId: null,
      });
      expect(removedAgain.statusCode).toBe(404);
      await app("DELETE", `/app/templates/${templateId}`);
    });
  });

  describe("sending (#79)", () => {
    let templateId: string;

    beforeAll(async () => {
      await configureSmtp(smtpPort);
      const created = await app("POST", "/app/templates", {
        name: "Welcome",
        subject: "Welcome, {{name}}",
        html: "<h1>Hello {{name}}</h1><p>Thanks for joining.</p>",
        variables: ["name"],
      });
      templateId = created.json<{ id: string }>().id;
    });

    it("renders a template, sends it through SMTP and logs it as sent", async () => {
      const { id, outcome } = await sendAndDeliver({
        to: ["ada@example.com"],
        cc: ["cc@example.com"],
        replyTo: "help@example.com",
        templateId,
        variables: { name: "Ada" },
      });
      const [mail] = await listMail();
      const content = await readMail(mail?.ID ?? "");
      const status = await api("GET", `/v1/messages/${id}`);

      expect(outcome).toBe("sent");
      expect(content.Subject).toBe("Welcome, Ada");
      expect(content.HTML).toContain("<h1>Hello Ada</h1>");
      expect(content.Text).toContain("HELLO ADA");
      expect(status.json()).toMatchObject({
        status: "sent",
        from: "App <app@example.com>",
        attempts: 1,
        error: null,
      });
      expect(
        status.json<{ providerMessageId: string }>().providerMessageId,
      ).not.toBe("");
    });

    it("adds the built-in emails once, and sends one by its name", async () => {
      const first = await runCliCommand(
        database,
        ["templates:add-built-ins"],
        () => Promise.resolve(""),
      );
      const again = await runCliCommand(
        database,
        ["templates:add-built-ins"],
        () => Promise.resolve(""),
      );
      const { outcome } = await sendAndDeliver({
        to: ["ada@example.com"],
        templateName: "Wizzaroo - Reset your password",
        variables: {
          email: "ada@example.com",
          resetUrl: "https://app.example.com/reset?token=t1",
          linkLifetime: "1 hour",
        },
      });
      const [mail] = await listMail();
      const content = await readMail(mail?.ID ?? "");
      const unknown = await api("POST", "/v1/messages", {
        to: ["ada@example.com"],
        templateName: "No such template",
      });
      const both = await api("POST", "/v1/messages", {
        to: ["ada@example.com"],
        templateId,
        templateName: "Welcome",
        variables: { name: "Ada" },
      });
      const bySlug = await sendAndDeliver({
        to: ["ada@example.com"],
        templateSlug: "wizzaroo-password-changed",
        variables: {
          email: "ada@example.com",
          changedAt: "20 November 2026 at 10:48 (UK time)",
        },
      });
      const unknownSlug = await api("POST", "/v1/messages", {
        to: ["ada@example.com"],
        templateSlug: "no-such-template",
      });
      const nameAndSlug = await api("POST", "/v1/messages", {
        to: ["ada@example.com"],
        templateName: "Welcome",
        templateSlug: "welcome",
        variables: { name: "Ada" },
      });

      const [wizzaroo] = await database
        .select()
        .from(configurations)
        .where(eq(configurations.name, "Wizzaroo"));
      const builtInRows = await database
        .select({ configurationId: templates.configurationId })
        .from(templates)
        .where(sql`${templates.name} like 'Wizzaroo - %'`);
      const updated = await runCliCommand(
        database,
        ["templates:update-built-ins"],
        () => Promise.resolve(""),
      );
      expect(updated).toContain("15 built-in email templates");
      expect(wizzaroo).toMatchObject({
        fromEmail: "no-reply@wizzaroo.adrianeyre.co.uk",
        fromName: "Wizzaroo",
      });
      expect(builtInRows).toHaveLength(15);
      expect(
        builtInRows.every((row) => row.configurationId === wizzaroo?.id),
      ).toBe(true);
      expect(content.From).toEqual({
        Name: "Wizzaroo",
        Address: "no-reply@wizzaroo.adrianeyre.co.uk",
      });
      expect(first).toMatch(/^Added 15 built-in email templates: /u);
      expect(again).toContain("Skipped 15");
      expect(outcome).toBe("sent");
      expect(content.Subject).toBe("Reset your Wizzaroo password");
      // Handlebars escapes "=" as &#x3D;, which mail apps decode back.
      expect(content.HTML).toContain(
        'href="https://app.example.com/reset?token&#x3D;t1"',
      );
      expect(content.Text).toContain("Choose a new password");
      // The Wizzaroo header and footer are sent around it.
      expect(content.HTML).toContain('aria-label="Wizzaroo"');
      expect(content.Text).toContain("This is an automated message");
      expect(content.Text).not.toContain("Choose a new password for your");
      expect(unknown.statusCode).toBe(404);
      expect(both.statusCode).toBe(422);
      expect(bySlug.outcome).toBe("sent");
      expect(unknownSlug.statusCode).toBe(404);
      expect(unknownSlug.json()).toMatchObject({
        error: "not_found",
        message: 'The template "no-such-template" was not found',
      });
      expect(nameAndSlug.statusCode).toBe(422);
      expect(nameAndSlug.json()).toMatchObject({
        errors: [{ field: "templateSlug" }],
      });
    });

    it("sends from the template's configuration unless the request gives a from address", async () => {
      const configuration = await app("POST", "/app/configurations", {
        name: "Precedence",
        fromEmail: "no-reply@precedence.example.com",
        fromName: "Precedence Team",
      });
      const configurationId = configuration.json<{ id: string }>().id;
      const created = await app("POST", "/app/templates", {
        name: "Configured",
        subject: "Configured",
        html: "<p>Hi</p>",
        configurationId,
      });
      const configuredId = created.json<{ id: string }>().id;

      const fromConfiguration = await sendAndDeliver({
        to: ["ada@example.com"],
        templateId: configuredId,
      });
      const [first] = await listMail();
      const firstMail = await readMail(first?.ID ?? "");
      const logged = await api("GET", `/v1/messages/${fromConfiguration.id}`);
      await fetch(`${mailpitApi}/api/v1/messages`, { method: "DELETE" });

      await sendAndDeliver({
        to: ["ada@example.com"],
        from: "Override <override@example.com>",
        templateId: configuredId,
      });
      const [second] = await listMail();
      const secondMail = await readMail(second?.ID ?? "");
      await fetch(`${mailpitApi}/api/v1/messages`, { method: "DELETE" });

      await app("DELETE", `/app/configurations/${configurationId}`);
      await sendAndDeliver({
        to: ["ada@example.com"],
        templateId: configuredId,
      });
      const [third] = await listMail();
      const thirdMail = await readMail(third?.ID ?? "");

      expect(firstMail.From).toEqual({
        Name: "Precedence Team",
        Address: "no-reply@precedence.example.com",
      });
      expect(logged.json()).toMatchObject({
        from: "Precedence Team <no-reply@precedence.example.com>",
      });
      expect(secondMail.From).toEqual({
        Name: "Override",
        Address: "override@example.com",
      });
      expect(thirdMail.From).toEqual({
        Name: "App",
        Address: "app@example.com",
      });
      await app("DELETE", `/app/templates/${configuredId}`);
    });

    it("sends raw content with attachments and drops the attachments once sent", async () => {
      const { id } = await sendAndDeliver({
        from: "billing@example.com",
        to: ["ada@example.com"],
        subject: "Your invoice",
        text: "Attached.",
        attachments: [
          {
            filename: "invoice.txt",
            contentType: "text/plain",
            content: Buffer.from("total: 10").toString("base64"),
          },
        ],
      });
      const [mail] = await listMail();
      const content = await readMail(mail?.ID ?? "");
      const [left] = await database
        .select({ total: count() })
        .from(messageAttachments)
        .where(eq(messageAttachments.messageId, id));

      expect(content.Attachments.map((file) => file.FileName)).toEqual([
        "invoice.txt",
      ]);
      expect(left?.total).toBe(0);
    });

    it("refuses a send missing a required variable, or mixing a template with raw content", async () => {
      const missing = await api("POST", "/v1/messages", {
        to: ["ada@example.com"],
        templateId,
        variables: {},
      });
      const mixed = await api("POST", "/v1/messages", {
        to: ["ada@example.com"],
        templateId,
        subject: "Also this",
        variables: { name: "Ada" },
      });
      const empty = await api("POST", "/v1/messages", {
        to: ["ada@example.com"],
      });

      expect(missing.statusCode).toBe(422);
      expect(missing.json()).toMatchObject({
        errors: [{ field: "variables.name" }],
      });
      expect(mixed.statusCode).toBe(422);
      expect(empty.statusCode).toBe(422);
    });

    it("queues the send-message job in the same transaction as the message", async () => {
      const accepted = await api("POST", "/v1/messages", {
        to: ["queue@example.com"],
        subject: "Queued",
        text: "Hi",
      });
      const jobs = await boss.fetch<{ messageId: string }>("send-message", {
        batchSize: 50,
      });
      expect(jobs.map((job) => job.data.messageId)).toContain(
        accepted.json<{ id: string }>().id,
      );
    });

    it("returns the first message for a repeated Idempotency-Key without sending again", async () => {
      const payload = { to: ["once@example.com"], subject: "Once", text: "Hi" };
      const headers = { "idempotency-key": "order-42" };
      const first = await api("POST", "/v1/messages", payload, headers);
      const second = await api("POST", "/v1/messages", payload, headers);
      const [stored] = await database
        .select({ total: count() })
        .from(messages)
        .where(eq(messages.idempotencyKey, "order-42"));

      expect(first.statusCode).toBe(202);
      expect(second.statusCode).toBe(200);
      expect(second.json<{ id: string }>().id).toBe(
        first.json<{ id: string }>().id,
      );
      expect(stored?.total).toBe(1);
    });

    it("retries while the provider is down, then sends once it recovers", async () => {
      await configureSmtp(1);
      const accepted = await api("POST", "/v1/messages", {
        to: ["retry@example.com"],
        subject: "Eventually",
        text: "Hi",
      });
      const id = accepted.json<{ id: string }>().id;
      await expect(
        sendQueuedMessage(sendParts(), id, {
          retryCount: 0,
          retryLimit: sendMessageRetryLimit,
        }),
      ).rejects.toThrow(SendWillBeRetriedError);
      const whileDown = await api("GET", `/v1/messages/${id}`);

      await configureSmtp(smtpPort);
      const outcome = await sendQueuedMessage(sendParts(), id, {
        retryCount: 1,
        retryLimit: sendMessageRetryLimit,
      });
      const afterRecovery = await api("GET", `/v1/messages/${id}`);

      expect(whileDown.json()).toMatchObject({ status: "queued", attempts: 1 });
      expect(whileDown.json<{ error: string }>().error).not.toBe("");
      expect(outcome).toBe("sent");
      expect(afterRecovery.json()).toMatchObject({
        status: "sent",
        attempts: 2,
        error: null,
      });
    });

    it("marks a message failed with the error after the last retry", async () => {
      await configureSmtp(1);
      const accepted = await api("POST", "/v1/messages", {
        to: ["never@example.com"],
        subject: "Never",
        text: "Hi",
        attachments: [{ filename: "a.txt", content: "aGk=" }],
      });
      const id = accepted.json<{ id: string }>().id;
      const outcome = await sendQueuedMessage(sendParts(), id, {
        retryCount: sendMessageRetryLimit,
        retryLimit: sendMessageRetryLimit,
      });
      const status = await api("GET", `/v1/messages/${id}`);
      const [left] = await database
        .select({ total: count() })
        .from(messageAttachments)
        .where(eq(messageAttachments.messageId, id));
      await configureSmtp(smtpPort);

      expect(outcome).toBe("failed");
      expect(status.json()).toMatchObject({ status: "failed" });
      expect(status.json<{ error: string }>().error).toMatch(
        /ECONNREFUSED|connect/i,
      );
      expect(left?.total).toBe(0);
    });

    it("refuses a send with no from address when no default is set", async () => {
      await app("PUT", "/app/settings", { defaultFrom: null });
      const response = await api("POST", "/v1/messages", {
        to: ["ada@example.com"],
        subject: "Hi",
        text: "Hi",
      });
      await configureSmtp(smtpPort);
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ errors: [{ field: "from" }] });
    });

    it("sends a template test from the UI through the normal queue", async () => {
      const response = await app("POST", `/app/templates/${templateId}/test`, {
        to: "tester@example.com",
        variables: { name: "Tester" },
      });
      const id = response.json<{ id: string }>().id;
      await sendQueuedMessage(sendParts(), id, {
        retryCount: 0,
        retryLimit: sendMessageRetryLimit,
      });
      expect(response.statusCode).toBe(202);
      expect((await listMail()).map((mail) => mail.Subject)).toEqual([
        "Welcome, Tester",
      ]);
    });
  });

  describe("logs and retention (#79)", () => {
    it("searches by recipient and status, and shows the rendered body", async () => {
      await configureSmtp(smtpPort);
      const { id } = await sendAndDeliver({
        to: ["findme@example.org"],
        subject: "Searchable",
        html: "<p>Body to read</p>",
      });
      const byRecipient = await app("GET", "/app/messages?search=findme");
      const failed = await app("GET", "/app/messages?status=failed");
      const detail = await app("GET", `/app/messages/${id}`);

      expect(
        byRecipient
          .json<{ messages: { id: string }[] }>()
          .messages.map((message) => message.id),
      ).toEqual([id]);
      expect(
        failed
          .json<{ messages: { status: string }[] }>()
          .messages.every((message) => message.status === "failed"),
      ).toBe(true);
      expect(detail.json()).toMatchObject({
        html: "<p>Body to read</p>",
        text: "Body to read",
      });
    });

    it("deletes messages older than the retention period and keeps newer ones", async () => {
      await app("PUT", "/app/settings", { logRetentionDays: 7 });
      const [old] = await database
        .insert(messages)
        .values({
          from: "a@example.com",
          to: ["b@example.com"],
          subject: "Old",
          createdAt: new Date(Date.now() - 8 * dayMs),
        })
        .returning();
      const [recent] = await database
        .insert(messages)
        .values({
          from: "a@example.com",
          to: ["b@example.com"],
          subject: "Recent",
          createdAt: new Date(Date.now() - 6 * dayMs),
        })
        .returning();
      const summary = await applyRetention(database, new Date());
      const left = await database
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.subject, "Old"));
      const kept = await database
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.id, recent?.id ?? ""));

      expect(old).toBeDefined();
      expect(summary.deletedMessages).toBeGreaterThanOrEqual(1);
      expect(left).toEqual([]);
      expect(kept).toHaveLength(1);
    });
  });

  describe("migrating an older install", () => {
    it("gives existing templates unique slugs made from their names", async () => {
      await database.execute(sql`create database slug_backfill`);
      const url = new URL(postgres.getConnectionUri());
      url.pathname = "/slug_backfill";
      const older = openDatabase(url.toString());
      const folder = await mkdtemp(join(tmpdir(), "migrations-"));
      try {
        // Migrate to just before the slug (0003), as an install made before it would be.
        await cp(migrationsFolder, folder, { recursive: true });
        const journalFile = join(folder, "meta", "_journal.json");
        const journal: unknown = JSON.parse(
          await readFile(journalFile, "utf8"),
        );
        const entries: unknown = Reflect.get(Object(journal), "entries");
        await writeFile(
          journalFile,
          JSON.stringify({
            ...Object(journal),
            entries: Array.isArray(entries)
              ? entries.filter(
                  (entry: unknown) =>
                    Number(Reflect.get(Object(entry), "idx")) < 3,
                )
              : [],
          }),
        );
        await migrate(older, { migrationsFolder: folder });
        await older.execute(sql`
          insert into templates (name, subject, html, created_at) values
            ('Order Shipped', 's', 'h', now() - interval '4 minutes'),
            ('order shipped!', 's', 'h', now() - interval '3 minutes'),
            ('Order-Shipped-2', 's', 'h', now() - interval '2 minutes'),
            ('Café crème', 's', 'h', now() - interval '1 minute'),
            ('***', 's', 'h', now())
        `);
        await older.execute(sql`insert into settings (id) values (1)`);

        await migrateDatabase(older);
        const rows = await older
          .select({ name: templates.name, slug: templates.slug })
          .from(templates)
          .orderBy(templates.createdAt);
        const [settingsRow] = await older.select().from(settings);

        expect(rows).toEqual([
          { name: "Order Shipped", slug: "order-shipped" },
          { name: "order shipped!", slug: "order-shipped-2" },
          { name: "Order-Shipped-2", slug: "order-shipped-2-2" },
          { name: "Café crème", slug: "cafe-creme" },
          { name: "***", slug: "template" },
        ]);
        // A later migration gives an install with no default from address one.
        expect(settingsRow?.defaultFrom).toBe(defaultFromAddress);
      } finally {
        await older.$client.end();
        await rm(folder, { recursive: true, force: true });
      }
    });
  });
});
