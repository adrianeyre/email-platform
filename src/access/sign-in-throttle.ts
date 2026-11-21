import { isIPv4 } from "node:net";
import { eq, lt, sql } from "drizzle-orm";
import type { Database } from "../lib/database.js";
import { throttleKeys, type ThrottleState } from "../lib/schema.js";

/*
 * The sign-in figures of the request-rate policy (PRD, "Pre-condition: the request-rate policy"). Every throttle keeps
 * its keys in Postgres (`throttle_keys`), so every api process counts against one figure and a restart forgets nothing
 * (pen test A1, #142). A key's row is deleted once its 15-minute window has passed with nothing in it (#123).
 */
const signInWindowMs = 15 * 60_000;
const failedSignInLimit = 10;
const addressBurst = 10;
const addressTriesPerWindow = 30;
/** One try comes back to an address's burst every 30 seconds, so a steady caller gets 30 tries a window. */
const addressRefillMs = signInWindowMs / addressTriesPerWindow;

/** Expired rows are swept at most once a minute by each throttle, so a sweep's cost is spread. */
const sweepEveryMs = 60_000;

const secondsUntil = (ms: number): number => Math.max(1, Math.ceil(ms / 1000));

const recent = (times: number[] | undefined, now: number): number[] =>
  (times ?? []).filter((time) => now - time < signInWindowMs);

/** Seconds until a key with these failures may try again, or `undefined` while it has fewer than 10 in the window. */
export const failureRetryAfter = (
  state: ThrottleState | undefined,
  now: number,
): number | undefined => {
  const times = recent(state?.times, now);
  const oldest = times[0];
  return times.length < failedSignInLimit || oldest === undefined
    ? undefined
    : secondsUntil(oldest + signInWindowMs - now);
};

/** A key's state with one more failure. Only the latest failures decide a block, so it holds at most 10 times. */
export const withFailure = (
  state: ThrottleState | undefined,
  now: number,
): ThrottleState => ({
  times: [...recent(state?.times, now), now].slice(-failedSignInLimit),
});

/**
 * Takes one try from an address's allowance (#122). The policy's "Burst 10" and "30 tries per 15 minutes" are read
 * together as a token bucket of 10 that refills one try every 30 seconds, capped by a count of 30 tries in any 15
 * minutes: the 11th try in a row is refused, a steady caller gets one try every 30 seconds, and no 15 minutes holds
 * more than 30. Answers the address's new state, or the seconds until it may try again.
 */
export const takeTry = (
  state: ThrottleState | undefined,
  now: number,
): { state: ThrottleState } | { retryAfter: number } => {
  const times = recent(state?.times, now);
  const tokens =
    state?.tokens === undefined || state.at === undefined
      ? addressBurst
      : Math.min(
          addressBurst,
          state.tokens + (now - state.at) / addressRefillMs,
        );
  const oldest = times[0];
  const untilToken = tokens < 1 ? (1 - tokens) * addressRefillMs : 0;
  const untilWindow =
    times.length >= addressTriesPerWindow && oldest !== undefined
      ? oldest + signInWindowMs - now
      : 0;
  if (untilToken > 0 || untilWindow > 0) {
    return { retryAfter: secondsUntil(Math.max(untilToken, untilWindow)) };
  }
  return { state: { times: [...times, now], tokens: tokens - 1, at: now } };
};

/** Reads and changes keys' rows in `throttle_keys`, one key at a time across every process. */
const createThrottleStore = (database: Database, now: () => number) => {
  let sweptAt = Number.NEGATIVE_INFINITY;
  const sweep = async (): Promise<void> => {
    if (now() - sweptAt < sweepEveryMs) {
      return;
    }
    sweptAt = now();
    await database
      .delete(throttleKeys)
      .where(lt(throttleKeys.expiresAt, new Date(now())));
  };
  return {
    read: async (key: string): Promise<ThrottleState | undefined> => {
      await sweep();
      const [row] = await database
        .select({ state: throttleKeys.state })
        .from(throttleKeys)
        .where(eq(throttleKeys.key, key));
      return row?.state;
    },
    /**
     * Reads a key's state and writes what `change` makes of it, holding a lock on the key meanwhile, so two processes
     * can't both count from the same figure. `change` answers no state to leave the row as it was.
     */
    update: async <Result>(
      key: string,
      change: (state: ThrottleState | undefined) => {
        state?: ThrottleState;
        result: Result;
      },
    ): Promise<Result> => {
      await sweep();
      return database.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
        );
        const [row] = await transaction
          .select({ state: throttleKeys.state })
          .from(throttleKeys)
          .where(eq(throttleKeys.key, key));
        const { state, result } = change(row?.state);
        const latest = state?.times.at(-1);
        if (state !== undefined && latest !== undefined) {
          const expiresAt = new Date(latest + signInWindowMs);
          await transaction
            .insert(throttleKeys)
            .values({ key, state, expiresAt })
            .onConflictDoUpdate({
              target: throttleKeys.key,
              set: { state, expiresAt },
            });
        }
        return result;
      });
    },
    remove: async (key: string): Promise<void> => {
      await database.delete(throttleKeys).where(eq(throttleKeys.key, key));
    },
  };
};

/**
 * Failures counted per key (an account's normalised email at sign-in, a User at step-up): 10 in 15 minutes blocks it. `scope`
 * keeps one throttle's keys apart from another's in the shared table.
 */
export const createSignInThrottle = (
  database: Database,
  scope: "sign-in" | "step-up",
  now: () => number = Date.now,
) => {
  const store = createThrottleStore(database, now);
  const scoped = (key: string) => `${scope}:${key}`;
  return {
    /** Seconds until a blocked key may try again (until its oldest failure leaves the window), or `undefined`. */
    retryAfterSeconds: async (key: string): Promise<number | undefined> =>
      failureRetryAfter(await store.read(scoped(key)), now()),
    recordFailure: (key: string): Promise<void> =>
      store.update(scoped(key), (state) => ({
        state: withFailure(state, now()),
        result: undefined,
      })),
    clear: (key: string): Promise<void> => store.remove(scoped(key)),
  };
};

/** Every sign-in try counted per address, whatever email it names (#122): see `takeTry`. */
export const createSignInAddressThrottle = (
  database: Database,
  now: () => number = Date.now,
) => {
  const store = createThrottleStore(database, now);
  return {
    /** Takes one try for the address, answering `undefined`, or the seconds until it may try again if it may not. */
    take: (address: string): Promise<number | undefined> =>
      store.update(`sign-in-address:${address}`, (state) => {
        const outcome = takeTry(state, now());
        return "state" in outcome
          ? { state: outcome.state, result: undefined }
          : { result: outcome.retryAfter };
      }),
  };
};

/** The socket's address as the throttles key on it: an IPv4-mapped IPv6 address folded to its IPv4 form. */
export const throttleAddress = (ip: string): string => {
  const mapped = ip.toLowerCase().startsWith("::ffff:") ? ip.slice(7) : "";
  return isIPv4(mapped) ? mapped : ip;
};
