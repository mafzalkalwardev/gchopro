import {
  AppError,
  SAFE_TEXT,
  analyticsCsv,
  averageDeliverySec,
  deliveryRatio,
  foldStats,
  rangeBounds,
  rollupWindow,
  settingSchemas,
  shiftDay,
  tallyFailures,
  toSeries,
  totalsOf,
  zonedDay,
  type AnalyticsCsvRow,
  type DailyStat,
  type SeriesPoint,
  type StatEvent,
} from "@gchopro/core";
import { and, desc, eq, gte, inArray, lt, lte, sql, type SQL } from "drizzle-orm";
import { appendAudit } from "./audit.js";
import { getDb } from "./client.js";
import { openSeal, type AdminActor } from "./device-shared.js";
import { readBackup } from "./backup-service.js";
import { getRedis } from "./redis.js";
import { messages, settings, sims, statsDaily, users } from "./schema.js";

const BEAT_KEY = "worker:beat";
const DAY = /^\d{4}-\d{2}-\d{2}$/u;

export type AnalyticsReport = {
  from: string;
  to: string;
  granularity: "day" | "week" | "month";
  series: SeriesPoint[];
  totals: SeriesPoint;
  topFailureReasons: { name: string; count: number }[];
};

type FailureHit = { userId: string; simId: string; name: string };

export async function rollupStats(now = new Date()): Promise<number> {
  const timeZone = await readTimezone();
  const window = rollupWindow(now, timeZone);
  const events = await loadEvents(window.start, window.end);
  const rows = foldStats(events, timeZone).filter((row) => window.days.includes(row.day));
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(statsDaily).where(inArray(statsDaily.day, window.days));
    if (rows.length === 0) return;
    await tx.insert(statsDaily).values(rows.map(statInsert));
  });
  return rows.length;
}

export async function analyticsSeries(input: {
  from?: string;
  to?: string;
  granularity?: string;
  userId?: string;
  simId?: string;
}): Promise<AnalyticsReport> {
  const timeZone = await readTimezone();
  const range = resolveRange(input.from, input.to, timeZone);
  const granularity = resolveGranularity(input.granularity);
  const userId = blank(input.userId);
  const simId = blank(input.simId);
  const filters = present([
    gte(statsDaily.day, range.from),
    lte(statsDaily.day, range.to),
    userId === undefined ? undefined : eq(statsDaily.userId, userId),
    simId === undefined ? undefined : eq(statsDaily.simId, simId),
  ]);
  const stored = await getDb()
    .select()
    .from(statsDaily)
    .where(and(...filters));
  const daily = stored.map(statFromRow);
  const failures = await loadFailures(range.from, range.to, timeZone, userId, simId);
  return {
    from: range.from,
    to: range.to,
    granularity,
    series: toSeries(daily, granularity),
    totals: totalsOf(daily),
    topFailureReasons: tallyFailures(failures.map((hit) => hit.name)).slice(0, 8),
  };
}

export async function analyticsLeaderboard(input: {
  from?: string;
  to?: string;
  metric?: string;
}): Promise<{ userId: string; username: string; value: number }[]> {
  const metric =
    input.metric === "failed" || input.metric === "deliveryRatio" ? input.metric : "sent";
  const timeZone = await readTimezone();
  const range = resolveRange(input.from, input.to, timeZone);
  const stored = await getDb()
    .select()
    .from(statsDaily)
    .where(and(gte(statsDaily.day, range.from), lte(statsDaily.day, range.to)));
  const grouped = new Map<string, DailyStat>();
  for (const row of stored) {
    if (row.userId === null) continue;
    const bucket = grouped.get(row.userId) ?? emptyUser(row.userId);
    bucket.sent += row.sent;
    bucket.delivered += row.delivered;
    bucket.failed += row.failed;
    grouped.set(row.userId, bucket);
  }
  const names = await usernames([...grouped.keys()]);
  return [...grouped.values()]
    .map((row) => ({
      userId: row.userId,
      username: names.get(row.userId) ?? row.userId,
      value:
        metric === "failed"
          ? row.failed
          : metric === "deliveryRatio"
            ? (deliveryRatio(row.delivered, row.sent) ?? 0)
            : row.sent,
    }))
    .sort((left, right) => right.value - left.value || left.username.localeCompare(right.username))
    .slice(0, 20);
}

