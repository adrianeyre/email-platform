/**
 * Pen test A1 (#92): passwords, sessions and the sign-in throttle. Answers H1 and H5's session bullets. The findings
 * note is `docs/pen-test/findings/A1.md`. A confirmed gap is an `it.fails` for the property that should hold beside a
 * `today_…` test pinning what happens now; a refuted probe is a plain passing test.
 *
 * The sign-in throttle lives in Postgres since #142, so every probe starts with it empty, and every throttle probe
 * builds a server of its own on the shared world's database (a fresh `api` process), and closes it.
 */
import { randomBytes } from "node:crypto";
import { eq, like, lt, sql } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSignInThrottle } from "../../access/sign-in-throttle.js";
import { buildHttpServer } from "../../api/http-server.js";
import type { Server } from "../../lib/http.js";
import { buildJobQueue } from "../../lib/jobs.js";
import { sessions, throttleKeys } from "../../lib/schema.js";
import { hashPassword, hashSecret } from "../../lib/secrets.js";
import { sendEmailOverSmtp } from "../../sending/delivery.js";
import { fixtureDomain, fixtureUsers } from "../fixtures/fixture-plan.js";
import {
  hasContainerRuntime,
  probeAppUrl,
  startProbeWorld,
  warnIfSkipped,
  type ProbeWorld,
} from "./probe-world.js";

warnIfSkipped("src/pen-test/probes/a1.test.ts");

const dayMs = 86_400_000;
const minuteMs = 60_000;
const megabyte = 1024 * 1024;

/** An email no fixture has, on the fixtures' undeliverable domain. */
const noAccountEmail = (name: string) => `${name}@users.${fixtureDomain}`;
const wrongPassword = "not-the-password-0000";

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
};

describe("pen test A1 (#92): hashing, without a container", () => {
  it("(regression) hashes every password with scrypt at OWASP's N=131072 (2^17), r=8, p=1 (#140)", async () => {
    const [scheme, cost, blockSize, parallelism] = (
      await hashPassword("a-password-of-twelve")
    ).split("$");
    expect({ scheme, cost, blockSize, parallelism }).toEqual({
      scheme: "scrypt",
      cost: "131072",
      blockSize: "8",
      parallelism: "1",
    });
  });

  it("hashes every password with at least OWASP's scrypt cost, N=2^17 with r=8", async () => {
    const [, cost, blockSize] = (
      await hashPassword("a-password-of-twelve")
    ).split("$");
    expect(Number(cost) * Number(blockSize)).toBeGreaterThanOrEqual(
      2 ** 17 * 8,
    );
  });
});

