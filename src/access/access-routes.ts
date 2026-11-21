import type { FastifyRequest } from "fastify";
import { Type } from "typebox";
import type { Database } from "../lib/database.js";
import type { JobQueue } from "../lib/jobs.js";
import {
  getSignedInUser,
  NotFoundError,
  RejectedRequestError,
  type Server,
  TooManyRequestsError,
} from "../lib/http.js";
import { createApiKey, deleteApiKey, listApiKeys } from "./api-keys.js";
import { noticeOtherUsers } from "./user-notices.js";
import {
  assertCurrentPassword,
  changePassword,
  CurrentPasswordWrongError,
  createSession,
  createUser,
  deleteSession,
  deleteUser,
  listUsers,
  maxPasswordLength,
  normaliseEmail,
  sessionDays,
  verifyCredentials,
} from "./users.js";
import {
  createSignInAddressThrottle,
  createSignInThrottle,
  throttleAddress,
} from "./sign-in-throttle.js";

/** The name every deployment used before #171, still the name on `http:`. On `https:` it is never read, only cleared. */
const legacySessionCookieName = "session";

/**
 * The session cookie's name. On an `https:` `APP_URL` it is `__Host-session`: the browser takes it only with `Secure`,
 * `Path=/` and no `Domain` from a secure page of this host, so no subdomain and no plain-`http:` service on another port
 * of the host name can set or replace it (pen test I1, #171). Cookies ignore ports, so an `https:` service on another
 * port can, and every service on the host name still reads it: the deployment guide asks for a host name of the
 * platform's own. The prefix needs `Secure`, which an `http:` `APP_URL` can't send, so there the name stays `session`.
 */
export const sessionCookieName = (appUrl: URL): string =>
  appUrl.protocol === "https:" ? "__Host-session" : legacySessionCookieName;

/**
 * Whether a request that changes the session came from the platform's own pages: its `Origin` is `APP_URL`'s, or the
 * browser says it is same-origin (the UI's dev server proxies with its own origin). A request with neither header is
 * no browser's, so it carries no one else's cookie. A form posted from another port of the host name is same-site, so
 * `SameSite=Lax` sends the cookie, but its `Origin` is that port's (pen test I1, #171).
 */
export const isFromOwnPages = (
  request: Pick<FastifyRequest, "headers">,
  appUrl: URL,
): boolean => {
  const { origin } = request.headers;
  const site = request.headers["sec-fetch-site"];
  if (site === "same-origin") {
    return true;
  }
  if (origin !== undefined) {
    return origin === appUrl.origin;
  }
  return site === undefined;
};

export interface AccessRouteParts {
  database: Database;
  appUrl: URL;
}

/** The account routes also queue notices to the other Users (pen test A2, #125). */
export interface AccountRouteParts extends AccessRouteParts {
  jobs: JobQueue;
}

/** The longest address a mailbox can be sent to (RFC 5321's 256-octet path less its angle brackets), pen test A1, #144. */
export const maxEmailLength = 254;

/** Every password a body takes is bounded, so an over-long one is refused with 422 before it is hashed (#141). */
const passwordField = (minLength = 0) =>
  Type.String({ minLength, maxLength: maxPasswordLength });

const credentialsBody = Type.Object({
  email: Type.String({ minLength: 1, maxLength: maxEmailLength }),
  password: passwordField(1),
});

/** Sign-in's email is held by the throttle, so it is bounded: RFC 5321's longest address, not megabytes (#123). */
const signInBody = Type.Object({
  ...credentialsBody.properties,
  email: Type.String({ minLength: 1, maxLength: 320 }),
});

/** The signed-in User's password, asked again before a change a stolen session must not make alone (step-up). */
const stepUpBody = Type.Object({ currentPassword: passwordField() });

const idParams = Type.Object({ id: Type.String({ format: "uuid" }) });