export async function analyticsExport(input: {
  from?: string;
  to?: string;
  scope?: string;
}): Promise<string> {
  const scope = input.scope === "sims" ? "sims" : "users";
  const timeZone = await readTimezone();
  const range = resolveRange(input.from, input.to, timeZone);
  const stored = await getDb()
    .select()
    .from(statsDaily)
    .where(and(gte(statsDaily.day, range.from), lte(statsDaily.day, range.to)));
  const failures = await loadFailures(range.from, range.to, timeZone);
  if (scope === "sims")
    return analyticsCsv("sims", await simRows(stored.map(statFromRow), failures));
  return analyticsCsv("users", await userRows(stored.map(statFromRow), failures));
}

export async function recordWorkerBeat(now = new Date()): Promise<void> {
  await getRedis().set(BEAT_KEY, now.toISOString(), "EX", 900);
}

export async function systemHealth(): Promise<{
  db: boolean;
  redis: boolean;
  worker: { lastBeatAt: string | null };
  queues: { simId: string; queued: number; held: number }[];
  backup: { lastAt: string | null; restoreTestAt: string | null };
}> {
  let dbOk = false;
  try {
    await getDb().execute(sql`select 1`);
    dbOk = true;
  } catch {
    dbOk = false;
  }
  let redisOk = false;
  let lastBeatAt: string | null = null;
  try {
    redisOk = (await getRedis().ping()) === "PONG";
    if (redisOk) lastBeatAt = await getRedis().get(BEAT_KEY);
  } catch {
    redisOk = false;
  }
  const queued = await getDb()
    .select({ simId: messages.simId, status: messages.status })
    .from(messages)
    .where(inArray(messages.status, ["queued", "held"]));
  let backup: { lastAt: string | null; restoreTestAt: string | null } = {
    lastAt: null,
    restoreTestAt: null,
  };
  if (redisOk) {
    try {
      backup = await readBackup();
    } catch {
      backup = { lastAt: null, restoreTestAt: null };
    }
  }
  const queues = new Map<string, { simId: string; queued: number; held: number }>();
  for (const row of queued) {
    const bucket = queues.get(row.simId) ?? { simId: row.simId, queued: 0, held: 0 };
    if (row.status === "held") bucket.held += 1;
    else bucket.queued += 1;
    queues.set(row.simId, bucket);
  }
  return {
    db: dbOk,
    redis: redisOk,
    worker: { lastBeatAt },
    queues: [...queues.values()],
    backup,
  };
}

export async function supportViewEnabled(): Promise<boolean> {
  const parsed = settingSchemas.portal.safeParse(await rawSetting("portal"));
  return parsed.success && parsed.data.allow_admin_support_view;
}

