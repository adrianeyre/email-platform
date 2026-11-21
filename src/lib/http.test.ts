import { describe, expect, it } from "vitest";
import { findViolatedConstraint, isUniqueViolation } from "./http.js";

describe("isUniqueViolation", () => {
  it("recognises Postgres unique violations directly or as a cause", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ cause: { code: "23505" } })).toBe(true);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe("findViolatedConstraint", () => {
  it("names the broken unique constraint directly or from the cause", () => {
    expect(
      findViolatedConstraint({
        code: "23505",
        constraint: "templates_slug_unique",
      }),
    ).toBe("templates_slug_unique");
    expect(
      findViolatedConstraint({
        cause: { code: "23505", constraint: "templates_name_unique" },
      }),
    ).toBe("templates_name_unique");
    expect(findViolatedConstraint({ code: "23505" })).toBeUndefined();
    expect(
      findViolatedConstraint({ code: "23503", constraint: "x" }),
    ).toBeUndefined();
  });
});
