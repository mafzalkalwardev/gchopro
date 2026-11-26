import { describe, expect, it } from "vitest";
import { redactForLog } from "./logger.js";

describe("redactForLog", () => {
  it("redacts secrets, ciphertexts, tokens, and message bodies", () => {
    const redacted = redactForLog({
      password: "plain-password",
      nested: {
        token: "device-token",
        totp_secret_enc: "v1:k1:iv:cipher",
        wire_body_enc: "ciphertext",
        authorization: "Bearer secret",
        cookie: "session=secret",
        address: "+15005550006",
        body: "hello",
        simId: "keep-me",
      },
    });
    const json = JSON.stringify(redacted);
    expect(json).not.toContain("plain-password");
    expect(json).not.toContain("device-token");
    expect(json).not.toContain("ciphertext");
    expect(json).not.toContain("Bearer");
    expect(json).not.toContain("+15005550006");
    expect(json).not.toContain("hello");
    expect(json).toContain("keep-me");
    expect(json).toContain("[Redacted]");
  });
});
