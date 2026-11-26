import { describe, expect, it } from "vitest";
import {
  analyticsCsv,
  bucketKey,
  foldStats,
  startOfZonedDay,
  toSeries,
  zonedDay,
  type StatEvent,
} from "./series.js";

const zone = "Asia/Karachi";

function event(patch: Partial<StatEvent>): StatEvent {
  return {
    createdAt: new Date("2026-11-26T12:00:00.000Z"),
    userId: "user-1",
    simId: "sim-1",
    direction: "out",
    status: "queued",
    isRetest: false,
    segments: 1,
    sentAt: null,
    deliveredAt: null,
    failureName: null,
    holdReason: null,
    blockReason: null,
    ...patch,
  };
}

describe("analytics series", () => {
  it("keeps a Karachi day on the local calendar", () => {
    expect(zonedDay(new Date("2026-11-26T12:00:00.000Z"), zone)).toBe("2026-11-26");
    expect(zonedDay(new Date("2026-11-26T20:00:00.000Z"), zone)).toBe("2026-11-27");
    expect(startOfZonedDay("2026-11-26", zone).toISOString()).toBe("2026-11-25T19:00:00.000Z");
  });

  it("counts a delivered message as sent and ignores a re-test", () => {
    const sentAt = new Date("2026-11-26T12:00:00.000Z");
    const deliveredAt = new Date("2026-11-26T12:00:05.000Z");
    const rows = foldStats(
      [
        event({ status: "delivered", sentAt, deliveredAt }),
        event({ status: "failed", failureName: "=cmd" }),
        event({ direction: "in", status: "received" }),
        event({ status: "blocked", blockReason: "opted_out" }),
        event({ status: "held", holdReason: "rate_minute" }),
        event({ status: "sent", isRetest: true }),
      ],
      zone,
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (row === undefined) throw new Error("missing rollup row");
    expect(row).toMatchObject({
      sent: 1,
      delivered: 1,
      failed: 1,
      received: 1,
      blocked: 1,
      optOuts: 1,
      limitHolds: 1,
      deliveryMsSum: 5000,
      deliveryMsCount: 1,
    });
    const series = toSeries(rows, "day");
    expect(series[0]?.deliveryRatio).toBe(1);
    expect(series[0]?.avgDeliverySec).toBe(5);
    expect(bucketKey("2026-11-26", "week")).toBe("2026-11-23");
  });

  it("escapes a formula in the analytics export", () => {
    const csv = analyticsCsv("users", [
      {
        id: "user-1",
        name: "demo",
        sent: 1,
        delivered: 1,
        failed: 1,
        received: 0,
        deliveryRatio: 1,
        avgDeliverySec: 5,
        topFailure: "=cmd",
      },
    ]);
    expect(csv).toContain(`"'=cmd"`);
    expect(csv.startsWith('"scope"')).toBe(true);
  });
});
