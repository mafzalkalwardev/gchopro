export type CapCounts = {
  minute: number;
  hour: number;
  day: number;
  segments: number;
};

export type CapLimits = {
  perMinute: number;
  perHour: number;
  perDay: number;
  segmentsPerDay: number;
};

export type HoldReason =
  | "rate_minute"
  | "rate_hour"
  | "rate_day"
  | "rate_segments"
  | "window"
  | "sim_unhealthy"
  | "kill_switch"
  | "subscription"
  | "device_offline"
  | "translation_pending";

export type BlockReason =
  | "opted_out"
  | "content_rule"
  | "subscription_inactive"
  | "user_disabled"
  | "limit_reached"
  | "no_sim";

export type GateDecision =
  | { kind: "dispatch" }
  | { kind: "hold"; reason: HoldReason; delayMs: number }
  | { kind: "block"; reason: BlockReason }
  | { kind: "fail"; failureName: "TRANSLATION_TIMEOUT" }
  | { kind: "wait"; delayMs: number };

export type GateInput = {
  now: Date;
  killSwitch: boolean;
  devicePaused: boolean;
  simPaused: boolean;
  simAssignable: boolean;
  userActive: boolean;
  subscriptionActive: boolean;
  optedOut: boolean;
  contentBlocked: boolean;
  windowOpen: boolean;
  nextWindowAt: Date;
  windowJitterMs: number;
  counts: CapCounts;
  limits: CapLimits;
  overLimitAction: "hold" | "reject";
  capReleaseMs: number;
  nextSendAt: Date | null;
  deviceOnline: boolean;
  translationRequired: boolean;
  translationReady: boolean;
  translationStartedAt: Date | null;
};

const THIRTY_SECONDS = 30_000;
const TRANSLATION_TIMEOUT = 3 * 60_000;

/**
 * Pacing and limits keep each SIM within carrier fair-use policies and protect
 * deliverability. They are not a mechanism to disguise traffic or evade carrier controls.
 */
export function evaluateGate(input: GateInput): GateDecision {
  if (input.killSwitch || input.devicePaused || input.simPaused) {
    return { kind: "hold", reason: "kill_switch", delayMs: THIRTY_SECONDS };
  }
  if (!input.userActive) return { kind: "block", reason: "user_disabled" };
  if (!input.subscriptionActive) return { kind: "block", reason: "subscription_inactive" };
  if (input.optedOut) return { kind: "block", reason: "opted_out" };
  if (input.contentBlocked) return { kind: "block", reason: "content_rule" };
  if (!input.windowOpen) {
    const until = input.nextWindowAt.getTime() - input.now.getTime() + input.windowJitterMs;
    return { kind: "hold", reason: "window", delayMs: Math.max(1000, until) };
  }
  const cap = overCap(input.counts, input.limits);
  if (cap !== null) {
    if (input.overLimitAction === "reject") return { kind: "block", reason: "limit_reached" };
    return { kind: "hold", reason: cap, delayMs: Math.max(1000, input.capReleaseMs) };
  }
  if (input.nextSendAt !== null && input.nextSendAt.getTime() > input.now.getTime()) {
    return { kind: "wait", delayMs: input.nextSendAt.getTime() - input.now.getTime() };
  }
  if (!input.deviceOnline)
    return { kind: "hold", reason: "device_offline", delayMs: THIRTY_SECONDS };
  if (!input.simAssignable)
    return { kind: "hold", reason: "sim_unhealthy", delayMs: THIRTY_SECONDS };
  if (input.translationRequired && !input.translationReady) {
    const started = input.translationStartedAt ?? input.now;
    if (input.now.getTime() - started.getTime() >= TRANSLATION_TIMEOUT) {
      return { kind: "fail", failureName: "TRANSLATION_TIMEOUT" };
    }
    return { kind: "hold", reason: "translation_pending", delayMs: 5000 };
  }
  return { kind: "dispatch" };
}

function overCap(counts: CapCounts, limits: CapLimits): HoldReason | null {
  if (counts.minute >= limits.perMinute) return "rate_minute";
  if (counts.hour >= limits.perHour) return "rate_hour";
  if (counts.day >= limits.perDay) return "rate_day";
  if (counts.segments >= limits.segmentsPerDay) return "rate_segments";
  return null;
}

export function gapSeconds(input: {
  base: number;
  jitter: number;
  floor: number;
  random: number;
}): number {
  const unit = Math.min(1, Math.max(0, input.random));
  const swing = (unit * 2 - 1) * input.jitter;
  return Math.max(input.floor, input.base + swing);
}

export function retryPlan(input: {
  failureClass: string;
  attempts: number;
  deliveryFailed: boolean;
}): { retry: false } | { retry: true; delayMs: number } {
  if (input.deliveryFailed) return { retry: false };
  if (input.failureClass !== "transient") return { retry: false };
  if (input.attempts >= 3) return { retry: false };
  return { retry: true, delayMs: input.attempts <= 1 ? 60_000 : 5 * 60_000 };
}

export function simQueueName(simId: string): string {
  return `send:sim:${simId}`;
}

export const KILL_POLL_MS = 500;

export type PolicyNumbers = {
  gapBaseSeconds: number;
  gapJitterSeconds: number;
  perMinute: number;
  perHour: number;
  perDay: number;
  segmentsPerDay: number;
  maxGroupRecipients: number;
  windowStart: string;
  windowEnd: string;
  windowDays: number[];
  overLimitAction: "hold" | "reject";
};

export function stricterPolicy(user: PolicyNumbers, sim: PolicyNumbers | null): PolicyNumbers {
  if (sim === null) return user;
  const days = user.windowDays.filter((day) => sim.windowDays.includes(day));
  return {
    gapBaseSeconds: Math.max(user.gapBaseSeconds, sim.gapBaseSeconds),
    gapJitterSeconds: Math.min(user.gapJitterSeconds, sim.gapJitterSeconds),
    perMinute: Math.min(user.perMinute, sim.perMinute),
    perHour: Math.min(user.perHour, sim.perHour),
    perDay: Math.min(user.perDay, sim.perDay),
    segmentsPerDay: Math.min(user.segmentsPerDay, sim.segmentsPerDay),
    maxGroupRecipients: Math.min(user.maxGroupRecipients, sim.maxGroupRecipients),
    windowStart: user.windowStart > sim.windowStart ? user.windowStart : sim.windowStart,
    windowEnd: user.windowEnd < sim.windowEnd ? user.windowEnd : sim.windowEnd,
    windowDays: days.length > 0 ? days : user.windowDays,
    overLimitAction:
      user.overLimitAction === "reject" || sim.overLimitAction === "reject" ? "reject" : "hold",
  };
}
