import { describe, expect, it } from "vitest";
import { deviceTokenHash } from "../crypto/field.js";
import { pairingCodeValid, pairingDecision, tokenNeedsRotation } from "./protocol.js";

const pepper = Buffer.alloc(32, 7).toString("base64");

describe("pairing", () => {
  it("accepts a 6-digit code and rejects everything else", () => {
    expect(pairingCodeValid("483920")).toBe(true);
    expect(pairingCodeValid("48392")).toBe(false);
    expect(pairingCodeValid("4839201")).toBe(false);
    expect(pairingCodeValid("48392a")).toBe(false);
  });

  it("rejects an expired or exhausted code", () => {
    const now = new Date("2026-11-25T10:00:00Z");
    expect(
      pairingDecision({
        found: true,
        expiresAt: new Date("2026-11-25T10:05:00Z"),
        attempts: 0,
        now,
      }),
    ).toBe("accept");
    expect(
      pairingDecision({
        found: true,
        expiresAt: new Date("2026-11-25T09:59:00Z"),
        attempts: 0,
        now,
      }),
    ).toBe("reject");
    expect(
      pairingDecision({
        found: true,
        expiresAt: new Date("2026-11-25T10:05:00Z"),
        attempts: 5,
        now,
      }),
    ).toBe("reject");
  });

  it("hashes a pairing code with the token pepper", () => {
    expect(deviceTokenHash(pepper, "483920")).toBe(deviceTokenHash(pepper, "483920"));
    expect(deviceTokenHash(pepper, "483920")).not.toBe(deviceTokenHash(pepper, "483921"));
  });

  it("asks for rotation when the token is old, previous, or requested", () => {
    const now = new Date("2026-11-25T10:00:00Z");
    expect(
      tokenNeedsRotation({
        rotatedAt: new Date("2026-10-01T10:00:00Z"),
        now,
        maxAgeDays: 30,
        requested: false,
        usingPrevious: false,
      }),
    ).toBe(true);
    expect(
      tokenNeedsRotation({
        rotatedAt: now,
        now,
        maxAgeDays: 30,
        requested: true,
        usingPrevious: false,
      }),
    ).toBe(true);
    expect(
      tokenNeedsRotation({
        rotatedAt: now,
        now,
        maxAgeDays: 30,
        requested: false,
        usingPrevious: false,
      }),
    ).toBe(false);
  });
});
