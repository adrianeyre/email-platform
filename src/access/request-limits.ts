import type { Database } from "../lib/database.js";
import { RejectedRequestError } from "../lib/http.js";
import {
  countInWindow,
  takeToken,
  type Allowance,
  type FixedWindow,
  type TokenBucket,
} from "../lib/rate-limit.js";
import { apiKeys, users } from "../lib/schema.js";

/*
 * The request-rate policy's limits on `/v1` and `/app` (pen test I2a, #162 and #164). The figures are the PRD's
 * (docs/product-requirements-document/pen-testing.md, "Pre-condition: the request-rate policy"), which is their home:
 * change one there, with its date and reason, then here. They are constants, not configuration, so no environment can
 * run without them or loosen them. Each is counted on its owner's row, across the deployment. Sends are counted by
 * src/sending/send-limit.ts.
 */

/** Every `/v1` call but a send and a Template preview: 120 a minute per API Key, 60 in a row. */
export const keyRequestsPerMinute = 120;
export const keyRequestBurst = 60;
/** `POST /v1/templates/preview`: 10 a minute per API Key. */
export const previewsPerKeyPerMinute = 10;
/** Every `/app` call: 300 a minute per User, 100 in a row. */
export const userRequestsPerMinute = 300;
export const userRequestBurst = 100;
/** `POST /app/settings/test`: 5 an hour per User, on top of the User's `/app` limit. */
export const testSendsPerUserPerHour = 5;

const keyRequests: TokenBucket = {
  burst: keyRequestBurst,
  perMinute: keyRequestsPerMinute,
  tokens: apiKeys.requestTokens,
  at: apiKeys.requestTokensAt,
};

const keyPreviews: FixedWindow = {
  limit: previewsPerKeyPerMinute,
  windowSeconds: 60,
  startedAt: apiKeys.previewWindowStartedAt,
  count: apiKeys.previewWindowCount,
};

const userRequests: TokenBucket = {
  burst: userRequestBurst,
  perMinute: userRequestsPerMinute,
  tokens: users.requestTokens,
  at: users.requestTokensAt,
};

const userTestSends: FixedWindow = {
  limit: testSendsPerUserPerHour,
  windowSeconds: 60 * 60,
  startedAt: users.testSendWindowStartedAt,
  count: users.testSendWindowCount,
};

/** The row was deleted while the request was on its way: the key or session is no longer valid. */
const gone = (allowance: Allowance | undefined, message: string): Allowance => {
  if (allowance === undefined) {
    throw new RejectedRequestError(401, "unauthenticated", message);
  }
  return allowance;
};

/**
 * Counts a `/v1` request against its API Key: a Template preview against the key's previews, a send against nothing
 * here (its recipients are counted with the Message), anything else against the key's requests. Answers where the key
 * stands, `undefined` for a send; throws RateLimitedError when the limit is reached.
 */
export const countKeyRequest = async (
  database: Database,
  apiKeyId: string,
  route: { method: string; url: string | undefined },
): Promise<Allowance | undefined> => {
  if (route.method === "POST" && route.url === "/v1/messages") {
    return undefined;
  }
  const row = { table: apiKeys, id: apiKeys.id, value: apiKeyId };
  const isPreview =
    route.method === "POST" && route.url === "/v1/templates/preview";
  return gone(
    isPreview
      ? await countInWindow(database, row, keyPreviews)
      : await takeToken(database, row, keyRequests),
    "The API key is not valid",
  );
};

/** Counts an `/app` request against its User. Throws RateLimitedError when the limit is reached. */
export const countUserRequest = async (
  database: Database,
  userId: string,
): Promise<Allowance> =>
  gone(
    await takeToken(
      database,
      { table: users, id: users.id, value: userId },
      userRequests,
    ),
    "Sign in first",
  );

/** Counts a test send against its User. Throws RateLimitedError when the limit is reached. */
export const countTestSend = async (
  database: Database,
  userId: string,
): Promise<Allowance> =>
  gone(
    await countInWindow(
      database,
      { table: users, id: users.id, value: userId },
      userTestSends,
    ),
    "Sign in first",
  );
