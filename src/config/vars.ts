import type { DatabaseRolePasswords } from "../lib/database-roles.js";

export interface Vars {
  databaseUrl: string;
  port: number;
  appUrl: URL;
  encryptionKey: Buffer;
}

const highestPort = 65_535;
const encryptionKeyBytes = 32;
/** The shortest database password taken (#166). `openssl rand -hex 32`, as the docs say, makes 64 characters. */
export const shortestDatabasePassword = 16;
const appUrlProtocols = new Set(["http:", "https:"]);
const databaseUrlProtocols = new Set(["postgres:", "postgresql:"]);

const optional = (name: string): string | undefined => {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
};

const required = (name: string): string => {
  const value = optional(name);
  if (value === undefined) {
    throw new Error(`${name} must be set`);
  }
  return value;
};

const count = (name: string, fallback: number): number => {
  const value = optional(name);
  if (value === undefined) {
    return fallback;
  }
  // Digits only: Number(" ") is 0, which would listen on a port the OS picks (#169).
  if (!/^\d+$/u.test(value)) {
    throw new Error(`${name} must be a whole number, not "${value}"`);
  }
  return Number(value);
};

const port = (name: string, fallback: number): number => {
  const parsed = count(name, fallback);
  if (parsed > highestPort) {
    throw new Error(`${name} must be a port number, not "${String(parsed)}"`);
  }
  return parsed;
};

const parseUrl = (name: string, value: string): URL => {
  if (!URL.canParse(value)) {
    throw new Error(`${name} must be a URL, not "${value}"`);
  }
  return new URL(value);
};

/**
 * The address the UI, the OpenAPI `servers`, robots.txt and the sitemap are built from: http: or https: only (#168).
 * Plain http: is ADR 0003's decision, for the LAN and tailnet, until the condition it records.
 */
const appUrl = (name: string): URL => {
  const value = required(name);
  const parsed = parseUrl(name, value);
  if (!appUrlProtocols.has(parsed.protocol)) {
    throw new Error(`${name} must be an http: or https: URL, not "${value}"`);
  }
  return parsed;
};

/**
 * Refuses a password a guess finds at once: shorter than {@link shortestDatabasePassword}, holding whitespace or a
 * control character, or one character repeated (#166). `name` is what to set right; the value is never shown.
 */
export const checkDatabasePassword = (name: string, password: string): void => {
  if (
    password.length < shortestDatabasePassword ||
    /[\s\p{Cc}]/u.test(password) ||
    new Set(password).size === 1
  ) {
    throw new Error(
      `${name} must be at least ${String(shortestDatabasePassword)} characters, with no whitespace and not one character repeated: make one with openssl rand -hex 32`,
    );
  }
};

/**
 * A Postgres URL, never echoed, as it may carry a password. A password in it must clear the floor; a URL with none is
 * left to the server's own authentication, as the development stack's trust login is (#166, #169).
 */
const databaseUrl = (
  name: string,
  {
    passwordName,
    passwordHint,
  }: { passwordName: string; passwordHint: string },
): string => {
  const value = required(name);
  const parsed = URL.canParse(value) ? new URL(value) : undefined;
  if (parsed === undefined || !databaseUrlProtocols.has(parsed.protocol)) {
    throw new Error(`${name} must be a postgres:// URL`);
  }
  // The URL parser drops a tab or newline wherever it is, so a password of one would read as no password at all.
  if (/[\s\p{Cc}]/u.test(value)) {
    throw new Error(
      `${name} must have no whitespace in it: check ${passwordHint}`,
    );
  }
  if (parsed.password !== "") {
    let password: string;
    try {
      password = decodeURIComponent(parsed.password);
    } catch {
      throw new Error(`${name} has a password that is not URL-encoded`);
    }
    checkDatabasePassword(passwordName, password);
  }
  return value;
};

/**
 * 32 bytes, and not one byte repeated: `.env.example` once held 32 bytes of 0x07, and all-zero is the other easy
 * mistake. Either would seal the SMTP password with a key anyone can guess (#165). The key is never shown.
 */
const encryptionKey = (name: string): Buffer => {
  const key = Buffer.from(required(name), "base64");
  if (key.length !== encryptionKeyBytes) {
    throw new Error(
      `${name} must be ${String(encryptionKeyBytes)} bytes encoded as base64`,
    );
  }
  if (key.every((byte) => byte === key[0])) {
    throw new Error(
      `${name} must be ${String(encryptionKeyBytes)} random bytes, not one byte repeated: make one with openssl rand -base64 32`,
    );
  }
  return key;
};

export const loadVars = (): Vars => ({
  databaseUrl: databaseUrl("DATABASE_URL", {
    passwordName: "The password in DATABASE_URL",
    passwordHint: "its password",
  }),
  port: port("PORT", 4320),
  appUrl: appUrl("APP_URL"),
  encryptionKey: encryptionKey("ENCRYPTION_KEY"),
});

export interface ProvisionVars {
  /** The bootstrap superuser's connection string: `provision` is the only app container that holds it. */
  superuserUrl: string;
  passwords: DatabaseRolePasswords;
}

const rolePassword = (name: string): string => {
  const password = required(name);
  checkDatabasePassword(name, password);
  return password;
};

/**
 * Compose builds `provision`'s DATABASE_URL from POSTGRES_PASSWORD, and every other app container waits on
 * `provision`, so a weak POSTGRES_PASSWORD or role password stops the stack here, by name (#166).
 */
export const loadProvisionVars = (): ProvisionVars => ({
  superuserUrl: new URL(
    databaseUrl("DATABASE_URL", {
      passwordName: "POSTGRES_PASSWORD (the password in DATABASE_URL)",
      passwordHint: "POSTGRES_PASSWORD",
    }),
  ).href,
  passwords: {
    migrate: rolePassword("DATABASE_MIGRATE_PASSWORD"),
    api: rolePassword("DATABASE_API_PASSWORD"),
    worker: rolePassword("DATABASE_WORKER_PASSWORD"),
    backup: rolePassword("DATABASE_BACKUP_PASSWORD"),
  },
});
