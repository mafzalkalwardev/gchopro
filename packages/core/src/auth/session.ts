import { sha256 } from "@oslojs/crypto/sha2";
import { encodeBase32LowerCaseNoPadding, encodeHexLowerCase } from "@oslojs/encoding";

export const COOKIE = {
  admin: "__Host-gcho_admin",
  portal: "__Host-gcho_portal",
  csrf: "__Host-gcho_csrf",
} as const;

export const SESSION_MS = {
  admin: { idle: 30 * 60 * 1000, absolute: 12 * 60 * 60 * 1000 },
  portal: { idle: 12 * 60 * 60 * 1000, absolute: 7 * 24 * 60 * 60 * 1000 },
} as const;

export const SUDO_MS = 10 * 60 * 1000;
export const SESSION_CACHE_SECONDS = 15;

export function newSessionToken(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return encodeBase32LowerCaseNoPadding(bytes);
}

export function sessionIdFromToken(token: string): string {
  return encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
}

function sessionRule(app: "admin" | "portal"): { idle: number; absolute: number } {
  if (app === "admin") return SESSION_MS.admin;
  return SESSION_MS.portal;
}

export function sessionWindow(
  app: "admin" | "portal",
  now: Date,
): { expiresAt: Date; absoluteExpiresAt: Date } {
  const rule = sessionRule(app);
  return {
    expiresAt: new Date(now.getTime() + rule.idle),
    absoluteExpiresAt: new Date(now.getTime() + rule.absolute),
  };
}

export function slideExpiry(app: "admin" | "portal", now: Date, absoluteExpiresAt: Date): Date {
  const idle = new Date(now.getTime() + sessionRule(app).idle);
  return idle.getTime() < absoluteExpiresAt.getTime() ? idle : absoluteExpiresAt;
}

export type SessionRejection = "revoked" | "expired" | "user_disabled" | "password_changed";

export function sessionRejection(input: {
  revokedAt: Date | null;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  now: Date;
  userStatus: "active" | "disabled";
  deletedAt: Date | null;
  passwordChangedAt: Date;
  sessionCreatedAt: Date;
}): SessionRejection | null {
  if (input.revokedAt !== null) return "revoked";
  if (input.expiresAt <= input.now || input.absoluteExpiresAt <= input.now) return "expired";
  if (input.userStatus !== "active" || input.deletedAt !== null) return "user_disabled";
  if (input.passwordChangedAt.getTime() > input.sessionCreatedAt.getTime())
    return "password_changed";
  return null;
}

export type AccessStep = "mfa" | "password" | "aup" | "ok";

export function accessStep(input: {
  app: "admin" | "portal";
  mfaVerified: boolean;
  mustChangePassword: boolean;
  aupAcceptedAt: Date | null;
}): AccessStep {
  if (input.app === "admin" && !input.mfaVerified) return "mfa";
  if (input.mustChangePassword) return "password";
  if (input.app === "portal" && input.aupAcceptedAt === null) return "aup";
  return "ok";
}

export type PortalBlock = "user_disabled" | "no_sim" | "subscription_inactive" | "ip_not_allowed";

export function portalAccess(input: {
  status: "active" | "disabled";
  deletedAt: Date | null;
  simId: string | null;
  ipAllowed: boolean;
  subscription: {
    status: "scheduled" | "active" | "paused" | "expired" | "disabled";
    expiryBehavior: "block" | "read_only";
  } | null;
}): { ok: true; readOnly: boolean; scheduled: boolean } | { ok: false; error: PortalBlock } {
  if (input.status !== "active" || input.deletedAt !== null)
    return { ok: false, error: "user_disabled" };
  if (!input.ipAllowed) return { ok: false, error: "ip_not_allowed" };
  if (input.simId === null) return { ok: false, error: "no_sim" };
  const subscription = input.subscription;
  if (subscription === null) return { ok: false, error: "subscription_inactive" };
  if (subscription.status === "active") return { ok: true, readOnly: false, scheduled: false };
  if (subscription.status === "scheduled") return { ok: true, readOnly: false, scheduled: true };
  if (subscription.status === "expired" && subscription.expiryBehavior === "read_only") {
    return { ok: true, readOnly: true, scheduled: false };
  }
  return { ok: false, error: "subscription_inactive" };
}

export function constantTimeEqual(leftText: string, rightText: string): boolean {
  const left = new TextEncoder().encode(leftText);
  const right = new TextEncoder().encode(rightText);
  const length = Math.max(left.byteLength, right.byteLength);
  let diff = left.byteLength === right.byteLength ? 0 : 1;
  for (let index = 0; index < length; index += 1) {
    // Byte positions, not object keys.
    // eslint-disable-next-line security/detect-object-injection
    const leftByte = left[index] ?? 0;
    // eslint-disable-next-line security/detect-object-injection
    const rightByte = right[index] ?? 0;
    diff |= leftByte ^ rightByte;
  }
  return diff === 0;
}
