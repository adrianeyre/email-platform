/**
 * Pen test I2a (#103): rate limiting, probed and quantified by arithmetic, not load (H1, H11). 101 requests in a row
 * from one address to `/auth/sign-in`, `POST /v1/messages`, `POST /v1/templates/preview` and `POST /app/settings/test`,
 * each answer recorded, and what the rate limit would have to key on. The findings note, with the arithmetic and the
 * figures I2b needs, is `docs/pen-test/findings/I2a.md`. A confirmed gap is an `it.fails` for the property that should
 * hold beside a `today_…` test pinning what happens now; a refuted probe is a plain passing test.
 *
 * The sign-in throttle lives in the server instance, so every sign-in probe builds a server of its own on the shared
 * world's database, as production builds it, and closes it.
 */
import { eq, inArray, like, sql } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  keyRequestBurst,
  previewsPerKeyPerMinute,
  testSendsPerUserPerHour,
  userRequestBurst,
} from "../../access/request-limits.js";
import { buildHttpServer } from "../../api/http-server.js";
import type { Server } from "../../lib/http.js";
import { buildJobQueue } from "../../lib/jobs.js";
import { messages } from "../../lib/schema.js";
import { sendEmailOverSmtp } from "../../sending/delivery.js";
import { recipientsPerKeyPerMinute } from "../../sending/send-limit.js";
import {
  fixtureDomain,
  fixtureUsers,
  secondAppTemplateSlug,
} from "../fixtures/fixture-plan.js";
import { field, readJson } from "./b1-routes.js";
import {
  hasContainerRuntime,
  probeAppUrl,
  startProbeWorld,
  warnIfSkipped,
  type ProbeWorld,
} from "./probe-world.js";

warnIfSkipped("src/pen-test/probes/i2a.test.ts");

/** The issue's figure: one more than a hundred, so any limit of 100 or fewer in a window shows as a 429. */
const inARow = 101;
const tries = Array.from({ length: inARow }, (_, index) => index);
const wrongPassword = "not-the-password-0000";

/** The address a request comes from when `inject` makes it: light-my-request's default socket. */
const injectSocketAddress = "127.0.0.1";

/** Anything a limiter would report: `RateLimit-*` (IETF draft), `X-RateLimit-*` or `Retry-After`. */
const reportsALimit = (response: LightMyRequestResponse): boolean =>
  Object.keys(response.headers).some(
    (name) => name.includes("ratelimit") || name === "retry-after",
  );

interface Run {
  statuses: number[];
  firstRefusal: number | undefined;
  reportsALimit: boolean;
  msEach: number;
}

/** Sends the requests one after another, never in parallel, and records each answer. */
const inSequence = async (
  requests: (() => Promise<LightMyRequestResponse>)[],
): Promise<Run> => {
  const statuses: number[] = [];
  let reported = false;
  const started = performance.now();
  for (const request of requests) {
    const response = await request();
    statuses.push(response.statusCode);
    reported ||= reportsALimit(response);
  }
  const elapsed = performance.now() - started;
  const firstRefusal = statuses.indexOf(429);
  return {
    statuses,
    firstRefusal: firstRefusal === -1 ? undefined : firstRefusal + 1,
    reportsALimit: reported,
    msEach: elapsed / requests.length,
  };
};

const countOf = (statuses: number[], status: number): number =>
  statuses.filter((value) => value === status).length;

const report = (label: string, run: Run): void => {
  console.info(
    `I2a: ${label}: ${String(inARow)} in a row, ${run.msEach.toFixed(1)} ms each (about ${Math.round(1000 / run.msEach).toLocaleString("en-GB")} a second one at a time); statuses ${JSON.stringify(Object.fromEntries([...new Set(run.statuses)].map((status) => [status, countOf(run.statuses, status)])))}; first 429 at ${String(run.firstRefusal ?? "none")}; limit headers ${String(run.reportsALimit)}`,
  );
};

