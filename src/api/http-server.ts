import fastifyCookie from "@fastify/cookie";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  BodyNotTakenError,
  internalError,
  readClientErrorStatus,
  refusalBody,
  refuseFrameworkError,
} from "./refusals.js";
import { securityHeaders } from "./security-headers.js";
import { renderIndexHtml, robotsTxt, sitemapXml } from "./site-files.js";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import {
  registerAjvFormats,
  TypeBoxValidatorCompiler,
  type TypeBoxTypeProvider,
} from "@fastify/type-provider-typebox";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyError } from "fastify";
import {
  registerAccountRoutes,
  registerSignInRoutes,
  sessionCookieName,
} from "../access/access-routes.js";
import { authenticateApiKey } from "../access/api-keys.js";
import { registerApplicationRoutes } from "../access/applications.js";
import { countKeyRequest, countUserRequest } from "../access/request-limits.js";
import { loadSignedInUser } from "../access/users.js";
import type { Database } from "../lib/database.js";
import {
  RejectedRequestError,
  TooManyRequestsError,
  findNulBytes,
  ValidationFailedError,
  type FieldError,
  type Server,
} from "../lib/http.js";
import type { JobQueue } from "../lib/jobs.js";
import { describeErrorForLog, withoutQuery } from "../lib/log.js";
import { RateLimitedError, rateLimitHeaders } from "../lib/rate-limit.js";
import type { SendEmail } from "../sending/delivery.js";
import {
  registerLogRoutes,
  registerSendRoutes,
} from "../sending/message-routes.js";
import { registerSettingsRoutes } from "../settings/settings-routes.js";
import { registerHeaderAndFooterRoutes } from "../templates/part-routes.js";
import { registerTemplateRoutes } from "../templates/template-routes.js";
import { registerConfigurationRoutes } from "../templates/configuration-routes.js";

export interface HttpServerParts {
  database: Database;
  jobs: JobQueue;
  appUrl: URL;
  encryptionKey: Buffer;
  sendEmail: SendEmail;
  uiDirectory: string | undefined;
  isLogging: boolean;
}

/**
 * The body every route takes unless it says otherwise: an email and a password, a name, the delivery settings, many
 * times over. A send and the routes that carry a Template take `largeBodyLimit`, and a route with no body schema takes
 * no body at all (pen test I1, #172).
 */
const bodyLimit = 16 * 1024;

const readFieldErrors = (error: FastifyError): FieldError[] =>
  (error.validation ?? []).flatMap((issue) => {
    const context = error.validationContext ?? "body";
    const path = issue.instancePath
      .split("/")
      .filter((segment) => segment !== "")
      .join(".");
    const missing =
      issue.keyword === "required" &&
      Array.isArray(issue.params.requiredProperties)
        ? issue.params.requiredProperties.filter(
            (property): property is string => typeof property === "string",
          )
        : [];
    if (missing.length > 0) {
      return missing.map((property) => {
        const field = path === "" ? property : `${path}.${property}`;
        return { field, message: `${context}.${field} is required` };
      });
    }
    const field = path === "" ? context : path;
    return [
      {
        field,
        message: `${context}.${field} ${issue.message ?? "is invalid"}`,
      },
    ];
  });

/**
 * The container log is outside Retention, so a request line keeps no query string (a Logs search is a recipient's
 * address) and an error keeps no value it carried, such as a failed query's parameters (pen test D2, #126).
 */
const loggerOptions = {
  serializers: {
    req: (request: FastifyRequest) => ({
      method: request.method,
      url: withoutQuery(request.url),
      host: request.host,
      remoteAddress: request.ip,
      remotePort: request.socket.remotePort,
    }),
    err: (error: unknown) => ({ ...describeErrorForLog(error) }),
  },
};

const isFastifyError = (error: unknown): error is FastifyError =>
  error instanceof Error && "code" in error;

