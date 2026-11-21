import { describe, expect, it } from "vitest";
import {
  formatBodyLimit,
  readClientErrorStatus,
  refuseFrameworkError,
} from "./refusals.js";

const fastifyError = (code: string, statusCode: number): Error =>
  Object.assign(new Error(`${code}: what the caller sent`), {
    code,
    statusCode,
  });

describe("refusals (pen test I1, #172, #174)", () => {
  it("writes a body limit as the guide does", () => {
    expect(formatBodyLimit(16 * 1024)).toBe("16 KiB");
    expect(formatBodyLimit(36 * 1024 * 1024)).toBe("36 MB");
  });

  it("reads only a status from 400 to 499", () => {
    expect(readClientErrorStatus(fastifyError("X", 415))).toBe(415);
    expect(readClientErrorStatus(fastifyError("X", 500))).toBeUndefined();
    expect(readClientErrorStatus(new Error("no status"))).toBeUndefined();
    expect(readClientErrorStatus("not an error")).toBeUndefined();
  });

  it("gives every framework refusal a code of the platform's own and a fixed message", () => {
    const refuse = (code: string, statusCode: number) =>
      refuseFrameworkError(fastifyError(code, statusCode), statusCode, 16_384);
    expect(refuse("FST_ERR_CTP_BODY_TOO_LARGE", 413)).toEqual({
      statusCode: 413,
      error: "request_too_large",
      message: "The request is larger than the 16 KiB this route takes",
    });
    expect(refuse("FST_ERR_CTP_INVALID_MEDIA_TYPE", 415).error).toBe(
      "unsupported_media_type",
    );
    expect(refuse("FST_ERR_CTP_INVALID_JSON_BODY", 400).error).toBe(
      "invalid_json",
    );
    expect(refuse("FST_ERR_CTP_EMPTY_JSON_BODY", 400).error).toBe(
      "invalid_json",
    );
    expect(refuse("FST_ERR_CTP_INVALID_CONTENT_LENGTH", 400).error).toBe(
      "invalid_content_length",
    );
    expect(refuse("FST_ERR_BAD_URL", 400)).toEqual({
      statusCode: 400,
      error: "bad_request",
      message: "The request could not be read",
    });
    expect(refuse("FST_ERR_MAX_PARAM_LENGTH", 414)).toEqual({
      statusCode: 414,
      error: "bad_request",
      message: "The request could not be read",
    });
    for (const [code, status] of [
      ["FST_ERR_CTP_INVALID_MEDIA_TYPE", 415],
      ["FST_ERR_CTP_INVALID_JSON_BODY", 400],
      ["FST_ERR_SOMETHING_NEW", 400],
    ] as const) {
      expect(JSON.stringify(refuse(code, status))).not.toMatch(
        /FST_ERR|fastify|what the caller sent/iu,
      );
    }
  });
});
