import { generateTOTP } from "@oslojs/otp";
import { describe, expect, it } from "vitest";
import { matchTotpStep, newRecoveryCodes, newTotpSecret, totpKeyUri } from "./totp.js";

describe("totp", () => {
  it("accepts the current code once and rejects the replay", () => {
    const secret = newTotpSecret();
    const code = generateTOTP(secret, 30, 6);
    const step = matchTotpStep(secret, code, null);
    expect(step).not.toBeNull();
    expect(matchTotpStep(secret, code, step)).toBeNull();
    expect(totpKeyUri("admin", secret)).toContain("otpauth://totp/");
  });

  it("issues ten single-use recovery codes", () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/u);
  });
});
