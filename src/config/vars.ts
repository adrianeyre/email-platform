export interface Vars {
  databaseUrl: string;
  port: number;
  appUrl: URL;
  encryptionKey: Buffer;
}

const highestPort = 65_535;
const encryptionKeyBytes = 32;

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
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a whole number, not "${value}"`);
  }
  return parsed;
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

const url = (name: string): URL => parseUrl(name, required(name));

const encryptionKey = (name: string): Buffer => {
  const key = Buffer.from(required(name), "base64");
  if (key.length !== encryptionKeyBytes) {
    throw new Error(
      `${name} must be ${String(encryptionKeyBytes)} bytes encoded as base64`,
    );
  }
  return key;
};

export const loadVars = (): Vars => ({
  databaseUrl: required("DATABASE_URL"),
  port: port("PORT", 4320),
  appUrl: url("APP_URL"),
  encryptionKey: encryptionKey("ENCRYPTION_KEY"),
});
