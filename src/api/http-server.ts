import fastifyCookie from "@fastify/cookie";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyReply } from "fastify";
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
import { loadSignedInUser } from "../access/users.js";
import type { Database } from "../lib/database.js";
import {
  RejectedRequestError,
  type FieldError,
  type Server,
} from "../lib/http.js";
import type { JobQueue } from "../lib/jobs.js";
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

const bodyLimit = 36 * 1024 * 1024;

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

const isFastifyError = (error: unknown): error is FastifyError =>
  error instanceof Error && "code" in error;

export const buildHttpServer = async (
  parts: HttpServerParts,
): Promise<Server> => {
  registerAjvFormats();
  const server: Server = Fastify({
    logger: parts.isLogging,
    bodyLimit,
    trustProxy: true,
  }).withTypeProvider<TypeBoxTypeProvider>();
  server.setValidatorCompiler(TypeBoxValidatorCompiler);
  server.decorateRequest("user", null);

  server.setErrorHandler((error, request, reply) => {
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
    if (isFastifyError(error) && error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return reply.code(413).send({
        error: "message_too_large",
        message: "The request is larger than the 25 MB message limit allows",
      });
    }
    if (
      isFastifyError(error) &&
      error.statusCode !== undefined &&
      error.statusCode < 500
    ) {
      return reply
        .code(error.statusCode)
        .send({ error: error.code, message: error.message });
    }
    request.log.error({ err: error }, "api.request.failed");
    return reply
      .code(500)
      .send({ error: "internal_error", message: "Something went wrong" });
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
  await server.register(fastifySwaggerUi, { routePrefix: "/docs" });

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
      scope.addHook("onRequest", async (request) => {
        await authenticateApiKey(parts.database, request.headers.authorization);
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
      scope.addHook("onRequest", async (request) => {
        request.user = await loadSignedInUser(
          parts.database,
          request.cookies[sessionCookieName],
        );
        if (request.user === null) {
          throw new RejectedRequestError(
            401,
            "unauthenticated",
            "Sign in first",
          );
        }
      });
      registerAccountRoutes(scope, parts);
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

  if (parts.uiDirectory !== undefined) {
    const indexHtml = renderIndexHtml(
      await readFile(join(parts.uiDirectory, "index.html"), "utf8"),
      parts.appUrl,
    );
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
  }

  return server;
};
