import { DrizzleQueryError } from "drizzle-orm";
import { DatabaseError } from "pg";
import { describe, expect, it } from "vitest";
import { describeErrorForLog, withoutQuery } from "./log.js";

const address = "ada@example.com";

describe("describeErrorForLog (pen test D2, #126)", () => {
  it("keeps a failed query's SQL and parameters out, and names the database error by its code", () => {
    const cause = Object.assign(
      new DatabaseError(
        `invalid input syntax for type uuid: "${address}"`,
        0,
        "error",
      ),
      { code: "22P02", routine: "string_to_uuid", detail: address },
    );
    const logged = describeErrorForLog(
      new DrizzleQueryError(
        'select * from "messages" where "to" = $1',
        [address],
        cause,
      ),
    );
    expect(logged).toMatchObject({
      type: "DrizzleQueryError",
      message: "Failed query",
      cause: {
        type: "DatabaseError",
        message: "Database error 22P02",
        code: "22P02",
        routine: "string_to_uuid",
      },
    });
    expect(logged.stack).toMatch(/^\s+at /u);
    const written = JSON.stringify(logged);
    expect(written).not.toContain(address);
    expect(written).not.toContain("messages");
  });

  it("keeps another error's name, code and message, and a stack of frames only", () => {
    const error = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    const logged = describeErrorForLog(error);
    expect(logged).toMatchObject({
      type: "Error",
      message: "connect ECONNREFUSED",
      code: "ECONNREFUSED",
    });
    expect(logged.stack).not.toContain("connect ECONNREFUSED");
  });

  it("stops following causes after three, and names a thrown non-Error by its type", () => {
    let error: unknown = "plain";
    for (let depth = 0; depth < 6; depth += 1) {
      error = new Error(`level ${String(depth)}`, { cause: error });
    }
    expect(JSON.stringify(describeErrorForLog(error))).not.toContain("level 1");
    expect(describeErrorForLog(address)).toEqual({
      type: "string",
      message: "A non-Error was thrown",
      stack: "",
    });
  });
});

describe("withoutQuery", () => {
  it("drops a query string and keeps the path", () => {
    expect(withoutQuery(`/app/messages?search=${address}`)).toBe(
      "/app/messages?[redacted]",
    );
    expect(withoutQuery("/v1/messages")).toBe("/v1/messages");
  });
});
