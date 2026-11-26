import { afterEach, describe, expect, it, vi } from "vitest";
import {
  evaluateGate,
  gapSeconds,
  KILL_POLL_MS,
  retryPlan,
  simQueueName,
  stricterPolicy,
  type GateInput,
} from "./gates.js";
import { applySignature, contentBlocked, renderTemplate } from "./template.js";
import { windowState } from "./window.js";

function openGate(overrides: Partial<GateInput> = {}): GateInput {
  const now = new Date("2026-06-01T12:00:00Z");
  return {
    now,
    killSwitch: false,
    devicePaused: false,
    simPaused: false,
    simAssignable: true,
    userActive: true,
    subscriptionActive: true,
    optedOut: false,
    contentBlocked: false,
    windowOpen: true,
    nextWindowAt: now,
    windowJitterMs: 0,
    counts: { minute: 0, hour: 0, day: 0, segments: 0 },
    limits: { perMinute: 3, perHour: 50, perDay: 300, segmentsPerDay: 400 },
    overLimitAction: "hold",
    capReleaseMs: 60_000,
    nextSendAt: null,
    deviceOnline: true,
    translationRequired: false,
    translationReady: true,
    translationStartedAt: null,
    ...overrides,
  };
}

describe("paced dispatch", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps two messages on one SIM at least base minus jitter apart", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
    const gap = gapSeconds({ base: 15, jitter: 5, floor: 5, random: 0 });
    expect(gap).toBe(10);
    let sent = 0;
    const run = async () => {
      sent += 1;
      await new Promise((resolve) => setTimeout(resolve, gap * 1000));
      sent += 1;
    };
    const pending = run();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toBe(1);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(sent).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toBe(2);
    await pending;
  });

  it("never drops the gap below the floor", () => {
    expect(gapSeconds({ base: 6, jitter: 5, floor: 5, random: 0 })).toBe(5);
  });

  it("paces two SIMs independently", () => {
    const left = gapSeconds({ base: 15, jitter: 5, floor: 5, random: 0 });
    const right = gapSeconds({ base: 15, jitter: 5, floor: 5, random: 1 });
    expect(left).toBe(10);
    expect(right).toBe(20);
  });

  it("holds a cap and releases it when the window expires", () => {
    const held = evaluateGate(
      openGate({ counts: { minute: 3, hour: 0, day: 0, segments: 0 }, capReleaseMs: 60_000 }),
    );
    expect(held).toEqual({ kind: "hold", reason: "rate_minute", delayMs: 60_000 });
    const released = evaluateGate(
      openGate({ counts: { minute: 2, hour: 0, day: 0, segments: 0 } }),
    );
    expect(released.kind).toBe("dispatch");
  });

  it("holds until the send window opens", () => {
    const now = new Date("2026-06-01T03:00:00Z");
    const next = new Date("2026-06-01T04:00:00Z");
    const held = evaluateGate(
      openGate({ now, windowOpen: false, nextWindowAt: next, windowJitterMs: 30_000 }),
    );
    expect(held).toEqual({ kind: "hold", reason: "window", delayMs: 3_630_000 });
  });

  it("stops new dispatches inside the kill-switch deadline", async () => {
    vi.useFakeTimers();
    let paused = false;
    const timer = setInterval(() => {
      paused = true;
    }, KILL_POLL_MS);
    expect(KILL_POLL_MS).toBeLessThanOrEqual(2000);
    await vi.advanceTimersByTimeAsync(2000);
    clearInterval(timer);
    expect(paused).toBe(true);
  });

  it("retries a transient failure on the same SIM and never moves a suspended SIM", () => {
    const sameSim = "sim-a";
    const first = retryPlan({ failureClass: "transient", attempts: 1, deliveryFailed: false });
    const second = retryPlan({ failureClass: "transient", attempts: 2, deliveryFailed: false });
    const third = retryPlan({ failureClass: "transient", attempts: 3, deliveryFailed: false });
    expect(first).toEqual({ retry: true, delayMs: 60_000 });
    expect(second).toEqual({ retry: true, delayMs: 300_000 });
    expect(third).toEqual({ retry: false });
    expect(
      retryPlan({ failureClass: "suspension_signal", attempts: 1, deliveryFailed: false }).retry,
    ).toBe(false);
    expect(
      retryPlan({ failureClass: "sim_problem", attempts: 1, deliveryFailed: false }).retry,
    ).toBe(false);
    expect(retryPlan({ failureClass: "permanent", attempts: 1, deliveryFailed: false }).retry).toBe(
      false,
    );
    expect(retryPlan({ failureClass: "transient", attempts: 1, deliveryFailed: true }).retry).toBe(
      false,
    );
    expect(simQueueName(sameSim)).toBe("send-sim-sim-a");
  });

  it("dispatches a scheduled message only after its time", () => {
    const now = new Date("2026-06-01T12:00:00Z");
    const later = new Date("2026-06-01T12:05:00Z");
    const waiting = evaluateGate(openGate({ now, nextSendAt: later }));
    expect(waiting).toEqual({ kind: "wait", delayMs: 300_000 });
    const due = evaluateGate(openGate({ now: later, nextSendAt: later }));
    expect(due.kind).toBe("dispatch");
  });
});