describe.skipIf(!hasContainerRuntime)(
  "pen test A1 (#92): passwords, sessions and the sign-in throttle",
  () => {
    let world: ProbeWorld;
    const extraServers: Server[] = [];

    beforeAll(async () => {
      world = await startProbeWorld({ hasMailpit: false });
      // Each extra server adds an error listener to the shared pool.
      world.database.$client.setMaxListeners(40);
    }, 300_000);

    afterAll(async () => {
      await Promise.all(extraServers.map((server) => server.close()));
      await world.stop();
    });

    const forgetThrottle = () => world.forgetSignInThrottle();

    beforeEach(async () => {
      await world.reloadFixtures();
      await forgetThrottle();
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

    const signIn = (
      server: Server,
      email: string,
      password: string,
      headers: Record<string, string> = {},
    ): Promise<LightMyRequestResponse> =>
      server.inject({
        method: "POST",
        url: "/auth/sign-in",
        headers,
        payload: { email, password },
      });

    const statusesOf = async (
      attempts: (() => Promise<LightMyRequestResponse>)[],
    ): Promise<number[]> => {
      const statuses: number[] = [];
      for (const attempt of attempts) {
        statuses.push((await attempt()).statusCode);
      }
      return statuses;
    };

    const colleagueEmail = fixtureUsers.colleague.email;
    /** A documentation address (RFC 5737) for the i-th try, so each try names a different client. */
    const forwardedFor = (index: number) => ({
      "x-forwarded-for": `203.0.113.${String(index + 1)}`,
    });
    const elevenTries = Array.from({ length: 11 }, (_, index) => index);

    const asSession = (token: string) => ({ cookie: `session=${token}` });
    const whoAmI = (token: string) =>
      world.server.inject({
        method: "GET",
        url: "/app/me",
        headers: asSession(token),
      });

    /* ---------- The throttle ---------- */

    it("answers the 11th wrong password for one User from one address with 429, and the right one too while it lasts", async () => {
      const server = await freshServer();
      const statuses = await statusesOf(
        elevenTries.map(
          () => () => signIn(server, colleagueEmail, wrongPassword),
        ),
      );
      expect(statuses).toEqual([...Array<number>(10).fill(401), 429]);
      const right = await signIn(
        server,
        colleagueEmail,
        world.credentials.passwords.colleague,
      );
      expect(right.statusCode).toBe(429);
      // Case and spaces are folded before the throttle keys on the email.
      const shouted = await signIn(
        server,
        `  ${colleagueEmail.toUpperCase()} `,
        wrongPassword,
      );
      expect(shouted.statusCode).toBe(429);
    });

    it("(regression) answers 11 wrong passwords for one User, each with a fresh X-Forwarded-For, with 10 × 401 then 429, and a made-up header doesn't get past the block (#114)", async () => {
      const server = await freshServer();
      const statuses = await statusesOf(
        elevenTries.map(
          (index) => () =>
            signIn(server, colleagueEmail, wrongPassword, forwardedFor(index)),
        ),
      );
      expect(statuses).toEqual([...Array<number>(10).fill(401), 429]);

      // The throttle keys on the socket's address, so neither the header nor its absence gets back in.
      const bare = await signIn(server, colleagueEmail, wrongPassword);
      expect(bare.statusCode).toBe(429);
      const throughTheHeader = await signIn(
        server,
        colleagueEmail,
        world.credentials.passwords.colleague,
        { "x-forwarded-for": "198.51.100.200" },
      );
      expect(throughTheHeader.statusCode).toBe(429);
    });

    it("answers the 11th wrong password for one User with 429 whatever X-Forwarded-For says", async () => {
      const server = await freshServer();
      const statuses = await statusesOf(
        elevenTries.map(
          (index) => () =>
            signIn(server, colleagueEmail, wrongPassword, forwardedFor(index)),
        ),
      );
      expect(statuses.at(-1)).toBe(429);
    });

    it("(regression) answers one password sprayed across 11 emails from one address with 10 × 401 then 429 and a Retry-After, with or without X-Forwarded-For (#122)", async () => {
      const emails = [
        fixtureUsers.victim.email,
        colleagueEmail,
        ...Array.from({ length: 9 }, (_, index) =>
          noAccountEmail(`spray-${String(index)}`),
        ),
      ];
      const bareServer = await freshServer();
      const bare = await statusesOf(
        emails.map((email) => () => signIn(bareServer, email, wrongPassword)),
      );
      expect(bare).toEqual([...Array<number>(10).fill(401), 429]);
      // The servers share the throttle through Postgres (#142), so the second spray starts it afresh.
      await forgetThrottle();
      const headerServer = await freshServer();
      const withHeader = await statusesOf(
        emails.map(
          (email, index) => () =>
            signIn(headerServer, email, wrongPassword, forwardedFor(index)),
        ),
      );
      expect(withHeader).toEqual([...Array<number>(10).fill(401), 429]);
      // The right password from that address is refused too, the same way the per-email throttle refuses.
      const right = await signIn(
        bareServer,
        colleagueEmail,
        world.credentials.passwords.colleague,
      );
      expect(right.statusCode).toBe(429);
      expect(right.json()).toEqual({
        error: "too_many_requests",
        message:
          "Too many requests. Try again after the number of seconds in the Retry-After header",
      });
      expect(Number(right.headers["retry-after"])).toBeGreaterThan(0);
    });

    it("answers a spray of one password across 11 emails from one address with 429 by the 11th", async () => {
      const server = await freshServer();
      const emails = Array.from({ length: 11 }, (_, index) =>
        noAccountEmail(`spray-limit-${String(index)}`),
      );
      const statuses = await statusesOf(
        emails.map((email) => () => signIn(server, email, wrongPassword)),
      );
      expect(statuses.at(-1)).toBe(429);
    });

    it("refuses a sign-in whose email is longer than 320 characters with 422, so the throttle never keys on it (#123)", async () => {
      const server = await freshServer();
      const response = await signIn(
        server,
        // Long enough to break the email's limit, short enough to pass /auth's 16 KiB body limit (#141).
        noAccountEmail("e".repeat(4096)),
        wrongPassword,
      );
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ error: "validation_failed" });
    });

    it("today_ spends one scrypt on every wrong password, at least 5 ms each", async () => {
      const server = await freshServer();
      const timings: number[] = [];
      for (let index = 0; index < 5; index += 1) {
        const started = performance.now();
        const response = await signIn(
          server,
          colleagueEmail,
          wrongPassword,
          forwardedFor(index),
        );
        timings.push(performance.now() - started);
        expect(response.statusCode).toBe(401);
      }
      console.info(
        `A1: a wrong password takes ${median(timings).toFixed(1)} ms (median of 5)`,
      );
      expect(median(timings)).toBeGreaterThan(5);
    });

    it("(regression) refuses a 35 MB password with 413 before parsing it, and one of 1,025 characters with 422 before hashing it, counting neither as a failure (#141)", async () => {
      const server = await freshServer();
      const started = performance.now();
      const huge = await signIn(
        server,
        colleagueEmail,
        "p".repeat(35 * megabyte),
      );
      const elapsed = performance.now() - started;
      console.info(
        `A1: a 35 MB password is refused in ${elapsed.toFixed(0)} ms`,
      );
      expect(huge.statusCode).toBe(413);
      const long = await signIn(server, colleagueEmail, "p".repeat(1025));
      expect(long.statusCode).toBe(422);
      expect(long.json()).toMatchObject({
        error: "validation_failed",
        errors: [{ field: "password" }],
      });
      const right = await signIn(
        server,
        colleagueEmail,
        world.credentials.passwords.colleague,
      );
      expect(right.statusCode).toBe(200);
    }, 60_000);

    it("refuses a password longer than 1,024 characters before hashing it", async () => {
      const server = await freshServer();
      const response = await signIn(
        server,
        colleagueEmail,
        "p".repeat(megabyte),
      );
      expect([413, 422]).toContain(response.statusCode);
    });

    it("(regression) still answers 429 from a new process after the old one answered 429, as the throttle is kept in Postgres (#142)", async () => {
      const before = await freshServer();
      const statuses = await statusesOf(
        elevenTries.map(
          () => () => signIn(before, colleagueEmail, wrongPassword),
        ),
      );
      expect(statuses).toEqual([...Array<number>(10).fill(401), 429]);
      const after = await freshServer();
      const refused = await signIn(
        after,
        colleagueEmail,
        world.credentials.passwords.colleague,
      );
      expect(refused.statusCode).toBe(429);
      expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
    });

    it("still answers 429 after the api restarts mid-throttle", async () => {
      const before = await freshServer();
      await statusesOf(
        elevenTries.map(
          () => () => signIn(before, colleagueEmail, wrongPassword),
        ),
      );
      const after = await freshServer();
      expect(
        (await signIn(after, colleagueEmail, wrongPassword)).statusCode,
      ).toBe(429);
    });

    /**
     * Records one failure for each of 40 keys of 300 characters, each with its 15-minute window long passed by the time
     * the next is recorded, and answers how many of those keys' rows the throttle still holds afterwards.
     */
    const countRetainedThrottleKeys = async (): Promise<number> => {
      let clock = Date.now();
      const throttle = createSignInThrottle(
        world.database,
        "sign-in",
        () => clock,
      );
      for (let index = 0; index < 40; index += 1) {
        await throttle.recordFailure(
          `198.51.100.7:${randomBytes(150).toString("hex")}`,
        );
        clock += 16 * minuteMs;
      }
      // One more call, so the last key's window has passed when its row is looked for too.
      expect(await throttle.retryAfterSeconds("198.51.100.7:nobody")).toBe(
        undefined,
      );
      const [held] = await world.database
        .select({ count: sql<number>`count(*)::int` })
        .from(throttleKeys)
        .where(like(throttleKeys.key, "sign-in:198.51.100.7:%"));
      return held?.count ?? Number.NaN;
    };

    it("(regression) drops each failed sign-in's key once its 15-minute window has passed, so of 40 keys none is held (#123, #142)", async () => {
      expect(await countRetainedThrottleKeys()).toBe(0);
    });

    it("forgets a failed sign-in's key once its 15-minute window has passed", async () => {
      expect(await countRetainedThrottleKeys()).toBeLessThanOrEqual(1);
    });

    /* ---------- Sessions ---------- */

    it("(regression) ends the victim's other sessions when they change their password, keeping the one that changed it and other Users' sessions (#124)", async () => {
      const stolen = await world.signIn("victim");
      const own = await world.signIn("victim");
      const colleague = await world.signIn("colleague");
      const change = await world.server.inject({
        method: "PUT",
        url: "/app/me/password",
        headers: asSession(own),
        payload: {
          currentPassword: world.credentials.passwords.victim,
          newPassword: "a-brand-new-password-0001",
        },
      });
      expect(change.statusCode).toBe(200);
      expect((await whoAmI(own)).json()).toEqual({
        userId: world.ids.users.victim,
        email: fixtureUsers.victim.email,
      });
      expect((await whoAmI(stolen)).statusCode).toBe(401);
      expect((await whoAmI(colleague)).statusCode).toBe(200);
      const left = await world.database
        .select({ count: sql<number>`count(*)::int` })
        .from(sessions)
        .where(eq(sessions.userId, world.ids.users.victim));
      expect(left[0]?.count).toBe(1);
    });

    it("ends the victim's other sessions when they change their password", async () => {
      const stolen = await world.signIn("victim");
      const own = await world.signIn("victim");
      await world.server.inject({
        method: "PUT",
        url: "/app/me/password",
        headers: asSession(own),
        payload: {
          currentPassword: world.credentials.passwords.victim,
          newPassword: "a-brand-new-password-0002",
        },
      });
      expect((await whoAmI(stolen)).statusCode).toBe(401);
    });

    it("refuses a stolen session changing the password without the current one", async () => {
      const stolen = await world.signIn("victim");
      const change = await world.server.inject({
        method: "PUT",
        url: "/app/me/password",
        headers: asSession(stolen),
        payload: {
          currentPassword: wrongPassword,
          newPassword: "an-attackers-password-01",
        },
      });
      expect(change.statusCode).toBe(422);
      expect(change.json()).toEqual({
        error: "validation_failed",
        message: "The current password is wrong",
      });
    });

    /** Moves a session back in time: unless told otherwise, it was last used when it was made (#143). */
    const moveSession = async (
      token: string,
      ages: { createdAt: Date; expiresAt: Date; lastUsedAt?: Date },
    ) => {
      await world.database
        .update(sessions)
        .set({ lastUsedAt: ages.createdAt, ...ages })
        .where(eq(sessions.tokenHash, hashSecret(token)));
    };

    it("refuses a session once its 30 days have passed", async () => {
      const token = await world.signIn("victim");
      await moveSession(token, {
        createdAt: new Date(Date.now() - 31 * dayMs),
        expiresAt: new Date(Date.now() - dayMs),
      });
      expect((await whoAmI(token)).statusCode).toBe(401);
    });

    it("today_ keeps an expired session's row until someone signs in again, refused all the while", async () => {
      const token = await world.signIn("victim");
      await moveSession(token, {
        createdAt: new Date(Date.now() - 31 * dayMs),
        expiresAt: new Date(Date.now() - dayMs),
      });
      expect((await whoAmI(token)).statusCode).toBe(401);
      const expiredRows = () =>
        world.database
          .select({ count: sql<number>`count(*)::int` })
          .from(sessions)
          .where(lt(sessions.expiresAt, new Date()));
      expect((await expiredRows())[0]?.count).toBe(1);
      await world.signIn("colleague");
      expect((await expiredRows())[0]?.count).toBe(0);
    });

    it("(regression) refuses a session made 29 days ago and never used since, and one last used 8 days ago, but serves one made 29 days ago and used yesterday (#143)", async () => {
      const unused = await world.signIn("victim");
      await moveSession(unused, {
        createdAt: new Date(Date.now() - 29 * dayMs),
        expiresAt: new Date(Date.now() + dayMs),
      });
      expect((await whoAmI(unused)).statusCode).toBe(401);
      const idle = await world.signIn("victim");
      await moveSession(idle, {
        createdAt: new Date(Date.now() - 29 * dayMs),
        expiresAt: new Date(Date.now() + dayMs),
        lastUsedAt: new Date(Date.now() - 8 * dayMs),
      });
      expect((await whoAmI(idle)).statusCode).toBe(401);
      const inUse = await world.signIn("victim");
      await moveSession(inUse, {
        createdAt: new Date(Date.now() - 29 * dayMs),
        expiresAt: new Date(Date.now() + dayMs),
        lastUsedAt: new Date(Date.now() - dayMs),
      });
      expect((await whoAmI(inUse)).statusCode).toBe(200);
      // Using it moved its last use to now, so it has seven more idle days, within its 30.
      const [row] = await world.database
        .select({ lastUsedAt: sessions.lastUsedAt })
        .from(sessions)
        .where(eq(sessions.tokenHash, hashSecret(inUse)));
      expect(Date.now() - (row?.lastUsedAt.getTime() ?? 0)).toBeLessThan(
        minuteMs,
      );
    });

    it("refuses a session left unused for 29 days", async () => {
      const token = await world.signIn("victim");
      await moveSession(token, {
        createdAt: new Date(Date.now() - 29 * dayMs),
        expiresAt: new Date(Date.now() + dayMs),
      });
      expect((await whoAmI(token)).statusCode).toBe(401);
    });

    it("ends that session, and only that one, on sign-out, and refuses its token afterwards", async () => {
      const leaving = await world.signIn("victim");
      const other = await world.signIn("victim");
      const signOut = await world.server.inject({
        method: "POST",
        url: "/auth/sign-out",
        headers: asSession(leaving),
      });
      expect(signOut.statusCode).toBe(200);
      expect(
        signOut.cookies.find((cookie) => cookie.name === "session")?.value,
      ).toBe("");
      expect((await whoAmI(leaving)).statusCode).toBe(401);
      expect((await whoAmI(other)).statusCode).toBe(200);
    });

    it("refuses every session of a User once they are deleted", async () => {
      const colleagueSession = await world.signIn("colleague");
      expect((await whoAmI(colleagueSession)).statusCode).toBe(200);
      const deletion = await world.request(
        { user: "victim" },
        {
          method: "DELETE",
          url: `/app/users/${world.ids.users.colleague}`,
          payload: { currentPassword: world.credentials.passwords.victim },
        },
      );
      expect(deletion.statusCode).toBe(200);
      expect((await whoAmI(colleagueSession)).statusCode).toBe(401);
      const left = await world.database
        .select({ count: sql<number>`count(*)::int` })
        .from(sessions)
        .where(eq(sessions.userId, world.ids.users.colleague));
      expect(left[0]?.count).toBe(0);
    });

    /* ---------- Refusals: an email with an account against one without ---------- */

    it("answers a wrong password, and a missing one, the same for an email with an account as for one without", async () => {
      const server = await freshServer();
      const pairs = [
        { password: wrongPassword, status: 401 },
        { password: "", status: 422 },
      ];
      for (const { password, status } of pairs) {
        const withAccount = await signIn(server, colleagueEmail, password);
        const withoutAccount = await signIn(
          server,
          noAccountEmail("nobody-a1"),
          password,
        );
        expect(withAccount.statusCode).toBe(status);
        expect(withoutAccount.statusCode).toBe(withAccount.statusCode);
        expect(withoutAccount.body).toBe(withAccount.body);
        expect(withoutAccount.headers["content-length"]).toBe(
          withAccount.headers["content-length"],
        );
      }
    });

    it("answers the 11th try with the same 429 for an email with an account as for one without", async () => {
      const server = await freshServer();
      const eleventh = async (email: string) => {
        let last: LightMyRequestResponse | undefined;
        for (let index = 0; index < 11; index += 1) {
          last = await signIn(server, email, wrongPassword);
        }
        return last;
      };
      const withAccount = await eleventh(colleagueEmail);
      const withoutAccount = await eleventh(noAccountEmail("nobody-a1-429"));
      expect(withAccount?.statusCode).toBe(429);
      expect(withoutAccount?.statusCode).toBe(429);
      expect(withoutAccount?.body).toBe(withAccount?.body);
    });

    it("takes about as long to refuse an email with an account as one without", async () => {
      const server = await freshServer();
      const time = async (email: string, index: number) => {
        const started = performance.now();
        await signIn(server, email, wrongPassword, forwardedFor(index + 100));
        return performance.now() - started;
      };
      const withAccount: number[] = [];
      const withoutAccount: number[] = [];
      for (let index = 0; index < 7; index += 1) {
        withAccount.push(await time(colleagueEmail, index));
        withoutAccount.push(
          await time(noAccountEmail("nobody-a1-timing"), index),
        );
      }
      console.info(
        `A1: refusing an email with an account takes ${median(withAccount).toFixed(1)} ms, one without ${median(withoutAccount).toFixed(1)} ms (medians of 7)`,
      );
      const ratio = median(withAccount) / median(withoutAccount);
      expect(ratio).toBeGreaterThan(1 / 3);
      expect(ratio).toBeLessThan(3);
    });

    /* ---------- Odd input ---------- */

    it("(regression) answers a sign-in whose email holds a NUL byte with 422 validation_failed, before the database (#144)", async () => {
      const server = await freshServer();
      const response = await signIn(
        server,
        `victim\u0000@users.${fixtureDomain}`,
        wrongPassword,
      );
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        error: "validation_failed",
        errors: [{ field: "body.email" }],
      });
    });

    it("answers a sign-in whose email holds a NUL byte from the closed set of refusals, not 500", async () => {
      const server = await freshServer();
      const response = await signIn(
        server,
        `victim\u0000@users.${fixtureDomain}`,
        wrongPassword,
      );
      expect(response.statusCode).toBeLessThan(500);
    });
  },
);
