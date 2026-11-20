import { describe, expect, it } from "vitest";
import { isPermanentSmtpFailure } from "./delivery.js";

describe("isPermanentSmtpFailure", () => {
  it("treats 5xx SMTP replies as permanent and everything else as retryable", () => {
    expect(isPermanentSmtpFailure({ responseCode: 550 })).toBe(true);
    expect(isPermanentSmtpFailure({ responseCode: 421 })).toBe(false);
    expect(isPermanentSmtpFailure(new Error("ECONNREFUSED"))).toBe(false);
    expect(isPermanentSmtpFailure(undefined)).toBe(false);
  });
});
