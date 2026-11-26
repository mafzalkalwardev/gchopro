import { describe, expect, it } from "vitest";
import { AUDIT_GENESIS, auditDigest, canonicalAudit, redactAudit } from "./chain.js";

describe("audit chain", () => {
  it("redacts secrets and hashes a stable canonical row", () => {
    expect(redactAudit({ password: "hunter2", body: "hello", name: "Ada" })).toEqual({
      password: "[Redacted]",
      body: "[Redacted]",
      name: "Ada",
    });
    const row = {
      id: "1",
      at: "2026-11-26T00:00:00.000Z",
      actorUserId: null,
      actorRole: "admin",
      actorIp: "127.0.0.1",
      actorKind: "admin" as const,
      action: "auth.login_succeeded",
      targetType: "user",
      targetId: "user",
      before: null,
      after: { ok: true },
      requestId: "req",
      prevHash: AUDIT_GENESIS,
    };
    const first = auditDigest(row.prevHash, canonicalAudit(row));
    const second = auditDigest(AUDIT_GENESIS, canonicalAudit({ ...row, after: { ok: true } }));
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
  });
});
