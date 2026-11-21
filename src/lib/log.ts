import { DrizzleQueryError } from "drizzle-orm";
import { DatabaseError } from "pg";

/**
 * What the platform writes to its container logs about an error. The logs sit outside Retention, so they hold no
 * value a request or query carried (pen test D2, #126): no SQL parameters, no query, no database message (Postgres
 * quotes the offending value in some, such as `invalid input syntax for type uuid: "…"`), and a stack of frames only,
 * since a stack's first line repeats the message.
 */
export interface LoggedError {
  type: string;
  message: string;
  code?: string;
  routine?: string;
  constraint?: string;
  stack: string;
  cause?: LoggedError;
}

const maxCauseDepth = 3;

const readString = (value: object, key: string): string | undefined => {
  const field: unknown = Reflect.get(value, key);
  return typeof field === "string" ? field : undefined;
};

const stackFrames = (error: Error): string =>
  (error.stack ?? "")
    .split("\n")
    .filter((line) => /^\s+at /u.test(line))
    .join("\n");

const describe = (error: unknown, depth: number): LoggedError => {
  if (!(error instanceof Error)) {
    return { type: typeof error, message: "A non-Error was thrown", stack: "" };
  }
  const cause =
    depth < maxCauseDepth && error.cause !== undefined
      ? { cause: describe(error.cause, depth + 1) }
      : {};
  if (error instanceof DrizzleQueryError) {
    // Its message is "Failed query: <sql>\nparams: <every value>"; the cause says what went wrong.
    return {
      type: "DrizzleQueryError",
      message: "Failed query",
      stack: stackFrames(error),
      ...cause,
    };
  }
  if (error instanceof DatabaseError) {
    // The SQLSTATE code and the server routine name the failure without the value that caused it.
    return {
      type: "DatabaseError",
      message: `Database error ${error.code ?? "unknown"}`,
      code: error.code,
      routine: error.routine,
      constraint: error.constraint,
      stack: stackFrames(error),
      ...cause,
    };
  }
  return {
    type: error.name,
    message: error.message,
    code: readString(error, "code"),
    stack: stackFrames(error),
    ...cause,
  };
};

export const describeErrorForLog = (error: unknown): LoggedError =>
  describe(error, 0);

/** A request's path without its query string, which can hold a search term such as a recipient's address. */
export const withoutQuery = (url: string): string => {
  const queryStart = url.indexOf("?");
  return queryStart === -1 ? url : `${url.slice(0, queryStart)}?[redacted]`;
};
