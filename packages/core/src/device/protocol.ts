import { randomBytes, randomInt } from "node:crypto";

export const PROTOCOL_VERSION = 2;
export const PAIRING_TTL_MS = 10 * 60 * 1000;
export const PAIRING_ATTEMPT_LIMIT = 5;
export const TOKEN_GRACE_MS = 10 * 60 * 1000;
export const POLL_INTERVAL_MS = 3000;
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const SIM_REPORT_STALE_MS = 5 * 60 * 1000;
export const NO_SERVICE_DWELL_MS = 2 * 60 * 1000;
export const NOT_READY_DWELL_MS = 5 * 60 * 1000;
export const ERROR_OFFLINE_MS = 10 * 60 * 1000;

export function newPairingCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function pairingCodeValid(code: string): boolean {
  return /^\d{6}$/.test(code);
}

export function newDeviceToken(): string {
  return randomBytes(32).toString("hex");
}

export function pairingDecision(input: {
  found: boolean;
  expiresAt: Date | null;
  attempts: number;
  now: Date;
}): "accept" | "reject" {
  if (!input.found || input.expiresAt === null) return "reject";
  if (input.expiresAt.getTime() <= input.now.getTime()) return "reject";
  if (input.attempts >= PAIRING_ATTEMPT_LIMIT) return "reject";
  return "accept";
}

export function tokenNeedsRotation(input: {
  rotatedAt: Date | null;
  now: Date;
  maxAgeDays: number;
  requested: boolean;
  usingPrevious: boolean;
}): boolean {
  if (input.requested || input.usingPrevious) return true;
  if (input.rotatedAt === null) return false;
  const ageMs = input.now.getTime() - input.rotatedAt.getTime();
  return ageMs > input.maxAgeDays * 24 * 60 * 60 * 1000;
}
