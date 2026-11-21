import { describe, expect, it } from "vitest";
import { TooManyRequestsError } from "./http.js";
import { RateLimitedError, rateLimitHeaders } from "./rate-limit.js";

describe("rateLimitHeaders", () => {
  it("reports a limit in the RateLimit draft's three headers", () => {
    expect(
      rateLimitHeaders({ limit: 60, remaining: 12, resetSeconds: 24 }),
    ).toEqual({
      "ratelimit-limit": "60",
      "ratelimit-remaining": "12",
      "ratelimit-reset": "24",
    });
  });
});

describe("RateLimitedError", () => {
  const allowance = { limit: 10, remaining: 0, resetSeconds: 40 };

  it("is the one 429 every limit gives, whichever fired", () => {
    const error = new RateLimitedError(allowance);
    expect(error).toBeInstanceOf(TooManyRequestsError);
    expect(error.statusCode).toBe(429);
    expect(error.code).toBe("too_many_requests");
    expect(error.message).toBe(new TooManyRequestsError(1).message);
  });

  it("says to come back when the window ends, or sooner when a request comes back sooner", () => {
    expect(new RateLimitedError(allowance).retryAfterSeconds).toBe(40);
    expect(new RateLimitedError(allowance, 1).retryAfterSeconds).toBe(1);
  });
});
