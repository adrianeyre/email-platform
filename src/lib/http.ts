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

declare module "fastify" {
  interface FastifyRequest {
    user: SignedInUser | null;
  }
}

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

export const describeError = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return String(error);
  }
  if (error.message !== "") {
    return error.message;
  }
  const nested =
    error instanceof AggregateError
      ? error.errors.map(describeError).filter((message) => message !== "")
      : [];
  const code: unknown = Reflect.get(error, "code");
  return (
    [...new Set(nested)].join("; ") ||
    (typeof code === "string" ? code : "") ||
    error.name
  );
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
