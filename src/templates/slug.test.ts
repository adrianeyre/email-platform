import { describe, expect, it } from "vitest";
import {
  findSlugProblem,
  firstFreeSlug,
  isValidSlug,
  maxSlugLength,
  numberedSlug,
  slugify,
} from "./slug.js";

describe("slugify", () => {
  it("lowercases and joins words with single hyphens", () => {
    expect(slugify("Order Shipped")).toBe("order-shipped");
    expect(slugify("Wizzaroo - Reset your password")).toBe(
      "wizzaroo-reset-your-password",
    );
    expect(slugify("  Two-factor   turned_off! ")).toBe(
      "two-factor-turned-off",
    );
    expect(slugify("Invoice #42 (v2)")).toBe("invoice-42-v2");
  });

  it("drops accents and falls back to template when nothing is left", () => {
    expect(slugify("Café crème")).toBe("cafe-creme");
    expect(slugify("---")).toBe("template");
    expect(slugify("")).toBe("template");
    expect(slugify("日本語")).toBe("template");
  });

  it("keeps within the length limit without a hyphen at the end", () => {
    const slug = slugify(`${"a".repeat(99)} bcd`);
    expect(slug).toBe("a".repeat(99));
    expect(slugify("a".repeat(150))).toHaveLength(maxSlugLength);
  });
});

describe("the slug rule", () => {
  it("allows only lowercase letters, numbers and hyphens, 1 to 100 of them", () => {
    expect(isValidSlug("order-shipped-2")).toBe(true);
    expect(isValidSlug("a".repeat(maxSlugLength))).toBe(true);
    expect(findSlugProblem("")).toBe("Enter a slug");
    expect(findSlugProblem("a".repeat(maxSlugLength + 1))).toBe(
      "The slug must be 100 characters or fewer",
    );
    expect(findSlugProblem("Order shipped")).toBe(
      "The slug may only use lowercase letters, numbers and hyphens (a-z, 0-9 and -), with no spaces, such as order-shipped",
    );
    expect(isValidSlug("order_shipped")).toBe(false);
    expect(isValidSlug("order shipped")).toBe(false);
    expect(isValidSlug("Order")).toBe(false);
  });
});

describe("numbered slugs", () => {
  it("adds -2, -3… until one is free", () => {
    const taken = new Set(["welcome", "welcome-2"]);
    expect(firstFreeSlug("welcome", (slug) => taken.has(slug))).toBe(
      "welcome-3",
    );
    expect(firstFreeSlug("receipt", (slug) => taken.has(slug))).toBe("receipt");
  });

  it("shortens a long slug to fit the number", () => {
    const slug = numberedSlug("a".repeat(maxSlugLength), 12);
    expect(slug).toHaveLength(maxSlugLength);
    expect(slug.endsWith("a-12")).toBe(true);
  });
});
