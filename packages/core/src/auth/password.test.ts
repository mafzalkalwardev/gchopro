import { describe, expect, it } from "vitest";
import {
  generatePassword,
  hashPassword,
  needsRehash,
  passwordRejection,
  verifyPassword,
} from "./password.js";

describe("passwords", () => {
  it("rejects short, common, and username passwords", () => {
    expect(passwordRejection("short", "admin")).toMatch(/12/);
    expect(passwordRejection("unbelievable", "admin")).toMatch(/common/);
    expect(passwordRejection("admin-admin-admin", "admin-admin-admin")).toMatch(/username/);
    expect(passwordRejection("gchopro-unique-passphrase", "admin")).toBeNull();
  });

  it("generates a 16 character password from the safe alphabet", () => {
    const password = generatePassword();
    expect(password).toHaveLength(16);
    expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/u);
  });

  it("verifies argon2id and notices a parameter change", async () => {
    const encoded = await hashPassword("gchopro-unique-passphrase");
    expect(encoded.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(encoded, "gchopro-unique-passphrase")).toBe(true);
    expect(await verifyPassword(encoded, "other-passphrase-value")).toBe(false);
    expect(needsRehash(encoded)).toBe(false);
    expect(needsRehash("$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA")).toBe(true);
  });
});
