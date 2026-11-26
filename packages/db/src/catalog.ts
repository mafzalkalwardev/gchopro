import {
  AppError,
  SAFE_TEXT,
  countSegments,
  type PolicyBody,
  type TemplateBody,
} from "@gchopro/core";
import { and, eq, gte, isNull, or } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { appendAudit, type Actor } from "./audit.js";
import { getDb } from "./client.js";
import type { AdminActor } from "./device-shared.js";
import { killSwitchOn, readHealth } from "./device-shared.js";
import { requireReady } from "./login.js";
import { alerts, devices, messages, rateLimitPolicies, sims, templates, users } from "./schema.js";

function reject(status: number, code: "not_found" | "conflict" | "forbidden"): never {
  const message =
    code === "not_found"
      ? SAFE_TEXT.not_found
      : code === "conflict"
        ? SAFE_TEXT.conflict
        : SAFE_TEXT.forbidden;
  throw new AppError(status, code, message);
}

function isUnique(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error ? isUnique(error.cause) : false;
}

function actorOf(actor: AdminActor): Actor {
  return {
    userId: actor.userId,
    role: actor.role,
    kind: "admin",
    ip: actor.ip,
    requestId: actor.requestId,
  };
}

function variablesIn(body: string): string[] {
  const names = new Set<string>();
  for (const match of body.matchAll(/\{([a-z0-9_]+)\}/gu)) {
    if (match[1]) names.add(match[1]);
  }
  return [...names];
}

function templateView(row: typeof templates.$inferSelect, shared: boolean) {
  const counted = countSegments(row.body);
  return {
    id: row.id,
    name: row.name,
    body: row.body,
    kind: row.kind,
    variables: row.variables,
    shared,
    segments: counted.segments,
    encoding: counted.encoding,
  };
}

export async function listPortalTemplates(token: string | undefined) {
  const session = await requireReady(token, "portal");
  const rows = await getDb()
    .select()
    .from(templates)
    .where(or(eq(templates.ownerUserId, session.userId), isNull(templates.ownerUserId)));
  return { templates: rows.map((row) => templateView(row, row.ownerUserId === null)) };
}

export async function savePortalTemplate(
  token: string | undefined,
  input: TemplateBody & { id?: string },
) {
  const session = await requireReady(token, "portal");
  const id = input.id ?? uuidv7();
  const values = {
    name: input.name,
    body: input.body,
    kind: input.kind,
    variables: variablesIn(input.body),
  };
  if (input.id) {
    const owned = await getDb()
      .select()
      .from(templates)
      .where(and(eq(templates.id, id), eq(templates.ownerUserId, session.userId)))
      .limit(1);
    if (owned.length === 0) reject(404, "not_found");
    await getDb().update(templates).set(values).where(eq(templates.id, id));
  } else {
    try {
      await getDb()
        .insert(templates)
        .values({
          id,
          ownerUserId: session.userId,
          createdBy: session.userId,
          ...values,
        });
    } catch (error) {
      if (isUnique(error)) reject(409, "conflict");
      throw error;
    }
  }
  const rows = await getDb().select().from(templates).where(eq(templates.id, id)).limit(1);
  const row = rows[0];
  if (row === undefined) reject(404, "not_found");
  return templateView(row, false);
}

export async function deletePortalTemplate(token: string | undefined, id: string) {
  const session = await requireReady(token, "portal");
  const removed = await getDb()
    .delete(templates)
    .where(and(eq(templates.id, id), eq(templates.ownerUserId, session.userId)))
    .returning({ id: templates.id });
  if (removed.length === 0) reject(404, "not_found");
}

export async function listSharedTemplates(token: string | undefined) {
  await requireReady(token, "admin");
  const rows = await getDb().select().from(templates).where(isNull(templates.ownerUserId));
  return { templates: rows.map((row) => templateView(row, true)) };
}

export async function saveSharedTemplate(actor: AdminActor, input: TemplateBody & { id?: string }) {
  const id = input.id ?? uuidv7();
  const values = {
    name: input.name,
    body: input.body,
    kind: input.kind,
    variables: variablesIn(input.body),
  };
  if (input.id) {
    const rows = await getDb()
      .select()
      .from(templates)
      .where(and(eq(templates.id, id), isNull(templates.ownerUserId)))
      .limit(1);
    if (rows.length === 0) reject(404, "not_found");
    await getDb().update(templates).set(values).where(eq(templates.id, id));
  } else {
    try {
      await getDb()
        .insert(templates)
        .values({ id, ownerUserId: null, createdBy: actor.userId, ...values });
    } catch (error) {
      if (isUnique(error)) reject(409, "conflict");
      throw error;
    }
  }
  const rows = await getDb().select().from(templates).where(eq(templates.id, id)).limit(1);
  const row = rows[0];
  if (row === undefined) reject(404, "not_found");
  return templateView(row, true);
}

export async function deleteSharedTemplate(actor: AdminActor, id: string) {
  const removed = await getDb()
    .delete(templates)
    .where(and(eq(templates.id, id), isNull(templates.ownerUserId)))
    .returning({ id: templates.id });
  if (removed.length === 0) reject(404, "not_found");
  await getDb().transaction(async (tx) => {
    await appendAudit(tx, actorOf(actor), "template.deleted", { type: "template", id }, null, null);
  });
}

