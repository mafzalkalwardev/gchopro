import {
  AppError,
  SAFE_TEXT,
  applySignature,
  contentBlocked,
  countSegments,
  csvLine,
  effectiveStatus,
  evaluateGate,
  gapSeconds,
  isTooLong,
  renderTemplate,
  retryPlan,
  sendingBlocked,
  settingSchemas,
  stricterPolicy,
  windowState,
  type CapCounts,
  type CapLimits,
  type GateDecision,
  type GroupSendBody,
  type PolicyNumbers,
  type SegmentCount,
  type SendBody,
} from "@gchopro/core";
import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, ne } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { commitCaps, readCaps } from "./caps.js";
import { getDb } from "./client.js";
import {
  indexPhone,
  killSwitchOn,
  normalizePhone,
  openSeal,
  readHealth,
  readOptOutScope,
  readRegion,
  seal,
} from "./device-shared.js";
import { requireReady } from "./login.js";
import { publishUser } from "./redis.js";
import {
  alerts,
  contactGroupMembers,
  contactGroups,
  contacts,
  conversations,
  devices,
  groupSends,
  messages,
  optOuts,
  rateLimitPolicies,
  settings,
  sims,
  subscriptions,
  templates,
  users,
} from "./schema.js";
import type { SessionRecord } from "./sessions.js";

const FALLBACK: PolicyNumbers = {
  gapBaseSeconds: 15,
  gapJitterSeconds: 5,
  perMinute: 3,
  perHour: 50,
  perDay: 300,
  segmentsPerDay: 400,
  maxGroupRecipients: 50,
  windowStart: "09:00:00",
  windowEnd: "20:00:00",
  windowDays: [1, 2, 3, 4, 5, 6, 7],
  overLimitAction: "hold",
};

const LEASE_MS = 120_000;
type PolicyRow = typeof rateLimitPolicies.$inferSelect;
type MessageRow = typeof messages.$inferSelect;

export type MessageView = {
  id: string;
  conversationId: string;
  direction: string;
  status: string;
  holdReason: string | null;
  blockReason: string | null;
  failureName: string | null;
  segments: number | null;
  encoding: string | null;
  body: string;
  scheduledFor: string | null;
  attempts: number;
  simId: string;
  createdAt: string;
};

function reject(status: number, code: keyof typeof SAFE_TEXT): never {
  throw new AppError(status, code, safeMessage(code));
}

function safeMessage(code: keyof typeof SAFE_TEXT): string {
  if (code === "too_long") return SAFE_TEXT.too_long;
  if (code === "opted_out") return SAFE_TEXT.opted_out;
  if (code === "outside_window") return SAFE_TEXT.outside_window;
  if (code === "limit_reached") return SAFE_TEXT.limit_reached;
  if (code === "line_unavailable") return SAFE_TEXT.line_unavailable;
  if (code === "kill_switch") return SAFE_TEXT.kill_switch;
  if (code === "missing_variables") return SAFE_TEXT.missing_variables;
  if (code === "user_disabled") return SAFE_TEXT.user_disabled;
  if (code === "subscription_inactive") return SAFE_TEXT.subscription_inactive;
  if (code === "not_found") return SAFE_TEXT.not_found;
  if (code === "forbidden") return SAFE_TEXT.forbidden;
  if (code === "conflict") return SAFE_TEXT.conflict;
  return SAFE_TEXT.invalid_body;
}

function isUnique(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error ? isUnique(error.cause) : false;
}

function viewOf(row: MessageRow): MessageView {
  return {
    id: row.id,
    conversationId: row.conversationId,
    direction: row.direction,
    status: row.status,
    holdReason: row.holdReason,
    blockReason: row.blockReason,
    failureName: row.failureName,
    segments: row.segments,
    encoding: row.encoding,
    body: openSeal(`messages.wire_body_enc.${row.id}`, row.wireBodyEnc) ?? "",
    scheduledFor: row.scheduledFor?.toISOString() ?? null,
    attempts: row.attempts,
    simId: row.simId,
    createdAt: row.createdAt.toISOString(),
  };
}

function asPolicy(row: PolicyRow | null): PolicyNumbers {
  if (row === null) return FALLBACK;
  return {
    gapBaseSeconds: row.gapBaseSeconds,
    gapJitterSeconds: row.gapJitterSeconds,
    perMinute: row.perMinute,
    perHour: row.perHour,
    perDay: row.perDay,
    segmentsPerDay: row.segmentsPerDay,
    maxGroupRecipients: row.maxGroupRecipients,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    windowDays: [...row.windowDays],
    overLimitAction: row.overLimitAction,
  };
}

function limitsOf(policy: PolicyNumbers): CapLimits {
  return {
    perMinute: policy.perMinute,
    perHour: policy.perHour,
    perDay: policy.perDay,
    segmentsPerDay: policy.segmentsPerDay,
  };
}

