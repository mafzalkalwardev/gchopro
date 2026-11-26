import { describe, expect, it } from "vitest";
import { csvCell } from "../csv.js";
import {
  digestDay,
  enableStatus,
  extendSubscription,
  pauseSubscription,
  periodsOverlap,
  reminderDue,
  resumeEndsAt,
  sendingBlocked,
  statusAtCreate,
  tickTransition,
} from "./machine.js";
import { addPlan } from "./period.js";

describe("subscription periods", () => {
  it("keeps wall-clock noon across a spring-forward day", () => {
    const start = new Date("2026-03-07T17:00:00.000Z");
    const end = addPlan(start, "day", 1, "America/New_York");
    expect(end.toISOString()).toBe("2026-03-08T16:00:00.000Z");
  });

  it("keeps wall-clock noon across a fall-back day", () => {
    const start = new Date("2026-10-31T16:00:00.000Z");
    const end = addPlan(start, "day", 1, "America/New_York");
    expect(end.toISOString()).toBe("2026-11-01T17:00:00.000Z");
  });

  it("clamps a month added to 31 January onto 28 February", () => {
    const start = new Date("2026-01-30T19:00:00.000Z");
    const end = addPlan(start, "month", 1, "Asia/Karachi");
    expect(end.toISOString()).toBe("2026-02-27T19:00:00.000Z");
  });

  it("adds weeks and years in the user zone", () => {
    const start = new Date("2026-01-30T19:00:00.000Z");
    expect(addPlan(start, "week", 2, "Asia/Karachi").toISOString()).toBe(
      "2026-02-13T19:00:00.000Z",
    );
    expect(addPlan(start, "year", 1, "Asia/Karachi").toISOString()).toBe(
      "2027-01-30T19:00:00.000Z",
    );
  });
});

describe("subscription transitions", () => {
  const now = new Date("2026-06-01T12:00:00.000Z");

  it("schedules a future start and activates a start that has arrived", () => {
    expect(statusAtCreate(new Date("2026-06-02T00:00:00.000Z"), now)).toBe("scheduled");
    expect(statusAtCreate(now, now)).toBe("active");
  });

  it("extends from the later of now and the current end, including an expired row", () => {
    const active = extendSubscription({
      status: "active",
      endsAt: new Date("2026-06-10T00:00:00.000Z"),
      now,
      unit: "day",
      quantity: 2,
      timeZone: "UTC",
    });
    expect(active.ok && active.endsAt.toISOString()).toBe("2026-06-12T00:00:00.000Z");
    const expired = extendSubscription({
      status: "expired",
      endsAt: new Date("2026-05-01T00:00:00.000Z"),
      now,
      unit: "day",
      quantity: 1,
      timeZone: "UTC",
    });
    expect(expired.ok && expired.endsAt.toISOString()).toBe("2026-06-02T12:00:00.000Z");
    expect(
      extendSubscription({
        status: "paused",
        endsAt: now,
        now,
        unit: "day",
        quantity: 1,
        timeZone: "UTC",
      }).ok,
    ).toBe(false);
  });

  it("stores the remaining seconds on pause and restores them on resume", () => {
    const endsAt = new Date(now.getTime() + 90_000);
    const paused = pauseSubscription({ status: "active", endsAt, now });
    expect(paused.ok && paused.remainingSeconds).toBe(90n);
    if (!paused.ok) return;
    expect(resumeEndsAt(paused.remainingSeconds, now).toISOString()).toBe(endsAt.toISOString());
    expect(pauseSubscription({ status: "paused", endsAt, now }).ok).toBe(false);
  });

  it("enables into active or expired from the stored end", () => {
    expect(enableStatus(new Date(now.getTime() + 1000), now)).toBe("active");
    expect(enableStatus(now, now)).toBe("expired");
  });

  it("activates, expires, and revokes only when expiry blocks access", () => {
    expect(
      tickTransition({
        status: "scheduled",
        startsAt: now,
        endsAt: new Date(now.getTime() + 1000),
        expiryBehavior: "block",
        now,
      }),
    ).toEqual({ kind: "activate" });
    expect(
      tickTransition({
        status: "active",
        startsAt: new Date(now.getTime() - 1000),
        endsAt: now,
        expiryBehavior: "block",
        now,
      }),
    ).toEqual({ kind: "expire", revoke: true });
    expect(
      tickTransition({
        status: "active",
        startsAt: new Date(now.getTime() - 1000),
        endsAt: now,
        expiryBehavior: "read_only",
        now,
      }),
    ).toEqual({ kind: "expire", revoke: false });
  });

  it("reminds once inside the three-day window", () => {
    const endsAt = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    expect(reminderDue({ status: "active", endsAt, reminderSentAt: null, now })).toBe(true);
    expect(reminderDue({ status: "active", endsAt, reminderSentAt: now, now })).toBe(false);
    expect(
      reminderDue({
        status: "active",
        endsAt: new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000),
        reminderSentAt: null,
        now,
      }),
    ).toBe(false);
  });

  it("opens the daily digest at 09:00 in the default zone", () => {
    expect(digestDay(new Date("2026-06-01T03:59:00.000Z"), "Asia/Karachi")).toBe(null);
    expect(digestDay(new Date("2026-06-01T04:00:00.000Z"), "Asia/Karachi")).toBe("2026-06-01");
  });

  it("treats overlapping open periods as a conflict and blocks sending outside full access", () => {
    expect(
      periodsOverlap(
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-02-01T00:00:00.000Z"),
        new Date("2026-01-15T00:00:00.000Z"),
        new Date("2026-03-01T00:00:00.000Z"),
      ),
    ).toBe(true);
    expect(sendingBlocked({ blocked: false, readOnly: true, scheduled: false })).toBe(true);
    expect(sendingBlocked({ blocked: false, readOnly: false, scheduled: false })).toBe(false);
  });
});

describe("csv cells", () => {
  it("quotes separators and neutralises formula characters", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("=cmd")).toBe(`"'=cmd"`);
    expect(csvCell(12)).toBe('"12"');
  });
});
