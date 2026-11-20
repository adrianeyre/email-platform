import { afterEach, describe, expect, it, vi } from "vitest";
import { loadVars } from "./vars.js";

describe("loadVars", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads the required variables and applies defaults", () => {
    const vars = loadVars();
    expect(vars.port).toBe(4320);
    expect(vars.appUrl.href).toBe("http://localhost:4320/");
    expect(vars.encryptionKey).toHaveLength(32);
  });

  it("refuses to start without a required variable", () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(() => loadVars()).toThrow("DATABASE_URL must be set");
  });

  it("refuses an encryption key that is not 32 bytes", () => {
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(16).toString("base64"));
    expect(() => loadVars()).toThrow("ENCRYPTION_KEY must be 32 bytes");
  });

  it("refuses a port that is not a whole number or out of range", () => {
    vi.stubEnv("PORT", "70000");
    expect(() => loadVars()).toThrow("PORT must be a port number");
    vi.stubEnv("PORT", "three");
    expect(() => loadVars()).toThrow(
      'PORT must be a whole number, not "three"',
    );
  });

  it("refuses a URL that does not parse", () => {
    vi.stubEnv("APP_URL", "not a url");
    expect(() => loadVars()).toThrow('APP_URL must be a URL, not "not a url"');
  });
});