function releaseMs(counts: CapCounts, limits: CapLimits): number {
  if (counts.minute >= limits.perMinute) return 60_000;
  if (counts.hour >= limits.perHour) return 3_600_000;
  return 86_400_000;
}

function overLimit(counts: CapCounts, limits: CapLimits, segments: number): boolean {
  return (
    counts.minute >= limits.perMinute ||
    counts.hour >= limits.perHour ||
    counts.day >= limits.perDay ||
    counts.segments + segments > limits.segmentsPerDay
  );
}

async function sender(token: string | undefined): Promise<SessionRecord> {
  const session = await requireReady(token, "portal");
  if (sendingBlocked(session)) {
    if (session.userStatus === "disabled") reject(403, "user_disabled");
    reject(403, "subscription_inactive");
  }
  return session;
}

async function policyRow(id: string | null): Promise<PolicyRow | null> {
  const db = getDb();
  if (id === null) {
    const rows = await db
      .select()
      .from(rateLimitPolicies)
      .where(eq(rateLimitPolicies.isDefault, true))
      .limit(1);
    return rows[0] ?? null;
  }
  const rows = await db
    .select()
    .from(rateLimitPolicies)
    .where(eq(rateLimitPolicies.id, id))
    .limit(1);
  return rows[0] ?? null;
}

async function rawSetting(key: string): Promise<unknown> {
  const rows = await getDb().select().from(settings).where(eq(settings.key, key)).limit(1);
  return rows[0]?.value;
}

async function optedOut(hash: string, userId: string): Promise<boolean> {
  const db = getDb();
  const scope = await readOptOutScope(db);
  const filters = [
    eq(optOuts.numberHash, hash),
    eq(optOuts.scope, scope),
    isNull(optOuts.reversedAt),
  ];
  if (scope === "user") filters.push(eq(optOuts.userId, userId));
  const rows = await db
    .select({ id: optOuts.id })
    .from(optOuts)
    .where(and(...filters))
    .limit(1);
  return rows.length > 0;
}

async function lineOf(userId: string) {
  const db = getDb();
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = userRows[0];
  if (user === undefined || user.simId === null) reject(422, "line_unavailable");
  const simRows = await db.select().from(sims).where(eq(sims.id, user.simId)).limit(1);
  const sim = simRows[0];
  if (sim === undefined || sim.retiredAt !== null) reject(422, "line_unavailable");
  const deviceRows = await db.select().from(devices).where(eq(devices.id, sim.deviceId)).limit(1);
  const device = deviceRows[0];
  if (device === undefined) reject(422, "line_unavailable");
  return { user, sim, device };
}

async function composeText(
  userId: string,
  input: { body: string; templateId?: string; variables?: Record<string, string> },
) {
  let source = input.body;
  let templateId: string | null = null;
  if (input.templateId) {
    const rows = await getDb()
      .select()
      .from(templates)
      .where(eq(templates.id, input.templateId))
      .limit(1);
    const template = rows[0];
    if (
      template === undefined ||
      (template.ownerUserId !== null && template.ownerUserId !== userId)
    ) {
      reject(404, "not_found");
    }
    source = template.body;
    templateId = template.id;
  }
  const rendered = renderTemplate(source, input.variables ?? {});
  if (!rendered.ok) reject(422, "missing_variables");
  const signature = settingSchemas.sender_signature.safeParse(await rawSetting("sender_signature"));
  const text = applySignature(
    rendered.text,
    signature.success ? signature.data : { enabled: false, text: "" },
  );
  const counted = countSegments(text);
  if (isTooLong(counted)) reject(422, "too_long");
  return { text, counted, templateId };
}

async function existingSend(userId: string, key: string | undefined): Promise<MessageView | null> {
  if (key === undefined) return null;
  const rows = await getDb()
    .select()
    .from(messages)
    .where(eq(messages.idempotencyKey, key))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  if (row.userId !== userId) reject(409, "conflict");
  return viewOf(row);
}

function previewFrom(message: MessageView) {
  return {
    text: message.body,
    segments: message.segments ?? 1,
    encoding: message.encoding ?? "gsm7",
  };
}

export async function previewMessage(
  token: string | undefined,
  input: { body: string; templateId?: string; variables?: Record<string, string> },
) {
  const session = await sender(token);
  const prepared = await composeText(session.userId, input);
  return {
    text: prepared.text,
    segments: prepared.counted.segments,
    encoding: prepared.counted.encoding,
  };
}

