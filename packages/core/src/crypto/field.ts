import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { hmac } from "@oslojs/crypto/hmac";
import { SHA256 } from "@oslojs/crypto/sha2";
import { encodeHexLowerCase } from "@oslojs/encoding";
import { parsePhoneNumberWithError, type CountryCode } from "libphonenumber-js";

const VERSION = "v1";

export class FieldCryptoError extends Error {
  constructor(message = "Field ciphertext could not be read") {
    super(message);
    this.name = "FieldCryptoError";
  }
}

export class PhoneError extends Error {
  constructor() {
    super("Phone number is not valid");
    this.name = "PhoneError";
  }
}

function keyBytes(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) throw new FieldCryptoError("Field key must be 32 bytes");
  return key;
}

function hmacHex(keyB64: string, value: string): string {
  const digest = hmac(SHA256, keyBytes(keyB64), new TextEncoder().encode(value));
  return encodeHexLowerCase(digest);
}

/** AES-256-GCM. Format: v1:<keyId>:<base64 iv>:<base64 ciphertext+tag>. */
export function encryptField(
  keyB64: string,
  keyId: string,
  aad: string,
  plaintext: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(keyB64), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return `${VERSION}:${keyId}:${iv.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptField(
  keys: Readonly<Record<string, string>>,
  aad: string,
  encoded: string,
): string {
  const parts = encoded.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new FieldCryptoError();
  const keyId = parts[1];
  const ivB64 = parts[2];
  const bodyB64 = parts[3];
  if (keyId === undefined || ivB64 === undefined || bodyB64 === undefined)
    throw new FieldCryptoError();
  const keyB64 = new Map(Object.entries(keys)).get(keyId);
  if (keyB64 === undefined) throw new FieldCryptoError();
  const iv = Buffer.from(ivB64, "base64");
  const body = Buffer.from(bodyB64, "base64");
  if (iv.length !== 12 || body.length < 16) throw new FieldCryptoError();
  const tag = body.subarray(body.length - 16);
  const ciphertext = body.subarray(0, body.length - 16);
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyBytes(keyB64), iv);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new FieldCryptoError();
  }
}

export function phoneIndex(indexKeyB64: string, e164: string): string {
  return hmacHex(indexKeyB64, e164);
}

export function toE164(input: string, defaultRegion: string): string {
  let parsed;
  try {
    parsed = parsePhoneNumberWithError(input, defaultRegion as CountryCode);
  } catch {
    throw new PhoneError();
  }
  if (!parsed.isValid()) throw new PhoneError();
  return parsed.number;
}

export function deviceTokenHash(pepperB64: string, token: string): string {
  return hmacHex(pepperB64, token);
}
