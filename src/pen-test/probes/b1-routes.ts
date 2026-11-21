/**
 * Pen test B1 (#95): every route the API registers, read from Fastify's own router (`src/api/route-list.ts`, which the
 * route guard test reads too, #149), and the hook each one runs under, found by asking it rather than by reading its
 * path. K1 (#94) uses the list too, to call every `/v1` route.
 */
import type { LightMyRequestResponse } from "fastify";

export {
  listRoutes,
  parseRouteTree,
  probeRequest,
  routeMethods,
  routeUrl,
  unknownId,
  type RegisteredRoute,
  type RouteMethod,
} from "../../api/route-list.js";

export const keyHookRefusal = {
  error: "unauthenticated",
  message: "Send an API key as a Bearer token in the Authorization header",
} as const;
export const invalidKeyRefusal = {
  error: "unauthenticated",
  message: "The API key is not valid",
} as const;
export const sessionHookRefusal = {
  error: "unauthenticated",
  message: "Sign in first",
} as const;
/** The `/docs` hook's refusal to a caller with neither a session nor a key (#148). */
export const docsHookRefusal = {
  error: "unauthenticated",
  message:
    "Sign in, or send an API key as a Bearer token in the Authorization header",
} as const;

export const readJson = (response: LightMyRequestResponse): unknown => {
  try {
    const body: unknown = JSON.parse(response.body);
    return body;
  } catch {
    return undefined;
  }
};

export const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null
    ? Reflect.get(value, key)
    : undefined;