export async function sendMessage(token: string | undefined, input: SendBody) {
  const session = await sender(token);
  const prior = await existingSend(session.userId, input.idempotencyKey);
  if (prior)
    return { message: prior, conversationId: prior.conversationId, preview: previewFrom(prior) };
  if (await killSwitchOn(getDb())) reject(422, "kill_switch");
  const { user, sim, device } = await lineOf(session.userId);
  if (!sim.activeOnDevice || sim.health !== "active" || sim.pausedByAdmin)
    reject(422, "line_unavailable");
  const prepared = await composeText(session.userId, input);
  const peer = normalizePhone(input.to, await readRegion(getDb()));
  const hash = indexPhone(peer);
  if (await optedOut(hash, user.id)) reject(422, "opted_out");
  const policy = asPolicy(await policyRow(user.rateLimitPolicyId));
  const window = windowState(new Date(), {
    start: policy.windowStart,
    end: policy.windowEnd,
    days: policy.windowDays,
    timeZone: await windowZone(user.timezone, user.rateLimitPolicyId),
  });
  if (!window.open && policy.overLimitAction === "reject") reject(422, "outside_window");
  const counts = await readCaps("u", user.id);
  if (
    overLimit(counts, limitsOf(policy), prepared.counted.segments) &&
    policy.overLimitAction === "reject"
  ) {
    reject(422, "limit_reached");
  }
  const rules = settingSchemas.content_rules.safeParse(await rawSetting("content_rules"));
  const blocked = contentBlocked(prepared.text, {
    blockedKeywords: rules.success ? rules.data.blocked_keywords : [],
    blockUrls: rules.success ? rules.data.block_urls : false,
  });
  const when = input.scheduledFor === undefined ? null : new Date(input.scheduledFor);
  const scheduled = when !== null && when.getTime() > Date.now();
  const messageId = uuidv7();
  const conversationId = await placeMessage({
    messageId,
    userId: user.id,
    simId: sim.id,
    deviceId: device.id,
    peer,
    hash,
    text: prepared.text,
    counted: prepared.counted,
    templateId: prepared.templateId,
    scheduledFor: scheduled ? when : null,
    status: blocked ? "blocked" : scheduled ? "scheduled" : "queued",
    blockReason: blocked ? "content_rule" : null,
    idempotencyKey: input.idempotencyKey ?? null,
    groupSendId: null,
  });
  const row = await loadMessage(messageId);
  return {
    message: viewOf(row),
    conversationId,
    preview: {
      text: prepared.text,
      segments: prepared.counted.segments,
      encoding: prepared.counted.encoding,
    },
  };
}

async function windowZone(userZone: string, policyId: string | null): Promise<string> {
  const row = await policyRow(policyId);
  if (row?.windowTimezoneMode === "fixed" && row.windowTimezone) return row.windowTimezone;
  return userZone;
}

async function placeMessage(input: {
  messageId: string;
  userId: string;
  simId: string;
  deviceId: string;
  peer: string;
  hash: string;
  text: string;
  counted: SegmentCount;
  templateId: string | null;
  scheduledFor: Date | null;
  status: "queued" | "scheduled" | "blocked";
  blockReason: "content_rule" | "opted_out" | null;
  idempotencyKey: string | null;
  groupSendId: string | null;
}): Promise<string> {
  const now = new Date();
  try {
    return await getDb().transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(conversations)
        .where(
          and(eq(conversations.userId, input.userId), eq(conversations.peerNumberHash, input.hash)),
        )
        .limit(1);
      const conversation = existing[0];
      const conversationId = conversation?.id ?? uuidv7();
      const preview = input.text.slice(0, 80);
      if (conversation === undefined) {
        await tx.insert(conversations).values({
          id: conversationId,
          userId: input.userId,
          simId: input.simId,
          peerNumberEnc: seal(`conversations.peer_number_enc.${conversationId}`, input.peer),
          peerNumberHash: input.hash,
          lastMessageAt: now,
          lastPreviewEnc: seal(`conversations.last_preview_enc.${conversationId}`, preview),
        });
      } else {
        await tx
          .update(conversations)
          .set({
            lastMessageAt: now,
            lastPreviewEnc: seal(`conversations.last_preview_enc.${conversationId}`, preview),
          })
          .where(eq(conversations.id, conversationId));
      }
      await tx.insert(messages).values({
        id: input.messageId,
        conversationId,
        userId: input.userId,
        simId: input.simId,
        deviceId: input.deviceId,
        direction: "out",
        peerNumberHash: input.hash,
        wireBodyEnc: seal(`messages.wire_body_enc.${input.messageId}`, input.text),
        encoding: input.counted.encoding,
        segments: input.counted.segments,
        status: input.status,
        blockReason: input.blockReason,
        templateId: input.templateId,
        scheduledFor: input.scheduledFor,
        queuedAt: input.status === "queued" ? now : null,
        idempotencyKey: input.idempotencyKey,
        groupSendId: input.groupSendId,
      });
      return conversationId;
    });
  } catch (error) {
    if (isUnique(error) && input.idempotencyKey) {
      const prior = await existingSend(input.userId, input.idempotencyKey);
      if (prior) return prior.conversationId;
    }
    throw error;
  }
}

