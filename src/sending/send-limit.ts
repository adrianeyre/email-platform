import type { Database } from "../lib/database.js";
import { RejectedRequestError, ValidationFailedError } from "../lib/http.js";
import { countInWindow, type Allowance } from "../lib/rate-limit.js";
import { apiKeys } from "../lib/schema.js";

/**
 * How many recipient addresses (to, cc and bcc together) one API Key may send to in a minute, across the deployment.
 * The figure is the PRD's request-rate policy (docs/product-requirements-document/pen-testing.md, "Pre-condition: the
 * request-rate policy"), which is its home: change it there, with its date and reason, then here. It is a constant,
 * not configuration, so no environment can run without it or loosen it.
 */
export const recipientsPerKeyPerMinute = 30;

/** Where a key stands against its send limit after a send was counted or refused, for the RateLimit headers. */
export type SendAllowance = Allowance;

/** Refuses a Message with more recipients than a key may send to in a minute: waiting would never let it through. */
export const checkRecipientCount = (recipients: number, limit: number) => {
  if (recipients > limit) {
    throw new ValidationFailedError([
      {
        field: "to",
        message: `Send to at most ${String(limit)} recipients (to, cc and bcc together) in one message: that is an API key's limit a minute`,
      },
    ]);
  }
};

/**
 * Counts a Message's recipients against its API Key's fixed one-minute window, in the transaction that stores the
 * Message, so a refused or failed send counts nothing. One UPDATE checks and counts at once, so two api processes
 * sending with one key can't both take the last of its limit. A window starts with the first send after the last one
 * ended. Throws RateLimitedError when the recipients don't fit in what is left.
 */
export const countSend = async (
  database: Pick<Database, "execute">,
  apiKeyId: string,
  recipients: number,
  limit: number,
): Promise<SendAllowance> => {
  const allowance = await countInWindow(
    database,
    { table: apiKeys, id: apiKeys.id, value: apiKeyId },
    {
      limit,
      windowSeconds: 60,
      startedAt: apiKeys.sendWindowStartedAt,
      count: apiKeys.sendWindowRecipients,
    },
    recipients,
  );
  if (allowance === undefined) {
    // The key was deleted while the request was on its way.
    throw new RejectedRequestError(
      401,
      "unauthenticated",
      "The API key is not valid",
    );
  }
  return allowance;
};