export const registerSignInRoutes = (
  server: Server,
  parts: AccessRouteParts,
): void => {
  const throttle = createSignInThrottle(parts.database, "sign-in");
  const addressThrottle = createSignInAddressThrottle(parts.database);
  const isSecureCookie = parts.appUrl.protocol === "https:";
  const cookieName = sessionCookieName(parts.appUrl);
  /** The cookies sign-in replaces and sign-out ends: the session's, and on `https:` the name used before #171. */
  const staleCookieNames = [cookieName, legacySessionCookieName].filter(
    (name, index, names) => names.indexOf(name) === index,
  );

  server.post(
    "/auth/sign-in",
    // The server's 16 KiB body limit holds an email of 320 characters and a password of 1,024 many times over, so a
    // huge body is refused before it is parsed (pen test A1, #141; I1, #172).
    { schema: { hide: true, body: signInBody } },
    async (request, reply) => {
      const address = throttleAddress(request.ip);
      // Failures count per account, on the normalised email alone, across every address and whether or not it has an
      // account (pen test I2a, #163).
      const throttleKey = normaliseEmail(request.body.email);
      // Every try counts against the address, a try the per-account throttle refuses included.
      const retryAfter =
        (await addressThrottle.take(address)) ??
        (await throttle.retryAfterSeconds(throttleKey));
      if (retryAfter !== undefined) {
        // One refusal whichever limit fired (PRD, request-rate policy), so the body says neither which nor why.
        throw new TooManyRequestsError(retryAfter);
      }
      const user = await verifyCredentials(
        parts.database,
        request.body.email,
        request.body.password,
      );
      if (user === undefined) {
        await throttle.recordFailure(throttleKey);
        throw new RejectedRequestError(
          401,
          "unauthenticated",
          "The email or password is wrong",
        );
      }
      await throttle.clear(throttleKey);
      const token = await createSession(parts.database, user.id);
      void reply.setCookie(cookieName, token, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: isSecureCookie,
        maxAge: sessionDays * 86_400,
      });
      if (cookieName !== legacySessionCookieName) {
        // A session from before #171 is no longer read, but would still be sent to every service on the host name.
        void reply.clearCookie(legacySessionCookieName, {
          path: "/",
          secure: true,
        });
      }
      return reply.send({ email: user.email });
    },
  );

  server.post(
    "/auth/sign-out",
    {
      schema: { hide: true },
      // On onRequest, so a form from another origin is refused for its Origin before the server's refusal of any body
      // (sign-out takes none, pen test I1, #172) is reached.
      onRequest: (request, _reply, done) => {
        done(
          isFromOwnPages(request, parts.appUrl)
            ? undefined
            : new RejectedRequestError(
                403,
                "forbidden",
                "Sign out from the platform's own pages",
              ),
        );
      },
    },
    async (request, reply) => {
      for (const name of staleCookieNames) {
        const token = request.cookies[name];
        if (token !== undefined) {
          await deleteSession(parts.database, token);
        }
        void reply.clearCookie(name, { path: "/", secure: isSecureCookie });
      }
      return reply.send({});
    },
  );
};

export const registerAccountRoutes = (
  server: Server,
  parts: AccountRouteParts,
): void => {
  const { database } = parts;
  /** Wrong step-up passwords, counted per User as the sign-in throttle counts wrong sign-ins. */
  const stepUpThrottle = createSignInThrottle(database, "step-up");

  /** Step-up: asks for the signed-in User's current password again, and answers their id. */
  const stepUp = async (
    request: FastifyRequest,
    currentPassword: string,
  ): Promise<string> => {
    const { userId } = getSignedInUser(request);
    const retryAfter = await stepUpThrottle.retryAfterSeconds(userId);
    if (retryAfter !== undefined) {
      throw new TooManyRequestsError(retryAfter);
    }
    try {
      await assertCurrentPassword(database, userId, currentPassword);
    } catch (error) {
      if (error instanceof CurrentPasswordWrongError) {
        await stepUpThrottle.recordFailure(userId);
      }
      throw error;
    }
    await stepUpThrottle.clear(userId);
    return userId;
  };

  server.get("/me", (request) => getSignedInUser(request));

  server.put(
    "/me/password",
    {
      schema: {
        body: Type.Object({
          currentPassword: passwordField(),
          newPassword: passwordField(),
        }),
      },
    },
    async (request) => {
      const userId = await stepUp(request, request.body.currentPassword);
      await changePassword(
        database,
        userId,
        request.body.newPassword,
        request.cookies[sessionCookieName(parts.appUrl)] ?? "",
      );
      return {};
    },
  );

  server.get("/users", async () => ({ users: await listUsers(database) }));

  server.post(
    "/users",
    {
      schema: {
        body: Type.Object({
          ...credentialsBody.properties,
          currentPassword: passwordField(),
        }),
      },
    },
    async (request, reply) => {
      await stepUp(request, request.body.currentPassword);
      const actor = getSignedInUser(request);
      const user = await createUser(
        database,
        request.body.email,
        request.body.password,
        actor,
      );
      await noticeOtherUsers(parts, request.log, {
        actor,
        change: `added the User ${user.email}`,
        subject: "A User was added to the email platform",
        skipUserIds: [user.id],
      });
      return reply.code(201).send(user);
    },
  );

  server.delete(
    "/users/:id",
    { schema: { params: idParams, body: stepUpBody } },
    async (request) => {
      const userId = await stepUp(request, request.body.currentPassword);
      const email = await deleteUser(database, request.params.id, userId);
      if (email === undefined) {
        throw new NotFoundError("The user");
      }
      await noticeOtherUsers(parts, request.log, {
        actor: getSignedInUser(request),
        change: `deleted the User ${email}`,
        subject: "A User was deleted from the email platform",
      });
      return {};
    },
  );

  server.get("/api-keys", async () => ({
    apiKeys: await listApiKeys(database),
  }));

  server.post(
    "/api-keys",
    {
      schema: {
        body: Type.Object({
          name: Type.String(),
          currentPassword: passwordField(),
          // The Application's name (ADR 0009): made when it is new; left out, the key's own name.
          application: Type.Optional(Type.String({ maxLength: 200 })),
        }),
      },
    },
    async (request, reply) => {
      await stepUp(request, request.body.currentPassword);
      const actor = getSignedInUser(request);
      const created = await createApiKey(
        database,
        request.body.name,
        request.body.application,
        actor,
      );
      await noticeOtherUsers(parts, request.log, {
        actor,
        change: `minted the API key "${created.apiKey.name}" for the application "${created.apiKey.applicationName}"`,
        subject: "An API key was minted on the email platform",
      });
      return reply.code(201).send(created);
    },
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