async function loadMessage(id: string): Promise<MessageRow> {
  const rows = await getDb().select().from(messages).where(eq(messages.id, id)).limit(1);
  const row = rows[0];
  if (row === undefined) reject(404, "not_found");
  return row;
}

async function groupNumbers(userId: string, input: GroupSendBody): Promise<string[]> {
  const listed = input.recipients ?? [];
  if (input.groupId === undefined) return listed;
  const owned = await getDb()
    .select({ id: contactGroups.id })
    .from(contactGroups)
    .where(and(eq(contactGroups.id, input.groupId), eq(contactGroups.userId, userId)))
    .limit(1);
  if (owned.length === 0) reject(404, "not_found");
  const members = await getDb()
    .select({ number: contacts.numberEnc, id: contacts.id })
    .from(contactGroupMembers)
    .innerJoin(contacts, eq(contacts.id, contactGroupMembers.contactId))
    .where(eq(contactGroupMembers.groupId, input.groupId));
  const stored = members
    .map((member) => openSeal(`contacts.number_enc.${member.id}`, member.number) ?? "")
    .filter((number) => number.length > 0);
  return [...listed, ...stored];
}

function tally(rows: { status: string }[]) {
  const counts = {
    queued: 0,
    held: 0,
    dispatched: 0,
    sent: 0,
    delivered: 0,
    failed: 0,
    blocked: 0,
    cancelled: 0,
    scheduled: 0,
    received: 0,
  };
  for (const row of rows) {
    if (row.status === "queued") counts.queued += 1;
    else if (row.status === "held") counts.held += 1;
    else if (row.status === "dispatched") counts.dispatched += 1;
    else if (row.status === "sent") counts.sent += 1;
    else if (row.status === "delivered") counts.delivered += 1;
    else if (row.status === "failed") counts.failed += 1;
    else if (row.status === "blocked") counts.blocked += 1;
    else if (row.status === "cancelled") counts.cancelled += 1;
    else if (row.status === "scheduled") counts.scheduled += 1;
    else if (row.status === "received") counts.received += 1;
  }
  return counts;
}

export async function sendGroup(token: string | undefined, input: GroupSendBody) {
  const session = await sender(token);
  const prior = await existingSend(session.userId, input.idempotencyKey);
  if (prior) {
    const groupId = (await loadMessage(prior.id)).groupSendId;
    if (groupId) return groupProgress(token, groupId);
  }
  if (await killSwitchOn(getDb())) reject(422, "kill_switch");
  const { user, sim, device } = await lineOf(session.userId);
  if (!sim.activeOnDevice || sim.health !== "active" || sim.pausedByAdmin)
    reject(422, "line_unavailable");
  const prepared = await composeText(session.userId, input);
  const policy = asPolicy(await policyRow(user.rateLimitPolicyId));
  const unique = [...new Set(await groupNumbers(session.userId, input))];
  if (unique.length > policy.maxGroupRecipients) reject(422, "limit_reached");
  const region = await readRegion(getDb());
  const when = input.scheduledFor === undefined ? null : new Date(input.scheduledFor);
  const scheduled = when !== null && when.getTime() > Date.now();
  const groupId = uuidv7();
  let blockedCount = 0;
  let first = true;
  await getDb()
    .insert(groupSends)
    .values({
      id: groupId,
      userId: user.id,
      name: input.name ?? null,
      bodyTemplateEnc: seal(`group_sends.body_template_enc.${groupId}`, prepared.text),
      recipientCount: unique.length,
      blockedCount: 0,
      status: "queued",
    });
  for (const raw of unique) {
    const peer = normalizePhone(raw, region);
    const hash = indexPhone(peer);
    const blocked = await optedOut(hash, user.id);
    if (blocked) blockedCount += 1;
    await placeMessage({
      messageId: uuidv7(),
      userId: user.id,
      simId: sim.id,
      deviceId: device.id,
      peer,
      hash,
      text: prepared.text,
      counted: prepared.counted,
      templateId: prepared.templateId,
      scheduledFor: scheduled ? when : null,
      status: blocked ? "blocked" : scheduled ? "scheduled" : "queued",
      blockReason: blocked ? "opted_out" : null,
      idempotencyKey: first ? (input.idempotencyKey ?? null) : null,
      groupSendId: groupId,
    });
    first = false;
  }
  await getDb().update(groupSends).set({ blockedCount }).where(eq(groupSends.id, groupId));
  return groupProgress(token, groupId);
}

export async function groupProgress(token: string | undefined, id: string) {
  const session = await requireReady(token, "portal");
  const groups = await getDb().select().from(groupSends).where(eq(groupSends.id, id)).limit(1);
  const group = groups[0];
  if (group === undefined || group.userId !== session.userId) reject(404, "not_found");
  const rows = await getDb().select().from(messages).where(eq(messages.groupSendId, id));
  return {
    id: group.id,
    name: group.name,
    recipientCount: group.recipientCount,
    blockedCount: rows.filter((row) => row.status === "blocked").length,
    counts: tally(rows),
    messages: rows.map(viewOf),
  };
}

