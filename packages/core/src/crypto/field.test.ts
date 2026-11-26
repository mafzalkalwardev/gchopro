import { describe, expect, it } from "vitest";
import { decryptField, encryptField, phoneIndex, toE164 } from "./field.js";

const key = Buffer.alloc(32, 7).toString("base64");
const keys = { k1: key };

describe("field crypto", () => {
  it("round-trips a value bound to its column", () => {
    const aad = "users.totp_secret_enc.row";
    const encoded = encryptField(key, "k1", aad, "secret-value");
    expect(encoded.startsWith("v1:k1:")).toBe(true);
    expect(decryptField(keys, aad, encoded)).toBe("secret-value");
  });

  it("rejects a ciphertext moved to another row", () => {
    const encoded = encryptField(key, "k1", "messages.wire_body_enc.a", "hello");
    expect(() => decryptField(keys, "messages.wire_body_enc.b", encoded)).toThrow();
  });

  it("indexes the same number to the same hex digest", () => {
    const first = phoneIndex(key, "+15005550006");
    const second = phoneIndex(key, "+15005550006");
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("normalizes a local number to E.164", () => {
    expect(toE164("3001234567", "PK")).toBe("+923001234567");
  });
});
