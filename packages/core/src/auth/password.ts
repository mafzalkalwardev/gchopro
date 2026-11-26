import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hash, verify } from "@node-rs/argon2";
import { generateRandomString } from "@oslojs/crypto/random";

const ARGON = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  algorithm: 2, // Argon2id. The library enum is const and cannot be imported under verbatimModuleSyntax.
} as const;

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const MAX_PASSWORD_LENGTH = 128;

const reader = {
  read(bytes: Uint8Array): void {
    crypto.getRandomValues(bytes);
  },
};

let common: Set<string> | undefined;
let dummyHash: Promise<string> | undefined;

function commonPasswords(): Set<string> {
  if (common) return common;
  const file = join(dirname(fileURLToPath(import.meta.url)), "common-passwords.txt");
  const words = readFileSync(file, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0);
  common = new Set(words);
  return common;
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON);
}

export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword("gchopro-dummy-password");
  return dummyHash;
}

export async function verifyPassword(encoded: string, password: string): Promise<boolean> {
  return verify(encoded, password, ARGON);
}

export function needsRehash(encoded: string): boolean {
  return !encoded.includes("m=19456,t=2,p=1");
}

export function generatePassword(length = 16): string {
  return generateRandomString(reader, PASSWORD_ALPHABET, length);
}

export function passwordRejection(password: string, username: string): string | null {
  if ([...password].length < 12) return "Use at least 12 characters.";
  if ([...password].length > MAX_PASSWORD_LENGTH) return "Use at most 128 characters.";
  if (password.toLowerCase() === username.toLowerCase())
    return "The password must differ from the username.";
  if (commonPasswords().has(password.toLowerCase())) return "That password is too common.";
  return null;
}
