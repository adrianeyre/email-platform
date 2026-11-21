/**
 * Pen test B1 (#95): every registered route compared with the hook it should run under (H16). `/v1` should sit behind
 * the API Key hook, `/app` behind the session hook, and anything else should be on a reviewed allow-list. The API is
 * built as production builds it, with a UI directory, so the SPA fallback and the UI's static files are in the list.
 * `docs/pen-test/findings/B1.md` gives the verdicts.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildHttpServer } from "../../api/http-server.js";
import type { Server } from "../../lib/http.js";
import { buildJobQueue } from "../../lib/jobs.js";
import { sessions } from "../../lib/schema.js";
import { hashSecret } from "../../lib/secrets.js";
import { sendEmailOverSmtp } from "../../sending/delivery.js";
import {
  field,
  invalidKeyRefusal,
  keyHookRefusal,
  listRoutes,
  parseRouteTree,
  probeRequest,
  readJson,
  docsHookRefusal,
  sessionHookRefusal,
  type RegisteredRoute,
} from "./b1-routes.js";
import {
  hasContainerRuntime,
  probeAppUrl,
  startProbeWorld,
  warnIfSkipped,
  type ProbeWorld,
} from "./probe-world.js";

warnIfSkipped("src/pen-test/probes/b1.test.ts");

/** `either` is the /docs hook: a key or a session lets a caller in (#148). */
type Hook = "key" | "session" | "either" | "none" | "unknown";

const uiMarker = "pen-test B1 UI";
const uiFiles = ["/index.html", "/assets/app.js"];

/**
 * The routes that may run outside every hook, and why: the allow-list `src/api/route-guard.test.ts` keeps (#149).
 * `/docs` is not on it: it is a signed-in User's or a key holder's (#148).
 */
const allowList: Record<string, string> = {
  "/": "the UI's page, which signs in through /auth",
  "/health":
    "Compose's health check; it says only whether the database answers",
  "/auth/sign-in": "how a User gets a session",
  "/auth/sign-out": "ends the session in the cookie it is sent, if any",
  "/robots.txt": "the public crawler rules",
  "/sitemap.xml": "the public sitemap",
};

const isAllowListed = (path: string) =>
  path in allowList || uiFiles.includes(path);

const expectedHook = (route: RegisteredRoute): Hook =>
  route.path.startsWith("/v1/")
    ? "key"
    : route.path.startsWith("/app/")
      ? "session"
      : route.path === "/docs" || route.path.startsWith("/docs/")
        ? "either"
        : "none";

const describeRoute = (route: RegisteredRoute) =>
  `${route.method} ${route.path}`;

/** The hook a route runs under, found by asking it: refused with no credential, then let in by a key or a session. */
const findHook = async (
  server: Server,
  route: RegisteredRoute,
  credentials: { key: Record<string, string>; session: Record<string, string> },
): Promise<Hook> => {
  const anonymous = await server.inject(probeRequest(route));
  if (anonymous.statusCode !== 401) {
    return "none";
  }
  const [withKey, withSession] = await Promise.all([
    server.inject(probeRequest(route, credentials.key)),
    server.inject(probeRequest(route, credentials.session)),
  ]);
  if (withKey.statusCode !== 401 && withSession.statusCode === 401) {
    return "key";
  }
  if (withSession.statusCode !== 401 && withKey.statusCode === 401) {
    return "session";
  }
  if (withSession.statusCode !== 401 && withKey.statusCode !== 401) {
    return "either";
  }
  return "unknown";
};

describe("pen test B1 (#95): reading the router tree", () => {
  it("turns Fastify's printed tree into full paths", () => {
    const tree = [
      "└── /",
      "    ├── docs (GET)",
      "    │   └── / (GET)",
      "    │       └── json (GET)",
      "    ├── v1/",
      "    │   └── templates (GET)",
      "    │       └── /",
      "    │           └── :id (GET)",
      "    └── health (GET)",
    ].join("\n");
    expect(parseRouteTree(tree, "GET")).toEqual([
      "/docs",
      "/docs/",
      "/docs/json",
      "/v1/templates",
      "/v1/templates/:id",
      "/health",
    ]);
  });
});

