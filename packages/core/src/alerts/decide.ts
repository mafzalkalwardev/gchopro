export type AlertSeverity = "info" | "warning" | "critical";

const CRITICAL_AFTER_MS = 15 * 60 * 1000;
const RENOTIFY_MS = 60 * 60 * 1000;

export function deviceOfflineDecision(input: {
  lastHeartbeatAt: Date | null;
  now: Date;
  offlineAfterSeconds: number;
}): { open: boolean; severity: AlertSeverity } {
  if (input.lastHeartbeatAt === null) return { open: false, severity: "warning" };
  const age = input.now.getTime() - input.lastHeartbeatAt.getTime();
  const openAfter = (input.offlineAfterSeconds + 60) * 1000;
  if (age < openAfter) return { open: false, severity: "warning" };
  return { open: true, severity: age >= CRITICAL_AFTER_MS ? "critical" : "warning" };
}

export function batteryLowOpen(input: {
  battery: number | null;
  charging: boolean | null;
  threshold: number;
}): boolean {
  if (input.charging === true || input.battery === null) return false;
  return input.battery < input.threshold;
}

export function batteryLowResolved(input: {
  battery: number | null;
  charging: boolean | null;
  threshold: number;
}): boolean {
  if (input.charging === true) return true;
  if (input.battery === null) return false;
  return input.battery >= input.threshold + 5;
}

export function renotifyDue(input: {
  severity: AlertSeverity;
  lastNotifiedAt: Date | null;
  now: Date;
}): boolean {
  if (input.lastNotifiedAt === null) return true;
  if (input.severity !== "critical") return false;
  return input.now.getTime() - input.lastNotifiedAt.getTime() >= RENOTIFY_MS;
}

export function maskNumber(value: string): string {
  const digits = value.replace(/[^\d+]/gu, "");
  if (digits.length < 8) return "****";
  return `${digits.slice(0, 4)}****${digits.slice(-4)}`;
}

export function alertText(input: { title: string; type: string }): string {
  return `${input.title} (${input.type})`;
}
