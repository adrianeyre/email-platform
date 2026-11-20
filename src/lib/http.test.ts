import { describe, expect, it } from "vitest";
import {
  describeError,
  findViolatedConstraint,
  isUniqueViolation,
} from "./http.js";

describe("describeError", () => {
  it("uses the message, then nested errors, then the code", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
    expect(
      describeError(
        new AggregateError([
          new Error("connect ECONNREFUSED ::1:1"),
          new Error("connect ECONNREFUSED 127.0.0.1:1"),
        ]),
      ),
    ).toBe("connect ECONNREFUSED ::1:1; connect ECONNREFUSED 127.0.0.1:1");
    expect(
      describeError(Object.assign(new Error(""), { code: "ESOCKET" })),
    ).toBe("ESOCKET");
    expect(describeError("plain")).toBe("plain");
  });
});

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
