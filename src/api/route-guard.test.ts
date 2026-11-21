/**
 * The route guard (pen test B1, #149): every route the API registers either refuses a caller with no credential, with
 * `401`, or is on the reviewed allow-list below. A route added outside the `/v1` key hook, the `/app` session hook and
 * the `/docs` hook fails this test until it is moved behind one or reviewed onto the list.
 *
 * It runs in every `pnpm test` with no container: no request here gets past a hook, so the database is never reached,
 * except by `/health`, which answers 503 for it.
 */
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../lib/database.js";
import type { Server } from "../lib/http.js";
import { buildHttpServer } from "./http-server.js";
import {
  isAllowListed,
  listRoutes,
  probeRequest,
  type RegisteredRoute,
} from "./route-list.js";

const describeRoute = (route: RegisteredRoute) =>
  `${route.method} ${route.path}`;

/** Every route that doesn't refuse a caller with no credential, found by asking it. */
const findUnprotectedRoutes = async (
  server: Server,
): Promise<RegisteredRoute[]> => {
  const unprotected: RegisteredRoute[] = [];
  for (const route of listRoutes(server)) {
    const response = await server.inject(probeRequest(route));
    if (response.statusCode !== 401) {
      unprotected.push(route);
    }
  }
  return unprotected;
};

describe("the route guard (#149)", () => {
  let database: Database;
  let uiDirectory: string;
  const servers: Server[] = [];

  const buildServer = async () => {
    const server = await buildHttpServer({
      database,
      jobs: {
        enqueue: () => Promise.reject(new Error("No job is queued here")),
      },
      appUrl: new URL("http://localhost:4320"),
      encryptionKey: randomBytes(32),
      sendEmail: () => Promise.reject(new Error("No email is sent here")),
      uiDirectory,
      isLogging: false,
    });
    servers.push(server);
    return server;
  };

  beforeAll(async () => {
    // Nothing listens on port 1, so the one query a request makes (/health's) fails at once.
    database = openDatabase("postgres://route-guard@127.0.0.1:1/route-guard");
    uiDirectory = await mkdtemp(join(tmpdir(), "route-guard-ui-"));
    await mkdir(join(uiDirectory, "assets"));
    await writeFile(join(uiDirectory, "index.html"), "<!doctype html>");
    await writeFile(join(uiDirectory, "assets", "app.js"), "");
  });

  afterAll(async () => {
    await Promise.all(servers.map((server) => server.close()));
    await database.$client.end();
    await rm(uiDirectory, { recursive: true, force: true });
  });

  it("every route outside the reviewed allow-list refuses a caller with no credential", async () => {
    const server = await buildServer();
    await server.ready();
    const routes = listRoutes(server);
    const unprotected = await findUnprotectedRoutes(server);

    expect(
      unprotected.filter((route) => !isAllowListed(route)).map(describeRoute),
    ).toEqual([]);
    // Every route under each hook was asked, and refused.
    const hooked = routes.filter((route) => !isAllowListed(route));
    for (const prefix of ["/v1/", "/app/", "/docs"]) {
      expect(
        hooked.filter((route) => route.path.startsWith(prefix)).length,
        prefix,
      ).toBeGreaterThan(0);
    }
    expect(hooked.length + unprotected.length).toBe(routes.length);
  });

  it("fails on a route added beside the hooks, as a future change might add one", async () => {
    const server = await buildServer();
    server.get("/export", { schema: { hide: true } }, () => ({
      exported: true,
    }));
    await server.ready();
    const unprotected = await findUnprotectedRoutes(server);

    expect(
      unprotected.filter((route) => !isAllowListed(route)).map(describeRoute),
    ).toEqual(["GET /export", "HEAD /export"]);
  });
});
