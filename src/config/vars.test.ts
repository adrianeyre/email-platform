import { afterEach, describe, expect, it, vi } from "vitest";
import { loadProvisionVars, loadVars } from "./vars.js";

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

describe("loadVars refuses weak or malformed values by name (pen test I3)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses an ENCRYPTION_KEY of one repeated byte, all-zero included, without showing it (#165)", () => {
    for (const byte of [0x00, 0x07, 0xff]) {
      const key = Buffer.alloc(32, byte).toString("base64");
      vi.stubEnv("ENCRYPTION_KEY", key);
      expect(() => loadVars()).toThrow(
        /^ENCRYPTION_KEY must be 32 random bytes, not one byte repeated/u,
      );
      expect(() => loadVars()).not.toThrow(key);
    }
  });

  it("takes a key with two different bytes (#165)", () => {
    const key = Buffer.alloc(32, 0x07);
    key[31] = 0x08;
    vi.stubEnv("ENCRYPTION_KEY", key.toString("base64"));
    expect(loadVars().encryptionKey).toEqual(key);
  });

  it("refuses an APP_URL that is neither http: nor https:, and takes both (#168)", () => {
    for (const value of [
      "javascript:alert(1)",
      "ftp://email.home",
      "file:///etc/passwd",
    ]) {
      vi.stubEnv("APP_URL", value);
      expect(() => loadVars()).toThrow(
        `APP_URL must be an http: or https: URL, not "${value}"`,
      );
    }
    for (const value of [
      "http://email.home:4320",
      "https://email.example.com",
    ]) {
      vi.stubEnv("APP_URL", value);
      expect(loadVars().appUrl.href).toBe(new URL(value).href);
    }
  });

  it("refuses a whitespace value for every variable it reads, by name (#169)", () => {
    for (const name of ["DATABASE_URL", "PORT", "APP_URL", "ENCRYPTION_KEY"]) {
      for (const value of [" ", "\t", " \n "]) {
        vi.stubEnv(name, value);
        expect(() => loadVars(), `${name}=${JSON.stringify(value)}`).toThrow(
          new RegExp(`^${name} must`, "u"),
        );
        vi.unstubAllEnvs();
      }
    }
  });

  it("refuses a PORT with anything but digits (#169)", () => {
    for (const value of [" 4320", "4320 ", "-1", "1e3", "0x10"]) {
      vi.stubEnv("PORT", value);
      expect(() => loadVars()).toThrow(/^PORT must be a whole number/u);
    }
  });

  it("refuses a DATABASE_URL that is not a postgres:// URL, without showing it (#169)", () => {
    for (const value of ["mysql://user:secret@host/db", "not a url"]) {
      vi.stubEnv("DATABASE_URL", value);
      expect(() => loadVars()).toThrow(
        /^DATABASE_URL must be a postgres:\/\/ URL$/u,
      );
    }
  });

  it("refuses a short, whitespace or one-character-repeated password in DATABASE_URL, without showing it (#166)", () => {
    for (const password of [
      "x",
      "%20",
      "short-password",
      "aaaaaaaaaaaaaaaaaaaa",
      "a%20long%20password%20with%20spaces",
    ]) {
      vi.stubEnv(
        "DATABASE_URL",
        `postgres://email_platform:${password}@localhost:5432/email_platform`,
      );
      expect(() => loadVars()).toThrow(
        /^The password in DATABASE_URL must be at least 16 characters, with no whitespace and not one character repeated: make one with openssl rand -hex 32$/u,
      );
    }
  });

  it("takes a DATABASE_URL with a long password, or with none, as the development stack's trust login has (#166)", () => {
    const strong = `postgres://email_platform:${"0123456789abcdef".repeat(4)}@localhost:5432/email_platform`;
    vi.stubEnv("DATABASE_URL", strong);
    expect(loadVars().databaseUrl).toBe(strong);
    const none = "postgresql://email_platform@localhost:54321/email_platform";
    vi.stubEnv("DATABASE_URL", none);
    expect(loadVars().databaseUrl).toBe(none);
  });
});

describe("loadProvisionVars (pen test I3, #166)", () => {
  const strong = "0123456789abcdef".repeat(4);
  const stubProvision = (overrides: Record<string, string> = {}) => {
    const vars: Record<string, string> = {
      DATABASE_URL: `postgres://email_platform:${strong}@postgres:5432/email_platform`,
      DATABASE_MIGRATE_PASSWORD: strong,
      DATABASE_API_PASSWORD: strong,
      DATABASE_WORKER_PASSWORD: strong,
      DATABASE_BACKUP_PASSWORD: strong,
      ...overrides,
    };
    for (const [name, value] of Object.entries(vars)) {
      vi.stubEnv(name, value);
    }
  };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("takes strong passwords", () => {
    stubProvision();
    expect(loadProvisionVars().passwords.api).toBe(strong);
  });

  it("refuses a one-character or whitespace POSTGRES_PASSWORD, substituted into DATABASE_URL as Compose does, by name", () => {
    for (const password of ["x", " ", "\t"]) {
      stubProvision({
        DATABASE_URL: `postgres://email_platform:${password}@postgres:5432/email_platform`,
      });
      expect(() => loadProvisionVars()).toThrow(/POSTGRES_PASSWORD/u);
    }
  });

  it("refuses a weak role password by name", () => {
    for (const name of [
      "DATABASE_MIGRATE_PASSWORD",
      "DATABASE_API_PASSWORD",
      "DATABASE_WORKER_PASSWORD",
      "DATABASE_BACKUP_PASSWORD",
    ]) {
      for (const password of ["x", " ", "password"]) {
        stubProvision({ [name]: password });
        expect(() => loadProvisionVars()).toThrow(
          new RegExp(`^${name} must be at least 16 characters`, "u"),
        );
      }
    }
  });
});
