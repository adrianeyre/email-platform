import { Type } from "typebox";
import type { Database } from "../lib/database.js";
import {
  getSignedInUser,
  NotFoundError,
  RejectedRequestError,
  type Server,
} from "../lib/http.js";
import { createApiKey, deleteApiKey, listApiKeys } from "./api-keys.js";
import {
  changePassword,
  createSession,
  createUser,
  deleteSession,
  deleteUser,
  listUsers,
  normaliseEmail,
  sessionDays,
  verifyCredentials,
} from "./users.js";

export const sessionCookieName = "session";

const failedSignInLimit = 10;
const failedSignInWindowMs = 15 * 60_000;

export const createSignInThrottle = (now: () => number = Date.now) => {
  const failures = new Map<string, number[]>();
  const recent = (key: string): number[] =>
    (failures.get(key) ?? []).filter(
      (time) => now() - time < failedSignInWindowMs,
    );
  return {
    isBlocked: (key: string): boolean =>
      recent(key).length >= failedSignInLimit,
    recordFailure: (key: string): void => {
      failures.set(key, [...recent(key), now()]);
    },
    clear: (key: string): void => {
      failures.delete(key);
    },
  };
};

export interface AccessRouteParts {
  database: Database;
  appUrl: URL;
}

const credentialsBody = Type.Object({
  email: Type.String({ minLength: 1 }),
  password: Type.String({ minLength: 1 }),
});

const idParams = Type.Object({ id: Type.String({ format: "uuid" }) });

export const registerSignInRoutes = (
  server: Server,
  parts: AccessRouteParts,
): void => {
  const throttle = createSignInThrottle();
  const isSecureCookie = parts.appUrl.protocol === "https:";

  server.post(
    "/auth/sign-in",
    { schema: { hide: true, body: credentialsBody } },
    async (request, reply) => {
      const throttleKey = `${request.ip}:${normaliseEmail(request.body.email)}`;
      if (throttle.isBlocked(throttleKey)) {
        throw new RejectedRequestError(
          429,
          "too_many_attempts",
          "Too many failed sign-ins. Try again in 15 minutes",
        );
      }
      const user = await verifyCredentials(
        parts.database,
        request.body.email,
        request.body.password,
      );
      if (user === undefined) {
        throttle.recordFailure(throttleKey);
        throw new RejectedRequestError(
          401,
          "unauthenticated",
          "The email or password is wrong",
        );
      }
      throttle.clear(throttleKey);
      const token = await createSession(parts.database, user.id);
      return reply
        .setCookie(sessionCookieName, token, {
          path: "/",
          httpOnly: true,
          sameSite: "lax",
          secure: isSecureCookie,
          maxAge: sessionDays * 86_400,
        })
        .send({ email: user.email });
    },
  );

  server.post(
    "/auth/sign-out",
    { schema: { hide: true } },
    async (request, reply) => {
      const token = request.cookies[sessionCookieName];
      if (token !== undefined) {
        await deleteSession(parts.database, token);
      }
      return reply.clearCookie(sessionCookieName, { path: "/" }).send({});
    },
  );
};

export const registerAccountRoutes = (
  server: Server,
  { database }: AccessRouteParts,
): void => {
  server.get("/me", (request) => getSignedInUser(request));

  server.put(
    "/me/password",
    {
      schema: {
        body: Type.Object({
          currentPassword: Type.String(),
          newPassword: Type.String(),
        }),
      },
    },
    async (request) => {
      await changePassword(
        database,
        getSignedInUser(request).userId,
        request.body.currentPassword,
        request.body.newPassword,
      );
      return {};
    },
  );

  server.get("/users", async () => ({ users: await listUsers(database) }));

  server.post(
    "/users",
    { schema: { body: credentialsBody } },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await createUser(database, request.body.email, request.body.password),
        ),
  );

  server.delete(
    "/users/:id",
    { schema: { params: idParams } },
    async (request) => {
      const isDeleted = await deleteUser(
        database,
        request.params.id,
        getSignedInUser(request).userId,
      );
      if (!isDeleted) {
        throw new NotFoundError("The user");
      }
      return {};
    },
  );

  server.get("/api-keys", async () => ({
    apiKeys: await listApiKeys(database),
  }));

  server.post(
    "/api-keys",
    { schema: { body: Type.Object({ name: Type.String() }) } },
    async (request, reply) =>
      reply.code(201).send(await createApiKey(database, request.body.name)),
  );

  server.delete(
    "/api-keys/:id",
    { schema: { params: idParams } },
    async (request) => {
      if (!(await deleteApiKey(database, request.params.id))) {
        throw new NotFoundError("The API key");
      }
      return {};
    },
  );
};
