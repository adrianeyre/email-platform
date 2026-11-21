import { sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Queryable } from "./database.js";
import { TooManyRequestsError } from "./http.js";

/*
 * The two shapes of the request-rate policy's limits (docs/product-requirements-document/pen-testing.md, "Pre-condition:
 * the request-rate policy"), each counted on its owner's row (an API Key's or a User's) by one UPDATE that checks and
 * counts at once, so every api process counts against one figure. Time is the database's clock, so every process agrees.
 * The figures themselves live beside the limits that use them, never here.
 */

/** Where a caller stands against a limit after a request was counted or refused, for the RateLimit headers. */
export interface Allowance {
  limit: number;
  remaining: number;
  /** Seconds until the caller's whole limit is back. */
  resetSeconds: number;
}

/**
 * A request a limit refused: the one 429 every limit gives (the error handler sends its body and Retry-After), with
 * where the caller stands, which the error handler reports in the RateLimit headers.
 */
export class RateLimitedError extends TooManyRequestsError {
  override name = "RateLimitedError";

  constructor(
    readonly allowance: Allowance,
    retryAfterSeconds: number = allowance.resetSeconds,
  ) {
    super(retryAfterSeconds);
  }
}

/** The headers that report a limit (the IETF RateLimit header fields draft's RateLimit-Limit, -Remaining and -Reset). */
export const rateLimitHeaders = (
  allowance: Allowance,
): Record<string, string> => ({
  "ratelimit-limit": String(allowance.limit),
  "ratelimit-remaining": String(allowance.remaining),
  "ratelimit-reset": String(allowance.resetSeconds),
});

/** The row a limit is counted on: its table, its key column and the key. */
export interface LimitedRow {
  table: PgTable;
  id: PgColumn;
  value: string;
}

/** A limit with a burst: up to `burst` requests in a row, refilled at `perMinute` a minute (a token bucket). */
export interface TokenBucket {
  burst: number;
  perMinute: number;
  /** What is left of the burst (double precision, null for full) and when that was worked out. */
  tokens: PgColumn;
  at: PgColumn;
}

/** A limit of `limit` in a fixed window of `windowSeconds`, which starts with the first count after the last one ended. */
export interface FixedWindow {
  limit: number;
  windowSeconds: number;
  /** When the current window started (null for none) and what it has counted. */
  startedAt: PgColumn;
  count: PgColumn;
}

type Executor = Pick<Queryable, "execute">;

const seconds = (value: number) => Math.max(1, Math.ceil(value));

/**
 * Takes one request from a token bucket. Answers where the caller stands, or `undefined` when the row is gone (its key or
 * User deleted while the request was on its way); throws RateLimitedError, with a Retry-After of when one request is
 * back, when the bucket is empty.
 */
export const takeToken = async (
  database: Executor,
  row: LimitedRow,
  bucket: TokenBucket,
): Promise<Allowance | undefined> => {
  const perSecond = bucket.perMinute / 60;
  const burst = sql`${bucket.burst}::float8`;
  const available = sql`least(${burst}, coalesce(${bucket.tokens}, ${burst}) + extract(epoch from (now() - coalesce(${bucket.at}, now())))::float8 * ${perSecond}::float8)`;
  const fullIn = (tokens: number) =>
    seconds((bucket.burst - tokens) / perSecond);
  const taken = await database.execute<{ tokens: number }>(
    sql`update ${row.table} set ${sql.identifier(bucket.tokens.name)} = ${available} - 1, ${sql.identifier(bucket.at.name)} = now() where ${row.id} = ${row.value} and ${available} >= 1 returning ${bucket.tokens} as tokens`,
  );
  const left = taken.rows[0];
  if (left !== undefined) {
    return {
      limit: bucket.burst,
      remaining: Math.floor(left.tokens),
      resetSeconds: fullIn(left.tokens),
    };
  }
  const refused = await database.execute<{ tokens: number }>(
    sql`select ${available} as tokens from ${row.table} where ${row.id} = ${row.value}`,
  );
  const now = refused.rows[0];
  if (now === undefined) {
    return undefined;
  }
  throw new RateLimitedError(
    { limit: bucket.burst, remaining: 0, resetSeconds: fullIn(now.tokens) },
    seconds((1 - now.tokens) / perSecond),
  );
};

/**
 * Counts `units` against a fixed window. Answers where the caller stands, or `undefined` when the row is gone; throws
 * RateLimitedError, with a Retry-After of when the window ends, when the units don't fit in what is left. Run in a
 * transaction, a count is undone with it.
 */
export const countInWindow = async (
  database: Executor,
  row: LimitedRow,
  window: FixedWindow,
  units = 1,
): Promise<Allowance | undefined> => {
  const length = sql`(${window.windowSeconds}::integer * interval '1 second')`;
  const isOver = sql`(${window.startedAt} is null or ${window.startedAt} <= now() - ${length})`;
  const secondsLeft = sql`greatest(1, ceil(extract(epoch from (${window.startedAt} + ${length} - now()))))::integer`;
  const amount = sql`${units}::integer`;
  const counted = await database.execute<{
    count: number;
    reset_seconds: number;
  }>(
    sql`update ${row.table} set ${sql.identifier(window.startedAt.name)} = case when ${isOver} then now() else ${window.startedAt} end, ${sql.identifier(window.count.name)} = case when ${isOver} then ${amount} else ${window.count} + ${amount} end where ${row.id} = ${row.value} and (${isOver} or ${window.count} + ${amount} <= ${window.limit}::integer) returning ${window.count} as count, ${secondsLeft} as reset_seconds`,
  );
  const allowance = (found: { count: number; reset_seconds: number }) => ({
    limit: window.limit,
    remaining: Math.max(0, window.limit - found.count),
    resetSeconds: found.reset_seconds,
  });
  const fitted = counted.rows[0];
  if (fitted !== undefined) {
    return allowance(fitted);
  }
  const refused = await database.execute<{
    count: number;
    reset_seconds: number;
  }>(
    sql`select ${window.count} as count, ${secondsLeft} as reset_seconds from ${row.table} where ${row.id} = ${row.value}`,
  );
  const found = refused.rows[0];
  if (found === undefined) {
    return undefined;
  }
  throw new RateLimitedError(allowance(found));
};
