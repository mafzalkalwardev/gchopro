import { addPlan, localDay, localHour, type PlanUnit } from "./period.js";

export type SubStatus = "scheduled" | "active" | "paused" | "expired" | "disabled";
export type ExpiryBehavior = "block" | "read_only";

const REMINDER_MS = 3 * 24 * 60 * 60 * 1000;

export function periodsOverlap(start: Date, end: Date, otherStart: Date, otherEnd: Date): boolean {
  return start.getTime() < otherEnd.getTime() && otherStart.getTime() < end.getTime();
}

export function statusAtCreate(startsAt: Date, now: Date): "scheduled" | "active" {
  return startsAt.getTime() > now.getTime() ? "scheduled" : "active";
}

export function effectiveStatus(input: {
  status: SubStatus;
  startsAt: Date;
  endsAt: Date;
  now: Date;
}): SubStatus {
  if (input.status === "scheduled" && input.startsAt.getTime() <= input.now.getTime()) {
    return input.endsAt.getTime() <= input.now.getTime() ? "expired" : "active";
  }
  if (input.status === "active" && input.endsAt.getTime() <= input.now.getTime()) return "expired";
  return input.status;
}

export function extendSubscription(input: {
  status: SubStatus;
  endsAt: Date;
  now: Date;
  unit: PlanUnit;
  quantity: number;
  timeZone: string;
}): { ok: true; endsAt: Date } | { ok: false } {
  if (input.status !== "active" && input.status !== "expired") return { ok: false };
  const base = input.endsAt.getTime() > input.now.getTime() ? input.endsAt : input.now;
  return { ok: true, endsAt: addPlan(base, input.unit, input.quantity, input.timeZone) };
}

export function pauseSubscription(input: {
  status: SubStatus;
  endsAt: Date;
  now: Date;
}): { ok: true; remainingSeconds: bigint } | { ok: false } {
  if (input.status !== "active") return { ok: false };
  const remaining = Math.max(0, Math.floor((input.endsAt.getTime() - input.now.getTime()) / 1000));
  return { ok: true, remainingSeconds: BigInt(remaining) };
}

export function resumeEndsAt(remainingSeconds: bigint, now: Date): Date {
  return new Date(now.getTime() + Number(remainingSeconds) * 1000);
}

export function enableStatus(endsAt: Date, now: Date): "active" | "expired" {
  return endsAt.getTime() > now.getTime() ? "active" : "expired";
}

export type TickChange = { kind: "activate" } | { kind: "expire"; revoke: boolean };

export function tickTransition(input: {
  status: SubStatus;
  startsAt: Date;
  endsAt: Date;
  expiryBehavior: ExpiryBehavior;
  now: Date;
}): TickChange | null {
  if (input.status === "scheduled" && input.startsAt.getTime() <= input.now.getTime()) {
    if (input.endsAt.getTime() <= input.now.getTime()) {
      return { kind: "expire", revoke: input.expiryBehavior === "block" };
    }
    return { kind: "activate" };
  }
  if (input.status === "active" && input.endsAt.getTime() <= input.now.getTime()) {
    return { kind: "expire", revoke: input.expiryBehavior === "block" };
  }
  return null;
}

export function reminderDue(input: {
  status: SubStatus;
  endsAt: Date;
  reminderSentAt: Date | null;
  now: Date;
}): boolean {
  if (input.status !== "active" || input.reminderSentAt !== null) return false;
  const left = input.endsAt.getTime() - input.now.getTime();
  return left > 0 && left <= REMINDER_MS;
}

export function digestDay(now: Date, timeZone: string): string | null {
  if (localHour(now, timeZone) < 9) return null;
  return localDay(now, timeZone);
}

export function sendingBlocked(input: {
  readOnly: boolean;
  scheduled: boolean;
  blocked: boolean;
}): boolean {
  return input.blocked || input.readOnly || input.scheduled;
}
