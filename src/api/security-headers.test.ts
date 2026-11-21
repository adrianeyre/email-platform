/**
 * The security headers (pen test I1, #170) and the session cookie's name and sign-out's origin check (#171), checked
 * with no container: no request here reaches the database, except `/health`, which answers 503 for it.
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isFromOwnPages, sessionCookieName } from "../access/access-routes.js";
import { openDatabase, type Database } from "../lib/database.js";
import type { Server } from "../lib/http.js";
import { buildHttpServer } from "./http-server.js";
import {
  contentSecurityPolicy,
  inlineScriptHashes,
  securityHeaders,
} from "./security-headers.js";

const httpAppUrl = new URL("http://localhost:4320");
const httpsAppUrl = new URL("https://email.example.test");
const themeScript = "document.documentElement.dataset.theme = 'sky';";
const indexHtml = `<!doctype html><html><head>
<script type="application/ld+json">{"@type":"WebApplication"}</script>
<script>${themeScript}</script>
<script type="module" crossorigin src="/assets/app.js"></script>
</head><body><div id="root"></div></body></html>`;

const sha256 = (text: string) =>
  `'sha256-${createHash("sha256").update(text).digest("base64")}'`;

describe("the content security policy (#170)", () => {
  it("allows the UI page's inline scripts by their hashes, and no script that loads from a src", () => {
    expect(inlineScriptHashes(indexHtml)).toEqual([
      sha256('{"@type":"WebApplication"}'),
      sha256(themeScript),
    ]);
  });

  it("forbids framing and limits every load to the platform's own origin", () => {
    const directives = contentSecurityPolicy(indexHtml).split("; ");
    expect(directives).toEqual([
      "default-src 'self'",
      `script-src 'self' ${sha256('{"@type":"WebApplication"}')} ${sha256(themeScript)}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ]);
    expect(contentSecurityPolicy(undefined)).toContain("script-src 'self';");
  });

  it("adds Strict-Transport-Security on an https: APP_URL only", () => {
    expect(
      securityHeaders({ appUrl: httpAppUrl, indexHtml })[
        "strict-transport-security"
      ],
    ).toBeUndefined();
    expect(
      securityHeaders({ appUrl: httpsAppUrl, indexHtml })[
        "strict-transport-security"
      ],
    ).toBe("max-age=31536000");
  });
});

describe("the session cookie's name and sign-out's origin check (#171)", () => {
  it("is __Host-session on an https: APP_URL, and session on an http: one, which can't take the prefix", () => {
    expect(sessionCookieName(httpsAppUrl)).toBe("__Host-session");
    expect(sessionCookieName(httpAppUrl)).toBe("session");
  });

  it("takes a request from APP_URL's origin, a same-origin one, or one no browser sent, and refuses any other origin", () => {
    const from = (headers: Record<string, string>) =>
      isFromOwnPages({ headers }, httpsAppUrl);
    expect(from({ origin: "https://email.example.test" })).toBe(true);
    expect(
      from({
        origin: "http://localhost:4321",
        "sec-fetch-site": "same-origin",
      }),
    ).toBe(true);
    expect(from({})).toBe(true);
    expect(from({ origin: "https://email.example.test:8443" })).toBe(false);
    expect(from({ origin: "http://email.example.test" })).toBe(false);
    expect(from({ origin: "null" })).toBe(false);
    expect(
      from({
        origin: "https://email.example.test:8443",
        "sec-fetch-site": "same-site",
      }),
    ).toBe(false);
    expect(from({ "sec-fetch-site": "same-site" })).toBe(false);
  });
});

describe("every response's headers (#170) and the cookie routes (#171), with inject", () => {
  let database: Database;
  let uiDirectory: string;
  const servers: Server[] = [];

  const build = async (appUrl: URL) => {
    const server = await buildHttpServer({
      database,
      jobs: {
        enqueue: () => Promise.reject(new Error("No job is queued here")),
      },
      appUrl,
      encryptionKey: Buffer.alloc(32, 7),
      sendEmail: () => Promise.reject(new Error("No email is sent here")),
      uiDirectory,
      isLogging: false,
    });
    servers.push(server);
    return server;
  };

  beforeAll(async () => {
    // Nothing listens on port 1, so the one query a request makes (/health's) fails at once.
    database = openDatabase("postgres://headers@127.0.0.1:1/headers");
    uiDirectory = await mkdtemp(join(tmpdir(), "security-headers-ui-"));
    await mkdir(join(uiDirectory, "assets"));
    await writeFile(join(uiDirectory, "index.html"), indexHtml);
    await writeFile(join(uiDirectory, "assets", "app.js"), "");
  });

  afterAll(async () => {
    await Promise.all(servers.map((server) => server.close()));
    await database.$client.end();
    await rm(uiDirectory, { recursive: true, force: true });
  });

  /** One request on each surface, every answer a page, a file, a refusal or a failure. */
  const requests = [
    { method: "GET", url: "/" },
    { method: "GET", url: "/users" },
    { method: "GET", url: "/assets/app.js" },
    { method: "GET", url: "/robots.txt" },
    { method: "GET", url: "/v1/templates" },
    { method: "GET", url: "/app/me" },
    { method: "GET", url: "/docs/" },
    { method: "GET", url: "/app/nothing-here" },
    { method: "POST", url: "/auth/sign-in", payload: "not an object" },
    { method: "POST", url: "/auth/sign-out" },
    { method: "GET", url: "/health" },
  ] as const;

  it("sends the security headers on every surface, a refusal and a failure included, and HSTS on https: only", async () => {
    for (const appUrl of [httpAppUrl, httpsAppUrl]) {
      const server = await build(appUrl);
      for (const request of requests) {
        const response = await server.inject(request);
        const name = `${appUrl.protocol} ${request.method} ${request.url} (${String(response.statusCode)})`;
        expect(
          {
            csp: response.headers["content-security-policy"],
            frame: response.headers["x-frame-options"],
            sniff: response.headers["x-content-type-options"],
            referrer: response.headers["referrer-policy"],
            opener: response.headers["cross-origin-opener-policy"],
            hsts: response.headers["strict-transport-security"],
          },
          name,
        ).toEqual({
          csp: contentSecurityPolicy(indexHtml),
          frame: "DENY",
          sniff: "nosniff",
          referrer: "strict-origin-when-cross-origin",
          opener: "same-origin",
          hsts: appUrl.protocol === "https:" ? "max-age=31536000" : undefined,
        });
      }
    }
  });

  it("on https:, reads only __Host-session: a session cookie, as a plain-http service on the host name can plant, is not read", async () => {
    const server = await build(httpsAppUrl);
    const planted = await server.inject({
      method: "GET",
      url: "/app/me",
      headers: { cookie: "session=a-planted-token" },
    });
    // Refused by the hook before any query: the database, which can't be reached, was never asked.
    expect(planted.statusCode).toBe(401);
    const real = await server.inject({
      method: "GET",
      url: "/app/me",
      headers: { cookie: "__Host-session=a-token" },
    });
    // This one is looked up, and the unreachable database fails it.
    expect(real.statusCode).toBe(500);
  });

  it("refuses sign-out from another origin with 403, before reading the cookie", async () => {
    const server = await build(httpsAppUrl);
    const refused = await server.inject({
      method: "POST",
      url: "/auth/sign-out",
      headers: {
        origin: "https://email.example.test:8443",
        "sec-fetch-site": "same-site",
        "content-type": "text/plain",
        cookie: "__Host-session=a-token",
      },
      payload: "x=",
    });
    expect([refused.statusCode, refused.json()]).toEqual([
      403,
      {
        error: "forbidden",
        message: "Sign out from the platform's own pages",
      },
    ]);
    expect(refused.headers["set-cookie"]).toBeUndefined();
  });

  it("on https:, sign-out from APP_URL's origin clears __Host-session and the session cookie from before #171", async () => {
    const server = await build(httpsAppUrl);
    const signedOut = await server.inject({
      method: "POST",
      url: "/auth/sign-out",
      headers: { origin: httpsAppUrl.origin },
    });
    expect(signedOut.statusCode).toBe(200);
    expect(signedOut.headers["set-cookie"]).toEqual([
      "__Host-session=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; SameSite=Lax",
      "session=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; SameSite=Lax",
    ]);
  });

  it("on http:, sign-out clears the one session cookie", async () => {
    const server = await build(httpAppUrl);
    const signedOut = await server.inject({
      method: "POST",
      url: "/auth/sign-out",
      headers: { origin: httpAppUrl.origin },
    });
    expect(signedOut.headers["set-cookie"]).toBe(
      "session=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax",
    );
  });
});
