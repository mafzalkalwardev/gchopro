import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateRandomString } from "@oslojs/crypto/random";

const ARGON = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  algorithm: 2, // Argon2id. The library enum is const and cannot be imported under verbatimModuleSyntax.
} as const;

type Argon2Module = {
  hash: (password: string, options: typeof ARGON) => Promise<string>;
  verify: (encoded: string, password: string, options: typeof ARGON) => Promise<boolean>;
};

/**
 * The native binding is loaded by Node at call time. A static import makes
 * Next's bundler parse the `.node` files and fail the production build.
 */
async function argon2(): Promise<Argon2Module> {
  const loaded = (await import(/* webpackIgnore: true */ "@node-rs/argon2")) as Argon2Module & {
    default?: Argon2Module;
  };
  if (typeof loaded.hash === "function") return loaded;
  if (loaded.default && typeof loaded.default.hash === "function") return loaded.default;
  throw new Error("argon2 binding did not load");
}

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

export async function hashPassword(password: string): Promise<string> {
  const { hash } = await argon2();
  return hash(password, ARGON);
}

export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword("gchopro-dummy-password");
  return dummyHash;
}

export async function verifyPassword(encoded: string, password: string): Promise<boolean> {
  const { verify } = await argon2();
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