export async function cancelGroup(token: string | undefined, id: string) {
  const session = await requireReady(token, "portal");
  const groups = await getDb().select().from(groupSends).where(eq(groupSends.id, id)).limit(1);
  const group = groups[0];
  if (group === undefined || group.userId !== session.userId) reject(404, "not_found");
  await getDb()
    .update(messages)
    .set({ status: "cancelled" })
    .where(
      and(eq(messages.groupSendId, id), inArray(messages.status, ["queued", "scheduled", "held"])),
    );
  await getDb().update(groupSends).set({ status: "cancelled" }).where(eq(groupSends.id, id));
  return groupProgress(token, id);
}

export async function cancelMessage(token: string | undefined, id: string) {
  const session = await requireReady(token, "portal");
  const row = await loadMessage(id);
  if (row.userId !== session.userId) reject(404, "not_found");
  if (row.status !== "queued" && row.status !== "scheduled" && row.status !== "held")
    reject(409, "conflict");
  await getDb().update(messages).set({ status: "cancelled" }).where(eq(messages.id, id));
  return viewOf(await loadMessage(id));
}

export async function listConversations(
  token: string | undefined,
  query: { q?: string; filter?: string; tag?: string; cursor?: string },
) {
  const session = await requireReady(token, "portal");
  const filters = [eq(conversations.userId, session.userId)];
  if (query.filter === "archived") filters.push(eq(conversations.archived, true));
  else filters.push(eq(conversations.archived, false));
  if (query.filter === "unread") filters.push(gt(conversations.unreadCount, 0));
  if (query.cursor) filters.push(lt(conversations.lastMessageAt, new Date(query.cursor)));
  const rows = await getDb()
    .select()
    .from(conversations)
    .where(and(...filters))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(50);
  let chosen = rows;
  if (query.filter === "failed") {
    const failed = await getDb()
      .select({ id: messages.conversationId })
      .from(messages)
      .where(and(eq(messages.userId, session.userId), eq(messages.status, "failed")));
    const ids = new Set(failed.map((row) => row.id));
    chosen = rows.filter((row) => ids.has(row.id));
  }
  const tag = query.tag ?? "";
  if (tag.length > 0) chosen = chosen.filter((row) => row.tags.includes(tag));
  const needle = query.q?.trim().toLowerCase() ?? "";
  const items = chosen
    .map((row) => ({
      id: row.id,
      peer: openSeal(`conversations.peer_number_enc.${row.id}`, row.peerNumberEnc) ?? "",
      preview: openSeal(`conversations.last_preview_enc.${row.id}`, row.lastPreviewEnc) ?? "",
      unread: row.unreadCount,
      archived: row.archived,
      tags: row.tags,
      lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    }))
    .filter(
      (row) => needle.length === 0 || `${row.peer} ${row.preview}`.toLowerCase().includes(needle),
    );
  return { conversations: items };
}

export async function listThread(token: string | undefined, id: string) {
  const session = await requireReady(token, "portal");
  const rows = await getDb().select().from(conversations).where(eq(conversations.id, id)).limit(1);
  const conversation = rows[0];
  if (conversation === undefined || conversation.userId !== session.userId)
    reject(404, "not_found");
  const thread = await getDb()
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt));
  return {
    id,
    peer: openSeal(`conversations.peer_number_enc.${id}`, conversation.peerNumberEnc) ?? "",
    archived: conversation.archived,
    tags: conversation.tags,
    optedOut: await optedOut(conversation.peerNumberHash, session.userId),
    messages: thread.map(viewOf),
  };
}

export async function markRead(token: string | undefined, id: string) {
  const session = await requireReady(token, "portal");
  const updated = await getDb()
    .update(conversations)
    .set({ unreadCount: 0 })
    .where(and(eq(conversations.id, id), eq(conversations.userId, session.userId)))
    .returning({ id: conversations.id });
  if (updated.length === 0) reject(404, "not_found");
}

export async function patchConversation(
  token: string | undefined,
  id: string,
  input: { archived?: boolean; tags?: string[] },
) {
  const session = await requireReady(token, "portal");
  const patch: { archived?: boolean; tags?: string[] } = {};
  if (input.archived !== undefined) patch.archived = input.archived;
  if (input.tags !== undefined) patch.tags = input.tags;
  const updated = await getDb()
    .update(conversations)
    .set(patch)
    .where(and(eq(conversations.id, id), eq(conversations.userId, session.userId)))
    .returning({ id: conversations.id });
  if (updated.length === 0) reject(404, "not_found");
  return listThread(token, id);
}

