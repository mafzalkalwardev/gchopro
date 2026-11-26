import { describe, expect, it } from "vitest";
import { RATE_LIMITS } from "./limits.js";
import { contentSecurityPolicy } from "./headers.js";

describe("limits and headers", () => {
  it("matches the login and API budgets", () => {
    expect(RATE_LIMITS.loginIp).toEqual({ points: 20, durationSeconds: 60 });
    expect(RATE_LIMITS.loginUsername).toEqual({ points: 5, durationSeconds: 900 });
    expect(RATE_LIMITS.portalApi.points).toBe(120);
    expect(RATE_LIMITS.adminApi.points).toBe(300);
    expect(RATE_LIMITS.csvImport).toEqual({ points: 5, durationSeconds: 3600 });
  });

  it("puts the nonce in the script source", () => {
    expect(contentSecurityPolicy("abc")).toContain("'nonce-abc'");
    expect(contentSecurityPolicy("abc")).toContain("frame-ancestors 'none'");
  });
});
