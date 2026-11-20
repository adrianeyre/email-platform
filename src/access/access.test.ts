import { describe, expect, it } from "vitest";
import { createSignInThrottle } from "./access-routes.js";

describe("createSignInThrottle", () => {
  it("blocks after 10 failures in 15 minutes and forgets them afterwards", () => {
    let now = 0;
    const throttle = createSignInThrottle(() => now);
    for (let index = 0; index < 9; index += 1) {
      throttle.recordFailure("ip:a@example.com");
    }
    expect(throttle.isBlocked("ip:a@example.com")).toBe(false);
    throttle.recordFailure("ip:a@example.com");
    expect(throttle.isBlocked("ip:a@example.com")).toBe(true);
    expect(throttle.isBlocked("ip:b@example.com")).toBe(false);
    now = 15 * 60_000;
    expect(throttle.isBlocked("ip:a@example.com")).toBe(false);
  });

  it("clears failures after a successful sign-in", () => {
    const throttle = createSignInThrottle();
    for (let index = 0; index < 10; index += 1) {
      throttle.recordFailure("key");
    }
    throttle.clear("key");
    expect(throttle.isBlocked("key")).toBe(false);
  });
});