describe("templates and windows", () => {
  it("renders known variables and reports missing ones", () => {
    expect(renderTemplate("Hi {name}", { name: "Ada" })).toEqual({ ok: true, text: "Hi Ada" });
    expect(renderTemplate("Hi {name} {custom1}", { name: "Ada" })).toEqual({
      ok: false,
      missing: ["custom1"],
    });
  });

  it("counts the signature as part of the wire body", () => {
    expect(applySignature("Hello", { enabled: true, text: "Desk" })).toBe("Hello\n— Desk");
    expect(applySignature("Hello", { enabled: false, text: "Desk" })).toBe("Hello");
  });

  it("blocks a keyword and a URL", () => {
    expect(contentBlocked("buy now", { blockedKeywords: ["buy"], blockUrls: false })).toBe(true);
    expect(
      contentBlocked("see https://example.com", { blockedKeywords: [], blockUrls: true }),
    ).toBe(true);
  });

  it("finds the next opening in the user timezone", () => {
    const closed = windowState(new Date("2026-06-01T03:30:00Z"), {
      start: "09:00:00",
      end: "20:00:00",
      days: [1, 2, 3, 4, 5, 6, 7],
      timeZone: "Asia/Karachi",
    });
    expect(closed.open).toBe(false);
    expect(closed.nextOpen.toISOString()).toBe("2026-06-01T04:00:00.000Z");
    const open = windowState(new Date("2026-06-01T12:00:00Z"), {
      start: "09:00:00",
      end: "20:00:00",
      days: [1, 2, 3, 4, 5, 6, 7],
      timeZone: "Asia/Karachi",
    });
    expect(open.open).toBe(true);
  });

  it("keeps the stricter value of each policy field", () => {
    const result = stricterPolicy(
      {
        gapBaseSeconds: 15,
        gapJitterSeconds: 5,
        perMinute: 3,
        perHour: 50,
        perDay: 300,
        segmentsPerDay: 400,
        maxGroupRecipients: 50,
        windowStart: "09:00:00",
        windowEnd: "20:00:00",
        windowDays: [1, 2, 3, 4, 5],
        overLimitAction: "hold",
      },
      {
        gapBaseSeconds: 20,
        gapJitterSeconds: 2,
        perMinute: 2,
        perHour: 40,
        perDay: 200,
        segmentsPerDay: 300,
        maxGroupRecipients: 10,
        windowStart: "10:00:00",
        windowEnd: "18:00:00",
        windowDays: [1, 2, 3],
        overLimitAction: "reject",
      },
    );
    expect(result.perMinute).toBe(2);
    expect(result.gapBaseSeconds).toBe(20);
    expect(result.windowDays).toEqual([1, 2, 3]);
    expect(result.overLimitAction).toBe("reject");
  });
});
