import { describe, expect, it } from "vitest";
import { maskEmailAddress } from "./mask-email-address.js";

describe("maskEmailAddress", () => {
  it("keeps the first character and the domain", () => {
    expect(maskEmailAddress("ada@example.com")).toBe("a•••@example.com");
  });

  it("uses the last @", () => {
    expect(maskEmailAddress('"a@b"@example.com')).toBe('"•••@example.com');
  });

  it("hides an address with no mailbox or no @", () => {
    expect(maskEmailAddress("@example.com")).toBe("•••");
    expect(maskEmailAddress("ada")).toBe("•••");
  });
});