export async function listScheduled(token: string | undefined) {
  const session = await requireReady(token, "portal");
  const rows = await getDb()
    .select()
    .from(messages)
    .where(and(eq(messages.userId, session.userId), eq(messages.status, "scheduled")))
    .orderBy(asc(messages.scheduledFor));
  return { messages: rows.map(viewOf) };
}

export async function exportMessages(token: string | undefined): Promise<string> {
  const session = await requireReady(token, "portal");
  const userRows = await getDb().select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (userRows[0]?.allowExport !== true) reject(403, "forbidden");
  const rows = await getDb()
    .select()
    .from(messages)
    .where(eq(messages.userId, session.userId))
    .orderBy(desc(messages.createdAt))
    .limit(1000);
  const lines = [csvLine(["id", "direction", "status", "body", "created_at"])];
  for (const row of rows) {
    const view = viewOf(row);
    lines.push(csvLine([view.id, view.direction, view.status, view.body, view.createdAt]));
  }
  return `${lines.join("\n")}\n`;
}

function rank(decision: GateDecision): number {
  if (decision.kind === "block") return 0;
  if (decision.kind === "fail") return 1;
  if (decision.kind === "hold") return 2;
  if (decision.kind === "wait") return 3;
  return 4;
}

function holdFrom(reason: string): "rate_minute" | "rate_hour" | "rate_day" | "rate_segments" {
  if (reason === "rate_hour" || reason === "rate_day" || reason === "rate_segments") return reason;
  return "rate_minute";
}