export async function openSupportView(actor: AdminActor, userId: string) {
  if (!(await supportViewEnabled())) throw new AppError(404, "not_found", SAFE_TEXT.not_found);
  const db = getDb();
  const owners = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const owner = owners[0];
  if (owner === undefined || owner.role !== "user" || owner.deletedAt !== null) {
    throw new AppError(404, "not_found", SAFE_TEXT.not_found);
  }
  await db.transaction(async (tx) => {
    await appendAudit(
      tx,
      {
        userId: actor.userId,
        role: actor.role,
        kind: "admin",
        ip: actor.ip,
        requestId: actor.requestId,
      },
      "support.viewed",
      { type: "user", id: userId },
      null,
      { view: "inbox" },
    );
  });
  const conversationRows = await db
    .select()
    .from(messages)
    .where(eq(messages.userId, userId))
    .orderBy(desc(messages.createdAt))
    .limit(100);
  return {
    userId,
    username: owner.username,
    messages: conversationRows.map((row) => ({
      id: row.id,
      conversationId: row.conversationId,
      direction: row.direction,
      status: row.status,
      body: openSeal(`messages.wire_body_enc.${row.id}`, row.wireBodyEnc) ?? "",
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

async function loadEvents(start: Date, end: Date): Promise<StatEvent[]> {
  const rows = await getDb()
    .select({
      createdAt: messages.createdAt,
      userId: messages.userId,
      simId: messages.simId,
      direction: messages.direction,
      status: messages.status,
      isRetest: messages.isRetest,
      segments: messages.segments,
      sentAt: messages.sentAt,
      deliveredAt: messages.deliveredAt,
      failureName: messages.failureName,
      holdReason: messages.holdReason,
      blockReason: messages.blockReason,
    })
    .from(messages)
    .where(
      and(
        gte(messages.createdAt, start),
        lt(messages.createdAt, end),
        eq(messages.isRetest, false),
      ),
    );
  return rows.map((row) => ({
    createdAt: row.createdAt,
    userId: row.userId,
    simId: row.simId,
    direction: row.direction,
    status: row.status,
    isRetest: row.isRetest,
    segments: row.segments,
    sentAt: row.sentAt,
    deliveredAt: row.deliveredAt,
    failureName: row.failureName,
    holdReason: row.holdReason,
    blockReason: row.blockReason,
  }));
}

async function loadFailures(
  from: string,
  to: string,
  timeZone: string,
  userId?: string,
  simId?: string,
): Promise<FailureHit[]> {
  const bounds = rangeBounds(from, to, timeZone);
  const rows = await getDb()
    .select({
      userId: messages.userId,
      simId: messages.simId,
      failureName: messages.failureName,
    })
    .from(messages)
    .where(
      and(
        ...present([
          gte(messages.createdAt, bounds.start),
          lt(messages.createdAt, bounds.end),
          eq(messages.isRetest, false),
          userId === undefined ? undefined : eq(messages.userId, userId),
          simId === undefined ? undefined : eq(messages.simId, simId),
        ]),
      ),
    );
  const hits: FailureHit[] = [];
  for (const row of rows) {
    if (row.failureName === null || row.failureName.length === 0) continue;
    hits.push({ userId: row.userId, simId: row.simId, name: row.failureName });
  }
  return hits;
}

async function userRows(rows: DailyStat[], failures: FailureHit[]): Promise<AnalyticsCsvRow[]> {
  const grouped = new Map<string, DailyStat>();
  for (const row of rows) {
    const bucket = grouped.get(row.userId) ?? emptyUser(row.userId);
    bucket.sent += row.sent;
    bucket.delivered += row.delivered;
    bucket.failed += row.failed;
    bucket.received += row.received;
    bucket.deliveryMsSum += row.deliveryMsSum;
    bucket.deliveryMsCount += row.deliveryMsCount;
    grouped.set(row.userId, bucket);
  }
  const names = await usernames([...grouped.keys()]);
  return [...grouped.values()].map((row) => ({
    id: row.userId,
    name: names.get(row.userId) ?? row.userId,
    sent: row.sent,
    delivered: row.delivered,
    failed: row.failed,
    received: row.received,
    deliveryRatio: deliveryRatio(row.delivered, row.sent),
    avgDeliverySec: averageDeliverySec(row.deliveryMsSum, row.deliveryMsCount),
    topFailure: topName(failures.filter((hit) => hit.userId === row.userId)),
  }));
}

async function simRows(rows: DailyStat[], failures: FailureHit[]): Promise<AnalyticsCsvRow[]> {
  const grouped = new Map<string, DailyStat>();
  for (const row of rows) {
    const bucket = grouped.get(row.simId) ?? emptyUser(row.simId);
    bucket.simId = row.simId;
    bucket.sent += row.sent;
    bucket.delivered += row.delivered;
    bucket.failed += row.failed;
    bucket.received += row.received;
    bucket.deliveryMsSum += row.deliveryMsSum;
    bucket.deliveryMsCount += row.deliveryMsCount;
    grouped.set(row.simId, bucket);
  }
  const labels = await simLabels([...grouped.keys()]);
  return [...grouped.values()].map((row) => ({
    id: row.simId,
    name: labels.get(row.simId) ?? row.simId,
    sent: row.sent,
    delivered: row.delivered,
    failed: row.failed,
    received: row.received,
    deliveryRatio: deliveryRatio(row.delivered, row.sent),
    avgDeliverySec: averageDeliverySec(row.deliveryMsSum, row.deliveryMsCount),
    topFailure: topName(failures.filter((hit) => hit.simId === row.simId)),
  }));
}

function topName(hits: FailureHit[]): string {
  return tallyFailures(hits.map((hit) => hit.name))[0]?.name ?? "";
}

function emptyUser(userId: string): DailyStat {
  return {
    day: "",
    userId,
    simId: "",
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

function statInsert(row: DailyStat) {
  return {
    day: row.day,
    userId: row.userId,
    simId: row.simId,
    sent: row.sent,
    delivered: row.delivered,
    failed: row.failed,
    received: row.received,
    blocked: row.blocked,
    segmentsOut: row.segmentsOut,
    optOuts: row.optOuts,
    deliveryMsSum: BigInt(row.deliveryMsSum),
    deliveryMsCount: row.deliveryMsCount,
    limitHolds: row.limitHolds,
  };
}

function statFromRow(row: typeof statsDaily.$inferSelect): DailyStat {
  return {
    day: row.day,
    userId: row.userId ?? "",
    simId: row.simId,
    sent: row.sent,
    delivered: row.delivered,
    failed: row.failed,
    received: row.received,
    blocked: row.blocked,
    segmentsOut: row.segmentsOut,
    optOuts: row.optOuts,
    deliveryMsSum: Number(row.deliveryMsSum),
    deliveryMsCount: row.deliveryMsCount,
    limitHolds: row.limitHolds,
  };
}

async function usernames(ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const rows = await getDb()
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(inArray(users.id, ids));
  for (const row of rows) names.set(row.id, row.username);
  return names;
}

async function simLabels(ids: string[]): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  if (ids.length === 0) return labels;
  const rows = await getDb().select().from(sims).where(inArray(sims.id, ids));
  for (const row of rows) {
    const phone = openSeal(`sims.phone_number_enc.${row.id}`, row.phoneNumberEnc);
    labels.set(row.id, phone ?? row.carrierName ?? row.id);
  }
  return labels;
}

async function readTimezone(): Promise<string> {
  const value = await rawSetting("default_timezone");
  return typeof value === "string" && value.length > 0 ? value : "Asia/Karachi";
}

async function rawSetting(key: string): Promise<unknown> {
  const rows = await getDb().select().from(settings).where(eq(settings.key, key)).limit(1);
  return rows[0]?.value;
}

function resolveRange(
  from: string | undefined,
  to: string | undefined,
  timeZone: string,
): { from: string; to: string } {
  const end = to === undefined || to.length === 0 ? zonedDay(new Date(), timeZone) : to;
  const start = from === undefined || from.length === 0 ? shiftDay(end, -6) : from;
  if (!DAY.test(start) || !DAY.test(end) || start > end) {
    throw new AppError(400, "invalid_body", SAFE_TEXT.invalid_body);
  }
  return { from: start, to: end };
}

function present(items: Array<SQL | undefined>): SQL[] {
  const kept: SQL[] = [];
  for (const item of items) if (item !== undefined) kept.push(item);
  return kept;
}

function blank(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined;
  return value;
}

function resolveGranularity(value: string | undefined): "day" | "week" | "month" {
  if (value === "week" || value === "month") return value;
  return "day";
}
