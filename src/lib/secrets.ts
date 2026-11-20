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
const passwordOptions = { N: 16_384, r: 8, p: 1 } as const;

const deriveKey = (
  password: string,
  salt: Buffer,
  options: ScryptOptions,
): Promise<Buffer> =>
  new Promise((resolveKey, rejectKey) => {
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
  const key = await deriveKey(password, salt, passwordOptions);
  return [
    passwordHashScheme,
    String(passwordOptions.N),
    String(passwordOptions.r),
    String(passwordOptions.p),
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
};

export const isPasswordMatch = async (
  password: string,
  passwordHash: string,
): Promise<boolean> => {
  const [scheme, cost, blockSize, parallelism, salt, expected] =
    passwordHash.split("$");
  if (
    scheme !== passwordHashScheme ||
    salt === undefined ||
    expected === undefined
  ) {
    return false;
  }
  const expectedKey = Buffer.from(expected, "base64url");
  const actualKey = await deriveKey(password, Buffer.from(salt, "base64url"), {
    N: Number(cost),
    r: Number(blockSize),
    p: Number(parallelism),
  });
  return (
    actualKey.length === expectedKey.length &&
    timingSafeEqual(actualKey, expectedKey)
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
