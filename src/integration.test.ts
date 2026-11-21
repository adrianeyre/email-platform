import { randomBytes, scryptSync } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfig, lintFromString } from "@redocly/openapi-core";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { count, eq, inArray, like, sql } from "drizzle-orm";
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
import {
  keyRequestBurst,
  previewsPerKeyPerMinute,
  testSendsPerUserPerHour,
  userRequestBurst,
} from "./access/request-limits.js";
import { CliCommandRefusedError, runCliCommand } from "./access/cli.js";
import { createUser } from "./access/users.js";
import { buildHttpServer } from "./api/http-server.js";
import { isAllowListed, listRoutes, probeRequest } from "./api/route-list.js";
import {
  migrateDatabase,
  migrationsFolder,
  openDatabase,
  type Database,
} from "./lib/database.js";
import type { Server } from "./lib/http.js";
import {
  buildJobQueue,
  createJobQueues,
  createMigratingJobBoss,
  sendMessageRetryLimit,
} from "./lib/jobs.js";
import {
  apiKeys,
  applications,
  configurations,
  emailParts,
  messageAttachments,
  messages,
  sessions,
  settings,
  templates,
  users,
} from "./lib/schema.js";
import { hashSecret } from "./lib/secrets.js";
import { sendEmailOverSmtp } from "./sending/delivery.js";
import { defaultFromAddress } from "./settings/settings-store.js";
import {
  applyRetention,
  bodyDroppedError,
  messageBodyMaxDays,
} from "./sending/retention.js";
import { recipientsPerKeyPerMinute } from "./sending/send-limit.js";
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

