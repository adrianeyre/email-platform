/** One field the email app refused, such as a missing template variable. */
export interface FieldError {
  field: string;
  message: string;
}

/** The email app answered with a status outside 2xx. */
export class EmailApiError extends Error {
  override name = "EmailApiError";

  constructor(
    /** The HTTP status, such as 401, 404 or 422. */
    readonly status: number,
    /** The app's error code, such as `validation_failed` or `not_found`, or `http_<status>` when it gave none. */
    readonly code: string,
    message: string,
    /** Each field the app refused, when it named any. */
    readonly fieldErrors: readonly FieldError[] = [],
  ) {
    super(message);
  }
}

/** The request never got an answer: the network failed or the app couldn't be reached. */
export class EmailNetworkError extends Error {
  override name = "EmailNetworkError";
}

/** The app took longer than `timeoutMs` to answer. The email may still have been accepted. */
export class EmailTimeoutError extends EmailNetworkError {
  override name = "EmailTimeoutError";

  constructor(readonly timeoutMs: number) {
    super(`The email app didn't answer within ${String(timeoutMs)} ms`);
  }
}