describe.skipIf(!hasContainerRuntime)(
  "pen test B1 (#95): every route compared with the hook it should have",
  () => {
    let world: ProbeWorld;
    let server: Server;
    let uiDirectory: string;
    let routes: RegisteredRoute[];

    const buildServer = (directory: string | undefined) =>
      buildHttpServer({
        database: world.database,
        jobs: buildJobQueue(world.boss),
        appUrl: probeAppUrl,
        encryptionKey: world.encryptionKey,
        sendEmail: sendEmailOverSmtp,
        uiDirectory: directory,
        isLogging: false,
      });

    beforeAll(async () => {
      world = await startProbeWorld({ hasMailpit: false });
      uiDirectory = await mkdtemp(join(tmpdir(), "pen-test-b1-ui-"));
      await mkdir(join(uiDirectory, "assets"));
      await writeFile(
        join(uiDirectory, "index.html"),
        `<!doctype html><html><head><link rel="canonical" href="__APP_URL__/"></head><body>${uiMarker}</body></html>`,
      );
      await writeFile(
        join(uiDirectory, "assets", "app.js"),
        "console.log('pen-test');",
      );
      server = await buildServer(uiDirectory);
      await server.ready();
      routes = listRoutes(server);
    }, 300_000);

    afterAll(async () => {
      await server.close();
      await rm(uiDirectory, { recursive: true, force: true });
      await world.stop();
    });

    const credentials = async () => ({
      key: world.asKey("wizzaroo"),
      session: await world.asUser("victim"),
    });

    /* ---------- Enumerate every route and its hook ---------- */

    it("every /v1 route runs under the key hook, every /app route under the session hook, every /docs route under the hook either passes (#148), and the rest under none", async () => {
      const found: Record<string, Hook> = {};
      const expected: Record<string, Hook> = {};
      const both = await credentials();
      for (const route of routes) {
        found[describeRoute(route)] = await findHook(server, route, both);
        expected[describeRoute(route)] = expectedHook(route);
      }
      expect(found).toEqual(expected);
      expect(Object.keys(found)).toHaveLength(routes.length);
      expect(
        routes.filter((route) => route.path.startsWith("/v1/")),
      ).toHaveLength(25);
      expect(
        routes.filter((route) => route.path.startsWith("/app/")),
      ).toHaveLength(54); // 49, then 5 for /app/applications (ADR 0009)
      expect(routes).toHaveLength(107);
    });

    /* ---------- The allow-list guard ---------- */

    const unhookedRoutes = async (target: Server) => {
      const both = await credentials();
      const found: string[] = [];
      for (const route of listRoutes(target)) {
        if ((await findHook(target, route, both)) === "none") {
          found.push(describeRoute(route));
        }
      }
      return found;
    };

    it("every route outside both hooks is on the reviewed allow-list", async () => {
      const offList = listRoutes(server)
        .filter((route) => !isAllowListed(route.path))
        .map(describeRoute);
      const unhooked = await unhookedRoutes(server);
      expect(unhooked.filter((route) => offList.includes(route))).toEqual([]);
    });

    it("(regression) the routes outside every hook are the allow-list's alone, /docs no longer among them, and src/api/route-guard.test.ts fails on a route added outside them, as this one is (#149, #148)", async () => {
      const unhooked = await unhookedRoutes(server);
      expect(
        unhooked.filter((name) => !isAllowListed(name.split(" ")[1] ?? "")),
      ).toEqual([]);
      expect(unhooked).toEqual([
        "GET /",
        "HEAD /",
        "GET /assets/app.js",
        "HEAD /assets/app.js",
        "POST /auth/sign-in",
        "POST /auth/sign-out",
        "GET /health",
        "HEAD /health",
        "GET /index.html",
        "HEAD /index.html",
        "GET /robots.txt",
        "HEAD /robots.txt",
        "GET /sitemap.xml",
        "HEAD /sitemap.xml",
      ]);

      // A route added beside the hooks still builds and answers anyone; the route guard in every `pnpm test` is what
      // now fails on it (its second test adds this same route).
      const extended = await buildServer(undefined);
      extended.get("/export", { schema: { hide: true } }, () => ({
        exported: true,
      }));
      await extended.ready();
      try {
        const answer = await extended.inject({ method: "GET", url: "/export" });
        expect(answer.statusCode).toBe(200);
        const extendedUnhooked = await unhookedRoutes(extended);
        expect(
          extendedUnhooked.filter(
            (name) => !isAllowListed(name.split(" ")[1] ?? ""),
          ),
        ).toEqual(["GET /export", "HEAD /export"]);
      } finally {
        await extended.close();
      }
    });

    /* ---------- Every route as every identity ---------- */

    it("every route answers every identity as its hook says: only a live key passes /v1, only a live session passes /app, and none answers 5xx", async () => {
      const victim = await world.signIn("victim");
      const colleague = await world.signIn("colleague");
      const expiredToken = randomBytes(32).toString("base64url");
      await world.database.insert(sessions).values({
        tokenHash: hashSecret(expiredToken),
        userId: world.ids.users.victim,
        expiresAt: new Date(Date.now() - 60_000),
      });
      const identities: {
        name: string;
        headers: Record<string, string>;
        passes: Hook;
      }[] = [
        { name: "no credential", headers: {}, passes: "none" },
        {
          name: "victim",
          headers: { cookie: `session=${victim}` },
          passes: "session",
        },
        {
          name: "colleague",
          headers: { cookie: `session=${colleague}` },
          passes: "session",
        },
        {
          name: "wizzaroo key",
          headers: world.asKey("wizzaroo"),
          passes: "key",
        },
        {
          name: "second-app key",
          headers: world.asKey("secondApp"),
          passes: "key",
        },
        {
          name: "deleted key",
          headers: world.asKey("deleted"),
          passes: "none",
        },
        {
          name: "expired session",
          headers: { cookie: `session=${expiredToken}` },
          passes: "none",
        },
        {
          name: "key sent as a cookie",
          headers: { cookie: `session=${world.credentials.apiKeys.wizzaroo}` },
          passes: "none",
        },
        {
          name: "session sent as a bearer",
          headers: { authorization: `Bearer ${victim}` },
          passes: "none",
        },
      ];
      const refusals = [
        keyHookRefusal,
        invalidKeyRefusal,
        sessionHookRefusal,
        docsHookRefusal,
      ];
      // Sign-out ends the session it is sent, so it goes last.
      const ordered = [
        ...routes.filter((route) => route.path !== "/auth/sign-out"),
        ...routes.filter((route) => route.path === "/auth/sign-out"),
      ];
      const mismatches: string[] = [];
      let calls = 0;
      for (const route of ordered) {
        const hook = expectedHook(route);
        let anonymousStatus: number | undefined;
        for (const identity of identities) {
          const response = await server.inject(
            probeRequest(route, identity.headers),
          );
          calls += 1;
          anonymousStatus ??= response.statusCode;
          const shouldPass =
            hook === "none" ||
            identity.passes === hook ||
            (hook === "either" && identity.passes !== "none");
          const didPass = response.statusCode !== 401;
          const problems = [
            shouldPass === didPass ? "" : `passed=${String(didPass)}`,
            response.statusCode >= 500
              ? `status ${String(response.statusCode)}`
              : "",
            hook === "none" && response.statusCode !== anonymousStatus
              ? `status ${String(response.statusCode)} not ${String(anonymousStatus)}`
              : "",
            response.statusCode === 401 &&
            route.method !== "HEAD" &&
            !refusals.some(
              (refusal) =>
                JSON.stringify(readJson(response)) === JSON.stringify(refusal),
            )
              ? `refusal ${response.body}`
              : "",
          ].filter((problem) => problem !== "");
          if (problems.length > 0) {
            mismatches.push(
              `${describeRoute(route)} as ${identity.name}: ${problems.join(", ")}`,
            );
          }
        }
      }
      expect(mismatches).toEqual([]);
      expect(calls).toBe(routes.length * identities.length);
      await world.reloadFixtures();
    }, 120_000);

    /* ---------- Path tricks against both hooks and the SPA fallback ---------- */

    const isIndex = (response: LightMyRequestResponse) =>
      response.body.includes(uiMarker);

    const tricks = [
      "/v1X/templates",
      "/v1X",
      "//v1/templates",
      "//app/settings",
      "/app/../v1/templates",
      "/v1/../app/settings",
      "/app/%2e%2e/v1/templates",
      "/v1%2Ftemplates",
      "/v1/templates%2F",
      "/app%2Fsettings",
      "/%761/templates",
      "/%61pp/settings",
      "/v1/templates.",
      "/v1./templates",
      "/app/settings.",
      "/app./settings",
      "/V1/templates",
      "/APP/settings",
      "/v1/templates/",
      "/app/settings/",
      "/v1/templates?x=/app",
      "/v1/templates#",
      "/v1;/templates",
      "/app;/settings",
    ];

    /** A request over a real socket, so the path reaches Fastify exactly as written: `inject` would resolve `..`. */
    const rawRequest = (method: string, path: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const address = server.server.address();
        const request = httpRequest(
          {
            host: "127.0.0.1",
            port:
              typeof address === "object" && address !== null
                ? address.port
                : undefined,
            method,
            path,
            headers:
              method === "POST" ? { "content-type": "application/json" } : {},
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.on("end", () => {
              resolve({
                status: response.statusCode ?? 0,
                body: Buffer.concat(chunks).toString("utf8"),
              });
            });
          },
        );
        request.on("error", reject);
        request.end(method === "POST" ? "[]" : undefined);
      });

    const groupOutcomes = (seen: Record<string, string>) => {
      const groups: Record<string, string[]> = {};
      for (const [request, outcome] of Object.entries(seen)) {
        (groups[outcome] ??= []).push(request);
      }
      return groups;
    };

    it("no path trick reaches a /v1 or /app handler without its hook: each is refused by the hook, not found, or the UI's page", async () => {
      await server.listen({ host: "127.0.0.1", port: 0 });
      const seen: Record<string, string> = {};
      for (const url of tricks) {
        for (const method of ["GET", "HEAD", "POST"] as const) {
          const { status, body } = await rawRequest(method, url);
          const outcome =
            status === 401
              ? body.includes(keyHookRefusal.message)
                ? "key hook"
                : body.includes(sessionHookRefusal.message)
                  ? "session hook"
                  : "401"
              : status === 404
                ? "404"
                : status === 200 && body.includes(uiMarker)
                  ? "page"
                  : `other ${String(status)} ${body.slice(0, 80)}`;
          seen[`${method} ${url}`] = outcome;
        }
      }
      expect(
        Object.entries(seen).filter(([, outcome]) =>
          outcome.startsWith("other"),
        ),
      ).toEqual([]);
      // What each trick meets today, so a change in the router or the fallback shows up here. HEAD has no body, so
      // its 401 names no hook; the GET beside it does.
      expect(groupOutcomes(seen)).toEqual({
        "key hook": [
          "GET /%761/templates",
          "POST /%761/templates",
          "GET /v1/templates/",
          "GET /v1/templates?x=/app",
          "POST /v1/templates?x=/app",
          "GET /v1/templates#",
          "POST /v1/templates#",
        ],
        "session hook": ["GET /%61pp/settings"],
        "401": [
          "HEAD /%761/templates",
          "HEAD /%61pp/settings",
          "HEAD /v1/templates/",
          "HEAD /v1/templates?x=/app",
          "HEAD /v1/templates#",
        ],
        page: [
          "GET /v1X/templates",
          "GET /v1X",
          "GET //v1/templates",
          "GET //app/settings",
          "GET /v1%2Ftemplates",
          "GET /app%2Fsettings",
          "GET /v1./templates",
          "GET /app./settings",
          "GET /V1/templates",
          "GET /APP/settings",
          "GET /v1;/templates",
          "GET /app;/settings",
        ],
        "404": [
          "HEAD /v1X/templates",
          "POST /v1X/templates",
          "HEAD /v1X",
          "POST /v1X",
          "HEAD //v1/templates",
          "POST //v1/templates",
          "HEAD //app/settings",
          "POST //app/settings",
          "GET /app/../v1/templates",
          "HEAD /app/../v1/templates",
          "POST /app/../v1/templates",
          "GET /v1/../app/settings",
          "HEAD /v1/../app/settings",
          "POST /v1/../app/settings",
          "GET /app/%2e%2e/v1/templates",
          "HEAD /app/%2e%2e/v1/templates",
          "POST /app/%2e%2e/v1/templates",
          "HEAD /v1%2Ftemplates",
          "POST /v1%2Ftemplates",
          "GET /v1/templates%2F",
          "HEAD /v1/templates%2F",
          "POST /v1/templates%2F",
          "HEAD /app%2Fsettings",
          "POST /app%2Fsettings",
          "POST /%61pp/settings",
          "GET /v1/templates.",
          "HEAD /v1/templates.",
          "POST /v1/templates.",
          "HEAD /v1./templates",
          "POST /v1./templates",
          "GET /app/settings.",
          "HEAD /app/settings.",
          "POST /app/settings.",
          "HEAD /app./settings",
          "POST /app./settings",
          "HEAD /V1/templates",
          "POST /V1/templates",
          "HEAD /APP/settings",
          "POST /APP/settings",
          "POST /v1/templates/",
          "GET /app/settings/",
          "HEAD /app/settings/",
          "POST /app/settings/",
          "HEAD /v1;/templates",
          "POST /v1;/templates",
          "HEAD /app;/settings",
          "POST /app;/settings",
        ],
      });
    });

    it("a HEAD to each hook is refused like a GET, and the SPA fallback never serves the UI's page under /v1, /app, /auth or /docs", async () => {
      for (const url of ["/v1/templates", "/app/settings", "/app/messages"]) {
        const head = await server.inject({ method: "HEAD", url });
        expect(head.statusCode).toBe(401);
        expect(head.body).toBe("");
      }
      for (const url of [
        "/v1/nothing-here",
        "/app/nothing-here",
        "/auth/nothing-here",
        "/docs/nothing-here",
      ]) {
        const response = await server.inject({ method: "GET", url });
        expect(isIndex(response)).toBe(false);
        expect([401, 404]).toContain(response.statusCode);
      }
      const page = await server.inject({ method: "GET", url: "/templates" });
      expect(page.statusCode).toBe(200);
      expect(isIndex(page)).toBe(true);
    });

    it("headers that rewrite a request elsewhere are ignored by both hooks", async () => {
      const rewrites = {
        "x-http-method-override": "GET",
        "x-original-url": "/health",
        "x-rewrite-url": "/health",
        "x-forwarded-prefix": "/health",
        "x-forwarded-host": "localhost",
        "x-forwarded-proto": "https",
        "x-forwarded-for": "127.0.0.1",
      };
      for (const [method, url] of [
        ["GET", "/v1/templates"],
        ["POST", "/v1/messages"],
        ["GET", "/app/settings"],
        ["PUT", "/app/settings"],
      ] as const) {
        {
          const response = await server.inject({
            method,
            url,
            headers: rewrites,
            ...(method === "GET" ? {} : { payload: [] }),
          });
          expect({ method, url, status: response.statusCode }).toEqual({
            method,
            url,
            status: 401,
          });
        }
      }
    });

    /* ---------- /docs with no credential ---------- */

    it("the API document is refused to a caller with no credential", async () => {
      const responses = await Promise.all(
        ["/docs/", "/docs/json", "/docs/yaml"].map((url) =>
          server.inject({ method: "GET", url }),
        ),
      );
      expect(responses.map((response) => response.statusCode)).toEqual([
        401, 401, 401,
      ]);
    });

    it("(regression) /docs, /docs/json, /docs/yaml and the page's files refuse a caller with no credential, or a dead one, with 401, and serve every /v1 route to a signed-in User or a key holder (#148)", async () => {
      const deadCredentials = [
        {},
        world.asKey("deleted"),
        { cookie: `session=${world.credentials.apiKeys.wizzaroo}` },
      ];
      for (const url of [
        "/docs",
        "/docs/",
        "/docs/json",
        "/docs/yaml",
        "/docs/static/swagger-ui.css",
      ]) {
        for (const headers of deadCredentials) {
          const refused = await server.inject({ method: "GET", url, headers });
          expect(refused.statusCode, url).toBe(401);
          expect(refused.body, url).not.toContain("/v1/messages");
        }
      }
      const anonymous = await server.inject({
        method: "GET",
        url: "/docs/json",
      });
      expect(readJson(anonymous)).toEqual(docsHookRefusal);

      const session = await world.asUser("victim");
      const page = await server.inject({
        method: "GET",
        url: "/docs/",
        headers: session,
      });
      expect(page.statusCode).toBe(200);
      expect(page.headers["content-type"]).toContain("text/html");
      const yaml = await server.inject({
        method: "GET",
        url: "/docs/yaml",
        headers: world.asKey("secondApp"),
      });
      expect(yaml.statusCode).toBe(200);
      expect(yaml.body).toContain("/v1/messages");

      const json = await server.inject({
        method: "GET",
        url: "/docs/json",
        headers: world.asKey("wizzaroo"),
      });
      expect(json.statusCode).toBe(200);
      const document = readJson(json);
      expect(field(document, "info")).toMatchObject({
        title: "Email API",
        version: "2.0.0",
      });
      const paths = field(document, "paths");
      expect(
        Object.keys(typeof paths === "object" && paths !== null ? paths : {}),
      ).toEqual([
        "/v1/messages",
        "/v1/messages/{id}",
        "/v1/templates",
        "/v1/templates/{id}",
        "/v1/templates/preview",
        "/v1/headers",
        "/v1/headers/{id}",
        "/v1/footers",
        "/v1/footers/{id}",
      ]);
    });

    it("the API document hides every /app and /auth route and names no credential, fixture or address", async () => {
      const json = await server.inject({
        method: "GET",
        url: "/docs/json",
        headers: world.asKey("wizzaroo"),
      });
      expect(json.body).not.toMatch(/\/app\/|\/auth\/|\/health/u);
      expect(json.body).not.toContain("pen-test.invalid");
      expect(json.body).not.toContain("wizzaroo");
      expect(json.body).not.toContain("ek_");
    });

    /* ---------- Refusals give nothing away ---------- */

    it("with no credential, a Message, Template or Header that exists is refused exactly like one that does not", async () => {
      const existing = {
        "/v1/messages/": world.plan.messages[0]?.id ?? "",
        "/v1/templates/": world.ids.secondAppTemplate,
        "/v1/headers/": world.ids.parts.header,
        "/app/messages/": world.plan.messages[0]?.id ?? "",
        "/app/templates/": world.ids.secondAppTemplate,
        "/app/headers/": world.ids.parts.header,
      };
      for (const [prefix, id] of Object.entries(existing)) {
        const [real, unknown] = await Promise.all(
          [id, "7e570000-0000-4000-8000-0000deadbeef"].map((value) =>
            server.inject({ method: "GET", url: `${prefix}${value}` }),
          ),
        );
        expect(real?.statusCode).toBe(401);
        expect(real?.body).toBe(unknown?.body);
        expect(real?.headers["content-length"]).toBe(
          unknown?.headers["content-length"],
        );
      }
    });
  },
);