describe.skipIf(!hasContainerRuntime)(
  "pen test I2a (#103): rate limiting, probed and quantified",
  () => {
    let world: ProbeWorld;
    const extraServers: Server[] = [];

    beforeAll(async () => {
      world = await startProbeWorld();
      // Each extra server adds an error listener to the shared pool.
      world.database.$client.setMaxListeners(40);
    }, 300_000);

    afterAll(async () => {
      await Promise.all(extraServers.map((server) => server.close()));
      await world.stop();
    });

    // The throttles live in Postgres since A1's #142, and the request limits on the key's or User's row since #162, so
    // each probe starts them empty.
    beforeEach(async () => {
      await world.forgetSignInThrottle();
      await world.forgetRequestLimits();
    });

    /** A server of its own, as production builds it: a fresh `api` process. */
    const freshServer = async (): Promise<Server> => {
      const server = await buildHttpServer({
        database: world.database,
        jobs: buildJobQueue(world.boss),
        appUrl: probeAppUrl,
        encryptionKey: world.encryptionKey,
        sendEmail: sendEmailOverSmtp,
        uiDirectory: undefined,
        isLogging: false,
      });
      extraServers.push(server);
      return server;
    };

    const signIn = (server: Server, email: string) =>
      server.inject({
        method: "POST",
        url: "/auth/sign-in",
        payload: { email, password: wrongPassword },
      });

    /** 101 different emails on the fixtures' undeliverable domain, both fixture Users among them. */
    const sprayEmails = tries.map((index) =>
      index === 0
        ? fixtureUsers.victim.email
        : index === 1
          ? fixtureUsers.colleague.email
          : `i2a-spray-${String(index)}@users.${fixtureDomain}`,
    );

    /* ---------- 1. POST /auth/sign-in ---------- */

    it("answers the 11th of 101 wrong passwords for one User from one address with 429, and every one after it, without hashing them", async () => {
      const server = await freshServer();
      const run = await inSequence(
        tries.map(() => () => signIn(server, fixtureUsers.colleague.email)),
      );
      report("sign-in, one email, one address", run);
      expect(run.statuses.slice(0, 10)).toEqual(Array(10).fill(401));
      expect(run.statuses.slice(10)).toEqual(Array(inARow - 10).fill(429));
      // Since #122 every sign-in 429 carries a Retry-After, so a client can tell when to come back.
      expect(run.reportsALimit).toBe(true);
    }, 60_000);

    it("answers 429 before 101 sign-ins in a row from one address, whichever emails they name", async () => {
      const server = await freshServer();
      const run = await inSequence(
        sprayEmails.map((email) => () => signIn(server, email)),
      );
      expect(run.statuses).toContain(429);
    }, 60_000);

    it("(regression) answers 101 sign-ins in a row from one address, each naming a different email, with 10 × 401 then 429 with a Retry-After for the rest, without hashing them (#122)", async () => {
      const server = await freshServer();
      const run = await inSequence(
        sprayEmails.map((email) => () => signIn(server, email)),
      );
      report("sign-in, 101 emails, one address", run);
      expect(run.statuses.slice(0, 10)).toEqual(Array(10).fill(401));
      expect(run.statuses.slice(10)).toEqual(Array(inARow - 10).fill(429));
      expect(run.reportsALimit).toBe(true);
      // Ten ran scrypt; the 91 refused are turned away before the credentials are checked, so nothing is hashed. A
      // timing bound would show that only on a quiet machine, so it is shown by the refusal itself: the right password
      // from the same address is refused too, which can only happen if the limit answers before scrypt runs.
      const rightPassword = await server.inject({
        method: "POST",
        url: "/auth/sign-in",
        payload: {
          email: fixtureUsers.colleague.email,
          password: world.credentials.passwords.colleague,
        },
      });
      expect(rightPassword.statusCode).toBe(429);
    }, 60_000);

    /** 101 sockets of their own (RFC 5737 documentation addresses), no X-Forwarded-For: a caller with many addresses. */
    const fromAddress = (index: number) => `198.51.100.${String(index + 1)}`;

    const signInFrom = (server: Server, remoteAddress: string) =>
      server.inject({
        method: "POST",
        url: "/auth/sign-in",
        remoteAddress,
        payload: {
          email: fixtureUsers.colleague.email,
          password: wrongPassword,
        },
      });

    it("answers 429 before 101 wrong passwords for one User, whichever addresses they come from", async () => {
      const server = await freshServer();
      const run = await inSequence(
        tries.map((index) => () => signInFrom(server, fromAddress(index))),
      );
      expect(run.statuses).toContain(429);
    }, 120_000);

    it("(regression) answers 101 wrong passwords for one User from 101 socket addresses, no header, with 10 × 401 then 429 with a Retry-After, and the right password too while it lasts (#163)", async () => {
      const server = await freshServer();
      const run = await inSequence(
        tries.map((index) => () => signInFrom(server, fromAddress(index))),
      );
      report("sign-in, one email, 101 socket addresses", run);
      expect(run.statuses.slice(0, 10)).toEqual(Array(10).fill(401));
      expect(run.statuses.slice(10)).toEqual(Array(inARow - 10).fill(429));
      expect(run.reportsALimit).toBe(true);
      // The account's limit refuses the same way the address's does, here from an address that has tried only once.
      const right = await server.inject({
        method: "POST",
        url: "/auth/sign-in",
        remoteAddress: fromAddress(0),
        payload: {
          email: fixtureUsers.colleague.email,
          password: world.credentials.passwords.colleague,
        },
      });
      expect(right.statusCode).toBe(429);
      expect(right.json()).toEqual({
        error: "too_many_requests",
        message:
          "Too many requests. Try again after the number of seconds in the Retry-After header",
      });
      expect(Number(right.headers["retry-after"])).toBeGreaterThan(0);
    }, 120_000);

    it("(regression) counts wrong passwords for an email with no account the same way, across addresses, keyed on the normalised email (#163)", async () => {
      const server = await freshServer();
      const nobody = `i2a-nobody@users.${fixtureDomain}`;
      const run = await inSequence(
        Array.from(
          { length: 11 },
          (_, index) => () =>
            server.inject({
              method: "POST",
              url: "/auth/sign-in",
              remoteAddress: fromAddress(index),
              payload: {
                // Case and spaces are folded before the limit keys on the email.
                email: index % 2 === 0 ? nobody : `  ${nobody.toUpperCase()} `,
                password: wrongPassword,
              },
            }),
        ),
      );
      expect(run.statuses).toEqual([...Array<number>(10).fill(401), 429]);
    }, 60_000);

    /* ---------- 2. What a limit would key on ---------- */

    /** A fresh server with a probe hook that records what Fastify says the caller's address is. */
    const addressSeenBy = async (headers: Record<string, string>) => {
      const server = await freshServer();
      const seen: { ip: string; socket: string | undefined }[] = [];
      server.addHook("onRequest", (request, _reply, done) => {
        seen.push({ ip: request.ip, socket: request.socket.remoteAddress });
        done();
      });
      const response = await server.inject({
        method: "GET",
        url: "/health",
        headers,
      });
      expect(response.statusCode).toBe(200);
      return seen[0];
    };

    it("keys a request on its socket's address, whatever X-Forwarded-For says", async () => {
      const seen = await addressSeenBy({
        "x-forwarded-for": "203.0.113.7",
      });
      expect(seen?.ip).toBe(injectSocketAddress);
    });

    it("(regression) makes request.ip, the only address a limit could key on, the socket's address on every route, whatever X-Forwarded-For the caller sends (#114)", async () => {
      const plain = await addressSeenBy({});
      expect(plain).toEqual({
        ip: injectSocketAddress,
        socket: injectSocketAddress,
      });
      const forged = await addressSeenBy({
        "x-forwarded-for": "203.0.113.7, 198.51.100.9",
      });
      expect(forged).toEqual({
        ip: injectSocketAddress,
        socket: injectSocketAddress,
      });
    });

    /* ---------- 3. POST /v1/messages ---------- */

    const sendOne = (index: number) =>
      world.request(
        { key: "secondApp" },
        {
          method: "POST",
          url: "/v1/messages",
          payload: {
            to: ["customer95@customers.pen-test.invalid"],
            subject: `I2a rate ${String(index)}`,
            text: "One of a hundred and one",
          },
        },
      );

    it("answers 429 before one key's 101st send in a row", async () => {
      await world.forgetSendWindows();
      const run = await inSequence(tries.map((index) => () => sendOne(index)));
      expect(run.statuses).toContain(429);
    }, 60_000);

    it("(regression) accepts one key's sends in a row up to its recipient limit a minute and answers the rest 429, reporting the limit; only the accepted are a Message row and a queued job (#133)", async () => {
      await world.forgetSendWindows();
      await world.database
        .delete(messages)
        .where(like(messages.subject, "I2a rate %"));
      const run = await inSequence(tries.map((index) => () => sendOne(index)));
      report("POST /v1/messages, one key", run);
      // Each send has one recipient, so the key's limit a minute is the number of sends that go.
      const accepted = recipientsPerKeyPerMinute;
      expect(run.statuses).toEqual(
        tries.map((index) => (index < accepted ? 202 : 429)),
      );
      expect(run.reportsALimit).toBe(true);

      // What each costs Postgres: the Message row and its pg-boss job.
      const rows = await world.database
        .select({ id: messages.id })
        .from(messages)
        .where(like(messages.subject, "I2a rate %"));
      expect(rows).toHaveLength(accepted);
      const ids = rows.map((row) => row.id);
      const messageBytes = await world.database.execute(
        sql`select sum(pg_column_size(m.*))::int as bytes from messages m where m.subject like 'I2a rate %'`,
      );
      const jobBytes = await world.database.execute(
        sql`select count(*)::int as jobs, sum(pg_column_size(j.*))::int as bytes from pgboss.job j join messages m on j.data->>'messageId' = m.id::text where j.name = 'send-message' and m.subject like 'I2a rate %'`,
      );
      const jobs = Number(jobBytes.rows[0]?.jobs);
      expect(jobs).toBe(accepted);
      console.info(
        `I2a: POST /v1/messages: ${String(accepted)} Messages hold ${String(messageBytes.rows[0]?.bytes)} bytes of row (${(Number(messageBytes.rows[0]?.bytes) / accepted).toFixed(0)} each), and ${String(jobs)} send-message jobs ${String(jobBytes.rows[0]?.bytes)} bytes (${(Number(jobBytes.rows[0]?.bytes) / accepted).toFixed(0)} each)`,
      );
      await world.database.delete(messages).where(inArray(messages.id, ids));
    }, 60_000);

    /* ---------- 4. POST /v1/templates/preview, and the API besides ---------- */

    const previewOne = (index: number) =>
      world.request(
        { key: "secondApp" },
        {
          method: "POST",
          url: "/v1/templates/preview",
          payload: {
            subject: "I2a preview {{n}}",
            html: "<p>Order {{n}} for {{name}}</p>",
            variables: { n: String(index), name: "Customer" },
          },
        },
      );

    it("answers 429 before one key's 101st Template preview in a row", async () => {
      const run = await inSequence(
        tries.map((index) => () => previewOne(index)),
      );
      expect(run.statuses).toContain(429);
    }, 60_000);

    it("(regression) answers one key's Template previews in a row with 200 up to its limit a minute, then 429 with a Retry-After and the RateLimit headers (#162)", async () => {
      expect(field(readJson(await previewOne(7)), "subject")).toBe(
        "I2a preview 7",
      );
      const run = await inSequence(
        tries.map((index) => () => previewOne(index)),
      );
      report("POST /v1/templates/preview, one key", run);
      // One was spent above. The window is a fixed minute, so nothing comes back while the run lasts.
      const accepted = previewsPerKeyPerMinute - 1;
      expect(run.statuses).toEqual(
        tries.map((index) => (index < accepted ? 200 : 429)),
      );
      expect(run.reportsALimit).toBe(true);
      const refused = await previewOne(0);
      expect(refused.statusCode).toBe(429);
      expect(refused.json()).toMatchObject({ error: "too_many_requests" });
      expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
      expect(refused.headers["ratelimit-limit"]).toBe(
        String(previewsPerKeyPerMinute),
      );
      expect(refused.headers["ratelimit-remaining"]).toBe("0");
      // Previews have a figure of their own: the key's other calls still go.
      const read = await world.request(
        { key: "secondApp" },
        { method: "GET", url: "/v1/templates" },
      );
      expect(read.statusCode).toBe(200);
      expect(read.headers["ratelimit-limit"]).toBe(String(keyRequestBurst));
    }, 60_000);

    it("answers 429 before one key's 101st read in a row", async () => {
      const run = await inSequence(
        tries.map(
          () => () =>
            world.request(
              { key: "secondApp" },
              { method: "GET", url: "/v1/templates" },
            ),
        ),
      );
      expect(run.statuses).toContain(429);
    }, 60_000);

    /** The burst is answered 200, then a 429 comes; a token or two may come back while the run lasts. */
    const expectBurstThenRefusal = (run: Run, burst: number) => {
      expect(run.statuses.slice(0, burst)).toEqual(Array(burst).fill(200));
      expect(run.firstRefusal).toBeDefined();
      expect(countOf(run.statuses, 200) + countOf(run.statuses, 429)).toBe(
        run.statuses.length,
      );
      expect(run.reportsALimit).toBe(true);
    };

    it("(regression) answers one key's reads in a row with 200 for its burst, then 429 with a Retry-After, reporting the limit (#162)", async () => {
      const reads = await inSequence(
        tries.map(
          () => () =>
            world.request(
              { key: "secondApp" },
              { method: "GET", url: "/v1/templates" },
            ),
        ),
      );
      report("GET /v1/templates, one key", reads);
      expectBurstThenRefusal(reads, keyRequestBurst);
      const refused = await world.request(
        { key: "secondApp" },
        { method: "GET", url: "/v1/templates" },
      );
      expect(refused.statusCode).toBe(429);
      expect(refused.json()).toMatchObject({ error: "too_many_requests" });
      expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
      expect(refused.headers["ratelimit-remaining"]).toBe("0");
      // Another key has a limit of its own.
      const other = await world.request(
        { key: "wizzaroo" },
        { method: "GET", url: "/v1/templates" },
      );
      expect(other.statusCode).toBe(200);
    }, 60_000);

    it("(regression) answers one User's /app requests in a row with 200 for their burst, then 429, across their sessions (#162)", async () => {
      const sessions = [
        await world.asUser("victim"),
        await world.asUser("victim"),
      ];
      const previews = await inSequence(
        Array.from(
          { length: 2 * userRequestBurst },
          (_, index) => () =>
            world.server.inject({
              method: "POST",
              url: "/app/templates/preview",
              headers: sessions[index % 2],
              payload: {
                subject: "I2a app preview",
                html: `<p>${String(index)}</p>`,
              },
            }),
        ),
      );
      report("POST /app/templates/preview, one User, two sessions", previews);
      expectBurstThenRefusal(previews, userRequestBurst);
      // Another User has a limit of their own.
      const colleague = await world.request(
        { user: "colleague" },
        { method: "GET", url: "/app/me" },
      );
      expect(colleague.statusCode).toBe(200);
    }, 60_000);

    /* ---------- 5. POST /app/settings/test ---------- */

    const testEmailTo = (index: number) =>
      `i2a-test-${String(index)}@elsewhere.${fixtureDomain}`;

    it("answers 429 before one User's 101st test email in a row", async () => {
      const session = await world.asUser("victim");
      const run = await inSequence(
        tries.map(
          (index) => () =>
            world.server.inject({
              method: "POST",
              url: "/app/settings/test",
              headers: session,
              payload: { to: testEmailTo(index) },
            }),
        ),
      );
      expect(run.statuses).toContain(429);
    }, 120_000);

    it("(regression) sends one User's test emails up to their limit an hour, each a Message the Logs show, and answers the rest 429 without sending them (#164)", async () => {
      await world.clearMail();
      const testEmails = eq(messages.subject, "Test email");
      await world.database.delete(messages).where(testEmails);
      const session = await world.asUser("victim");
      const run = await inSequence(
        tries.map(
          (index) => () =>
            world.server.inject({
              method: "POST",
              url: "/app/settings/test",
              headers: session,
              payload: { to: testEmailTo(index) },
            }),
        ),
      );
      report("POST /app/settings/test, one session", run);
      expect(run.statuses).toEqual(
        tries.map((index) => (index < testSendsPerUserPerHour ? 200 : 429)),
      );
      expect(run.reportsALimit).toBe(true);
      const sent = new Set(
        tries.slice(0, testSendsPerUserPerHour).map(testEmailTo),
      );

      // Only those reached the provider (Mailpit here).
      const mail = (await world.listMail()).filter(
        (item) => item.Subject === "Test email",
      );
      expect(new Set(mail.map((item) => item.To[0]?.Address))).toEqual(sent);

      // Each is a sent Message with no Application, which every User reads in the Logs.
      const logs = await world.request(
        { user: "colleague" },
        { method: "GET", url: "/app/messages?search=i2a-test-" },
      );
      expect(logs.statusCode).toBe(200);
      const listed = field(readJson(logs), "messages");
      expect(Array.isArray(listed)).toBe(true);
      const rows = await world.database
        .select({
          to: messages.to,
          status: messages.status,
          applicationId: messages.applicationId,
        })
        .from(messages)
        .where(testEmails);
      expect(rows).toHaveLength(testSendsPerUserPerHour);
      expect(Array.isArray(listed) ? listed.length : 0).toBe(rows.length);
      expect(new Set(rows.map((row) => row.to[0]))).toEqual(sent);
      for (const row of rows) {
        expect(row).toMatchObject({ status: "sent", applicationId: null });
      }
      await world.database.delete(messages).where(testEmails);
    }, 120_000);

    /* ---------- 6. Sends by Template, which render on accept ---------- */

    it("today_ renders a Template on every accepted send, in the api process, before the 202", async () => {
      await world.forgetSendWindows();
      const run = await inSequence(
        tries.slice(0, 20).map(
          (index) => () =>
            world.request(
              { key: "secondApp" },
              {
                method: "POST",
                url: "/v1/messages",
                payload: {
                  templateSlug: secondAppTemplateSlug,
                  to: ["customer95@customers.pen-test.invalid"],
                  variables: {
                    orderNumber: `I2A-${String(index)}`,
                    trackingUrl: `https://second-app.${fixtureDomain}/track/I2A`,
                  },
                },
              },
            ),
        ),
      );
      console.info(
        `I2a: POST /v1/messages by Template: 20 in a row, ${run.msEach.toFixed(1)} ms each; statuses ${JSON.stringify([...new Set(run.statuses)])}`,
      );
      expect(run.statuses).toEqual(Array(20).fill(202));
      await world.reloadFixtures();
    }, 60_000);
  },
);
