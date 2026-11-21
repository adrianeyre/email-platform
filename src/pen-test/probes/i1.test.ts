/**
 * Pen test I1 (#102): HTTP hardening, the session cookie and the error handler. Answers H9's header, cookie and body
 * limit bullets and H16's error-handler, Handlebars and SMTP-text bullets. The findings note is
 * `docs/pen-test/findings/I1.md`. A confirmed gap is an `it.fails` for the property that should hold beside a `today_…`
 * test pinning what happens now; a refuted probe is a plain passing test.
 *
 * The API is built as production builds it, with a stand-in UI directory (one `index.html` that reads `/app` with the
 * session cookie, as the real UI does), and listens on a real socket so Chrome can load it. The framing and cookie
 * probes drive Chrome (playwright-core, a dev dependency) against it and against a second origin on another port of
 * the same host (`i1-origins.ts`). Without Chrome those probes skip, saying so; everything else runs with `inject`.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LightMyRequestResponse } from "fastify";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionCookieName } from "../../access/access-routes.js";
import { buildHttpServer } from "../../api/http-server.js";
import { openDatabase } from "../../lib/database.js";
import type { Server } from "../../lib/http.js";
import { buildJobQueue } from "../../lib/jobs.js";
import { sendEmailOverSmtp } from "../../sending/delivery.js";
import { fixtureUsers } from "../fixtures/fixture-plan.js";
import { field, listRoutes, probeRequest, readJson } from "./b1-routes.js";
import {
  launchBrowser,
  standInIndexHtml,
  startOtherOrigin,
  startRefusingSmtp,
  type OtherOrigin,
} from "./i1-origins.js";
import {
  hasContainerRuntime,
  probeAppUrl,
  startProbeWorld,
  warnIfSkipped,
  type ProbeWorld,
} from "./probe-world.js";

warnIfSkipped("src/pen-test/probes/i1.test.ts");

const megabyte = 1024 * 1024;
const bodyLimit = 36 * megabyte;
const unknownId = "7e570000-0000-4000-8000-0000deadbeef";
const httpsAppUrl = new URL("https://email.pen-test.invalid:4320");

/** Text that would tell a caller about the server's insides: driver, SQL, Handlebars, SMTP, paths, stacks, versions. */
const leakMarkers =
  /password authentication|28P01|email_platform|postgres|\bselect\b|\binsert\b|\bupdate\b|node_modules|\/src\/|\/dist\/|\n\s+at |ECONN|getaddrinfo|handlebars|nodemailer|drizzle|pg-boss|fastify|v\d+\.\d+\.\d+/iu;

interface ParsedCookie {
  name: string;
  value: string;
  attributes: Record<string, string>;
}

const parseSetCookie = (header: string): ParsedCookie => {
  const [pair = "", ...attributes] = header
    .split(";")
    .map((part) => part.trim());
  const [name = "", value = ""] = pair.split("=");
  return {
    name,
    value,
    attributes: Object.fromEntries(
      attributes.map((attribute) => {
        const [key = "", setting = ""] = attribute.split("=");
        return [key.toLowerCase(), setting];
      }),
    ),
  };
};

const setCookieOf = (response: LightMyRequestResponse): string => {
  const header = response.headers["set-cookie"];
  return Array.isArray(header) ? (header[0] ?? "") : (header ?? "");
};

/** The header names a response carries, without the two every response has. */
const headerNames = (response: LightMyRequestResponse): string[] =>
  Object.keys(response.headers)
    .filter((name) => name !== "date" && name !== "connection")
    .sort();

