import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  decrypt,
  encrypt,
  maskSecret,
  masterKeyFromBase64,
  SecretDecryptError,
} from "../../src/crypto/secrets";

const masterKey = randomBytes(32);
const apiKey = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz-a1b2";

function flipFirstByte(buffer: Buffer): Buffer {
  const copy = Buffer.from(buffer);
  copy[0] = (copy[0] ?? 0) ^ 0xff;
  return copy;
}

describe("secrets", () => {
  test("round-trips a key", () => {
    const secret = encrypt(apiKey, masterKey);
    expect(secret.iv).toHaveLength(12);
    expect(secret.tag).toHaveLength(16);
    expect(secret.ciphertext.toString("utf8")).not.toContain("abcdefgh");
    expect(decrypt(secret, masterKey)).toBe(apiKey);
  });

  test("uses a fresh IV for every encryption", () => {
    const a = encrypt(apiKey, masterKey);
    const b = encrypt(apiKey, masterKey);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  test("fails on a tampered tag", () => {
    const secret = encrypt(apiKey, masterKey);
    expect(() => decrypt({ ...secret, tag: flipFirstByte(secret.tag) }, masterKey)).toThrow(
      SecretDecryptError,
    );
  });

  test("fails on tampered ciphertext or IV", () => {
    const secret = encrypt(apiKey, masterKey);
    expect(() =>
      decrypt({ ...secret, ciphertext: flipFirstByte(secret.ciphertext) }, masterKey),
    ).toThrow(SecretDecryptError);
    expect(() => decrypt({ ...secret, iv: flipFirstByte(secret.iv) }, masterKey)).toThrow(
      SecretDecryptError,
    );
  });

  test("fails with the wrong MASTER_KEY, and the error carries no secret material", () => {
    const secret = encrypt(apiKey, masterKey);
    const error = (() => {
      try {
        decrypt(secret, randomBytes(32));
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(SecretDecryptError);
    expect(JSON.stringify(error) + String(error)).not.toContain("a1b2");
  });

  test("decodes a base64 master key and rejects a wrong length", () => {
    expect(masterKeyFromBase64(masterKey.toString("base64")).equals(masterKey)).toBe(true);
    expect(() => masterKeyFromBase64(randomBytes(16).toString("base64"))).toThrow();
  });

  test("masks a key down to a prefix and the last four characters", () => {
    expect(maskSecret(apiKey)).toBe("sk-…a1b2");
    expect(maskSecret("or-v1-0123456789abcdef")).toBe("or-…cdef");
    expect(maskSecret("0123456789abcdef")).toBe("…cdef");
    expect(maskSecret("short")).toBe("…");
  });
});
