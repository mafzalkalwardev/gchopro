import { csvLine } from "../csv.js";

export type StatEvent = {
  createdAt: Date;
  userId: string;
  simId: string;
  direction: "in" | "out";
  status: string;
  isRetest: boolean;
  segments: number | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  failureName: string | null;
  holdReason: string | null;
  blockReason: string | null;
};

export type DailyStat = {
  day: string;
  userId: string;
  simId: string;
  sent: number;
  delivered: number;
  failed: number;
  received: number;
  blocked: number;
  segmentsOut: number;
  optOuts: number;
  deliveryMsSum: number;
  deliveryMsCount: number;
  limitHolds: number;
};

export type SeriesPoint = {
  bucket: string;
  sent: number;
  delivered: number;
  failed: number;
  received: number;
  blocked: number;
  deliveryRatio: number | null;
  avgDeliverySec: number | null;
};

export type AnalyticsCsvRow = {
  id: string;
  name: string;
  sent: number;
  delivered: number;
  failed: number;
  received: number;
  deliveryRatio: number | null;
  avgDeliverySec: number | null;
  topFailure: string;
};

const RATE_HOLDS = new Set(["rate_minute", "rate_hour", "rate_day", "rate_segments"]);

export function zonedDay(when: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(when);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return `${map.get("year") ?? "0000"}-${map.get("month") ?? "01"}-${map.get("day") ?? "01"}`;
}

export function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

export function startOfZonedDay(day: string, timeZone: string): Date {
  const [yearText, monthText, dateText] = day.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const date = Number(dateText);
  const utcGuess = Date.UTC(year, month - 1, date, 0, 0, 0);
  const guess = new Date(utcGuess);
  const offset = wallClockAsUtc(guess, timeZone) - guess.getTime();
  return new Date(utcGuess - offset);
}

export function rollupWindow(
  now: Date,
  timeZone: string,
): { start: Date; end: Date; days: string[] } {
  const today = zonedDay(now, timeZone);
  const yesterday = shiftDay(today, -1);
  return {
    start: startOfZonedDay(yesterday, timeZone),
    end: startOfZonedDay(shiftDay(today, 1), timeZone),
    days: [yesterday, today],
  };
}

export function rangeBounds(
  from: string,
  to: string,
  timeZone: string,
): { start: Date; end: Date } {
  return {
    start: startOfZonedDay(from, timeZone),
    end: startOfZonedDay(shiftDay(to, 1), timeZone),
  };
}

export function deliveryRatio(delivered: number, sent: number): number | null {
  if (sent === 0) return null;
  return Math.round((delivered / sent) * 10_000) / 10_000;
}

export function averageDeliverySec(sumMs: number, count: number): number | null {
  if (count === 0) return null;
  return sumMs / count / 1000;
}

export function foldStats(events: readonly StatEvent[], timeZone: string): DailyStat[] {
  const buckets = new Map<string, DailyStat>();
  for (const event of events) {
    if (event.isRetest) continue;
    const day = zonedDay(event.createdAt, timeZone);
    const key = `${day}\n${event.userId}\n${event.simId}`;
    const bucket = buckets.get(key) ?? emptyStat(day, event.userId, event.simId);
    const sent =
      event.direction === "out" && (event.status === "sent" || event.status === "delivered");
    if (sent) bucket.sent += 1;
    if (event.status === "delivered") bucket.delivered += 1;
    if (event.status === "failed") bucket.failed += 1;
    if (event.direction === "in") bucket.received += 1;
    if (event.status === "blocked") bucket.blocked += 1;
    if (sent) bucket.segmentsOut += event.segments ?? 0;
    if (event.blockReason === "opted_out") bucket.optOuts += 1;
    if (event.status === "held" && event.holdReason !== null && RATE_HOLDS.has(event.holdReason)) {
      bucket.limitHolds += 1;
    }
    if (
      event.status === "delivered" &&
      event.sentAt !== null &&
      event.deliveredAt !== null &&
      event.deliveredAt.getTime() >= event.sentAt.getTime()
    ) {
      bucket.deliveryMsSum += event.deliveredAt.getTime() - event.sentAt.getTime();
      bucket.deliveryMsCount += 1;
    }
    buckets.set(key, bucket);
  }
  return [...buckets.values()];
}

export function bucketKey(day: string, granularity: "day" | "week" | "month"): string {
  if (granularity === "month") return day.slice(0, 7);
  if (granularity === "day") return day;
  const date = new Date(`${day}T00:00:00Z`);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - weekday + 1);
  return date.toISOString().slice(0, 10);
}

export function toSeries(
  rows: readonly DailyStat[],
  granularity: "day" | "week" | "month",
): SeriesPoint[] {
  const buckets = new Map<string, DailyStat>();
  for (const row of rows) {
    const key = bucketKey(row.day, granularity);
    const bucket = buckets.get(key) ?? emptyStat(key, "", "");
    addStat(bucket, row);
    buckets.set(key, bucket);
  }
  return [...buckets.values()]
    .sort((left, right) => left.day.localeCompare(right.day))
    .map((row) => pointOf(row.day, row));
}

export function totalsOf(rows: readonly DailyStat[]): SeriesPoint {
  const total = emptyStat("total", "", "");
  for (const row of rows) addStat(total, row);
  return pointOf("total", total);
}

export function tallyFailures(names: readonly string[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

export function analyticsCsv(scope: "users" | "sims", rows: readonly AnalyticsCsvRow[]): string {
  const lines = [
    csvLine([
      "scope",
      "id",
      "name",
      "sent",
      "delivered",
      "failed",
      "received",
      "delivery_ratio",
      "avg_delivery_sec",
      "top_failure",
    ]),
  ];
  for (const row of rows) {
    lines.push(
      csvLine([
        scope,
        row.id,
        row.name,
        row.sent,
        row.delivered,
        row.failed,
        row.received,
        row.deliveryRatio,
        row.avgDeliverySec,
        row.topFailure,
      ]),
    );
  }
  return `${lines.join("\n")}\n`;
}

function emptyStat(day: string, userId: string, simId: string): DailyStat {
  return {
    day,
    userId,
    simId,
    sent: 0,
    delivered: 0,
    failed: 0,
    received: 0,
    blocked: 0,
    segmentsOut: 0,
    optOuts: 0,
    deliveryMsSum: 0,
    deliveryMsCount: 0,
    limitHolds: 0,
  };
}

function addStat(target: DailyStat, row: DailyStat): void {
  target.sent += row.sent;
  target.delivered += row.delivered;
  target.failed += row.failed;
  target.received += row.received;
  target.blocked += row.blocked;
  target.segmentsOut += row.segmentsOut;
  target.optOuts += row.optOuts;
  target.deliveryMsSum += row.deliveryMsSum;
  target.deliveryMsCount += row.deliveryMsCount;
  target.limitHolds += row.limitHolds;
}

function pointOf(bucket: string, row: DailyStat): SeriesPoint {
  return {
    bucket,
    sent: row.sent,
    delivered: row.delivered,
    failed: row.failed,
    received: row.received,
    blocked: row.blocked,
    deliveryRatio: deliveryRatio(row.delivered, row.sent),
    avgDeliverySec: averageDeliverySec(row.deliveryMsSum, row.deliveryMsCount),
  };
}

function wallClockAsUtc(when: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(when);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  let hour = Number(map.get("hour"));
  if (hour === 24) hour = 0;
  return Date.UTC(
    Number(map.get("year")),
    Number(map.get("month")) - 1,
    Number(map.get("day")),
    hour,
    Number(map.get("minute")),
    Number(map.get("second")),
  );
}
