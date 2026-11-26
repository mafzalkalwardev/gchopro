import { createTOTPKeyURI, verifyHOTP, verifyTOTPWithGracePeriod } from "@oslojs/otp";
import { decodeBase32IgnorePadding, encodeBase32NoPadding } from "@oslojs/encoding";
import { generateRandomString } from "@oslojs/crypto/random";
import { hashPassword, verifyPassword } from "./password.js";

const PERIOD = 30;
const DIGITS = 6;
const GRACE_SECONDS = 30;
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const reader = {
  read(bytes: Uint8Array): void {
    crypto.getRandomValues(bytes);
  },
};

export function newTotpSecret(): Uint8Array {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function totpSecretText(secret: Uint8Array): string {
  return encodeBase32NoPadding(secret);
}

export function totpSecretBytes(secret: string): Uint8Array {
  return decodeBase32IgnorePadding(secret);
}

export function totpKeyUri(username: string, secret: Uint8Array): string {
  return createTOTPKeyURI("GChoPro", username, secret, PERIOD, DIGITS);
}

/**
 * Accepts the current step and one step either side, and rejects a step that was already used.
 * `verifyTOTPWithGracePeriod` is the acceptance check; HOTP identifies the step for replay protection.
 */
export function matchTotpStep(
  secret: Uint8Array,
  code: string,
  last: bigint | null,
): bigint | null {
  if (!/^\d{6}$/u.test(code)) return null;
  if (!verifyTOTPWithGracePeriod(secret, PERIOD, DIGITS, code, GRACE_SECONDS)) return null;
  const base = BigInt(Math.floor(Date.now() / (PERIOD * 1000)));
  for (const step of [base, base - 1n, base + 1n]) {
    if (step < 0n) continue;
    if (last !== null && step <= last) continue;
    if (verifyHOTP(secret, step, DIGITS, code)) return step;
  }
  return null;
}

export function newRecoveryCodes(): string[] {
  const codes: string[] = [];
  for (let index = 0; index < 10; index += 1) {
    const raw = generateRandomString(reader, RECOVERY_ALPHABET, 8);
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return codes;
}

export async function hashRecoveryCodes(codes: readonly string[]): Promise<string[]> {
  const hashes: string[] = [];
  for (const code of codes) hashes.push(await hashPassword(normalizeRecoveryCode(code)));
  return hashes;
}

export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/gu, "").toUpperCase();
}

export async function matchRecoveryCode(
  code: string,
  hashes: readonly (string | null)[],
): Promise<number | null> {
  const normalized = normalizeRecoveryCode(code);
  let index = 0;
  for (const encoded of hashes) {
    if (
      encoded !== undefined &&
      encoded !== null &&
      encoded.length > 0 &&
      (await verifyPassword(encoded, normalized))
    ) {
      return index;
    }
    index += 1;
  }
  return null;
}