export async function processSend(
  messageId: string,
  options: { now?: Date; random?: number } = {},
): Promise<GateDecision | { kind: "skip" }> {
  const now = options.now ?? new Date();
  const random = options.random ?? Math.random();
  const message = await loadMessage(messageId);
  if (
    message.status === "sent" ||
    message.status === "delivered" ||
    message.status === "failed" ||
    message.status === "blocked" ||
    message.status === "cancelled" ||
    message.status === "received" ||
    message.status === "dispatched"
  ) {
    return { kind: "skip" };
  }
  if (
    message.status === "scheduled" &&
    message.scheduledFor &&
    message.scheduledFor.getTime() > now.getTime()
  ) {
    return { kind: "wait", delayMs: message.scheduledFor.getTime() - now.getTime() };
  }
  const db = getDb();
  const userRows = await db.select().from(users).where(eq(users.id, message.userId)).limit(1);
  const user = userRows[0];
  const simRows = await db.select().from(sims).where(eq(sims.id, message.simId)).limit(1);
  const sim = simRows[0];
  const device =
    sim === undefined
      ? undefined
      : (await db.select().from(devices).where(eq(devices.id, sim.deviceId)).limit(1))[0];
  if (user === undefined || sim === undefined || device === undefined) {
    await db
      .update(messages)
      .set({ status: "blocked", blockReason: "no_sim" })
      .where(eq(messages.id, message.id));
    return { kind: "block", reason: "no_sim" };
  }
  const userPolicy = asPolicy(await policyRow(user.rateLimitPolicyId));
  const simRow = sim.rateLimitPolicyId ? await policyRow(sim.rateLimitPolicyId) : null;
  const policy = stricterPolicy(userPolicy, simRow ? asPolicy(simRow) : null);
  const subs = await db.select().from(subscriptions).where(eq(subscriptions.userId, user.id));
  const subscription =
    subs.find(
      (row) => row.status === "active" || row.status === "paused" || row.status === "scheduled",
    ) ?? subs[0];
  const subscriptionStatus = subscription
    ? effectiveStatus({
        status: subscription.status,
        startsAt: subscription.startsAt,
        endsAt: subscription.endsAt,
        now,
      })
    : "expired";
  const health = await readHealth(db);
  const online =
    device.lastHeartbeatAt !== null &&
    now.getTime() - device.lastHeartbeatAt.getTime() <= health.offline_after_seconds * 1000;
  const floorParsed = settingSchemas.min_gap_floor_seconds.safeParse(
    await rawSetting("min_gap_floor_seconds"),
  );
  const floor = floorParsed.success ? floorParsed.data : 5;
  const window = windowState(now, {
    start: policy.windowStart,
    end: policy.windowEnd,
    days: policy.windowDays,
    timeZone: await windowZone(user.timezone, user.rateLimitPolicyId),
  });
  const rules = settingSchemas.content_rules.safeParse(await rawSetting("content_rules"));
  const body = openSeal(`messages.wire_body_enc.${message.id}`, message.wireBodyEnc) ?? "";
  const translation = settingSchemas.translation.safeParse(await rawSetting("translation"));
  const translationRequired =
    !message.isRetest &&
    user.translationEnabled &&
    translation.success &&
    translation.data.provider !== "none";
  const counts = message.isRetest
    ? { minute: 0, hour: 0, day: 0, segments: 0 }
    : await readCaps("u", user.id, now.getTime());
  const limits = message.isRetest
    ? { perMinute: 1_000_000, perHour: 1_000_000, perDay: 1_000_000, segmentsPerDay: 1_000_000 }
    : limitsOf(policy);
  let decision = evaluateGate({
    now,
    killSwitch: await killSwitchOn(db),
    devicePaused: device.paused,
    simPaused: sim.pausedByAdmin,
    simAssignable: sim.health === "active" && sim.activeOnDevice && device.status === "active",
    userActive: message.isRetest || (user.status === "active" && user.deletedAt === null),
    subscriptionActive: message.isRetest || subscriptionStatus === "active",
    optedOut:
      message.isRetest || message.isOptOutConfirmation
        ? false
        : await optedOut(message.peerNumberHash, user.id),
    contentBlocked: message.isRetest
      ? false
      : contentBlocked(body, {
          blockedKeywords: rules.success ? rules.data.blocked_keywords : [],
          blockUrls: rules.success ? rules.data.block_urls : false,
        }),
    windowOpen: message.isRetest || window.open,
    nextWindowAt: window.nextOpen,
    windowJitterMs: Math.floor(random * 60_000),
    counts,
    limits,
    overLimitAction: policy.overLimitAction,
    capReleaseMs: releaseMs(counts, limits),
    nextSendAt: sim.nextSendAt,
    deviceOnline: online,
    translationRequired,
    translationReady: false,
    translationStartedAt: message.queuedAt,
  });
  if (!message.isRetest && simRow && decision.kind === "dispatch") {
    const simCounts = await readCaps("s", sim.id, now.getTime());
    const simLimits = limitsOf(asPolicy(simRow));
    const simDecision = evaluateGate({
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
      counts: simCounts,
      limits: simLimits,
      overLimitAction: simRow.overLimitAction,
      capReleaseMs: releaseMs(simCounts, simLimits),
      nextSendAt: null,
      deviceOnline: true,
      translationRequired: false,
      translationReady: true,
      translationStartedAt: null,
    });
    if (rank(simDecision) < rank(decision)) decision = simDecision;
  }
  if (decision.kind === "dispatch") {
    const flying = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.simId, sim.id),
          eq(messages.status, "dispatched"),
          gt(messages.leaseExpiresAt, now),
          ne(messages.id, message.id),
        ),
      )
      .limit(1);
    if (flying.length > 0) return { kind: "wait", delayMs: 2000 };
    if (!message.isRetest) {
      const reserved = await commitCaps("u", user.id, {
        now: now.getTime(),
        perMinute: limits.perMinute,
        perHour: limits.perHour,
        perDay: limits.perDay,
        segmentsPerDay: limits.segmentsPerDay,
        segments: message.segments ?? 1,
        member: message.id,
      });
      if (!reserved.ok) {
        decision = {
          kind: "hold",
          reason: holdFrom(reserved.reason),
          delayMs: releaseMs(reserved.counts, limits),
        };
      }
    }
  }
  if (decision.kind === "dispatch") {
    const gap = gapSeconds({
      base: policy.gapBaseSeconds,
      jitter: policy.gapJitterSeconds,
      floor,
      random,
    });
    await db.transaction(async (tx) => {
      await tx
        .update(messages)
        .set({
          status: "dispatched",
          dispatchedAt: now,
          leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
          attempts: message.attempts + 1,
          holdReason: null,
        })
        .where(eq(messages.id, message.id));
      await tx
        .update(sims)
        .set({ nextSendAt: new Date(now.getTime() + gap * 1000) })
        .where(eq(sims.id, sim.id));
    });
    await publishUser(user.id, {
      type: "message.status",
      messageId: message.id,
      status: "dispatched",
    });
    return decision;
  }
  if (decision.kind === "hold") {
    await db
      .update(messages)
      .set({ status: "held", holdReason: decision.reason })
      .where(eq(messages.id, message.id));
    await publishUser(user.id, { type: "message.status", messageId: message.id, status: "held" });
    return decision;
  }
  if (decision.kind === "block") {
    await db
      .update(messages)
      .set({ status: "blocked", blockReason: decision.reason })
      .where(eq(messages.id, message.id));
    await publishUser(user.id, {
      type: "message.status",
      messageId: message.id,
      status: "blocked",
    });
    return decision;
  }
  if (decision.kind === "fail") {
    await db
      .update(messages)
      .set({
        status: "failed",
        failedAt: now,
        failureName: decision.failureName,
        failureClass: "permanent",
      })
      .where(eq(messages.id, message.id));
    return decision;
  }
  if (message.status !== "queued") {
    await db
      .update(messages)
      .set({ status: "queued", holdReason: null, queuedAt: now })
      .where(eq(messages.id, message.id));
  }
  return decision;
}

