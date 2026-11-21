import type { IncomingMessage, ServerResponse } from "node:http";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyRequest,
  RawServerDefault,
} from "fastify";

export type Server = FastifyInstance<
  RawServerDefault,
  IncomingMessage,
  ServerResponse,
  FastifyBaseLogger,
  TypeBoxTypeProvider
>;

export interface SignedInUser {
  userId: string;
  email: string;
}

/** The API Key a `/v1` request was made with, and the Application it acts for. */
export interface CallingApiKey {
  apiKeyId: string;
  applicationId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user: SignedInUser | null;
    /** Set on `/v1`, where an API Key is scoped to its Application; null for a signed-in User, who may change anything. */
    apiKey: CallingApiKey | null;
  }
}

/**
 * The body a send, or a route that carries a Template or its variables, may be: a 25 MB message in base64 with room for
 * its JSON. Every other route takes the server's 16 KiB, or no body at all (pen test I1, #172).
 */
export const largeBodyLimit = 36 * 1024 * 1024;

export interface FieldError {
  field: string;
  message: string;
}

export class RejectedRequestError extends Error {
  override name = "RejectedRequestError";

  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly fieldErrors: readonly FieldError[] = [],
  ) {
    super(message);
  }
}

export class ValidationFailedError extends RejectedRequestError {
  override name = "ValidationFailedError";

  constructor(fieldErrors: readonly FieldError[]) {
    super(
      422,
      "validation_failed",
      fieldErrors.map((fieldError) => fieldError.message).join("; "),
      fieldErrors,
    );
  }
}

/**
 * The one refusal every request-rate limit gives, whichever limit fired (the PRD's request-rate policy), so the body
 * doesn't tell a caller which limit it met. `Retry-After` carries when to try again.
 */
export class TooManyRequestsError extends RejectedRequestError {
  override name = "TooManyRequestsError";

  constructor(readonly retryAfterSeconds: number) {
    super(
      429,
      "too_many_requests",
      "Too many requests. Try again after the number of seconds in the Retry-After header",
    );
  }
}

export class NotFoundError extends RejectedRequestError {
  override name = "NotFoundError";

  constructor(thing: string) {
    super(404, "not_found", `${thing} was not found`);
  }
}

export const getSignedInUser = (request: FastifyRequest): SignedInUser => {
  if (request.user === null) {
    throw new RejectedRequestError(401, "unauthenticated", "Sign in first");
  }
  return request.user;
};

export const isUniqueViolation = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const cause: unknown = Reflect.get(error, "cause");
  return (
    Reflect.get(error, "code") === "23505" ||
    (typeof cause === "object" &&
      cause !== null &&
      Reflect.get(cause, "code") === "23505")
  );
};

/** The unique constraint a unique violation broke, such as "templates_slug_unique", or undefined. */
export const findViolatedConstraint = (error: unknown): string | undefined => {
  if (
    !isUniqueViolation(error) ||
    typeof error !== "object" ||
    error === null
  ) {
    return undefined;
  }
  const cause: unknown = Reflect.get(error, "cause");
  const constraint: unknown =
    Reflect.get(error, "constraint") ??
    (typeof cause === "object" && cause !== null
      ? Reflect.get(cause, "constraint")
      : undefined);
  return typeof constraint === "string" ? constraint : undefined;
};

/**
 * Every place a JSON body or a header carries a NUL byte, by field path. Postgres refuses 0x00 in text (SQLSTATE 22021),
 * so a NUL byte is refused here with 422, before any query, rather than reaching the database as a 500 (pen test S1,
 * #151; A1, #144).
 */
export const findNulBytes = (
  value: unknown,
  path: readonly string[] = [],
): FieldError[] => {
  const field = path.join(".");
  if (typeof value === "string") {
    return value.includes("\u0000")
      ? [{ field, message: `${field} must not contain a NUL byte` }]
      : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findNulBytes(item, [...path, String(index)]),
    );
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => [
      ...(key.includes("\u0000")
        ? [
            {
              field: [...path, key].join("."),
              message: `${[...path, key].join(".")} must not contain a NUL byte`,
            },
          ]
        : []),
      ...findNulBytes(item, [...path, key]),
    ]);
  }
  return [];
};
