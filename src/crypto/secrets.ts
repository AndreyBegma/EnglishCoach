import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type EncryptedSecret = { ciphertext: Buffer; iv: Buffer; tag: Buffer };

/** Raised when a secret cannot be decrypted: tampered data or the wrong master key. Carries no secret material. */
export class SecretDecryptError extends Error {
  override name = "SecretDecryptError";
}

/** Decodes `MASTER_KEY` (32 bytes, base64) into the raw key. Env validation guarantees the shape. */
export function masterKeyFromBase64(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("MASTER_KEY must decode to 32 bytes");
  return key;
}

/** AES-256-GCM with a fresh random IV per call. */
export function encrypt(plaintext: string, masterKey: Buffer): EncryptedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

export function decrypt(secret: EncryptedSecret, masterKey: Buffer): string {
  try {
    const decipher = createDecipheriv(ALGORITHM, masterKey, secret.iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAuthTag(secret.tag);
    return Buffer.concat([decipher.update(secret.ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // The underlying error says nothing useful and must not be passed on with the inputs attached.
    throw new SecretDecryptError("secret could not be decrypted (tampered data or wrong key)");
  }
}

/**
 * The only form a key may take on its way back to the user: a short prefix and the last four
 * characters (`sk-…a1b2`). Keys too short to keep anything hidden are masked completely.
 */
export function maskSecret(secret: string): string {
  if (secret.length < 12) return "…";
  const prefix = secret.match(/^[A-Za-z]{2,4}-/)?.[0] ?? "";
  return `${prefix}…${secret.slice(-4)}`;
}