export async function promoteScheduled(now = new Date()): Promise<number> {
  const rows = await getDb()
    .update(messages)
    .set({ status: "queued", queuedAt: now })
    .where(and(eq(messages.status, "scheduled"), lte(messages.scheduledFor, now)))
    .returning({ id: messages.id });
  return rows.length;
}

export async function sweepLeases(now = new Date()): Promise<number> {
  const db = getDb();
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.status, "dispatched"), lt(messages.leaseExpiresAt, now)));
  let swept = 0;
  for (const message of rows) {
    const deviceRows = await db
      .select()
      .from(devices)
      .where(eq(devices.id, message.deviceId))
      .limit(1);
    const device = deviceRows[0];
    const offline =
      device === undefined ||
      device.lastHeartbeatAt === null ||
      (message.dispatchedAt !== null &&
        device.lastHeartbeatAt.getTime() < message.dispatchedAt.getTime());
    if (offline) {
      await db
        .update(messages)
        .set({
          status: "failed",
          failedAt: now,
          failureClass: "transient",
          failureName: "LEASE_EXPIRED_DEVICE_OFFLINE",
        })
        .where(eq(messages.id, message.id));
      await requeueSameSim(message.id, message.simId, message.attempts, "transient", false, now);
    } else {
      await db
        .update(messages)
        .set({
          status: "failed",
          failedAt: now,
          failureClass: "permanent",
          failureName: "LEASE_EXPIRED",
        })
        .where(eq(messages.id, message.id));
      await db.insert(alerts).values({
        id: uuidv7(),
        type: "sim_state_change",
        severity: "warning",
        simId: message.simId,
        deviceId: message.deviceId,
        userId: message.userId,
        title: "A dispatch lease expired",
        detail: { messageId: message.id },
        dedupeKey: `lease:${message.id}`,
        notifiedChannels: [],
      });
    }
    swept += 1;
  }
  return swept;
}

/** Retries stay on the same SIM. Nothing in this function changes sim_id. */
export async function requeueSameSim(
  messageId: string,
  simId: string,
  attempts: number,
  failureClass: string,
  deliveryFailed: boolean,
  now = new Date(),
): Promise<boolean> {
  const plan = retryPlan({ failureClass, attempts, deliveryFailed });
  if (!plan.retry) return false;
  const retryAt = new Date(now.getTime() + plan.delayMs);
  await getDb().transaction(async (tx) => {
    await tx
      .update(messages)
      .set({
        status: "queued",
        holdReason: null,
        queuedAt: retryAt,
        failedAt: null,
        failureClass: null,
        failureName: null,
      })
      .where(eq(messages.id, messageId));
    const simRows = await tx
      .select({ next: sims.nextSendAt })
      .from(sims)
      .where(eq(sims.id, simId))
      .limit(1);
    const next = simRows[0]?.next ?? null;
    if (next === null || next.getTime() < retryAt.getTime()) {
      await tx.update(sims).set({ nextSendAt: retryAt }).where(eq(sims.id, simId));
    }
  });
  return true;
}

export async function dueWork(limit = 100): Promise<{ id: string; simId: string }[]> {
  return getDb()
    .select({ id: messages.id, simId: messages.simId })
    .from(messages)
    .where(inArray(messages.status, ["queued", "held", "scheduled"]))
    .orderBy(asc(messages.createdAt))
    .limit(limit);
}

export async function holdUnhealthy(simId: string): Promise<void> {
  await getDb()
    .update(messages)
    .set({ status: "held", holdReason: "sim_unhealthy" })
    .where(and(eq(messages.simId, simId), eq(messages.status, "queued")));
}

export async function simRuntime(): Promise<{ simId: string; assignable: boolean }[]> {
  const rows = await getDb()
    .select({ sim: sims, device: devices })
    .from(sims)
    .innerJoin(devices, eq(devices.id, sims.deviceId))
    .where(isNull(sims.retiredAt));
  return rows.map((row) => ({
    simId: row.sim.id,
    assignable:
      row.sim.health === "active" &&
      row.sim.activeOnDevice &&
      !row.sim.pausedByAdmin &&
      row.device.status === "active" &&
      !row.device.paused,
  }));
}

export async function usageCounts(userId: string) {
  const counts = await readCaps("u", userId);
  return {
    minute: counts.minute,
    hour: counts.hour,
    day: counts.day,
    segmentsDay: counts.segments,
  };
}

export async function writeKillAlert(enabled: boolean, reason: string): Promise<void> {
  await getDb()
    .insert(alerts)
    .values({
      id: uuidv7(),
      type: "kill_switch_changed",
      severity: "critical",
      title: enabled ? "Sending paused" : "Sending resumed",
      detail: { enabled, reason },
      dedupeKey: `kill_switch:${enabled}:${Date.now()}`,
      notifiedChannels: [],
    });
}