describe.skipIf(!hasContainerRuntime)(
  "pen test I1 (#102): HTTP hardening, the cookie and the error handler",
  () => {
    let world: ProbeWorld;
    let server: Server;
    let uiDirectory: string;
    let app: string;
    let other: OtherOrigin;
    let browser: Browser | undefined;

    // One server answers every probe here, so each injected sign-in comes from a socket of its own (RFC 3849's
    // documentation prefix): the per-address sign-in limit (#122) is then left to the browser's sign-ins, from 127.0.0.1.
    let injectedSignIns = 0;
    const ownAddress = (): string => {
      injectedSignIns += 1;
      return `2001:db8:1::${injectedSignIns.toString(16)}`;
    };

    const build = (appUrl: URL, database = world.database) =>
      buildHttpServer({
        database,
        jobs: buildJobQueue(world.boss),
        appUrl,
        encryptionKey: world.encryptionKey,
        sendEmail: sendEmailOverSmtp,
        uiDirectory,
        isLogging: false,
      });

    beforeAll(async () => {
      world = await startProbeWorld({ hasMailpit: false });
      uiDirectory = await mkdtemp(join(tmpdir(), "pen-test-i1-ui-"));
      await writeFile(join(uiDirectory, "index.html"), standInIndexHtml);
      server = await build(probeAppUrl);
      const address = await server.listen({ port: 0, host: "127.0.0.1" });
      app = `http://localhost:${new URL(address).port}`;
      other = await startOtherOrigin();
      browser = await launchBrowser();
      if (browser === undefined) {
        console.warn(
          "SKIPPED the I1 framing and cookie probes: Chrome would not start (set CHROME_PATH)",
        );
      }
    }, 300_000);

    afterAll(async () => {
      await browser?.close();
      await other.close();
      await server.close();
      await rm(uiDirectory, { recursive: true, force: true });
      await world.stop();
    });

    /* ---------- Probe 1: every response header, and framing ---------- */

    /**
     * One request on each surface: the UI, /v1, /app, /auth and /docs, and /health. The session goes under the cookie
     * name the target's APP_URL reads (`__Host-session` on https:, #171).
     */
    const surfaces = async (target: Server, appUrl = probeAppUrl) => {
      const session = {
        cookie: `${sessionCookieName(appUrl)}=${await world.signIn("victim")}`,
      };
      const requests = {
        "GET /": { method: "GET", url: "/" },
        "GET /users": { method: "GET", url: "/users" },
        "GET /api-keys": { method: "GET", url: "/api-keys" },
        "GET /v1/templates": {
          method: "GET",
          url: "/v1/templates",
          headers: world.asKey("wizzaroo"),
        },
        "GET /app/users": {
          method: "GET",
          url: "/app/users",
          headers: session,
        },
        "GET /app/api-keys": {
          method: "GET",
          url: "/app/api-keys",
          headers: session,
        },
        "POST /auth/sign-in": {
          method: "POST",
          url: "/auth/sign-in",
          remoteAddress: ownAddress(),
          payload: {
            email: fixtureUsers.colleague.email,
            password: world.credentials.passwords.colleague,
          },
        },
        "POST /auth/sign-out": { method: "POST", url: "/auth/sign-out" },
        // /docs is a signed-in User's or a key holder's since #148.
        "GET /docs/": { method: "GET", url: "/docs/", headers: session },
        "GET /docs/json": {
          method: "GET",
          url: "/docs/json",
          headers: session,
        },
        "GET /docs/static/swagger-ui.css": {
          method: "GET",
          url: "/docs/static/swagger-ui.css",
          headers: session,
        },
        "GET /health": { method: "GET", url: "/health" },
      } as const;
      const answers: Record<string, LightMyRequestResponse> = {};
      for (const [name, request] of Object.entries(requests)) {
        answers[name] = await target.inject(request);
      }
      return answers;
    };

    it("every surface sends a content security policy with frame-ancestors, X-Frame-Options, nosniff and a referrer policy", async () => {
      const missing: Record<string, string[]> = {};
      for (const [name, response] of Object.entries(await surfaces(server))) {
        const absent = [
          "content-security-policy",
          "x-frame-options",
          "x-content-type-options",
          "referrer-policy",
        ].filter((header) => response.headers[header] === undefined);
        if (absent.length > 0) {
          missing[name] = absent;
        }
      }
      expect(missing).toEqual({});
    });

    it("an https: APP_URL sends Strict-Transport-Security", async () => {
      const httpsServer = await build(httpsAppUrl);
      try {
        const answer = await httpsServer.inject({ method: "GET", url: "/" });
        expect(answer.headers["strict-transport-security"]).toBeDefined();
      } finally {
        await httpsServer.close();
      }
    });

    it("(regression) every surface sends the same security headers on an http: or an https: APP_URL, Strict-Transport-Security only on https:, and none names its server or framework (#170)", async () => {
      const httpsServer = await build(httpsAppUrl);
      try {
        for (const target of [server, httpsServer]) {
          const isHttps = target === httpsServer;
          const answers = await surfaces(
            target,
            isHttps ? httpsAppUrl : probeAppUrl,
          );
          const names = Object.fromEntries(
            Object.entries(answers).map(([name, response]) => [
              name,
              headerNames(response),
            ]),
          );
          // Cross-Origin-Resource-Policy and Permissions-Policy are left out on purpose (findings note, #170).
          const sent = (...own: string[]) =>
            [
              ...own,
              "content-security-policy",
              "cross-origin-opener-policy",
              "referrer-policy",
              "x-content-type-options",
              "x-frame-options",
              ...(isHttps ? ["strict-transport-security"] : []),
            ].sort();
          expect(names).toEqual({
            "GET /": sent("cache-control", "content-length", "content-type"),
            "GET /users": sent(
              "cache-control",
              "content-length",
              "content-type",
            ),
            "GET /api-keys": sent(
              "cache-control",
              "content-length",
              "content-type",
            ),
            // Every /v1 and /app answer reports its caller's request limit (I2a, #162).
            "GET /v1/templates": sent(
              "content-length",
              "content-type",
              "ratelimit-limit",
              "ratelimit-remaining",
              "ratelimit-reset",
            ),
            // Every /v1 and /app answer reports its caller's request limit (I2a, #162).
            "GET /app/users": sent(
              "content-length",
              "content-type",
              "ratelimit-limit",
              "ratelimit-remaining",
              "ratelimit-reset",
            ),
            // Every /v1 and /app answer reports its caller's request limit (I2a, #162).
            "GET /app/api-keys": sent(
              "content-length",
              "content-type",
              "ratelimit-limit",
              "ratelimit-remaining",
              "ratelimit-reset",
            ),
            "POST /auth/sign-in": sent(
              "content-length",
              "content-type",
              "set-cookie",
            ),
            "POST /auth/sign-out": sent(
              "content-length",
              "content-type",
              "set-cookie",
            ),
            "GET /docs/": sent("content-length", "content-type"),
            "GET /docs/json": sent("content-length", "content-type"),
            "GET /docs/static/swagger-ui.css": sent(
              "accept-ranges",
              "cache-control",
              "content-length",
              "content-type",
              "etag",
              "last-modified",
            ),
            "GET /health": sent("content-length", "content-type"),
          });
          for (const response of Object.values(answers)) {
            expect(response.headers["x-frame-options"]).toBe("DENY");
            expect(response.headers["x-content-type-options"]).toBe("nosniff");
            expect(response.headers["content-security-policy"]).toContain(
              "frame-ancestors 'none'",
            );
            for (const header of [
              "cross-origin-resource-policy",
              "permissions-policy",
              "server",
              "x-powered-by",
            ]) {
              expect(response.headers[header]).toBeUndefined();
            }
          }
        }
      } finally {
        await httpsServer.close();
      }
    });

    /** A Chrome profile signed in as `victim` at the platform's origin, through the UI's own sign-in call. */
    const signedInBrowser = async (
      present: Browser,
    ): Promise<{ context: BrowserContext; page: Page; token: string }> => {
      const context = await present.newContext();
      const page = await context.newPage();
      await page.goto(`${app}/`);
      const status = await page.evaluate(
        async ([email, password]) =>
          (
            await fetch("/auth/sign-in", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ email, password }),
            })
          ).status,
        [
          fixtureUsers.victim.email,
          world.credentials.passwords.victim,
        ] as const,
      );
      expect(status).toBe(200);
      const token = (await context.cookies(app)).find(
        (cookie) => cookie.name === "session",
      )?.value;
      if (token === undefined) {
        throw new Error("Signing in set no session cookie");
      }
      return { context, page, token };
    };

    /** What the platform's page shows inside a frame on `top`, or `undefined` if the browser would not frame it. */
    const framedText = async (
      page: Page,
      top: string,
      path: string,
    ): Promise<string | undefined> => {
      await page.goto(
        `${top}/frame?src=${encodeURIComponent(`${app}${path}`)}`,
      );
      await page.waitForLoadState("load");
      const frame = page.frames().find((each) => each.url().startsWith(app));
      if (frame === undefined) {
        return undefined;
      }
      // A locator, not waitForFunction, which evaluates a string the platform's CSP refuses (#170).
      const isLoaded = await frame
        .locator("#out", { hasText: /^loaded/u })
        .waitFor({ timeout: 5_000 })
        .then(
          () => true,
          () => false,
        );
      return isLoaded
        ? ((await frame.textContent("#out")) ?? undefined)
        : undefined;
    };

    const sameSiteOrigin = () => `http://localhost:${String(other.port)}`;
    const crossSiteOrigin = () => `http://127.0.0.1:${String(other.port)}`;

    it("a page on another origin can't frame the signed-in Users and API Keys pages", async ({
      skip,
    }) => {
      if (browser === undefined) {
        skip();
        return;
      }
      const { context, page } = await signedInBrowser(browser);
      try {
        for (const path of ["/users", "/api-keys"]) {
          expect(
            await framedText(page, sameSiteOrigin(), path),
          ).toBeUndefined();
          expect(
            await framedText(page, crossSiteOrigin(), path),
          ).toBeUndefined();
        }
      } finally {
        await context.close();
      }
    });

    it("(regression) Chrome blocks the Users and API Keys pages framed from another port of the same host or from another LAN host: the frame never becomes the platform's page, which never runs to call /app (#170)", async ({
      skip,
    }) => {
      if (browser === undefined) {
        skip();
        return;
      }
      const { context, page } = await signedInBrowser(browser);
      const appCalls: string[] = [];
      page.on("request", (request) => {
        if (request.url().startsWith(`${app}/app/`)) {
          appCalls.push(request.url());
        }
      });
      try {
        for (const top of [sameSiteOrigin(), crossSiteOrigin()]) {
          for (const path of ["/users", "/api-keys"]) {
            await page.goto(
              `${top}/frame?src=${encodeURIComponent(`${app}${path}`)}`,
            );
            await page.waitForLoadState("load");
            const framed = page
              .frames()
              .filter((frame) => frame !== page.mainFrame());
            // The frame is there, but never became the platform's page.
            expect(framed).toHaveLength(1);
            expect(framed[0]?.url()).not.toContain(app);
          }
        }
        expect(appCalls).toEqual([]);
      } finally {
        await context.close();
      }
    });

    /* ---------- Probe 2: the session cookie ---------- */

    const signInCookie = async (target: Server): Promise<ParsedCookie> =>
      parseSetCookie(
        setCookieOf(
          await target.inject({
            method: "POST",
            url: "/auth/sign-in",
            remoteAddress: ownAddress(),
            payload: {
              email: fixtureUsers.colleague.email,
              password: world.credentials.passwords.colleague,
            },
          }),
        ),
      );

    // Not Secure on http: is #168's (I3), a documented decision pinned here and by the it.fails below.
    it("today_ on an http: APP_URL the session cookie is session=, HttpOnly, SameSite=Lax, Path=/, 30 days, no Domain, and not Secure", async () => {
      const onHttp = await signInCookie(server);
      expect(onHttp.name).toBe("session");
      expect(onHttp.value).toMatch(/^[\w-]{43}$/u);
      expect(onHttp.attributes).toEqual({
        "max-age": "2592000",
        path: "/",
        httponly: "",
        samesite: "Lax",
      });
    });

    it("(regression) on an https: APP_URL the session cookie is __Host-session=, Secure, HttpOnly, SameSite=Lax, Path=/, 30 days, no Domain, and sign-in clears the session= cookie from before (#171)", async () => {
      const httpsServer = await build(httpsAppUrl);
      try {
        const answer = await httpsServer.inject({
          method: "POST",
          url: "/auth/sign-in",
          remoteAddress: ownAddress(),
          payload: {
            email: fixtureUsers.colleague.email,
            password: world.credentials.passwords.colleague,
          },
        });
        const [session, old] = [answer.headers["set-cookie"] ?? []]
          .flat()
          .map(parseSetCookie);
        expect(session?.name).toBe("__Host-session");
        expect(session?.value).toMatch(/^[\w-]{43}$/u);
        expect(session?.attributes).toEqual({
          "max-age": "2592000",
          path: "/",
          httponly: "",
          secure: "",
          samesite: "Lax",
        });
        expect([old?.name, old?.value, old?.attributes["max-age"]]).toEqual([
          "session",
          "",
          "0",
        ]);
      } finally {
        await httpsServer.close();
      }
    });

    it.fails(
      "the session cookie is Secure on every deployment, an http: APP_URL included",
      async () => {
        expect((await signInCookie(server)).attributes).toHaveProperty(
          "secure",
        );
      },
    );

    // __Host- needs Secure, Path=/ and no Domain, set from a secure page: it stops a subdomain and a plain-http service
    // on another port of the host name. Cookies ignore ports, so an https: service on another port still can (#171).
    it("the session cookie is a __Host- cookie, so no other port or subdomain can set it", async () => {
      const httpsServer = await build(httpsAppUrl);
      try {
        expect((await signInCookie(httpsServer)).name).toMatch(/^__Host-/u);
      } finally {
        await httpsServer.close();
      }
    });

    // Still open, and no code can close it: a browser sends a host's cookies to every port of that host, whatever the
    // cookie's name or flags. Only a host name of the platform's own, which docs/operations/deploying.md now requires,
    // keeps the cookie from other services (#171).
    it.fails(
      "another service on the same host name never receives the session cookie",
      async ({ skip }) => {
        if (browser === undefined) {
          skip();
          return;
        }
        const { context, page, token } = await signedInBrowser(browser);
        try {
          other.cookiesSeen.length = 0;
          await page.goto(`${sameSiteOrigin()}/`);
          expect(other.cookiesSeen.join("; ")).not.toContain(token);
        } finally {
          await context.close();
        }
      },
    );

    it("today_ any page on another port of the same host name gets the victim's session cookie with every request, and it works at /app", async ({
      skip,
    }) => {
      if (browser === undefined) {
        skip();
        return;
      }
      const { context, page, token } = await signedInBrowser(browser);
      try {
        other.cookiesSeen.length = 0;
        await page.goto(`${sameSiteOrigin()}/`);
        expect(other.cookiesSeen).toEqual([`session=${token}`]);
        const stolen = await server.inject({
          method: "GET",
          url: "/app/me",
          headers: { cookie: `session=${token}` },
        });
        expect(stolen.json()).toEqual({
          userId: fixtureUsers.victim.id,
          email: fixtureUsers.victim.email,
        });
      } finally {
        await context.close();
      }
    });

    /**
     * On an https: APP_URL. Chrome reaches the second origin as `http://email.pen-test.invalid:<port>`, the https:
     * APP_URL's host name, over plain http, as another service on the platform's host name would be: neither
     * `localhost` nor `127.0.0.1`, which Chrome treats as secure. It plants a `__Host-session` and a `session`; the
     * https: platform is then asked with every cookie Chrome would send it.
     */
    it("a page on another port of the same host can't plant a session the platform then uses", async ({
      skip,
    }) => {
      const mapped = await launchBrowser([
        `--host-resolver-rules=MAP ${httpsAppUrl.hostname} 127.0.0.1`,
      ]);
      if (mapped === undefined) {
        skip();
        return;
      }
      const httpsServer = await build(httpsAppUrl);
      try {
        const context = await mapped.newContext();
        const page = await context.newPage();
        const planted = await world.signIn("colleague");
        other.plantCookie([
          `__Host-session=${planted}; Secure; Path=/`,
          `session=${planted}; Path=/`,
        ]);
        other.cookiesSeen.length = 0;
        await page.goto(
          `http://${httpsAppUrl.hostname}:${String(other.port)}/plant`,
        );
        expect(other.cookiesSeen).toEqual([""]);
        const jar = await context.cookies(httpsAppUrl.href);
        // Chrome refused the __Host- cookie from a page that isn't secure, and took the plain one.
        expect(jar.map((cookie) => cookie.name)).toEqual(["session"]);
        const asked = await httpsServer.inject({
          method: "GET",
          url: "/app/me",
          headers: {
            cookie: jar
              .map((cookie) => `${cookie.name}=${cookie.value}`)
              .join("; "),
          },
        });
        expect(asked.statusCode).toBe(401);
      } finally {
        await httpsServer.close();
        await mapped.close();
      }
    });

    it("today_ on an http: APP_URL, which can't take the __Host- prefix, a page on another port of the same host replaces the victim's HttpOnly session with one of its choosing, and the UI then runs as that User", async ({
      skip,
    }) => {
      if (browser === undefined) {
        skip();
        return;
      }
      const { context, page, token } = await signedInBrowser(browser);
      try {
        const planted = await world.signIn("colleague");
        other.plantCookie(`session=${planted}; Path=/`);
        await page.goto(`${sameSiteOrigin()}/plant`);
        const jar = await context.cookies(app);
        expect(jar.map((cookie) => [cookie.name, cookie.value])).toEqual([
          ["session", planted],
        ]);
        expect(jar.map((cookie) => cookie.value)).not.toContain(token);
        await page.goto(`${app}/users`);
        // A locator, not waitForFunction, which evaluates a string the platform's CSP refuses (#170).
        await page.locator("#out", { hasText: /^loaded/u }).waitFor();
        expect(await page.textContent("#out")).toContain(
          `200 /app/me {"userId":"${fixtureUsers.colleague.id}","email":"${fixtureUsers.colleague.email}"}`,
        );
      } finally {
        await context.close();
      }
    });

    it("a page on another port of the same host can't sign the User out with a form post", async ({
      skip,
    }) => {
      if (browser === undefined) {
        skip();
        return;
      }
      const { context, page, token } = await signedInBrowser(browser);
      try {
        await page.goto(
          `${sameSiteOrigin()}/post?action=${encodeURIComponent(`${app}/auth/sign-out`)}&body=x`,
        );
        await page.waitForURL(`${app}/auth/sign-out`);
        const after = await server.inject({
          method: "GET",
          url: "/app/me",
          headers: { cookie: `session=${token}` },
        });
        expect(after.statusCode).toBe(200);
      } finally {
        await context.close();
      }
    });

    it("(regression) a text/plain form posted from another port of the same host carries the session to /auth/sign-out, which refuses it with 403 for its Origin and keeps the session and the cookie (#171)", async ({
      skip,
    }) => {
      if (browser === undefined) {
        skip();
        return;
      }
      const { context, page, token } = await signedInBrowser(browser);
      try {
        await page.goto(
          `${sameSiteOrigin()}/post?action=${encodeURIComponent(`${app}/auth/sign-out`)}&body=x`,
        );
        await page.waitForURL(`${app}/auth/sign-out`);
        expect(readJsonText(await page.textContent("pre"))).toEqual({
          error: "forbidden",
          message: "Sign out from the platform's own pages",
        });
        expect(
          (await context.cookies(app)).map((cookie) => cookie.value),
        ).toEqual([token]);
        const after = await server.inject({
          method: "GET",
          url: "/app/me",
          headers: { cookie: `session=${token}` },
        });
        expect(after.statusCode).toBe(200);
      } finally {
        await context.close();
      }
    });

    it("a page on another port of the same host can't make an API Key with the session: a text/plain form gets 422, and a JSON fetch fails its CORS preflight", async ({
      skip,
    }) => {
      if (browser === undefined) {
        skip();
        return;
      }
      const { context, page, token } = await signedInBrowser(browser);
      const countKeys = async () =>
        (
          await server.inject({
            method: "GET",
            url: "/app/api-keys",
            headers: { cookie: `session=${token}` },
          })
        ).json<{ apiKeys: unknown[] }>().apiKeys.length;
      try {
        const before = await countKeys();
        await page.goto(
          `${sameSiteOrigin()}/post?action=${encodeURIComponent(`${app}/app/api-keys`)}&body=${encodeURIComponent('{"name":"ridden"}')}`,
        );
        await page.waitForURL(`${app}/app/api-keys`);
        expect(readJsonText(await page.textContent("pre"))).toEqual({
          error: "validation_failed",
          message: "body.body must be object",
          errors: [{ field: "body", message: "body.body must be object" }],
        });
        await page.goto(`${sameSiteOrigin()}/`);
        const fetched = await page.evaluate(async (target) => {
          try {
            const response = await fetch(target, {
              method: "POST",
              credentials: "include",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ name: "fetched" }),
            });
            return String(response.status);
          } catch (error) {
            return String(error);
          }
        }, `${app}/app/api-keys`);
        expect(fetched).toBe("TypeError: Failed to fetch");
        expect(await countKeys()).toBe(before);
      } finally {
        await context.close();
      }
    });

    it("no /app route takes a body a form can send: every /app POST, as a signed-in User, refuses text/plain with 422 and a form encoding with 415", async () => {
      const session = await world.asUser("victim");
      const posts = listRoutes(server).filter(
        (route) => route.method === "POST" && route.path.startsWith("/app/"),
      );
      expect(posts.length).toBeGreaterThan(0);
      for (const route of posts) {
        const url = route.path.replace(/:[a-z]+/giu, unknownId);
        const plain = await server.inject({
          method: "POST",
          url,
          headers: { ...session, "content-type": "text/plain" },
          payload: '{"name":"ridden"}',
        });
        expect([route.path, plain.statusCode]).toEqual([route.path, 422]);
        const form = await server.inject({
          method: "POST",
          url,
          headers: {
            ...session,
            "content-type": "application/x-www-form-urlencoded",
          },
          payload: "name=ridden",
        });
        expect([route.path, form.statusCode]).toEqual([route.path, 415]);
      }
    });

    it("X-Forwarded-Proto and X-Forwarded-Host, which trustProxy honours, change neither the cookie nor the API document's origin", async () => {
      const forged = {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "attacker.pen-test.invalid",
      };
      const signIn = await server.inject({
        method: "POST",
        url: "/auth/sign-in",
        remoteAddress: ownAddress(),
        headers: forged,
        payload: {
          email: fixtureUsers.colleague.email,
          password: world.credentials.passwords.colleague,
        },
      });
      expect(parseSetCookie(setCookieOf(signIn)).attributes).not.toHaveProperty(
        "secure",
      );
      const document = await server.inject({
        method: "GET",
        url: "/docs/json",
        headers: { ...forged, ...world.asKey("wizzaroo") },
      });
      expect(document.body).not.toContain("attacker");
      expect(document.json<{ servers: unknown }>().servers).toEqual([
        { url: probeAppUrl.origin },
      ]);
    });

    /* ---------- Probe 3: 36 MB bodies ---------- */

    /** A body of `bytes` that isn't JSON, so a 400 can only mean the server read and parsed all of it. */
    const notJson = (bytes: number) => `{${"x".repeat(bytes - 1)}`;
    const credentialsOf = (bytes: number) =>
      JSON.stringify({
        email: fixtureUsers.colleague.email,
        password: "x".repeat(bytes - 200),
      });

    // Met since A1's #141 gave /auth a 16 KiB body limit, which is now the server's for every small body (#172).
    it("sign-in refuses a body much larger than an email and a password with 413, before parsing it", async () => {
      const answer = await server.inject({
        method: "POST",
        url: "/auth/sign-in",
        remoteAddress: ownAddress(),
        headers: { "content-type": "application/json" },
        payload: credentialsOf(bodyLimit),
      });
      expect(answer.statusCode).toBe(413);
    });

    it("a route that takes no body refuses a 36 MB one with 413, before parsing it", async () => {
      const session = await world.asUser("victim");
      for (const request of [
        { method: "POST", url: "/auth/sign-out", headers: {} },
        {
          method: "DELETE",
          url: `/app/api-keys/${unknownId}`,
          headers: session,
        },
      ] as const) {
        const answer = await server.inject({
          ...request,
          headers: { ...request.headers, "content-type": "application/json" },
          payload: notJson(bodyLimit),
        });
        expect(answer.statusCode).toBe(413);
      }
    });

    it("(regression) every route refuses a body over its own limit with 413 naming that limit: none on sign-out and a bodiless /app DELETE, 16 KiB at sign-in and on a small /app body, 36 MB on POST /v1/messages, while a Template route takes more than 16 KiB; with no session the /app hook still refuses first (#172)", async () => {
      const session = await world.asUser("victim");
      const send = async (
        method: "POST" | "PUT" | "DELETE",
        url: string,
        headers: Record<string, string>,
        payload: string,
      ) =>
        server.inject({
          method,
          url,
          remoteAddress: ownAddress(),
          headers: { ...headers, "content-type": "application/json" },
          payload,
        });
      const over = (limit: string) => ({
        error: "request_too_large",
        message: `The request is larger than the ${limit} this route takes`,
      });
      // A route that takes no body refuses even a small one, before reading it.
      for (const [method, url, headers] of [
        ["POST", "/auth/sign-out", {}],
        ["DELETE", `/app/api-keys/${unknownId}`, session],
      ] as const) {
        const answer = await send(method, url, headers, "{}");
        expect([url, answer.statusCode, answer.json()]).toEqual([
          url,
          413,
          {
            error: "request_too_large",
            message: "This route takes no request body",
          },
        ]);
      }
      // Without a session the /app hook refuses on onRequest, before the body is looked at.
      const anonymous = await send(
        "DELETE",
        `/app/api-keys/${unknownId}`,
        {},
        notJson(bodyLimit),
      );
      expect(anonymous.statusCode).toBe(401);
      // A small body's route takes 16 KiB, and says so.
      for (const [method, url, headers] of [
        ["POST", "/auth/sign-in", {}],
        ["PUT", "/app/settings", session],
      ] as const) {
        const answer = await send(
          method,
          url,
          headers,
          credentialsOf(17 * 1024),
        );
        expect([url, answer.statusCode, answer.json()]).toEqual([
          url,
          413,
          over("16 KiB"),
        ]);
      }
      // The send route takes 36 MB, and says so.
      const tooBig = await send(
        "POST",
        "/v1/messages",
        world.asKey("wizzaroo"),
        notJson(bodyLimit + 1),
      );
      expect([tooBig.statusCode, tooBig.json()]).toEqual([413, over("36 MB")]);
      // A route that carries a Template takes far more than 16 KiB.
      const preview = await send(
        "POST",
        "/app/templates/preview",
        session,
        JSON.stringify({ subject: "s", html: "x".repeat(512 * 1024) }),
      );
      expect(preview.statusCode).toBe(200);
    });

    /* ---------- Probe 4: make every route fail ---------- */

    it("with Postgres refusing the password, every route as no one, an API Key and a session answers from a closed set: a fixed 500, the fixed 401s, /health's 503, and no driver text", async () => {
      const uri = new URL(world.databaseUrls.api);
      uri.password = "not-the-password";
      const refused = openDatabase(uri.toString());
      refused.$client.on("error", () => undefined);
      const down = await build(probeAppUrl, refused);
      await down.ready();
      try {
        const identities = [
          {},
          world.asKey("wizzaroo"),
          { cookie: `session=${await world.signIn("victim")}` },
        ];
        const refusals = new Set<string>();
        const routes = listRoutes(down);
        expect(routes.length).toBeGreaterThan(90);
        for (const route of routes) {
          for (const identity of identities) {
            const answer = await down.inject(probeRequest(route, identity));
            if (answer.statusCode >= 400) {
              expect(answer.body).not.toMatch(leakMarkers);
              refusals.add(`${String(answer.statusCode)} ${answer.body}`);
            }
          }
        }
        expect([...refusals].sort()).toEqual([
          "401 ",
          '401 {"error":"unauthenticated","message":"Send an API key as a Bearer token in the Authorization header"}',
          '401 {"error":"unauthenticated","message":"Sign in first"}',
          // The /docs hook's, to a caller with neither a session nor a key (#148).
          '401 {"error":"unauthenticated","message":"Sign in, or send an API key as a Bearer token in the Authorization header"}',
          // Sign-out's, which takes no body, to the probe's JSON array (#172).
          '413 {"error":"request_too_large","message":"This route takes no request body"}',
          '422 {"error":"validation_failed","message":"body.body must be object","errors":[{"field":"body","message":"body.body must be object"}]}',
          "500 ",
          '500 {"error":"internal_error","message":"Something went wrong"}',
          "503 ",
          '503 {"status":"failing","database":"unreachable"}',
        ]);
      } finally {
        await down.close();
        await refused.$client.end();
      }
    });

    it("a Template that won't compile is refused 422 with Handlebars' parse error, which holds only the author's own template and Handlebars' grammar: no path, version or stack", async () => {
      const broken = [
        ["{{#if}}", "Parse error on line 1:\n{{#if}}\n-------^\nExpecting "],
        [
          "{{x.[}}",
          "Parse error on line 1:\n{{x.[}}\n----^\nExpecting 'ID', got 'INVALID'",
        ],
        ["{{> partial}}", "The partial partial could not be found"],
        ["{{foo bar}}", 'Missing helper: "foo"'],
      ] as const;
      const session = await world.asUser("victim");
      for (const [html, expected] of broken) {
        for (const request of [
          {
            method: "POST",
            url: "/v1/templates/preview",
            headers: world.asKey("wizzaroo"),
            payload: { subject: "s", html },
          },
          {
            method: "POST",
            url: "/v1/templates",
            headers: world.asKey("wizzaroo"),
            payload: { name: `i1 broken ${html}`, subject: "s", html },
          },
          {
            method: "POST",
            url: "/app/templates",
            headers: session,
            payload: { name: `i1 broken ${html}`, subject: "s", html },
          },
        ] as const) {
          const answer = await server.inject(request);
          expect(answer.statusCode).toBe(422);
          const message = String(field(readJson(answer), "message"));
          expect(message).toContain(
            `The template does not render: ${expected}`,
          );
          expect(message).not.toMatch(leakMarkers);
        }
      }
    });

    /** Points Settings at `host:port`, sends a Message as `secondApp`, runs the worker on it and reads it back. */
    const failedSendError = async (host: string, port: number) => {
      const session = await world.asUser("victim");
      const settings = await server.inject({
        method: "PUT",
        url: "/app/settings",
        headers: session,
        payload: {
          smtpHost: host,
          smtpPort: port,
          smtpSecure: false,
          smtpUsername: null,
          smtpPassword: null,
        },
      });
      expect(settings.statusCode).toBe(200);
      const sent = await world.request(
        { key: "secondApp" },
        {
          method: "POST",
          url: "/v1/messages",
          payload: {
            to: ["customer@example.com"],
            subject: "Order shipped",
            text: "On its way",
          },
        },
      );
      expect(sent.statusCode).toBe(202);
      const id = sent.json<{ id: string }>().id;
      expect(await world.deliver(id)).toBe("failed");
      const read = await world.request(
        { key: "secondApp" },
        { method: "GET", url: `/v1/messages/${id}` },
      );
      const test = await server.inject({
        method: "POST",
        url: "/app/settings/test",
        headers: session,
        payload: { to: "customer@example.com" },
      });
      return {
        error: read.json<{ error: string | null }>().error,
        test: test.json<{ message: string }>().message,
      };
    };

    const providerRefusal =
      "550 5.7.1 Relay denied for 10.20.30.40 by smtp-7.internal.provider.example (account 4411)";

    /** The class every failure before an SMTP session is told as (#173, #184). */
    const unreachable =
      "The SMTP provider could not be reached, or the connection to it failed (a name, network, TLS or timeout failure)";

    it("a failed Message tells the API Key that sent it that it failed, without the provider's reply, host, port or address", async () => {
      const smtp = await startRefusingSmtp(providerRefusal);
      try {
        for (const [host, port] of [
          ["127.0.0.1", smtp.port],
          ["127.0.0.1", 1],
          ["smtp.internal.invalid", 587],
        ] as const) {
          const { error } = await failedSendError(host, port);
          expect(error).not.toMatch(
            /10\.20\.30\.40|smtp-7|account 4411|127\.0\.0\.1|smtp\.internal\.invalid|ECONN|ENOTFOUND|getaddrinfo/u,
          );
        }
      } finally {
        await smtp.close();
        await world.reloadFixtures();
      }
    });

    it("(regression) a failed Message's error, read by the API Key, is its class: refused with the reply and status code, permanent or temporary, or unreachable, and never the provider's reply or Node's network error (#173)", async () => {
      const smtp = await startRefusingSmtp(providerRefusal);
      try {
        const refusedByProvider = await failedSendError("127.0.0.1", smtp.port);
        expect(refusedByProvider.error).toBe(
          "The SMTP provider refused it with reply 550 5.7.1 (permanent)",
        );
        const deadHost = await failedSendError("127.0.0.1", 1);
        expect(deadHost.error).toBe(unreachable);
        const noSuchHost = await failedSendError("smtp.internal.invalid", 587);
        expect(noSuchHost.error).toBe(unreachable);
      } finally {
        await smtp.close();
        await world.reloadFixtures();
      }
    });

    it("the Delivery page's test send tells the User who set the provider the same class, reply and status code, without the reply's text (#173, #184)", async () => {
      const smtp = await startRefusingSmtp(providerRefusal);
      try {
        // The probes above each made a test send too; this one is about what it says, not the hourly limit (#164).
        await world.forgetRequestLimits();
        const { test } = await failedSendError("127.0.0.1", smtp.port);
        expect(test).toBe(
          "The test email was not sent: The SMTP provider refused it with reply 550 5.7.1 (permanent)",
        );
      } finally {
        await smtp.close();
        await world.reloadFixtures();
      }
    });

    /** Requests Fastify refuses before a route runs: a type it can't parse, JSON that isn't, and no JSON at all. */
    const fastifyRefusals = async () => {
      const answers: Record<string, unknown> = {};
      for (const [name, contentType, payload] of [
        ["xml", "application/xml", "<a/>"],
        ["form", "application/x-www-form-urlencoded", "a=b"],
        ["broken JSON", "application/json", "{"],
        ["empty JSON", "application/json", ""],
      ] as const) {
        for (const [url, headers] of [
          ["/auth/sign-in", {}],
          ["/v1/messages", world.asKey("wizzaroo")],
        ] as const) {
          const answer = await server.inject({
            method: "POST",
            url,
            headers: { ...headers, "content-type": contentType },
            payload,
          });
          answers[`${name} ${url}`] = [answer.statusCode, readJson(answer)];
        }
      }
      return answers;
    };

    it("every 4xx carries an error code from the platform's own set, never Fastify's FST_ERR_ codes", async () => {
      expect(JSON.stringify(await fastifyRefusals())).not.toContain("FST_ERR_");
    });

    it("(regression) a body Fastify can't take is refused with the platform's own code and a fixed message: unsupported_media_type and invalid_json, naming neither the framework nor anything sent (#174)", async () => {
      const mediaType = [
        415,
        {
          error: "unsupported_media_type",
          message:
            "The request's Content-Type is not one this route takes: send application/json",
        },
      ];
      const brokenJson = [
        400,
        {
          error: "invalid_json",
          message: "The request body is not valid JSON",
        },
      ];
      const emptyJson = [
        400,
        {
          error: "invalid_json",
          message:
            "The request body is empty, but its Content-Type is application/json",
        },
      ];
      expect(JSON.stringify(await fastifyRefusals())).not.toMatch(leakMarkers);
      expect(await fastifyRefusals()).toEqual({
        "xml /auth/sign-in": mediaType,
        "xml /v1/messages": mediaType,
        "form /auth/sign-in": mediaType,
        "form /v1/messages": mediaType,
        "broken JSON /auth/sign-in": brokenJson,
        "broken JSON /v1/messages": brokenJson,
        "empty JSON /auth/sign-in": emptyJson,
        "empty JSON /v1/messages": emptyJson,
      });
      // A URL the router can't decode is refused from the same set, not with Fastify's body echoing the path.
      const badUrl = await server.inject({
        method: "GET",
        url: "/v1/templates/%zz-pen-test",
      });
      expect([badUrl.statusCode, readJson(badUrl)]).toEqual([
        400,
        { error: "bad_request", message: "The request could not be read" },
      ]);
    });
  },
);

const readJsonText = (text: string | null): unknown => {
  try {
    const value: unknown = JSON.parse(text ?? "");
    return value;
  } catch {
    return undefined;
  }
};
