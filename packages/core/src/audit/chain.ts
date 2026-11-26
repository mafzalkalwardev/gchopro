import { sha256 } from "@oslojs/crypto/sha2";
import { encodeHexLowerCase } from "@oslojs/encoding";

export type AuditActorKind = "admin" | "user" | "device" | "system";

export type AuditPayload = {
  id: string;
  at: string;
  actorUserId: string | null;
  actorRole: string | null;
  actorIp: string | null;
  actorKind: AuditActorKind;
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  requestId: string | null;
  prevHash: string;
};

function isSensitive(key: string): boolean {
  const lower = key.toLowerCase();
  if (lower.includes("password")) return true;
  if (lower.includes("token")) return true;
  if (lower.includes("secret")) return true;
  if (lower.endsWith("_enc")) return true;
  if (lower === "body") return true;
  return false;
}

export function redactAudit(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactAudit(entry));
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value).map(([key, entry]) => {
    if (isSensitive(key)) return [key, "[Redacted]"] as const;
    return [key, redactAudit(entry)] as const;
  });
  return Object.fromEntries(entries);
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => stable(entry));
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value)
    .filter((entry) => entry[1] !== undefined)
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .map(([key, entry]) => [key, stable(entry)] as const);
  return Object.fromEntries(entries);
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stable(value));
}

export function canonicalAudit(row: AuditPayload): string {
  return stableStringify({
    action: row.action,
    actorIp: row.actorIp,
    actorKind: row.actorKind,
    actorRole: row.actorRole,
    actorUserId: row.actorUserId,
    after: row.after,
    at: row.at,
    before: row.before,
    id: row.id,
    prevHash: row.prevHash,
    requestId: row.requestId,
    targetId: row.targetId,
    targetType: row.targetType,
  });
}

export function auditDigest(prevHash: string, canonical: string): string {
  const bytes = new TextEncoder().encode(prevHash + canonical);
  return encodeHexLowerCase(sha256(bytes));
}

export const AUDIT_GENESIS = "";
