/**
 * The platform's own refusal for whatever Fastify refuses before a route runs: a body it can't take, one over the
 * route's limit, a URL it can't read. Each is a code from the platform's closed set with a fixed message, so a refusal
 * echoes nothing the caller sent and doesn't name the framework (pen test I1, #172, #174).
 */
import { RejectedRequestError } from "../lib/http.js";

export interface Refusal {
  statusCode: number;
  error: string;
  message: string;
}

/** The body a refusal is sent with. */
export const refusalBody = ({ error, message }: Refusal) => ({
  error,
  message,
});

/** Anything that isn't the caller's fault: the error is logged, and the caller learns nothing about it. */
export const internalError: Refusal = {
  statusCode: 500,
  error: "internal_error",
  message: "Something went wrong",
};

const megabyte = 1024 * 1024;

/** A route's body limit as the guide writes it: `36 MB`, `16 KiB`. */
export const formatBodyLimit = (bytes: number): string =>
  bytes % megabyte === 0
    ? `${String(bytes / megabyte)} MB`
    : `${String(Math.floor(bytes / 1024))} KiB`;

/** The 413 for a body over the route's own limit, naming that limit. */
export const bodyTooLarge = (bodyLimit: number): Refusal => ({
  statusCode: 413,
  error: "request_too_large",
  message: `The request is larger than the ${formatBodyLimit(bodyLimit)} this route takes`,
});

/** A route that takes no body refuses one before a byte of it is read. */
export class BodyNotTakenError extends RejectedRequestError {
  override name = "BodyNotTakenError";

  constructor() {
    super(413, "request_too_large", "This route takes no request body");
  }
}

const unsupportedMediaType: Refusal = {
  statusCode: 415,
  error: "unsupported_media_type",
  message:
    "The request's Content-Type is not one this route takes: send application/json",
};

const byFastifyCode: Readonly<Record<string, Refusal>> = {
  FST_ERR_CTP_INVALID_MEDIA_TYPE: unsupportedMediaType,
  FST_ERR_CTP_INVALID_JSON_BODY: {
    statusCode: 400,
    error: "invalid_json",
    message: "The request body is not valid JSON",
  },
  FST_ERR_CTP_EMPTY_JSON_BODY: {
    statusCode: 400,
    error: "invalid_json",
    message:
      "The request body is empty, but its Content-Type is application/json",
  },
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: {
    statusCode: 400,
    error: "invalid_content_length",
    message:
      "The request body's length does not match its Content-Length header",
  },
};

/** Any other refusal under 500 keeps its status and gets the platform's code for it. */
const byStatus = (statusCode: number): Refusal => {
  switch (statusCode) {
    case 404:
      return { statusCode, error: "not_found", message: "Not found" };
    case 415:
      return unsupportedMediaType;
    default:
      return {
        statusCode,
        error: "bad_request",
        message: "The request could not be read",
      };
  }
};

/** The status of an error that refuses the caller (400 to 499), or undefined for any other error. */
export const readClientErrorStatus = (error: unknown): number | undefined => {
  if (!(error instanceof Error)) {
    return undefined;
  }
  const statusCode: unknown = Reflect.get(error, "statusCode");
  return typeof statusCode === "number" && statusCode >= 400 && statusCode < 500
    ? statusCode
    : undefined;
};

/** The platform's refusal for a framework error under 500, given the route's body limit for a 413. */
export const refuseFrameworkError = (
  error: Error,
  statusCode: number,
  bodyLimit: number,
): Refusal => {
  const code: unknown = Reflect.get(error, "code");
  if (statusCode === 413 || code === "FST_ERR_CTP_BODY_TOO_LARGE") {
    return bodyTooLarge(bodyLimit);
  }
  return (
    (typeof code === "string" ? byFastifyCode[code] : undefined) ??
    byStatus(statusCode)
  );
};
