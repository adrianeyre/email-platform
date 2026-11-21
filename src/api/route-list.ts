/**
 * Every route the API registers, read from Fastify's own router. The route guard test (`route-guard.test.ts`, pen test
 * B1, #149) asks each one whether it refuses a caller with no credential; the B1, I1 and K1 probes use the list too.
 */
import type { Server } from "../lib/http.js";

export const routeMethods = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "OPTIONS",
] as const;
export type RouteMethod = (typeof routeMethods)[number];

export interface RegisteredRoute {
  method: RouteMethod;
  path: string;
}

/** One line of `printRoutes({ method })`: its indent (4 characters a level), its segment and the methods it ends. */
const treeLine = /^((?:[│ ] {3})*)[├└]── (.+?)(?: \(([A-Z, ]+)\))?$/u;

/** Turns one method's router tree, as Fastify prints it, into the full path of every route it ends. */
export const parseRouteTree = (tree: string, method: RouteMethod): string[] => {
  const segments: string[] = [];
  const paths: string[] = [];
  for (const line of tree.split("\n")) {
    const match = treeLine.exec(line);
    if (match === null) {
      continue;
    }
    const [, indent = "", segment = "", methods] = match;
    segments.length = indent.length / 4;
    segments.push(segment);
    if (methods?.split(", ").includes(method) === true) {
      paths.push(segments.join(""));
    }
  }
  return paths;
};

/** Every route the server has registered, by method. Call it after `ready()`. */
export const listRoutes = (server: Server): RegisteredRoute[] =>
  routeMethods
    .flatMap((method) =>
      parseRouteTree(server.printRoutes({ method }), method).map((path) => ({
        method,
        path,
      })),
    )
    .sort((a, b) =>
      a.path === b.path
        ? a.method.localeCompare(b.method)
        : a.path.localeCompare(b.path),
    );

/** An id no row has, so a request that gets past a hook meets a 404 or a 422 and changes nothing. */
export const unknownId = "7e570000-0000-4000-8000-0000deadbeef";

/** A URL that reaches the route: each parameter is an id no row has, and a wildcard names a real static file. */
export const routeUrl = (path: string, id = unknownId): string =>
  path.replace(/:[a-z]+/giu, id).replace(/\*$/u, "swagger-ui.css");

/** The request that reaches a route without changing anything: a JSON array fails every body schema with a 422. */
export const probeRequest = (
  route: RegisteredRoute,
  headers: Record<string, string> = {},
  id = unknownId,
) => ({
  method: route.method,
  url: routeUrl(route.path, id),
  headers,
  ...(route.method === "GET" || route.method === "HEAD" ? {} : { payload: [] }),
});

/**
 * The routes that may answer a caller with no credential, and why. Reviewed in the fourth pen-test round; add to it
 * only with a reason a reviewer agrees with. `/docs` is not on it: the API document is a User's or a key holder's (#148).
 */
export const allowList: Record<string, string> = {
  "/": "the UI's page, which signs in through /auth",
  "/health":
    "Compose's health check; it says only whether the database answers",
  "/auth/sign-in": "how a User gets a session",
  "/auth/sign-out": "ends the session in the cookie it is sent, if any",
  "/robots.txt": "the public crawler rules",
  "/sitemap.xml": "the public sitemap",
};

/** The UI's own files, served as they are built, which hold no data. */
export const uiFiles = ["/index.html", "/assets/app.js"];

export const isAllowListed = (route: RegisteredRoute) =>
  route.path in allowList || uiFiles.includes(route.path);
