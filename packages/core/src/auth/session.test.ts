import { describe, expect, it } from "vitest";
import { accessStep, portalAccess, sessionRejection, sessionWindow } from "./session.js";
import { csrfRejected } from "./csrf.js";

const now = new Date("2026-11-26T00:00:00.000Z");

describe("sessions", () => {
  it("gives admins a 30 minute idle window and a 12 hour absolute window", () => {
    const window = sessionWindow("admin", now);
    expect(window.expiresAt.toISOString()).toBe("2026-11-26T00:30:00.000Z");
    expect(window.absoluteExpiresAt.toISOString()).toBe("2026-11-26T12:00:00.000Z");
  });

  it("rejects a session created before the latest password change", () => {
    const reason = sessionRejection({
      revokedAt: null,
      expiresAt: new Date("2026-11-26T01:00:00.000Z"),
      absoluteExpiresAt: new Date("2026-11-26T12:00:00.000Z"),
      now,
      userStatus: "active",
      deletedAt: null,
      passwordChangedAt: new Date("2026-11-26T00:00:00.000Z"),
      sessionCreatedAt: new Date("2026-11-25T00:00:00.000Z"),
    });
    expect(reason).toBe("password_changed");
  });

  it("keeps portal users on the password step before the acceptable-use step", () => {
    expect(
      accessStep({
        app: "portal",
        mfaVerified: true,
        mustChangePassword: true,
        aupAcceptedAt: null,
      }),
    ).toBe("password");
    expect(
      accessStep({
        app: "admin",
        mfaVerified: false,
        mustChangePassword: true,
        aupAcceptedAt: null,
      }),
    ).toBe("mfa");
  });

  it("allows a read-only expired subscription and blocks a paused one", () => {
    const base = {
      status: "active" as const,
      deletedAt: null,
      simId: "sim",
      ipAllowed: true,
    };
    expect(
      portalAccess({
        ...base,
        subscription: { status: "expired", expiryBehavior: "read_only" },
      }),
    ).toEqual({ ok: true, readOnly: true, scheduled: false });
    expect(
      portalAccess({
        ...base,
        subscription: { status: "paused", expiryBehavior: "block" },
      }),
    ).toEqual({ ok: false, error: "subscription_inactive" });
    expect(
      portalAccess({
        ...base,
        simId: null,
        subscription: { status: "active", expiryBehavior: "block" },
      }),
    ).toEqual({
      ok: false,
      error: "no_sim",
    });
  });
});

describe("csrf", () => {
  it("requires the origin host and a matching double-submit token", () => {
    expect(
      csrfRejected({
        method: "POST",
        origin: "https://admin.localhost:3001",
        headerToken: "token",
        cookieToken: "token",
        expectedHost: "admin.localhost",
      }),
    ).toBe(false);
    expect(
      csrfRejected({
        method: "POST",
        origin: "https://evil.example",
        headerToken: "token",
        cookieToken: "token",
        expectedHost: "admin.localhost",
      }),
    ).toBe(true);
    expect(
      csrfRejected({
        method: "POST",
        origin: "https://admin.localhost:3001",
        headerToken: null,
        cookieToken: "token",
        expectedHost: "admin.localhost",
      }),
    ).toBe(true);
    expect(
      csrfRejected({
        method: "GET",
        origin: null,
        headerToken: null,
        cookieToken: null,
        expectedHost: "admin.localhost",
      }),
    ).toBe(false);
  });
});
