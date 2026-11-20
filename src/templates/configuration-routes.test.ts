import { describe, expect, it } from "vitest";
import { formatFromAddress } from "./configuration-routes.js";

describe("formatFromAddress", () => {
  it("puts the from name before the address", () => {
    expect(
      formatFromAddress({
        fromEmail: "no-reply@wizzaroo.adrianeyre.co.uk",
        fromName: "Wizzaroo",
      }),
    ).toBe("Wizzaroo <no-reply@wizzaroo.adrianeyre.co.uk>");
  });

  it("sends the address alone when there is no name", () => {
    expect(
      formatFromAddress({ fromEmail: "a@example.com", fromName: "  " }),
    ).toBe("a@example.com");
  });

  it("quotes a name with punctuation, and escapes its quotes", () => {
    expect(
      formatFromAddress({
        fromEmail: "a@example.com",
        fromName: 'Ada "The Countess", Lovelace',
      }),
    ).toBe('"Ada \\"The Countess\\", Lovelace" <a@example.com>');
    expect(
      formatFromAddress({ fromEmail: "a@example.com", fromName: "A.\nB" }),
    ).toBe('"A. B" <a@example.com>');
  });
});