const encryptionKey = randomBytes(32);
const ownerEmail = "owner@example.com";
const ownerPassword = "a long enough password";
const dayMs = 86_400_000;
/** What a send that never reached an SMTP session is told as, with no host, address or port (#173, #184). */
const unreachableSummary =
  "The SMTP provider could not be reached, or the connection to it failed (a name, network, TLS or timeout failure)";

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
  /** The Application the tests' API Key belongs to (ADR 0009). */
  let applicationId: string;

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
      // Mailpit has no TLS, so no username and no AUTH: credentials only ever go over TLS (pen test I5, #186). The
      // password is saved all the same, and given each time, as a change of port asks for it again (#185).
      smtpUsername: null,
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
    boss = createMigratingJobBoss(postgres.getConnectionUri());
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
    const created = await createApiKey(database, "Integration tests");
    apiKey = created.secret;
    applicationId = created.apiKey.applicationId;
  }, 300_000);

  afterAll(async () => {
    await server.close();
    await boss.stop({ graceful: false });
    await database.$client.end();
    await Promise.all([postgres.stop(), mailpit.stop()]);
  });

  beforeEach(async () => {
    await fetch(`${mailpitApi}/api/v1/messages`, { method: "DELETE" });
    // Each test starts with its keys' whole minute of sends (pen test K1, #133).
    // And with every key's and User's whole request limits (pen test I2a, #162, #164).
    await database.update(apiKeys).set({
      sendWindowStartedAt: null,
      sendWindowRecipients: 0,
      requestTokens: null,
      requestTokensAt: null,
      previewWindowStartedAt: null,
      previewWindowCount: 0,
    });
    await database.update(users).set({
      requestTokens: null,
      requestTokensAt: null,
      testSendWindowStartedAt: null,
      testSendWindowCount: 0,
    });
  });

  describe("health and API reference", () => {
    it("reports a healthy database", async () => {
      const response = await server.inject({ method: "GET", url: "/health" });
      expect(response.json()).toEqual({ status: "ok", database: "ok" });
    });

    it("serves the API reference to a signed-in User or an API Key holder, and refuses anyone else with 401 (#148)", async () => {
      for (const url of ["/docs/", "/docs/json", "/docs/yaml"]) {
        const anonymous = await server.inject({ method: "GET", url });
        const badKey = await server.inject({
          method: "GET",
          url,
          headers: { authorization: "Bearer ek_not-a-key" },
        });
        expect([anonymous.statusCode, badKey.statusCode], url).toEqual([
          401, 401,
        ]);
        expect((await app("GET", url)).statusCode, url).toBe(200);
        expect((await api("GET", url)).statusCode, url).toBe(200);
      }
    });

    it("lets every guarded route's caller in by its hook: a key on /v1, a session on /app, either on /docs (#149)", async () => {
      // A User and key of this test's own, so whatever a route does to the caller it is asked as touches no other test.
      await createUser(
        database,
        "route-guard@example.com",
        "route guard password",
      );
      const signedIn = await server.inject({
        method: "POST",
        url: "/auth/sign-in",
        remoteAddress: "198.51.100.149",
        payload: {
          email: "route-guard@example.com",
          password: "route guard password",
        },
      });
      const cookie = `session=${signedIn.cookies.find((c) => c.name === "session")?.value ?? ""}`;
      const created = await createApiKey(database, "Route guard");
      const key = created.secret;
      const letIn: { key: string[]; session: string[] } = {
        key: [],
        session: [],
      };
      const guarded = listRoutes(server).filter(
        (route) => !isAllowListed(route),
      );
      for (const route of guarded) {
        const name = `${route.method} ${route.path}`;
        const anonymous = await server.inject(probeRequest(route));
        expect(anonymous.statusCode, name).toBe(401);
        const byKey = await server.inject(
          probeRequest(route, { authorization: `Bearer ${key}` }),
        );
        const bySession = await server.inject(probeRequest(route, { cookie }));
        if (byKey.statusCode !== 401) {
          letIn.key.push(name);
        }
        if (bySession.statusCode !== 401) {
          letIn.session.push(name);
        }
        expect(
          byKey.statusCode !== 401 || bySession.statusCode !== 401,
          `${name} lets in neither a key nor a session`,
        ).toBe(true);
      }
      const names = (prefix: string) =>
        guarded
          .filter((route) => route.path.startsWith(prefix))
          .map((route) => `${route.method} ${route.path}`);
      expect(letIn.key.toSorted()).toEqual(
        [...names("/v1/"), ...names("/docs")].toSorted(),
      );
      expect(letIn.session.toSorted()).toEqual(
        [...names("/app/"), ...names("/docs")].toSorted(),
      );
      expect(
        names("/v1/").length + names("/app/").length + names("/docs").length,
      ).toBe(guarded.length);
      // Every other User is told of later changes, so this test's User and key leave with it.
      await database.delete(apiKeys).where(eq(apiKeys.id, created.apiKey.id));
      await database
        .delete(users)
        .where(eq(users.email, "route-guard@example.com"));
    });

    it("documents only the public API, and the document is valid OpenAPI", async () => {
      const response = await api("GET", "/docs/json");
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
          remoteAddress: "192.0.2.10",
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
        currentPassword: ownerPassword,
      });
      const short = await app("POST", "/app/users", {
        email: "short@example.com",
        password: "short",
        currentPassword: ownerPassword,
      });
      const me = await app("GET", "/app/me");
      const deleteSelf = await app(
        "DELETE",
        `/app/users/${me.json<{ userId: string }>().userId}`,
        { currentPassword: ownerPassword },
      );
      // Postgres reads a uuid in any case, so the guard does too (pen test A2, #145).
      const deleteSelfShouted = await app(
        "DELETE",
        `/app/users/${me.json<{ userId: string }>().userId.toUpperCase()}`,
        { currentPassword: ownerPassword },
      );
      const deleteFriend = await app(
        "DELETE",
        `/app/users/${added.json<{ id: string }>().id}`,
        { currentPassword: ownerPassword },
      );
      expect(added.statusCode).toBe(201);
      expect(added.json()).toMatchObject({ email: "friend@example.com" });
      expect(short.statusCode).toBe(422);
      expect(deleteSelf.statusCode).toBe(409);
      expect(deleteSelfShouted.statusCode).toBe(409);
      expect(deleteSelfShouted.json()).toMatchObject({
        error: "cannot_delete_self",
      });
      expect(deleteFriend.statusCode).toBe(200);
    });

    it("still adds a User when no default from address is set, queuing no notice to the other Users (pen test A2, #125)", async () => {
      const step = { currentPassword: ownerPassword };
      const told = await app("POST", "/app/users", {
        email: "told@example.com",
        password: "told password long",
        ...step,
      });
      await app("PUT", "/app/settings", { defaultFrom: null });
      const added = await app("POST", "/app/users", {
        email: "unannounced@example.com",
        password: "unannounced password long",
        ...step,
      });
      await app("PUT", "/app/settings", { defaultFrom: defaultFromAddress });
      expect([told.statusCode, added.statusCode]).toEqual([201, 201]);
      expect(added.json<{ createdByEmail: string }>().createdByEmail).toBe(
        ownerEmail,
      );
      const notices = await database
        .select({ text: messages.text })
        .from(messages)
        .where(eq(messages.subject, "A User was added to the email platform"));
      expect(
        notices.filter((notice) => notice.text?.includes("told@example.com")),
      ).not.toEqual([]);
      expect(
        notices.filter((notice) =>
          notice.text?.includes("unannounced@example.com"),
        ),
      ).toEqual([]);
      for (const user of [told, added]) {
        await app(
          "DELETE",
          `/app/users/${user.json<{ id: string }>().id}`,
          step,
        );
      }
      // Remove the notices so later Logs counts are unchanged.
      await database
        .delete(messages)
        .where(like(messages.subject, "A User was %"));
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

    /** Signs in as a User, answering the session's cookie header. Each from an address of its own, out of the per-address limit. */
    let signIns = 0;
    const signInAs = async (email: string, password: string) => {
      signIns += 1;
      const signIn = await server.inject({
        method: "POST",
        url: "/auth/sign-in",
        remoteAddress: `198.51.100.${String(signIns)}`,
        payload: { email, password },
      });
      expect(signIn.statusCode).toBe(200);
      return {
        cookie: `session=${signIn.cookies.find((item) => item.name === "session")?.value ?? ""}`,
      };
    };

    it("ignores X-Forwarded-For, so a fresh one on each try still blocks after 10 failures (#114)", async () => {
      await createUser(database, "forwarded@example.com", "forwarded password");
      const statuses: number[] = [];
      for (let index = 1; index <= 11; index += 1) {
        const response = await server.inject({
          method: "POST",
          url: "/auth/sign-in",
          remoteAddress: "192.0.2.11",
          headers: { "x-forwarded-for": `203.0.113.${String(index)}` },
          payload: { email: "forwarded@example.com", password: "wrong" },
        });
        statuses.push(response.statusCode);
      }
      expect(statuses).toEqual([...Array<number>(10).fill(401), 429]);
      const right = await server.inject({
        method: "POST",
        url: "/auth/sign-in",
        remoteAddress: "192.0.2.11",
        headers: { "x-forwarded-for": "198.51.100.200" },
        payload: {
          email: "forwarded@example.com",
          password: "forwarded password",
        },
      });
      expect(right.statusCode).toBe(429);
    });

    it("refuses the 11th sign-in in a row from one address whatever emails they name, with the same 429 and a Retry-After (#122)", async () => {
      const statuses: number[] = [];
      for (let index = 0; index < 10; index += 1) {
        const response = await server.inject({
          method: "POST",
          url: "/auth/sign-in",
          remoteAddress: "192.0.2.12",
          payload: {
            email: `spray-${String(index)}@example.com`,
            password: "x",
          },
        });
        statuses.push(response.statusCode);
      }
      expect(statuses).toEqual(Array<number>(10).fill(401));
      // The same address written as IPv4-mapped IPv6 is the same caller.
      const eleventh = await server.inject({
        method: "POST",
        url: "/auth/sign-in",
        remoteAddress: "::ffff:192.0.2.12",
        payload: { email: ownerEmail, password: ownerPassword },
      });
      expect(eleventh.statusCode).toBe(429);
      expect(eleventh.json()).toEqual({
        error: "too_many_requests",
        message:
          "Too many requests. Try again after the number of seconds in the Retry-After header",
      });
      expect(Number(eleventh.headers["retry-after"])).toBeGreaterThan(0);
      // Another address is not held up by it.
      const elsewhere = await server.inject({
        method: "POST",
        url: "/auth/sign-in",
        remoteAddress: "192.0.2.13",
        payload: { email: ownerEmail, password: ownerPassword },
      });
      expect(elsewhere.statusCode).toBe(200);
    });

    it("refuses a sign-in email longer than 320 characters before it reaches the throttle (#123)", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/auth/sign-in",
        remoteAddress: "192.0.2.14",
        payload: { email: `${"a".repeat(310)}@example.com`, password: "x" },
      });
      expect(response.statusCode).toBe(422);
    });

    it("counts failed sign-ins in Postgres, so a second api process refuses where the first left off (pen test A1, #142)", async () => {
      await createUser(database, "shared@example.com", "shared password long");
      const otherProcess = await buildHttpServer({
        database,
        jobs: buildJobQueue(boss),
        appUrl: new URL("http://email.test"),
        encryptionKey,
        sendEmail: sendEmailOverSmtp,
        uiDirectory: undefined,
        isLogging: false,
      });
      const attempt = (target: Server, password: string) =>
        target.inject({
          method: "POST",
          url: "/auth/sign-in",
          remoteAddress: "192.0.2.15",
          payload: { email: "shared@example.com", password },
        });
      try {
        for (let index = 0; index < 5; index += 1) {
          expect((await attempt(server, "wrong")).statusCode).toBe(401);
          expect((await attempt(otherProcess, "wrong")).statusCode).toBe(401);
        }
        expect(
          (await attempt(otherProcess, "shared password long")).statusCode,
        ).toBe(429);
        expect((await attempt(server, "shared password long")).statusCode).toBe(
          429,
        );
      } finally {
        await otherProcess.close();
      }
    });

    it("refuses a password over 1,024 characters with 422 at sign-in, adding a User and changing the password, and a body over 16 KiB at sign-in with 413 (pen test A1, #141)", async () => {
      const long = "p".repeat(1025);
      const signIn = await server.inject({
        method: "POST",
        url: "/auth/sign-in",
        remoteAddress: "192.0.2.16",
        payload: { email: ownerEmail, password: long },
      });
      const added = await app("POST", "/app/users", {
        email: "long@example.com",
        password: long,
        currentPassword: ownerPassword,
      });
      const changed = await app("PUT", "/app/me/password", {
        currentPassword: ownerPassword,
        newPassword: long,
      });
      const stepUp = await app("PUT", "/app/me/password", {
        currentPassword: long,
        newPassword: ownerPassword,
      });
      for (const response of [signIn, added, changed, stepUp]) {
        expect(response.statusCode).toBe(422);
        expect(response.json()).toMatchObject({ error: "validation_failed" });
      }
      await expect(
        createUser(database, "cli-long@example.com", long),
      ).rejects.toThrow("The password must be at most 1024 characters");
      const huge = await server.inject({
        method: "POST",
        url: "/auth/sign-in",
        remoteAddress: "192.0.2.16",
        payload: { email: ownerEmail, password: "p".repeat(20_000) },
      });
      expect(huge.statusCode).toBe(413);
    });

    it("hashes at OWASP's scrypt cost, and makes a hash at an older, cheaper cost again on the next sign-in (pen test A1, #140)", async () => {
      await createUser(database, "old-hash@example.com", "old hash password");
      // The hash as the platform made it before #140: N=2^14.
      const salt = randomBytes(16);
      const key = scryptSync("old hash password", salt, 64, {
        N: 16_384,
        r: 8,
        p: 1,
      });
      const oldHash = `scrypt$16384$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`;
      await database
        .update(users)
        .set({ passwordHash: oldHash })
        .where(eq(users.email, "old-hash@example.com"));
      await signInAs("old-hash@example.com", "old hash password");
      const [row] = await database
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.email, "old-hash@example.com"));
      expect(row?.passwordHash).toMatch(/^scrypt\$131072\$8\$1\$/);
      await signInAs("old-hash@example.com", "old hash password");
    });

    it("refuses a session left unused for 7 days within its 30, and writes its last use at most every few minutes (pen test A1, #143)", async () => {
      await createUser(database, "idle@example.com", "idle password long");
      const headers = await signInAs("idle@example.com", "idle password long");
      const tokenHash = hashSecret(headers.cookie.slice("session=".length));
      const setLastUse = (lastUsedAt: Date) =>
        database
          .update(sessions)
          .set({ lastUsedAt })
          .where(eq(sessions.tokenHash, tokenHash));
      const lastUse = async () =>
        (
          await database
            .select({ lastUsedAt: sessions.lastUsedAt })
            .from(sessions)
            .where(eq(sessions.tokenHash, tokenHash))
        )[0]?.lastUsedAt.getTime() ?? 0;
      const me = () =>
        server.inject({ method: "GET", url: "/app/me", headers });
      const aMinuteAgo = new Date(Date.now() - 60_000);
      await setLastUse(aMinuteAgo);
      expect((await me()).statusCode).toBe(200);
      expect(await lastUse()).toBe(aMinuteAgo.getTime());
      await setLastUse(new Date(Date.now() - 6 * dayMs));
      expect((await me()).statusCode).toBe(200);
      expect(Date.now() - (await lastUse())).toBeLessThan(60_000);
      await setLastUse(new Date(Date.now() - 7 * dayMs - 60_000));
      expect((await me()).statusCode).toBe(401);
    });

    it("asks for the current password before adding a user, minting an API key or deleting a user (#115)", async () => {
      await createUser(database, "step-up@example.com", "step up password");
      const headers = await signInAs("step-up@example.com", "step up password");
      const doomed = await createUser(
        database,
        "doomed@example.com",
        "doomed password long",
      );
      const routes = [
        {
          method: "POST",
          url: "/app/users",
          body: { email: "stepped@example.com", password: "stepped password" },
          status: 201,
        },
        {
          method: "POST",
          url: "/app/api-keys",
          body: { name: "Stepped up" },
          status: 201,
        },
        {
          method: "DELETE",
          url: `/app/users/${doomed.id}`,
          body: {},
          status: 200,
        },
      ] as const;
      for (const { method, url, body, status } of routes) {
        const send = (payload: object) =>
          server.inject({ method, url, headers, payload });
        const missing = await send(body);
        const wrong = await send({ ...body, currentPassword: "not it" });
        const right = await send({
          ...body,
          currentPassword: "step up password",
        });
        expect({ url, status: missing.statusCode }).toEqual({
          url,
          status: 422,
        });
        expect(missing.json()).toMatchObject({
          error: "validation_failed",
          errors: [
            {
              field: "currentPassword",
              message: "body.currentPassword is required",
            },
          ],
        });
        expect({ url, status: wrong.statusCode }).toEqual({ url, status: 422 });
        expect(wrong.json()).toEqual({
          error: "validation_failed",
          message: "The current password is wrong",
        });
        expect({ url, status: right.statusCode }).toEqual({ url, status });
      }
      const [stepped] = await database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, "stepped@example.com"));
      expect(stepped).toBeDefined();
      const [doomedLeft] = await database
        .select({ count: count() })
        .from(users)
        .where(eq(users.id, doomed.id));
      expect(doomedLeft?.count).toBe(0);
    });

    it("blocks a User's step-up after 10 wrong passwords, even with the right one (#115)", async () => {
      await createUser(database, "guesser@example.com", "guesser password");
      const headers = await signInAs("guesser@example.com", "guesser password");
      const mint = (currentPassword: string) =>
        server.inject({
          method: "POST",
          url: "/app/api-keys",
          headers,
          payload: { name: "Guessed", currentPassword },
        });
      const statuses: number[] = [];
      for (let index = 0; index < 11; index += 1) {
        statuses.push((await mint(`guess ${String(index)}`)).statusCode);
      }
      expect(statuses).toEqual([...Array<number>(10).fill(422), 429]);
      const right = await mint("guesser password");
      expect(right.statusCode).toBe(429);
      expect(right.json()).toEqual({
        error: "too_many_requests",
        message:
          "Too many requests. Try again after the number of seconds in the Retry-After header",
      });
    });

    it("ends every other session of the User when their password changes, keeping the one that changed it (#115, #124)", async () => {
      await createUser(database, "changer@example.com", "changer password");
      const stolen = await signInAs("changer@example.com", "changer password");
      const own = await signInAs("changer@example.com", "changer password");
      const change = await server.inject({
        method: "PUT",
        url: "/app/me/password",
        headers: own,
        payload: {
          currentPassword: "changer password",
          newPassword: "changer new password",
        },
      });
      expect(change.statusCode).toBe(200);
      const whoAmI = (headers: { cookie: string }) =>
        server.inject({ method: "GET", url: "/app/me", headers });
      expect((await whoAmI(own)).statusCode).toBe(200);
      expect((await whoAmI(stolen)).statusCode).toBe(401);
      // Another User's session is not touched.
      expect((await app("GET", "/app/me")).statusCode).toBe(200);
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
      const created = await app("POST", "/app/api-keys", {
        name: "Shop",
        currentPassword: ownerPassword,
      });
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
      // Recorded as a sent Message with no Application, which the Logs show every User (pen test I2a, #164).
      const logs = await app("GET", "/app/messages?search=me%40example.com");
      expect(logs.json()).toMatchObject({
        messages: [
          { to: ["me@example.com"], subject: "Test email", status: "sent" },
        ],
      });
      const [recorded] = await database
        .select({ applicationId: messages.applicationId })
        .from(messages)
        .where(eq(messages.subject, "Test email"));
      expect(recorded).toEqual({ applicationId: null });
      await database.delete(messages).where(eq(messages.subject, "Test email"));
    });

    it("records a test email the provider refused as a failed Message (pen test I2a, #164)", async () => {
      await configureSmtp(1);
      const test = await app("POST", "/app/settings/test", {
        to: "refused@example.com",
      });
      expect(test.statusCode).toBe(502);
      // Told by its class, with no address or port, so the test send is no port scanner (pen test I5, #184).
      expect(test.json()).toEqual({
        error: "smtp_failed",
        message: `The test email was not sent: ${unreachableSummary}`,
      });
      const [recorded] = await database
        .select({
          to: messages.to,
          status: messages.status,
          error: messages.error,
        })
        .from(messages)
        .where(eq(messages.subject, "Test email"));
      expect(recorded).toMatchObject({
        to: ["refused@example.com"],
        status: "failed",
        error: unreachableSummary,
      });
      await database.delete(messages).where(eq(messages.subject, "Test email"));
      await configureSmtp(smtpPort);
    });

    it("keeps the saved password when a change leaves it out", async () => {
      await app("PUT", "/app/settings", { logRetentionDays: 30 });
      const read = await app("GET", "/app/settings");
      expect(read.json()).toMatchObject({
        hasSmtpPassword: true,
        logRetentionDays: 30,
      });
    });

    it("asks for the saved password again when the host or port changes (pen test I5, #185)", async () => {
      for (const change of [
        { smtpHost: "smtp.elsewhere.example" },
        { smtpPort: smtpPort + 1 },
      ]) {
        const refused = await app("PUT", "/app/settings", change);
        expect(refused.statusCode).toBe(422);
        expect(refused.json()).toMatchObject({
          error: "validation_failed",
          errors: [{ field: "smtpPassword" }],
        });
      }
      const [row] = await database.select().from(settings);
      expect(row).toMatchObject({ smtpHost: mailpit.getHost(), smtpPort });
      // The same host in another case, with the same port, isn't a change.
      const same = await app("PUT", "/app/settings", {
        smtpHost: mailpit.getHost().toUpperCase(),
        smtpPort,
      });
      expect(same.statusCode, same.body).toBe(200);
      const cleared = await app("PUT", "/app/settings", {
        smtpHost: "smtp.elsewhere.example",
        smtpPassword: null,
      });
      expect(cleared.json()).toMatchObject({ hasSmtpPassword: false });
      await configureSmtp(smtpPort);
    });

    it("won't send credentials to a server that doesn't offer STARTTLS (pen test I5, #186)", async () => {
      await app("PUT", "/app/settings", { smtpUsername: "mailer" });
      const test = await app("POST", "/app/settings/test", {
        to: "plaintext@example.com",
      });
      expect(test.statusCode).toBe(502);
      expect(test.json<{ message: string }>().message).toBe(
        `The test email was not sent: ${unreachableSummary}`,
      );
      expect(await listMail()).toEqual([]);
      await database.delete(messages).where(eq(messages.subject, "Test email"));
      await configureSmtp(smtpPort);
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
      // Given to the tests' Application, so its key may send from the Wizzaroo Configuration's address (ADR 0009).
      const first = await runCliCommand(
        database,
        ["templates:add-built-ins", "--application", "Integration tests"],
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
      expect(first).toContain(
        'Gave them to the application "Integration tests"',
      );
      expect(wizzaroo?.applicationId).toBe(applicationId);
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
        applicationId,
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

      // The request's from wins, when it is one the key's Application may send from: here the default.
      await sendAndDeliver({
        to: ["ada@example.com"],
        from: "Override <app@example.com>",
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
        Address: "app@example.com",
      });
      expect(thirdMail.From).toEqual({
        Name: "App",
        Address: "app@example.com",
      });
      await app("DELETE", `/app/templates/${configuredId}`);
    });

    it("sends raw content with attachments and drops the attachments once sent", async () => {
      const { id } = await sendAndDeliver({
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

    it("refuses a repeated Idempotency-Key with a different request with 409, and replays a Message stored before fingerprints with any request (pen test S2, #135)", async () => {
      const headers = { "idempotency-key": "order-43" };
      const payload = {
        to: ["first@example.com"],
        subject: "First",
        text: "Hi",
      };
      const first = await api("POST", "/v1/messages", payload, headers);
      expect(first.statusCode).toBe(202);
      const different = await api(
        "POST",
        "/v1/messages",
        { ...payload, to: ["second@example.com"] },
        headers,
      );
      expect(different.statusCode).toBe(409);
      expect(different.json()).toMatchObject({
        error: "idempotency_key_reused",
      });
      // A left-out cc is the same request as an empty one.
      const same = await api(
        "POST",
        "/v1/messages",
        { text: "Hi", cc: [], subject: "First", to: ["first@example.com"] },
        headers,
      );
      expect(same.statusCode).toBe(200);

      // A Message stored before the fingerprint was kept has none: it is answered as a repeat, as it was then.
      await database
        .update(messages)
        .set({ requestFingerprint: null })
        .where(eq(messages.id, first.json<{ id: string }>().id));
      const unknownFirst = await api(
        "POST",
        "/v1/messages",
        { ...payload, subject: "Anything" },
        headers,
      );
      expect(unknownFirst.statusCode).toBe(200);
      expect(unknownFirst.json<{ id: string }>().id).toBe(
        first.json<{ id: string }>().id,
      );
    });

    it("sends each to, cc and bcc entry to its one mailbox, a display name kept, and refuses a list, a group or CR and LF in an entry with 422 (pen test S1, #134)", async () => {
      await configureSmtp(smtpPort);
      const { outcome } = await sendAndDeliver({
        to: ['"Lovelace, Ada" <ada@example.com>'],
        cc: ["Grace <grace@example.com>"],
        subject: "One mailbox each",
        text: "Hi",
      });
      expect(outcome).toBe("sent");
      const [mail] = await listMail();
      expect(mail?.To.map((to) => to.Address)).toEqual(["ada@example.com"]);

      for (const entry of [
        "a@example.com, b@example.com",
        "Team: a@example.com, b@example.com;",
        "a@example.com\r\nBcc: b@example.com",
        "no-at-sign",
        "<>",
      ]) {
        const refused = await api("POST", "/v1/messages", {
          to: ["fine@example.com"],
          bcc: [entry],
          subject: "Refused",
          text: "Hi",
        });
        expect(refused.statusCode, entry).toBe(422);
        expect(refused.json(), entry).toMatchObject({
          errors: [{ field: "bcc.0" }],
        });
      }
    });

    it("counts a key's recipient addresses against its limit a minute, across processes, reports it, and refuses the rest with 429 and Retry-After (pen test K1, #133)", async () => {
      const { secret, apiKey: key } = await createApiKey(
        database,
        "Send limit",
        "Integration tests",
      );
      const otherProcess = await buildHttpServer({
        database,
        jobs: buildJobQueue(boss),
        appUrl: new URL("http://email.test"),
        encryptionKey,
        sendEmail: sendEmailOverSmtp,
        uiDirectory: undefined,
        isLogging: false,
      });
      const sendOn = (target: Server, to: string[], subject: string) =>
        target.inject({
          method: "POST",
          url: "/v1/messages",
          headers: { authorization: `Bearer ${secret}` },
          payload: { to, subject, text: "Hi" },
        });
      const addresses = (count: number, label: string) =>
        Array.from(
          { length: count },
          (_, index) => `${label}${String(index)}@example.com`,
        );
      try {
        const limit = recipientsPerKeyPerMinute;
        const tooMany = await sendOn(
          server,
          addresses(limit + 1, "many"),
          "Limit: too many",
        );
        expect(tooMany.statusCode).toBe(422);

        const half = Math.floor(limit / 2);
        const first = await sendOn(server, addresses(half, "a"), "Limit: a");
        expect(first.statusCode).toBe(202);
        expect(first.headers["ratelimit-limit"]).toBe(String(limit));
        expect(first.headers["ratelimit-remaining"]).toBe(String(limit - half));
        const reset = Number(first.headers["ratelimit-reset"]);
        expect(reset).toBeGreaterThanOrEqual(1);
        expect(reset).toBeLessThanOrEqual(60);

        // Two processes sending what together is more than is left: one is counted, the other refused.
        const [left, right] = await Promise.all([
          sendOn(server, addresses(limit - half, "b"), "Limit: b"),
          sendOn(otherProcess, addresses(limit - half, "c"), "Limit: c"),
        ]);
        expect([left.statusCode, right.statusCode].toSorted()).toEqual([
          202, 429,
        ]);
        const refused = left.statusCode === 429 ? left : right;
        expect(refused.json()).toEqual({
          error: "too_many_requests",
          message:
            "Too many requests. Try again after the number of seconds in the Retry-After header",
        });
        expect(Number(refused.headers["retry-after"])).toBeGreaterThanOrEqual(
          1,
        );
        expect(refused.headers["ratelimit-remaining"]).toBe("0");

        const [stored] = await database
          .select({ total: count() })
          .from(messages)
          .where(eq(messages.apiKeyId, key.id));
        expect(stored?.total).toBe(2);
        const [row] = await database
          .select({ recipients: apiKeys.sendWindowRecipients })
          .from(apiKeys)
          .where(eq(apiKeys.id, key.id));
        expect(row?.recipients).toBe(limit);

        // Another key of the same Application has a minute of its own.
        const other = await api("POST", "/v1/messages", {
          to: ["own-minute@example.com"],
          subject: "Limit: another key",
          text: "Hi",
        });
        expect(other.statusCode).toBe(202);
      } finally {
        await otherProcess.close();
      }
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
      const bodyWhileDown = await app("GET", `/app/messages/${id}`);

      await configureSmtp(smtpPort);
      const outcome = await sendQueuedMessage(sendParts(), id, {
        retryCount: 1,
        retryLimit: sendMessageRetryLimit,
      });
      const afterRecovery = await api("GET", `/v1/messages/${id}`);
      const [mail] = await listMail();

      expect(whileDown.json()).toMatchObject({ status: "queued", attempts: 1 });
      expect(whileDown.json<{ error: string }>().error).not.toBe("");
      // The retry needs the body, so a Message waiting for one keeps it (#116).
      expect(bodyWhileDown.json()).toMatchObject({
        isBodyKept: true,
        text: "Hi",
      });
      expect(outcome).toBe("sent");
      expect(mail?.Subject).toBe("Eventually");
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

      const [row] = await database
        .select({ html: messages.html, text: messages.text })
        .from(messages)
        .where(eq(messages.id, id));

      expect(outcome).toBe("failed");
      expect(status.json()).toMatchObject({ status: "failed" });
      // A failed Message is never sent again, so its body goes with its attachments (#116).
      expect(row).toEqual({ html: null, text: null });
      // Its class only, never Node's network error naming the SMTP host and port (pen test I1, #173).
      expect(status.json<{ error: string }>().error).toBe(unreachableSummary);
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

  describe("API keys belong to an Application (ADR 0009; pen test K1, #113, #117, #118)", () => {
    /** The other Application's key, made by a User for "Other app". */
    let otherKey: string;
    let otherApplicationId: string;

    const withKey = (
      secret: string,
      method: "GET" | "POST" | "PUT" | "DELETE",
      url: string,
      payload?: object,
    ) =>
      server.inject({
        method,
        url,
        headers: { authorization: `Bearer ${secret}` },
        ...(payload === undefined ? {} : { payload }),
      });
    const unknownId = "00000000-0000-4000-8000-000000000000";
    const templateBody = (name: string) => ({
      name,
      subject: "Scoped",
      html: "<p>Scoped</p>",
    });
    const idOf = (response: { body: string }): string => {
      const body: unknown = JSON.parse(response.body);
      const id: unknown = Reflect.get(Object(body), "id");
      return typeof id === "string" ? id : "";
    };

    beforeAll(async () => {
      await configureSmtp(smtpPort);
      const created = await app("POST", "/app/api-keys", {
        name: "Other key",
        application: "Other app",
        currentPassword: ownerPassword,
      });
      expect(created.statusCode).toBe(201);
      const body = created.json<{
        secret: string;
        apiKey: { applicationId: string; applicationName: string };
      }>();
      otherKey = body.secret;
      otherApplicationId = body.apiKey.applicationId;
      expect(body.apiKey.applicationName).toBe("Other app");
      expect(otherApplicationId).not.toBe(applicationId);
    });

    it("lets a key change and delete only its own Application's Templates, Headers and Footers, answering 404 for any other", async () => {
      const template = await withKey(
        otherKey,
        "POST",
        "/v1/templates",
        templateBody("Other app's template"),
      );
      const header = await withKey(otherKey, "POST", "/v1/headers", {
        name: "Other app's header",
        html: "<p>Header</p>",
      });
      const footer = await withKey(otherKey, "POST", "/v1/footers", {
        name: "Other app's footer",
        html: "<p>Footer</p>",
      });
      expect(template.json()).toMatchObject({
        applicationId: otherApplicationId,
      });
      expect(header.json()).toMatchObject({
        applicationId: otherApplicationId,
      });

      const targets = [
        [`/v1/templates/${idOf(template)}`, templateBody("Taken over")],
        [`/v1/headers/${idOf(header)}`, { name: "Taken", html: "<p>x</p>" }],
        [`/v1/footers/${idOf(footer)}`, { name: "Taken", html: "<p>x</p>" }],
      ] as const;
      for (const [url, payload] of targets) {
        const unknownUrl = url.replace(/[^/]+$/u, unknownId);
        const put = await withKey(apiKey, "PUT", url, payload);
        const putUnknown = await withKey(apiKey, "PUT", unknownUrl, payload);
        const deleted = await withKey(apiKey, "DELETE", url);
        const deletedUnknown = await withKey(apiKey, "DELETE", unknownUrl);
        expect(put.statusCode, url).toBe(404);
        expect(put.body).toBe(putUnknown.body);
        expect(deleted.statusCode, url).toBe(404);
        expect(deleted.body).toBe(deletedUnknown.body);
        // Reading is not scoped: any key may read and send with any Template.
        expect((await withKey(apiKey, "GET", url)).statusCode).toBe(200);
      }
      // A key can't make a row for another Application.
      const forOther = await withKey(apiKey, "POST", "/v1/templates", {
        ...templateBody("For the other app"),
        applicationId: otherApplicationId,
      });
      expect(forOther.statusCode).toBe(422);

      // Its own key changes it; a User can change and delete it, and keeps its owner unless they choose another.
      const own = await withKey(
        otherKey,
        "PUT",
        `/v1/templates/${idOf(template)}`,
        templateBody("Other app's template, changed"),
      );
      expect(own.statusCode).toBe(200);
      const byUser = await app(
        "PUT",
        `/app/templates/${idOf(template)}`,
        templateBody("Changed by a User"),
      );
      expect(byUser.statusCode).toBe(200);
      expect(byUser.json()).toMatchObject({
        applicationId: otherApplicationId,
      });

      // A Template a User made for no Application is changed by no key.
      const unowned = await app(
        "POST",
        "/app/templates",
        templateBody("Unowned"),
      );
      expect(unowned.json()).toMatchObject({ applicationId: null });
      const unownedPut = await withKey(
        otherKey,
        "PUT",
        `/v1/templates/${idOf(unowned)}`,
        templateBody("Unowned, taken"),
      );
      expect(unownedPut.statusCode).toBe(404);

      for (const [url] of targets) {
        expect(
          (await app("DELETE", url.replace("/v1/", "/app/"))).statusCode,
        ).toBe(200);
      }
      await app("DELETE", `/app/templates/${idOf(unowned)}`);
    });

    it("lets a key send only from its own Application's Configurations or the default from address, however the from is given", async () => {
      const configuration = await app("POST", "/app/configurations", {
        name: "Other app's address",
        fromEmail: "no-reply@other.example.com",
        fromName: "Other app",
        applicationId: otherApplicationId,
      });
      expect(configuration.json()).toMatchObject({
        applicationId: otherApplicationId,
      });
      const template = await app("POST", "/app/templates", {
        ...templateBody("Sent as the other app"),
        configurationId: idOf(configuration),
        applicationId: otherApplicationId,
      });
      const raw = { to: ["ada@example.com"], subject: "Scoped", text: "Hi" };

      const othersFrom = await withKey(apiKey, "POST", "/v1/messages", {
        ...raw,
        from: "Other app <no-reply@other.example.com>",
      });
      const unconfigured = await withKey(apiKey, "POST", "/v1/messages", {
        ...raw,
        from: "nobody@nowhere.example.com",
      });
      const throughTemplate = await withKey(apiKey, "POST", "/v1/messages", {
        to: ["ada@example.com"],
        templateId: idOf(template),
      });
      expect(othersFrom.statusCode).toBe(422);
      expect(othersFrom.json()).toMatchObject({
        error: "validation_failed",
        errors: [{ field: "from" }],
      });
      expect(unconfigured.statusCode).toBe(422);
      expect(throughTemplate.statusCode).toBe(422);

      const own = await withKey(otherKey, "POST", "/v1/messages", {
        to: ["ada@example.com"],
        templateId: idOf(template),
      });
      const ownGiven = await withKey(otherKey, "POST", "/v1/messages", {
        ...raw,
        from: "NO-REPLY@other.example.com",
      });
      const byDefault = await withKey(apiKey, "POST", "/v1/messages", raw);
      expect(own.statusCode).toBe(202);
      expect(own.json()).toMatchObject({
        from: "Other app <no-reply@other.example.com>",
      });
      expect(ownGiven.statusCode).toBe(202);
      expect(byDefault.statusCode).toBe(202);
      expect(byDefault.json()).toMatchObject({ from: "App <app@example.com>" });

      // A User's test send from the UI is not an API Key's, so it may use any Template's Configuration.
      const test = await app("POST", `/app/templates/${idOf(template)}/test`, {
        to: "ada@example.com",
      });
      expect(test.statusCode).toBe(202);
      await app("DELETE", `/app/templates/${idOf(template)}`);
      await app("DELETE", `/app/configurations/${idOf(configuration)}`);
    });

    it("lets a key read only its own Application's Messages, and keeps each Application's Idempotency-Keys apart", async () => {
      const raw = { to: ["ada@example.com"], subject: "Mine", text: "Hi" };
      const mine = await withKey(apiKey, "POST", "/v1/messages", raw);
      const read = await withKey(otherKey, "GET", `/v1/messages/${idOf(mine)}`);
      const readUnknown = await withKey(
        otherKey,
        "GET",
        `/v1/messages/${unknownId}`,
      );
      expect(read.statusCode).toBe(404);
      expect(read.body).toBe(readUnknown.body);
      expect(
        (await withKey(apiKey, "GET", `/v1/messages/${idOf(mine)}`)).statusCode,
      ).toBe(200);
      // Users read every Message.
      expect((await app("GET", `/app/messages/${idOf(mine)}`)).statusCode).toBe(
        200,
      );
      const [row] = await database
        .select()
        .from(messages)
        .where(eq(messages.id, idOf(mine)));
      expect(row).toMatchObject({ applicationId });
      expect(row?.apiKeyId).not.toBeNull();

      const send = (secret: string) =>
        server.inject({
          method: "POST",
          url: "/v1/messages",
          headers: {
            authorization: `Bearer ${secret}`,
            "idempotency-key": "shared-key",
          },
          payload: raw,
        });
      const first = await send(apiKey);
      const other = await send(otherKey);
      const repeat = await send(apiKey);
      expect(first.statusCode).toBe(202);
      expect(other.statusCode).toBe(202);
      expect(idOf(other)).not.toBe(idOf(first));
      expect(repeat.statusCode).toBe(200);
      expect(idOf(repeat)).toBe(idOf(first));
    });

    it("lists, renames and deletes Applications for Users, refusing to delete one that has keys", async () => {
      const listed = await app("GET", "/app/applications");
      expect(
        listed.json<{ applications: { name: string; apiKeys: number }[] }>()
          .applications,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Other app", apiKeys: 1 }),
        ]),
      );
      const renamed = await app(
        "PUT",
        `/app/applications/${otherApplicationId}`,
        {
          name: "Other app, renamed",
        },
      );
      expect(renamed.json()).toMatchObject({ name: "Other app, renamed" });
      const taken = await app(
        "PUT",
        `/app/applications/${otherApplicationId}`,
        {
          name: "Integration tests",
        },
      );
      expect(taken.statusCode).toBe(409);
      const refused = await app(
        "DELETE",
        `/app/applications/${otherApplicationId}`,
      );
      expect(refused.statusCode).toBe(409);
      const keys = await app("GET", "/app/api-keys");
      const other = keys
        .json<{ apiKeys: { id: string; applicationId: string }[] }>()
        .apiKeys.find((key) => key.applicationId === otherApplicationId);
      await app("DELETE", `/app/api-keys/${other?.id ?? unknownId}`);
      const deleted = await app(
        "DELETE",
        `/app/applications/${otherApplicationId}`,
      );
      expect(deleted.statusCode).toBe(200);
      const created = await app("POST", "/app/applications", { name: "Spare" });
      expect(created.statusCode).toBe(201);
      await app("DELETE", `/app/applications/${idOf(created)}`);
    });
  });

  describe("request limits (pen test I2a, #162, #164)", () => {
    const secondsAgo = (seconds: number) =>
      sql`now() - ${seconds}::integer * interval '1 second'`;

    it("refuses a key's request with 429 once its burst is spent, and lets it in as the burst refills", async () => {
      await database
        .update(apiKeys)
        .set({ requestTokens: 0.4, requestTokensAt: sql`now()` });
      const refused = await api("GET", "/v1/templates");
      expect(refused.statusCode).toBe(429);
      expect(refused.json()).toMatchObject({ error: "too_many_requests" });
      // 120 a minute is one back every half second.
      expect(refused.headers["retry-after"]).toBe("1");
      expect(refused.headers["ratelimit-limit"]).toBe(String(keyRequestBurst));
      expect(refused.headers["ratelimit-remaining"]).toBe("0");

      await database
        .update(apiKeys)
        .set({ requestTokens: 0, requestTokensAt: secondsAgo(10) });
      const refilled = await api("GET", "/v1/templates");
      expect(refilled.statusCode).toBe(200);
      expect(Number(refilled.headers["ratelimit-remaining"])).toBe(19);
      expect(Number(refilled.headers["ratelimit-reset"])).toBeGreaterThan(0);

      // The burst never grows past its figure, however long the key was idle.
      await database
        .update(apiKeys)
        .set({ requestTokens: 0, requestTokensAt: secondsAgo(3600) });
      const idle = await api("GET", "/v1/templates");
      expect(idle.headers["ratelimit-remaining"]).toBe(
        String(keyRequestBurst - 1),
      );
    });

    it("counts a key's previews on their own figure, and its sends on neither", async () => {
      await database.update(apiKeys).set({
        previewWindowStartedAt: sql`now()`,
        previewWindowCount: previewsPerKeyPerMinute,
      });
      const preview = await api("POST", "/v1/templates/preview", {
        subject: "Hi",
        html: "<p>Hi</p>",
      });
      expect(preview.statusCode).toBe(429);
      expect(preview.headers["ratelimit-limit"]).toBe(
        String(previewsPerKeyPerMinute),
      );
      expect((await api("GET", "/v1/templates")).statusCode).toBe(200);

      await database
        .update(apiKeys)
        .set({ requestTokens: 0, requestTokensAt: sql`now()` });
      const send = await api("POST", "/v1/messages", {
        to: ["limits@example.com"],
        subject: "Limits",
        text: "Hi",
      });
      expect(send.statusCode).toBe(202);
      await database.delete(messages).where(eq(messages.subject, "Limits"));
    });

    it("refuses a User's /app request with 429 once their burst is spent", async () => {
      await database
        .update(users)
        .set({ requestTokens: 0, requestTokensAt: sql`now()` });
      const refused = await app("GET", "/app/me");
      expect(refused.statusCode).toBe(429);
      expect(refused.headers["retry-after"]).toBe("1");
      expect(refused.headers["ratelimit-limit"]).toBe(String(userRequestBurst));
    });

    it("refuses a User's test send past their limit an hour until the hour is up", async () => {
      await configureSmtp(smtpPort);
      await database.update(users).set({
        testSendWindowStartedAt: secondsAgo(30 * 60),
        testSendWindowCount: testSendsPerUserPerHour,
      });
      const refused = await app("POST", "/app/settings/test", {
        to: "limits@example.com",
      });
      expect(refused.statusCode).toBe(429);
      const retryAfter = Number(refused.headers["retry-after"]);
      expect(retryAfter).toBeGreaterThan(29 * 60);
      expect(retryAfter).toBeLessThanOrEqual(30 * 60);
      expect(await listMail()).toEqual([]);

      await database
        .update(users)
        .set({ testSendWindowStartedAt: secondsAgo(61 * 60) });
      const sent = await app("POST", "/app/settings/test", {
        to: "limits@example.com",
      });
      expect(sent.statusCode, sent.body).toBe(200);
      expect(sent.headers["ratelimit-limit"]).toBe(
        String(testSendsPerUserPerHour),
      );
      expect(sent.headers["ratelimit-remaining"]).toBe(
        String(testSendsPerUserPerHour - 1),
      );
      await database.delete(messages).where(eq(messages.subject, "Test email"));
    });
  });

  describe("logs and retention (#79)", () => {
    it("searches by recipient and status, and shows a queued body but drops it once sent (#116)", async () => {
      await configureSmtp(smtpPort);
      const queued = await api("POST", "/v1/messages", {
        to: ["findme@example.org"],
        subject: "Searchable",
        html: "<p>Body to read</p>",
      });
      const id = queued.json<{ id: string }>().id;
      const whileQueued = await app("GET", `/app/messages/${id}`);
      const [queuedRow] = await database
        .select({ html: messages.html, text: messages.text })
        .from(messages)
        .where(eq(messages.id, id));
      const outcome = await sendQueuedMessage(sendParts(), id, {
        retryCount: 0,
        retryLimit: sendMessageRetryLimit,
      });
      const [mail] = await listMail();
      const content = await readMail(mail?.ID ?? "");
      const [sentRow] = await database
        .select({ html: messages.html, text: messages.text })
        .from(messages)
        .where(eq(messages.id, id));
      const byRecipient = await app("GET", "/app/messages?search=findme");
      const failed = await app("GET", "/app/messages?status=failed");
      const detail = await app("GET", `/app/messages/${id}`);

      expect(queuedRow).toEqual({
        html: "<p>Body to read</p>",
        text: "Body to read",
      });
      expect(whileQueued.json()).toMatchObject({
        status: "queued",
        isBodyKept: true,
        html: "<p>Body to read</p>",
        text: "Body to read",
      });
      expect(outcome).toBe("sent");
      expect(content.HTML).toContain("<p>Body to read</p>");
      expect(sentRow).toEqual({ html: null, text: null });

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
        status: "sent",
        subject: "Searchable",
        to: ["findme@example.org"],
        isBodyKept: false,
        html: null,
        text: null,
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

    it("drops the body and attachments of a Message older than seven days whatever Retention is, failing one still queued (#147)", async () => {
      await app("PUT", "/app/settings", { logRetentionDays: 3650 });
      const body = { html: "<p>link</p>", text: "link" };
      const insert = async (subject: string, ageDays: number) => {
        const [row] = await database
          .insert(messages)
          .values({
            from: "a@example.com",
            to: ["b@example.com"],
            subject,
            ...body,
            createdAt: new Date(Date.now() - ageDays * dayMs),
          })
          .returning();
        if (row === undefined) {
          throw new Error("No Message was inserted");
        }
        await database.insert(messageAttachments).values({
          messageId: row.id,
          filename: "a.txt",
          contentType: "text/plain",
          content: Buffer.from("link"),
        });
        return row.id;
      };
      const stale = await insert("Stale queued", messageBodyMaxDays + 1);
      const fresh = await insert("Fresh queued", messageBodyMaxDays - 1);

      const summary = await applyRetention(database, new Date());
      const rows = await database
        .select()
        .from(messages)
        .where(inArray(messages.id, [stale, fresh]));
      const attachments = await database
        .select({ messageId: messageAttachments.messageId })
        .from(messageAttachments)
        .where(inArray(messageAttachments.messageId, [stale, fresh]));
      const byId = new Map(rows.map((row) => [row.id, row]));

      expect(summary.deletedMessages).toBe(0);
      expect(summary.droppedBodies).toBeGreaterThanOrEqual(1);
      expect(byId.get(stale)).toMatchObject({
        status: "failed",
        error: bodyDroppedError,
        html: null,
        text: null,
      });
      expect(byId.get(fresh)).toMatchObject({ status: "queued", ...body });
      expect(attachments.map((row) => row.messageId)).toEqual([fresh]);
      await app("PUT", "/app/settings", { logRetentionDays: 90 });
    });
  });

  describe("migrating an older install", () => {
    it("drops the body of every Message already sent or failed, and keeps a queued one's (#116)", async () => {
      await database.execute(sql`create database drop_sent_bodies`);
      const url = new URL(postgres.getConnectionUri());
      url.pathname = "/drop_sent_bodies";
      const older = openDatabase(url.toString());
      const folder = await mkdtemp(join(tmpdir(), "migrations-"));
      try {
        // Migrate to just before the migration that drops sent bodies, as an install made before it would be.
        await cp(migrationsFolder, folder, { recursive: true });
        const journalFile = join(folder, "meta", "_journal.json");
        const journal: unknown = JSON.parse(
          await readFile(journalFile, "utf8"),
        );
        const entries: unknown = Reflect.get(Object(journal), "entries");
        const list: unknown[] = Array.isArray(entries) ? entries : [];
        const cut = list.findIndex((entry) =>
          String(Reflect.get(Object(entry), "tag")).endsWith(
            "_drop_sent_message_bodies",
          ),
        );
        expect(cut).toBeGreaterThan(0);
        await writeFile(
          journalFile,
          JSON.stringify({ ...Object(journal), entries: list.slice(0, cut) }),
        );
        await migrate(older, { migrationsFolder: folder });
        await older.execute(sql`
          insert into messages ("from", "to", subject, html, text, status) values
            ('a@example.com', '{b@example.com}', 'Queued', '<p>q</p>', 'q', 'queued'),
            ('a@example.com', '{b@example.com}', 'Sent', '<a href="https://example.com/reset?token=t">r</a>', 'https://example.com/reset?token=t', 'sent'),
            ('a@example.com', '{b@example.com}', 'Failed', '<p>f</p>', 'f', 'failed')
        `);

        await migrateDatabase(older);
        const rows = await older
          .select({
            subject: messages.subject,
            status: messages.status,
            html: messages.html,
            text: messages.text,
          })
          .from(messages)
          .orderBy(messages.subject);

        expect(rows).toEqual([
          { subject: "Failed", status: "failed", html: null, text: null },
          { subject: "Queued", status: "queued", html: "<p>q</p>", text: "q" },
          { subject: "Sent", status: "sent", html: null, text: null },
        ]);
      } finally {
        await older.$client.end();
        await rm(folder, { recursive: true, force: true });
      }
    });

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

    it("gives an install's existing keys, Templates, Headers, Footers, Configurations and Messages one Application (ADR 0009)", async () => {
      await database.execute(sql`create database application_backfill`);
      const url = new URL(postgres.getConnectionUri());
      url.pathname = "/application_backfill";
      const older = openDatabase(url.toString());
      const folder = await mkdtemp(join(tmpdir(), "migrations-"));
      try {
        // Migrate to just before Applications (0007), as an install made before them would be.
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
                    Number(Reflect.get(Object(entry), "idx")) < 7,
                )
              : [],
          }),
        );
        await migrate(older, { migrationsFolder: folder });
        await older.execute(sql`
          insert into api_keys (name, lookup_id, secret_hash) values ('Wizzaroo', '0123456789abcdef', 'hash')
        `);
        await older.execute(sql`
          insert into templates (name, slug, subject, html) values ('Reset', 'reset', 's', 'h')
        `);
        await older.execute(sql`
          insert into email_parts (kind, name, html) values ('header', 'Logo', 'h'), ('footer', 'Small print', 'f')
        `);
        await older.execute(sql`
          insert into configurations (name, from_email) values ('Wizzaroo', 'no-reply@example.com')
        `);
        await older.execute(sql`
          insert into messages ("from", "to", subject, idempotency_key) values ('a@example.com', '{b@example.com}', 's', 'k1')
        `);

        await migrateDatabase(older);
        const made = await older.select().from(applications);
        const owners = [
          ...(await older.select({ id: apiKeys.applicationId }).from(apiKeys)),
          ...(await older
            .select({ id: templates.applicationId })
            .from(templates)),
          ...(await older
            .select({ id: emailParts.applicationId })
            .from(emailParts)),
          ...(await older
            .select({ id: configurations.applicationId })
            .from(configurations)),
          ...(await older
            .select({ id: messages.applicationId })
            .from(messages)),
        ];
        // Named after the only key, as a key is usually named after the application using it.
        expect(made.map((row) => row.name)).toEqual(["Wizzaroo"]);
        expect(owners).toHaveLength(6);
        expect(owners.every((row) => row.id === made[0]?.id)).toBe(true);
      } finally {
        await older.$client.end();
        await rm(folder, { recursive: true, force: true });
      }
    });
  });
});
