import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

const encryptionAlgorithm = "aes-256-gcm";
const initialisationVectorBytes = 12;
const encryptedValueVersion = "v1";

export class UnreadableEncryptedValueError extends Error {
  override name = "UnreadableEncryptedValueError";
}

export const generateSecret = (bytes = 24): string =>
  randomBytes(bytes).toString("base64url");

export const hashSecret = (secret: string): string =>
  createHash("sha256").update(secret).digest("hex");

export const isSecretMatch = (
  secret: string,
  expectedHash: string,
): boolean => {
  const actual = Buffer.from(hashSecret(secret), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

const passwordKeyBytes = 64;
const passwordSaltBytes = 16;
const passwordHashScheme = "scrypt";
export interface PasswordHashCost {
  N: number;
  r: number;
  p: number;
}

/**
 * scrypt's cost for every new password hash: OWASP's minimum (Password Storage Cheat Sheet), N=2^17, r=8, p=1, about
 * 128 MiB and 170 ms a hash (pen test A1, #140). A stored hash carries the cost it was made with, so an older, cheaper
 * hash still matches, and a successful sign-in hashes the password again at this cost (`isPasswordHashOutdated`).
 */
export const passwordHashCost: PasswordHashCost = { N: 2 ** 17, r: 8, p: 1 };

/** The most memory one scrypt may take: twice what this cost needs. Node's own default (32 MiB) is too small for it. */
const maxScryptMemory = 2 * 128 * passwordHashCost.N * passwordHashCost.r;

const deriveKey = (
  password: string,
  salt: Buffer,
  cost: PasswordHashCost,
): Promise<Buffer> =>
  new Promise((resolveKey, rejectKey) => {
    const options: ScryptOptions = { ...cost, maxmem: maxScryptMemory };
    scrypt(password, salt, passwordKeyBytes, options, (error, key) => {
      if (error === null) {
        resolveKey(key);
      } else {
        rejectKey(error);
      }
    });
  });

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(passwordSaltBytes);
  const key = await deriveKey(password, salt, passwordHashCost);
  return [
    passwordHashScheme,
    String(passwordHashCost.N),
    String(passwordHashCost.r),
    String(passwordHashCost.p),
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
};

const readPasswordHash = (passwordHash: string) => {
  const [scheme, cost, blockSize, parallelism, salt, expected] =
    passwordHash.split("$");
  if (
    scheme !== passwordHashScheme ||
    salt === undefined ||
    expected === undefined
  ) {
    return undefined;
  }
  return {
    cost: { N: Number(cost), r: Number(blockSize), p: Number(parallelism) },
    salt: Buffer.from(salt, "base64url"),
    expectedKey: Buffer.from(expected, "base64url"),
  };
};

export const isPasswordMatch = async (
  password: string,
  passwordHash: string,
): Promise<boolean> => {
  const stored = readPasswordHash(passwordHash);
  if (stored === undefined) {
    return false;
  }
  const actualKey = await deriveKey(password, stored.salt, stored.cost);
  return (
    actualKey.length === stored.expectedKey.length &&
    timingSafeEqual(actualKey, stored.expectedKey)
  );
};

/** Answers whether a stored hash was made at less than `passwordHashCost`, so it should be made again (#140). */
export const isPasswordHashOutdated = (passwordHash: string): boolean => {
  const stored = readPasswordHash(passwordHash);
  return (
    stored === undefined ||
    stored.cost.N * stored.cost.r < passwordHashCost.N * passwordHashCost.r ||
    stored.cost.p < passwordHashCost.p
  );
};

export const encryptValue = (key: Buffer, plaintext: string): string => {
  const initialisationVector = randomBytes(initialisationVectorBytes);
  const cipher = createCipheriv(encryptionAlgorithm, key, initialisationVector);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    encryptedValueVersion,
    initialisationVector.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
};

export const decryptValue = (key: Buffer, encrypted: string): string => {
  const [version, initialisationVector, authTag, ciphertext] =
    encrypted.split(".");
  if (
    version !== encryptedValueVersion ||
    initialisationVector === undefined ||
    authTag === undefined ||
    ciphertext === undefined
  ) {
    throw new UnreadableEncryptedValueError(
      "The encrypted value is not in a known format",
    );
  }
  const decipher = createDecipheriv(
    encryptionAlgorithm,
    key,
    Buffer.from(initialisationVector, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
};