export const buildHttpServer = async (
  parts: HttpServerParts,
): Promise<Server> => {
  registerAjvFormats();
  const server: Server = Fastify({
    logger: parts.isLogging ? loggerOptions : false,
    bodyLimit,
    // No proxy is in front of the platform, so `request.ip` is the socket's address and X-Forwarded-For is ignored:
    // the sign-in throttle keys on it (pen test H1, #114). Trusting a proxy has to name it.
    trustProxy: false,
    // A URL the router can't take (a bad percent-encoding, an over-long parameter) is refused from the closed set too,
    // not with Fastify's own body, which echoes the path (pen test I1, #174).
    frameworkErrors: (error, _request, reply: FastifyReply) => {
      const statusCode = readClientErrorStatus(error);
      const refusal =
        statusCode === undefined
          ? internalError
          : refuseFrameworkError(error, statusCode, bodyLimit);
      void reply.code(refusal.statusCode).send(refusalBody(refusal));
    },
  }).withTypeProvider<TypeBoxTypeProvider>();
  server.setValidatorCompiler(TypeBoxValidatorCompiler);
  server.decorateRequest("user", null);
  server.decorateRequest("apiKey", null);

  const indexHtml =
    parts.uiDirectory === undefined
      ? undefined
      : renderIndexHtml(
          await readFile(join(parts.uiDirectory, "index.html"), "utf8"),
          parts.appUrl,
        );
  const sessionCookie = sessionCookieName(parts.appUrl);

  // Every response, a refusal and a static file included, carries the security headers (pen test I1, #170).
  const headers = securityHeaders({ appUrl: parts.appUrl, indexHtml });
  server.addHook("onSend", async (_request, reply, payload) => {
    void reply.headers(headers);
    return payload;
  });

  server.setErrorHandler((error, request, reply) => {
    if (error instanceof TooManyRequestsError) {
      // Every limit's refusal says when to try again (PRD, request-rate policy).
      void reply.header("retry-after", String(error.retryAfterSeconds));
    }
    if (error instanceof RateLimitedError) {
      // And where the caller stands against the limit that fired.
      void reply.headers(rateLimitHeaders(error.allowance));
    }
    if (error instanceof RejectedRequestError) {
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
        ...(error.fieldErrors.length > 0 ? { errors: error.fieldErrors } : {}),
      });
    }
    if (isFastifyError(error) && error.validation !== undefined) {
      const errors = readFieldErrors(error);
      return reply.code(422).send({
        error: "validation_failed",
        message: errors.map((fieldError) => fieldError.message).join("; "),
        errors,
      });
    }
    // Whatever Fastify refuses before a route runs gets the platform's own code and a fixed message (pen test I1, #174).
    const statusCode = readClientErrorStatus(error);
    if (statusCode !== undefined && error instanceof Error) {
      const refusal = refuseFrameworkError(
        error,
        statusCode,
        request.routeOptions.bodyLimit,
      );
      return reply.code(refusal.statusCode).send(refusalBody(refusal));
    }
    request.log.error({ err: error }, "api.request.failed");
    return reply.code(500).send(refusalBody(internalError));
  });

  // A NUL byte anywhere in a body or a header is refused from the closed set, before validation reaches the database
  // (pen test S1, #151; A1, #144).
  // Headers are checked before any scope's onRequest hook reads a key or a session cookie.
  server.addHook("onRequest", (request, _reply, done) => {
    const fieldErrors = Object.entries(request.headers).flatMap(
      ([name, value]) => findNulBytes(value, ["headers", name]),
    );
    done(
      fieldErrors.length > 0
        ? new ValidationFailedError(fieldErrors)
        : undefined,
    );
  });
  // A route with no body schema takes no body: one is refused before a byte of it is read, after any scope's onRequest
  // hook has refused a caller with no credential (pen test I1, #172). GET and HEAD bodies are never read.
  server.addHook("preParsing", async (request, _reply, payload) => {
    const length = request.headers["content-length"];
    const hasBody =
      request.headers["transfer-encoding"] !== undefined ||
      (length !== undefined && length !== "0");
    const takesNoBody =
      !request.is404 &&
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      request.routeOptions.schema?.body === undefined;
    if (hasBody && takesNoBody) {
      throw new BodyNotTakenError();
    }
    return payload;
  });
  server.addHook("preValidation", (request, _reply, done) => {
    const fieldErrors = findNulBytes(request.body, ["body"]);
    done(
      fieldErrors.length > 0
        ? new ValidationFailedError(fieldErrors)
        : undefined,
    );
  });

  parts.database.$client.on("error", (error) => {
    server.log.error({ err: error }, "api.database.idle-client-failed");
  });

  await server.register(fastifyCookie);
  await server.register(fastifySwagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Email API",
        version: "2.0.0",
        description:
          "Send emails from your templates or raw content. Authenticate with an API key as a Bearer token.",
      },
      servers: [{ url: parts.appUrl.origin }],
      components: {
        securitySchemes: {
          apiKey: { type: "http", scheme: "bearer" },
        },
      },
      security: [{ apiKey: [] }],
    },
  });
  // The API document, its page and the page's files go to a signed-in User or an API Key holder, never to anyone (pen
  // test B1, #148). The UI's link to /docs sends the session cookie, same-origin.
  await server.register(async (scope: Server) => {
    scope.addHook("onRequest", async (request) => {
      const user = await loadSignedInUser(
        parts.database,
        request.cookies[sessionCookie],
      );
      if (user !== null) {
        return;
      }
      if (request.headers.authorization !== undefined) {
        await authenticateApiKey(parts.database, request.headers.authorization);
        return;
      }
      throw new RejectedRequestError(
        401,
        "unauthenticated",
        "Sign in, or send an API key as a Bearer token in the Authorization header",
      );
    });
    await scope.register(fastifySwaggerUi, { routePrefix: "/docs" });
  });

  server.get("/health", { schema: { hide: true } }, async (_request, reply) => {
    try {
      await parts.database.execute(sql`select 1`);
      return { status: "ok", database: "ok" };
    } catch {
      return reply
        .code(503)
        .send({ status: "failing", database: "unreachable" });
    }
  });

  registerSignInRoutes(server, parts);

  await server.register(
    (scope: Server, _options, done) => {
      scope.addHook("onRequest", async (request, reply) => {
        const key = await authenticateApiKey(
          parts.database,
          request.headers.authorization,
        );
        // Every /v1 route scopes what it changes, sends and reads to this key's Application (ADR 0009).
        request.apiKey = { apiKeyId: key.id, applicationId: key.applicationId };
        // The request log names the key, so a leaked key's calls can be found (pen test K1, #132).
        request.log = reply.log = request.log.child({ apiKeyId: key.id });
        // Counted against the key across the deployment, before the route runs (pen test I2a, #162).
        const allowance = await countKeyRequest(parts.database, key.id, {
          method: request.method,
          url: request.routeOptions.url,
        });
        if (allowance !== undefined) {
          void reply.headers(rateLimitHeaders(allowance));
        }
      });
      registerSendRoutes(scope, parts);
      registerTemplateRoutes(scope, parts);
      registerHeaderAndFooterRoutes(scope, parts);
      done();
    },
    { prefix: "/v1" },
  );

  await server.register(
    (scope: Server, _options, done) => {
      scope.addHook("onRoute", (routeOptions) => {
        routeOptions.schema = { ...routeOptions.schema, hide: true };
      });
      scope.addHook("onRequest", async (request, reply) => {
        request.user = await loadSignedInUser(
          parts.database,
          request.cookies[sessionCookie],
        );
        if (request.user === null) {
          throw new RejectedRequestError(
            401,
            "unauthenticated",
            "Sign in first",
          );
        }
        // Counted against the User across the deployment, before the route runs (pen test I2a, #162).
        void reply.headers(
          rateLimitHeaders(
            await countUserRequest(parts.database, request.user.userId),
          ),
        );
      });
      registerAccountRoutes(scope, parts);
      registerApplicationRoutes(scope, parts);
      registerTemplateRoutes(scope, parts);
      registerHeaderAndFooterRoutes(scope, parts);
      registerConfigurationRoutes(scope, parts);
      registerLogRoutes(scope, parts);
      registerSettingsRoutes(scope, parts);
      done();
    },
    { prefix: "/app" },
  );

  const startedAt = new Date();
  server.get(
    "/robots.txt",
    { schema: { hide: true } },
    async (_request, reply) =>
      reply.type("text/plain; charset=utf-8").send(robotsTxt(parts.appUrl)),
  );
  server.get(
    "/sitemap.xml",
    { schema: { hide: true } },
    async (_request, reply) =>
      reply
        .type("application/xml; charset=utf-8")
        .send(sitemapXml(parts.appUrl, startedAt)),
  );

  if (parts.uiDirectory !== undefined && indexHtml !== undefined) {
    const sendIndex = (reply: FastifyReply) =>
      reply
        .header("cache-control", "no-cache")
        .type("text/html; charset=utf-8")
        .send(indexHtml);
    await server.register(fastifyStatic, {
      root: parts.uiDirectory,
      wildcard: false,
      index: false,
    });
    server.get("/", { schema: { hide: true } }, async (_request, reply) =>
      sendIndex(reply),
    );
    server.setNotFoundHandler((request, reply) => {
      const isPageRequest =
        request.method === "GET" &&
        !/^\/(v1|app|auth|docs)(\/|$)/.test(request.url);
      if (isPageRequest) {
        return sendIndex(reply);
      }
      return reply.code(404).send({ error: "not_found", message: "Not found" });
    });
  } else {
    // Fastify's own 404 handler logs "Route GET:<url> not found", query string and all (pen test D2, #126).
    server.setNotFoundHandler((_request, reply) =>
      reply.code(404).send({ error: "not_found", message: "Not found" }),
    );
  }

  return server;
};