function policyView(row: typeof rateLimitPolicies.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.isDefault,
    gapBaseSeconds: row.gapBaseSeconds,
    gapJitterSeconds: row.gapJitterSeconds,
    perMinute: row.perMinute,
    perHour: row.perHour,
    perDay: row.perDay,
    segmentsPerDay: row.segmentsPerDay,
    maxGroupRecipients: row.maxGroupRecipients,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    windowDays: row.windowDays,
    windowTimezoneMode: row.windowTimezoneMode,
    windowTimezone: row.windowTimezone,
    overLimitAction: row.overLimitAction,
  };
}

export async function listPolicyRows() {
  const rows = await getDb().select().from(rateLimitPolicies);
  return rows.map(policyView);
}

export async function savePolicy(actor: AdminActor, input: PolicyBody & { id?: string }) {
  const id = input.id ?? uuidv7();
  const values = {
    name: input.name,
    gapBaseSeconds: input.gapBaseSeconds,
    gapJitterSeconds: input.gapJitterSeconds,
    perMinute: input.perMinute,
    perHour: input.perHour,
    perDay: input.perDay,
    segmentsPerDay: input.segmentsPerDay,
    maxGroupRecipients: input.maxGroupRecipients,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    windowDays: input.windowDays,
    windowTimezoneMode: input.windowTimezoneMode,
    windowTimezone: input.windowTimezone ?? null,
    overLimitAction: input.overLimitAction,
    updatedBy: actor.userId,
  };
  try {
    if (input.id) {
      const existing = await getDb()
        .select()
        .from(rateLimitPolicies)
        .where(eq(rateLimitPolicies.id, id))
        .limit(1);
      if (existing.length === 0) reject(404, "not_found");
      await getDb().update(rateLimitPolicies).set(values).where(eq(rateLimitPolicies.id, id));
    } else {
      await getDb()
        .insert(rateLimitPolicies)
        .values({ id, isDefault: false, ...values });
    }
  } catch (error) {
    if (isUnique(error)) reject(409, "conflict");
    throw error;
  }
  await getDb().transaction(async (tx) => {
    await appendAudit(tx, actorOf(actor), "policy.saved", { type: "policy", id }, null, {
      name: input.name,
    });
  });
  const rows = await getDb()
    .select()
    .from(rateLimitPolicies)
    .where(eq(rateLimitPolicies.id, id))
    .limit(1);
  const row = rows[0];
  if (row === undefined) reject(404, "not_found");
  return policyView(row);
}

export async function deletePolicy(actor: AdminActor, id: string) {
  const rows = await getDb()
    .select()
    .from(rateLimitPolicies)
    .where(eq(rateLimitPolicies.id, id))
    .limit(1);
  const row = rows[0];
  if (row === undefined) reject(404, "not_found");
  if (row.isDefault) reject(409, "conflict");
  const usedByUser = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.rateLimitPolicyId, id))
    .limit(1);
  const usedBySim = await getDb()
    .select({ id: sims.id })
    .from(sims)
    .where(eq(sims.rateLimitPolicyId, id))
    .limit(1);
  if (usedByUser.length > 0 || usedBySim.length > 0) reject(409, "conflict");
  await getDb().delete(rateLimitPolicies).where(eq(rateLimitPolicies.id, id));
  await getDb().transaction(async (tx) => {
    await appendAudit(
      tx,
      actorOf(actor),
      "policy.deleted",
      { type: "policy", id },
      { name: row.name },
      null,
    );
  });
}

export async function dashboard() {
  const db = getDb();
  const health = await readHealth(db);
  const now = Date.now();
  const deviceRows = await db.select().from(devices).where(isNull(devices.retiredAt));
  let devicesOnline = 0;
  let devicesOffline = 0;
  for (const device of deviceRows) {
    const fresh =
      device.status === "active" &&
      device.lastHeartbeatAt !== null &&
      now - device.lastHeartbeatAt.getTime() <= health.offline_after_seconds * 1000;
    if (fresh) devicesOnline += 1;
    else devicesOffline += 1;
  }
  const simRows = await db.select({ health: sims.health }).from(sims).where(isNull(sims.retiredAt));
  const simHealth = new Map<string, number>();
  for (const row of simRows) simHealth.set(row.health, (simHealth.get(row.health) ?? 0) + 1);
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "user"), eq(users.status, "active"), isNull(users.deletedAt)));
  const queued = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.status, "queued"));
  const held = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.status, "held"));
  const openAlerts = await db.select().from(alerts).where(isNull(alerts.resolvedAt)).limit(8);
  const since = new Date(now - 24 * 60 * 60 * 1000);
  const recent = await db
    .select({ at: messages.createdAt })
    .from(messages)
    .where(gte(messages.createdAt, since));
  const hours = new Map<number, number>();
  for (let hour = 0; hour < 24; hour += 1) hours.set(hour, 0);
  for (const row of recent) {
    const bucket = Math.min(23, Math.max(0, Math.floor((now - row.at.getTime()) / 3_600_000)));
    hours.set(23 - bucket, (hours.get(23 - bucket) ?? 0) + 1);
  }
  const traffic = [...hours.entries()].map(([hour, count]) => ({ hour, count }));
  return {
    devicesOnline,
    devicesOffline,
    sims: [...simHealth.entries()].map(([healthName, count]) => ({ health: healthName, count })),
    usersActive: userRows.length,
    queue: { queued: queued.length, held: held.length },
    killSwitch: await killSwitchOn(db),
    alerts: openAlerts.map((alert) => ({
      id: alert.id,
      type: alert.type,
      severity: alert.severity,
      title: alert.title,
      createdAt: alert.createdAt.toISOString(),
    })),
    traffic,
  };
}
