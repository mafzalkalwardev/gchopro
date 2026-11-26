import { ERROR_OFFLINE_MS, NO_SERVICE_DWELL_MS, NOT_READY_DWELL_MS } from "../device/protocol.js";

export type SimHealth =
  | "active"
  | "no_service"
  | "absent"
  | "locked"
  | "suspected_suspended"
  | "error"
  | "paused_admin"
  | "inactive"
  | "retired";

const ABSENT = new Set(["SIM_STATE_ABSENT", "SIM_STATE_CARD_IO_ERROR"]);
const LOCKED = new Set([
  "SIM_STATE_PIN_REQUIRED",
  "SIM_STATE_PUK_REQUIRED",
  "SIM_STATE_NETWORK_LOCKED",
  "SIM_STATE_PERM_DISABLED",
  "SIM_STATE_CARD_RESTRICTED",
]);
const OUT = new Set(["OUT_OF_SERVICE", "EMERGENCY_ONLY", "POWER_OFF", "STATE_OUT_OF_SERVICE"]);

export type HealthInput = {
  deviceRetired: boolean;
  pausedByAdmin: boolean;
  activeOnDevice: boolean;
  simState: string | null;
  serviceState: string | null;
  signalLevel: number | null;
  current: SimHealth;
  consecutiveFailures: number;
  suspensionSignals24h: number;
  notReadySince: Date | null;
  serviceOutSince: Date | null;
  lastHeartbeatAt: Date | null;
  now: Date;
  consecutiveFailureThreshold: number;
  suspensionSignalThreshold: number;
  clearSuspension: boolean;
};

export function serviceOutSince(
  previous: string | null,
  next: string | null,
  updatedAt: Date,
): Date | null {
  if (next === null || !OUT.has(next)) return null;
  if (previous !== null && OUT.has(previous)) return updatedAt;
  return null;
}

export function notReadySince(
  previous: string | null,
  next: string | null,
  updatedAt: Date,
): Date | null {
  if (next !== "SIM_STATE_NOT_READY") return null;
  if (previous === "SIM_STATE_NOT_READY") return updatedAt;
  return null;
}

function olderThan(since: Date | null, now: Date, dwellMs: number): boolean {
  if (since === null) return false;
  return now.getTime() - since.getTime() >= dwellMs;
}

function inService(serviceState: string | null): boolean {
  return serviceState === "STATE_IN_SERVICE" || serviceState === "IN_SERVICE";
}

export function evaluateHealth(input: HealthInput): SimHealth {
  if (input.deviceRetired) return "retired";
  if (input.pausedByAdmin) return "paused_admin";
  if (!input.activeOnDevice) return "inactive";
  const notReadyTooLong =
    input.simState === "SIM_STATE_NOT_READY" &&
    olderThan(input.notReadySince, input.now, NOT_READY_DWELL_MS);
  if ((input.simState !== null && ABSENT.has(input.simState)) || notReadyTooLong) return "absent";
  if (input.simState !== null && LOCKED.has(input.simState)) return "locked";
  const suspension =
    input.current === "suspected_suspended" ||
    input.suspensionSignals24h >= input.suspensionSignalThreshold ||
    (input.consecutiveFailures >= input.consecutiveFailureThreshold &&
      inService(input.serviceState) &&
      (input.signalLevel ?? 0) >= 1);
  if (suspension && !input.clearSuspension) return "suspected_suspended";
  if (
    input.serviceState !== null &&
    OUT.has(input.serviceState) &&
    olderThan(input.serviceOutSince, input.now, NO_SERVICE_DWELL_MS)
  ) {
    return "no_service";
  }
  const offline =
    input.lastHeartbeatAt !== null &&
    input.now.getTime() - input.lastHeartbeatAt.getTime() >= ERROR_OFFLINE_MS;
  if (
    (input.consecutiveFailures >= input.consecutiveFailureThreshold &&
      !inService(input.serviceState)) ||
    offline
  ) {
    return "error";
  }
  return "active";
}
