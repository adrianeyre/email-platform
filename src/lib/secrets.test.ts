import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptValue,
  encryptValue,
  generateSecret,
  hashPassword,
  hashSecret,
  isPasswordMatch,
  isSecretMatch,
  UnreadableEncryptedValueError,
} from "./secrets.js";

describe("secrets", () => {
  it("matches a secret only against its own hash", () => {
    const secret = generateSecret();
    expect(isSecretMatch(secret, hashSecret(secret))).toBe(true);
    expect(isSecretMatch(`${secret}x`, hashSecret(secret))).toBe(false);
  });

  it("round-trips a value through encryption without storing it in plain text", () => {
    const key = randomBytes(32);
    const encrypted = encryptValue(key, "-----BEGIN PRIVATE KEY-----");
    expect(encrypted).not.toContain("PRIVATE");
    expect(decryptValue(key, encrypted)).toBe("-----BEGIN PRIVATE KEY-----");
  });

  it("refuses to decrypt with the wrong key or a malformed value", () => {
    const encrypted = encryptValue(randomBytes(32), "value");
    expect(() => decryptValue(randomBytes(32), encrypted)).toThrow();
    expect(() => decryptValue(randomBytes(32), "nonsense")).toThrow(
      UnreadableEncryptedValueError,
    );
  });

  it("hashes a password with a fresh salt and matches only that password", async () => {
    const first = await hashPassword("correct horse battery");
    const second = await hashPassword("correct horse battery");
    expect(first).not.toContain("correct");
    expect(first).not.toBe(second);
    expect(await isPasswordMatch("correct horse battery", first)).toBe(true);
    expect(await isPasswordMatch("wrong horse battery", first)).toBe(false);
    expect(await isPasswordMatch("correct horse battery", "nonsense")).toBe(
      false,
    );
  });
});
