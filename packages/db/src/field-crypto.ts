import { createCipheriv, createHmac, randomBytes } from "node:crypto";

/** Seed-only field crypto. The shared module moves to packages/core in M1. */
export function encryptField(
  keyB64: string,
  keyId: string,
  aad: string,
  plaintext: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyB64, "base64"), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return `v1:${keyId}:${iv.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function phoneIndex(indexKeyB64: string, e164: string): string {
  return createHmac("sha256", Buffer.from(indexKeyB64, "base64")).update(e164).digest("hex");
}

export function deviceTokenHash(pepperB64: string, token: string): string {
  return createHmac("sha256", Buffer.from(pepperB64, "base64")).update(token).digest("hex");
}
