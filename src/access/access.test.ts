import { describe, expect, it } from "vitest";
import type { ThrottleState } from "../lib/schema.js";
import {
  failureRetryAfter,
  takeTry,
  throttleAddress,
  withFailure,
} from "./sign-in-throttle.js";

describe("the failure throttle's arithmetic", () => {
  it("blocks after 10 failures in 15 minutes and forgets them afterwards", () => {
    let state: ThrottleState | undefined;
    for (let index = 0; index < 9; index += 1) {
      state = withFailure(state, 0);
    }
    expect(failureRetryAfter(state, 0)).toBeUndefined();
    state = withFailure(state, 0);
    expect(failureRetryAfter(state, 0)).toBe(15 * 60);
    expect(failureRetryAfter(undefined, 0)).toBeUndefined();
    expect(failureRetryAfter(state, 15 * 60_000)).toBeUndefined();
  });

  it("answers Retry-After until the oldest failure leaves the window", () => {
    let state: ThrottleState | undefined;
    let now = 0;
    for (let index = 0; index < 10; index += 1) {
      state = withFailure(state, now);
      now += 60_000;
    }
    expect(failureRetryAfter(state, now)).toBe(5 * 60);
  });

  it("keeps at most the limit's 10 failures, dropping those past the window", () => {
    let state: ThrottleState | undefined;
    for (let index = 0; index < 25; index += 1) {
      state = withFailure(state, index);
    }
    expect(state?.times).toHaveLength(10);
    expect(withFailure(state, 20 * 60_000).times).toEqual([20 * 60_000]);
  });
});

describe("the address throttle's arithmetic (#122)", () => {
  /** Takes one try after another for one address, as the stored state would carry them. */
  const takeAt = (states: Map<string, ThrottleState>, address: string) => {
    return (now: number): number | undefined => {
      const outcome = takeTry(states.get(address), now);
      if ("state" in outcome) {
        states.set(address, outcome.state);
        return undefined;
      }
      return outcome.retryAfter;
    };
  };

  it("refuses the 11th try in a row, then gives one try back every 30 seconds", () => {
    const states = new Map<string, ThrottleState>();
    const take = takeAt(states, "192.0.2.1");
    const taken = Array.from({ length: 11 }, () => take(0));
    expect(taken.slice(0, 10)).toEqual(Array<undefined>(10).fill(undefined));
    expect(taken[10]).toBe(30);
    expect(takeAt(states, "192.0.2.2")(0)).toBeUndefined();
    expect(take(30_000)).toBeUndefined();
    expect(take(30_000)).toBe(30);
  });

  it("holds an address to 30 tries in any 15 minutes", () => {
    const take = takeAt(new Map(), "192.0.2.1");
    let accepted = 0;
    // A try every 10 seconds for 15 minutes: the bucket alone would let 10 + 30 through.
    for (let now = 0; now < 15 * 60_000; now += 10_000) {
      if (take(now) === undefined) {
        accepted += 1;
      }
    }
    expect(accepted).toBe(30);
  });
});

describe("throttleAddress", () => {
  it("folds an IPv4-mapped IPv6 address to IPv4 and leaves others alone", () => {
    expect(throttleAddress("::ffff:192.0.2.1")).toBe("192.0.2.1");
    expect(throttleAddress("::FFFF:192.0.2.1")).toBe("192.0.2.1");
    expect(throttleAddress("192.0.2.1")).toBe("192.0.2.1");
    expect(throttleAddress("2001:db8::1")).toBe("2001:db8::1");
    expect(throttleAddress("::ffff:2001:db8::1")).toBe("::ffff:2001:db8::1");
  });
});
