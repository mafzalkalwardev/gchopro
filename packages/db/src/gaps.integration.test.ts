import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { applySignature, countSegments, hashPassword } from "@gchopro/core";
import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createUser, freeSims, tickSubscriptions } from "./account-service.js";
import { verifyAuditChain } from "./audit.js";
import { clearCaps } from "./caps.js";
import { closeDb, getDb } from "./client.js";
import { importContacts } from "./contacts.js";
import { ingestInbox } from "./device-messages.js";
import {
  authenticateDevice,
  capacity,
  createPairing,
  recordHeartbeat,
  registerDevice,
  reportSims,
  retireDevice,
  rotateDeviceToken,
} from "./device-service.js";
import { indexPhone, normalizePhone, openSeal } from "./device-shared.js";
import { acceptAup, changePassword, login } from "./login.js";
import { dueWork, processSend, sendGroup, sendMessage, usageCounts } from "./messaging.js";
import { portalProfile } from "./profile.js";
import { closeRedis, getRedis } from "./redis.js";
import {
  alerts,
  auditLogs,
  conversations,
  devices,
  messages,
  optOuts,
  rateLimitPolicies,
  sessions,
  settings,
  sims,
  subscriptions,
  users,
} from "./schema.js";
import { forgetSessions, isSessionRecord, readSession } from "./sessions.js";
import { updateSetting } from "./settings-service.js";
import { testTranslationProvider, translationPending } from "./translation-service.js";

const NONE_TRANSLATION = {
  provider: "none",
  deepl: { plan: "free" },
  google: {},
  libretranslate: { url: null },
  preview_before_send: true,
};

type SimSpec = { subscriptionId: number; slotIndex: number; number: string };
type PolicyPatch = {
  perMinute?: number;
  perHour?: number;
  perDay?: number;
  segmentsPerDay?: number;
  maxGroupRecipients?: number;
  overLimitAction?: "hold" | "reject";
};

function simInput(spec: SimSpec) {
  return {
    subscriptionId: spec.subscriptionId,
    slotIndex: spec.slotIndex,
    isEmbedded: false,
    carrierName: "Jazz",
    displayName: `SIM ${spec.slotIndex + 1}`,
    mcc: "410",
    mnc: "01",
    countryIso: "pk",
    number: spec.number,
    simState: "SIM_STATE_READY",
    serviceState: "STATE_IN_SERVICE",
    signalLevel: 3,
  };
}

function translationValue(
  provider: "none" | "deepl" | "google" | "libretranslate",
  url: string | null,
) {
  return {
    provider,
    deepl: { plan: "free" as const },
    google: {},
    libretranslate: { url },
    preview_before_send: true,
  };
}

async function insertPolicy(name: string, patch: PolicyPatch = {}): Promise<string> {
  const id = uuidv7();
  await getDb()
    .insert(rateLimitPolicies)
    .values({
      id,
      name,
      gapBaseSeconds: 5,
      gapJitterSeconds: 0,
      perMinute: patch.perMinute ?? 30,
      perHour: patch.perHour ?? 100,
      perDay: patch.perDay ?? 500,
      segmentsPerDay: patch.segmentsPerDay ?? 500,
      maxGroupRecipients: patch.maxGroupRecipients ?? 50,
      windowStart: "00:00:00",
      windowEnd: "23:59:59",
      windowDays: [1, 2, 3, 4, 5, 6, 7],
      windowTimezoneMode: "user",
      overLimitAction: patch.overLimitAction ?? "hold",
    });
  return id;
}

function requiredPortal(value: string | null): string {
  if (typeof value !== "string" || value.length === 0) throw new Error("portal missing");
  return value;
}

async function beat(deviceId: string): Promise<void> {
  await getDb()
    .update(devices)
    .set({ lastHeartbeatAt: new Date() })
    .where(eq(devices.id, deviceId));
}

async function openDesk(input: {
  prefix: string;
  adminIp: string;
  deviceIp: string;
  name: string;
  sims?: SimSpec[];
  policy?: PolicyPatch;
  portalIp?: string;
}) {
  const db = getDb();
  const adminId = uuidv7();
  const stamp = adminId.replaceAll("-", "").slice(0, 8);
  const adminName = `ga${input.prefix}${stamp}`;
  await db.insert(users).values({
    id: adminId,
    role: "admin",
    username: adminName,
    displayName: input.name,
    passwordHash: await hashPassword("integration-password-1"),
    passwordChangedAt: new Date(),
    mustChangePassword: false,
    status: "active",
  });
  const actor = {
    userId: adminId,
    role: "admin" as const,
    ip: input.adminIp,
    requestId: randomUUID(),
  };
  const pairing = await createPairing(actor, input.name);
  const registered = await registerDevice({
    code: pairing.code,
    name: input.name,
    protocolVersion: 2,
    appVersion: "2.0.0",
    model: "Infinix X6528",
    androidSdk: 34,
    ip: input.deviceIp,
  });
  const auth = await authenticateDevice(registered.id, registered.token);
  const specs = input.sims ?? [];
  let simIds: string[] = [];
  let policyId: string | null = null;
  if (specs.length > 0) {
    const reported = await reportSims(auth.device, {
      reportedAt: new Date().toISOString(),
      slotsOnDevice: Math.max(specs.length, 1),
      sims: specs.map((spec) => simInput(spec)),
    });
    simIds = reported.sims.map((sim) => sim.simId);
    policyId = await insertPolicy(`open-${input.prefix}-${stamp}`, input.policy);
    await db.update(sims).set({ rateLimitPolicyId: policyId }).where(inArray(sims.id, simIds));
    await recordHeartbeat(auth.device, {
      battery: 80,
      charging: true,
      network: "wifi",
      appVersion: "2.0.0",
      androidSdk: 34,
      activeModemCount: specs.length,
    });
  }
  let portalToken: string | null = null;
  let userId: string | null = null;
  const lineId = simIds[0];
  if (input.portalIp !== undefined && lineId !== undefined && policyId !== null) {
    const created = await createUser(actor, {
      username: `gu${input.prefix}${stamp}`,
      displayName: input.name,
      simId: lineId,
      policyId,
      userLanguage: "en",
      recipientLanguage: "en",
      translationEnabled: false,
      timezone: "Asia/Karachi",
      allowExport: true,
      allowSelfPasswordChange: true,
      subscription: { planUnit: "month", planQuantity: 1, expiryBehavior: "block" },
    });
    const password = created.initialPassword ?? "";
    const signedIn = await login({
      app: "portal",
      username: created.user.username,
      password,
      ip: input.portalIp,
      userAgent: "vitest",
      requestId: randomUUID(),
    });
    if (!signedIn.ok) throw new Error("login failed");
    await changePassword({
      token: signedIn.token,
      currentPassword: password,
      newPassword: "integration-password-2",
      ip: input.portalIp,
      requestId: randomUUID(),
    });
    await acceptAup(signedIn.token, input.portalIp, randomUUID());
    portalToken = signedIn.token;
    userId = created.user.id;
  }
  return {
    db,
    actor,
    device: auth.device,
    deviceId: registered.id,
    deviceToken: registered.token,
    simIds,
    policyId,
    portalToken,
    userId,
  };
}

async function readyAdmin(prefix: string, ip: string) {
  const db = getDb();
  const adminId = uuidv7();
  const stamp = adminId.replaceAll("-", "").slice(0, 8);
  await db.insert(users).values({
    id: adminId,
    role: "admin",
    username: `gt${prefix}${stamp}`,
    displayName: "Settings admin",
    passwordHash: await hashPassword("integration-password-1"),
    passwordChangedAt: new Date(),
    mustChangePassword: false,
    status: "active",
  });
  const signed = await login({
    app: "admin",
    username: `gt${prefix}${stamp}`,
    password: "integration-password-1",
    ip,
    userAgent: "vitest",
    requestId: randomUUID(),
  });
  if (!signed.ok) throw new Error("admin login failed");
  const record = await readSession(signed.token);
  if (!isSessionRecord(record)) throw new Error("admin session missing");
  await db.update(sessions).set({ mfaVerified: true }).where(eq(sessions.id, record.sessionId));
  await db.update(users).set({ totpEnabled: true }).where(eq(users.id, adminId));
  await forgetSessions([record.sessionId]);
  await getRedis().set(
    `sudo:${record.sessionId}`,
    new Date(Date.now() + 600_000).toISOString(),
    "EX",
    600,
  );
  return { db, token: signed.token };
}

async function languagesServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const ok = req.url === "/languages";
    res.writeHead(ok ? 200 : 404, { "content-type": "application/json" });
    res.end(ok ? "[]" : "");
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

describe("acceptance gaps", () => {
  afterAll(async () => {
    const db = getDb();
    await db
      .update(settings)
      .set({ value: { enabled: false, reason: null, since: null } })
      .where(eq(settings.key, "kill_switch"));
    await db
      .update(settings)
      .set({ value: { enabled: false, text: "" } })
      .where(eq(settings.key, "sender_signature"));
    await db
      .update(settings)
      .set({ value: NONE_TRANSLATION })
      .where(eq(settings.key, "translation"));
    await closeDb();
    await closeRedis();
  });

  it("marks a removed SIM inactive and rejects a send", async () => {
    const spec: SimSpec = { subscriptionId: 9501, slotIndex: 0, number: "+923009950001" };
    const desk = await openDesk({
      prefix: "ln",
      adminIp: "203.0.113.140",
      deviceIp: "203.0.113.141",
      portalIp: "203.0.113.142",
      name: "Removed line",
      sims: [spec],
    });
    const token = requiredPortal(desk.portalToken);
    expect((await portalProfile(token)).line.available).toBe(true);
    await reportSims(desk.device, {
      reportedAt: new Date().toISOString(),
      slotsOnDevice: 1,
      sims: [],
    });
    const profile = await portalProfile(token);
    expect(profile.line.health).toBe("inactive");
    expect(profile.line.available).toBe(false);
    await expect(
      sendMessage(token, { to: "+923009950011", body: "after removal" }),
    ).rejects.toMatchObject({ status: 422, code: "line_unavailable" });
  }, 60_000);

  it("counts free lines and offers only a free active SIM", async () => {
    const specs: SimSpec[] = [
      { subscriptionId: 9502, slotIndex: 0, number: "+923009950021" },
      { subscriptionId: 9503, slotIndex: 1, number: "+923009950022" },
    ];
    const desk = await openDesk({
      prefix: "cap",
      adminIp: "203.0.113.143",
      deviceIp: "203.0.113.144",
      name: "Capacity rack",
      sims: specs,
    });
    const [first, second] = desk.simIds;
    if (first === undefined || second === undefined) throw new Error("sims missing");
    const before = (await capacity()).devices.find((device) => device.deviceId === desk.deviceId);
    expect(before).toMatchObject({
      slotsOnDevice: 2,
      activeSims: 2,
      assignedSims: 0,
      freeSims: 2,
    });
    const open = new Set((await freeSims()).map((sim) => sim.id));
    expect(open.has(first)).toBe(true);
    expect(open.has(second)).toBe(true);
    await createUser(desk.actor, {
      username: `gcap${desk.actor.userId.replaceAll("-", "").slice(0, 8)}`,
      displayName: "Capacity user",
      simId: first,
      policyId: desk.policyId ?? undefined,
      userLanguage: "en",
      recipientLanguage: "en",
      translationEnabled: false,
      timezone: "Asia/Karachi",
      allowExport: true,
      allowSelfPasswordChange: true,
      subscription: { planUnit: "month", planQuantity: 1, expiryBehavior: "block" },
    });
    const assigned = new Set((await freeSims()).map((sim) => sim.id));
    expect(assigned.has(first)).toBe(false);
    expect(assigned.has(second)).toBe(true);
    const mid = (await capacity()).devices.find((device) => device.deviceId === desk.deviceId);
    expect(mid).toMatchObject({ activeSims: 2, assignedSims: 1, freeSims: 1 });
    await reportSims(desk.device, {
      reportedAt: new Date().toISOString(),
      slotsOnDevice: 2,
      sims: [simInput(specs[0]!)],
    });
    const offered = new Set((await freeSims()).map((sim) => sim.id));
    expect(offered.has(first)).toBe(false);
    expect(offered.has(second)).toBe(false);
    const after = (await capacity()).devices.find((device) => device.deviceId === desk.deviceId);
    expect(after).toMatchObject({ activeSims: 1, assignedSims: 1, freeSims: 0 });
  }, 60_000);

  it("routes inbox rows per device and alerts on an unknown subscription", async () => {
    const left = await openDesk({
      prefix: "inb",
      adminIp: "203.0.113.145",
      deviceIp: "203.0.113.146",
      portalIp: "203.0.113.147",
      name: "Inbox left",
      sims: [{ subscriptionId: 9504, slotIndex: 0, number: "+923009950031" }],
    });
    const right = await openDesk({
      prefix: "inc",
      adminIp: "203.0.113.148",
      deviceIp: "203.0.113.149",
      portalIp: "203.0.113.150",
      name: "Inbox right",
      sims: [{ subscriptionId: 9505, slotIndex: 0, number: "+923009950032" }],
    });
    const owned = await ingestInbox(left.deviceId, [
      {
        providerId: "shared-id",
        subscriptionId: 9504,
        address: "+923009950041",
        body: "for the owner",
        receivedAt: new Date().toISOString(),
      },
    ]);
    expect(owned.inserted).toBe(1);
    const repeat = await ingestInbox(left.deviceId, [
      {
        providerId: "shared-id",
        subscriptionId: 9504,
        address: "+923009950041",
        body: "for the owner",
        receivedAt: new Date().toISOString(),
      },
    ]);
    expect(repeat.duplicates).toBe(1);
    const leftRows = await left.db
      .select()
      .from(messages)
      .where(and(eq(messages.deviceId, left.deviceId), eq(messages.providerId, "shared-id")));
    expect(leftRows).toHaveLength(1);
    expect(leftRows[0]?.userId).toBe(left.userId);
    const other = await ingestInbox(right.deviceId, [
      {
        providerId: "shared-id",
        subscriptionId: 9505,
        address: "+923009950042",
        body: "for the other owner",
        receivedAt: new Date().toISOString(),
      },
    ]);
    expect(other.inserted).toBe(1);
    const both = await left.db.select().from(messages).where(eq(messages.providerId, "shared-id"));
    expect(both).toHaveLength(2);
    const missing = await ingestInbox(left.deviceId, [
      {
        providerId: "missing-sub",
        subscriptionId: 999999,
        address: "+923009950043",
        body: "nobody home",
        receivedAt: new Date().toISOString(),
      },
    ]);
    expect(missing.unroutable).toBe(1);
    const stored = await left.db
      .select()
      .from(messages)
      .where(eq(messages.providerId, "missing-sub"));
    expect(stored).toHaveLength(0);
    const alert = await left.db
      .select()
      .from(alerts)
      .where(eq(alerts.dedupeKey, `${left.deviceId}:unroutable:missing-sub`));
    expect(alert[0]?.title).toBe("Unroutable message");
  }, 60_000);

  it("accepts the previous token during grace and rejects a retired device", async () => {
    const desk = await openDesk({
      prefix: "tok",
      adminIp: "203.0.113.151",
      deviceIp: "203.0.113.152",
      name: "Token rack",
    });
    const rotated = await rotateDeviceToken(desk.device);
    const row = (
      await desk.db.select().from(devices).where(eq(devices.id, desk.deviceId)).limit(1)
    )[0];
    const expiry = row?.tokenPrevExpiresAt;
    if (expiry === null || expiry === undefined) throw new Error("grace missing");
    const during = await authenticateDevice(
      desk.deviceId,
      desk.deviceToken,
      new Date(expiry.getTime() - 1000),
    );
    expect(during.device.id).toBe(desk.deviceId);
    await expect(
      authenticateDevice(desk.deviceId, desk.deviceToken, new Date(expiry.getTime() + 1000)),
    ).rejects.toMatchObject({ status: 401, code: "device_revoked" });
    await authenticateDevice(desk.deviceId, rotated.token);
    await retireDevice(desk.actor, desk.deviceId);
    await expect(authenticateDevice(desk.deviceId, rotated.token)).rejects.toMatchObject({
      status: 401,
      code: "device_revoked",
    });
  }, 60_000);

  it("blocks an opted-out group recipient and rejects a send over the cap", async () => {
    const desk = await openDesk({
      prefix: "grp",
      adminIp: "203.0.113.153",
      deviceIp: "203.0.113.154",
      portalIp: "203.0.113.155",
      name: "Group rack",
      sims: [{ subscriptionId: 9506, slotIndex: 0, number: "+923009950051" }],
      policy: { maxGroupRecipients: 1 },
    });
    const token = desk.portalToken;
    const userId = desk.userId;
    const simId = desk.simIds[0];
    if (token === null || userId === null || simId === undefined) throw new Error("desk missing");
    const before = await desk.db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.userId, userId));
    await expect(
      sendGroup(token, {
        recipients: ["+923009950061", "+923009950062"],
        body: "too many",
      }),
    ).rejects.toMatchObject({ status: 422, code: "limit_reached" });
    const after = await desk.db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.userId, userId));
    expect(after).toHaveLength(before.length);
    await desk.db
      .update(rateLimitPolicies)
      .set({ maxGroupRecipients: 5 })
      .where(eq(rateLimitPolicies.id, desk.policyId ?? ""));
    await desk.db.insert(optOuts).values({
      id: uuidv7(),
      numberHash: indexPhone("+923009950062"),
      scope: "global",
      source: "admin",
    });
    const group = await sendGroup(token, {
      recipients: ["+923009950063", "+923009950062"],
      body: "group note",
    });
    expect(group.messages.filter((message) => message.status === "blocked")).toHaveLength(1);
    expect(group.messages.every((message) => message.simId === simId)).toBe(true);
  }, 60_000);

  it("holds hour and day caps, rejects a segment cap, and shows those counts", async () => {
    const desk = await openDesk({
      prefix: "lim",
      adminIp: "203.0.113.156",
      deviceIp: "203.0.113.157",
      portalIp: "203.0.113.158",
      name: "Cap rack",
      sims: [{ subscriptionId: 9507, slotIndex: 0, number: "+923009950071" }],
      policy: { perMinute: 30, perHour: 1, perDay: 100, segmentsPerDay: 100 },
    });
    const token = desk.portalToken;
    const userId = desk.userId;
    const simId = desk.simIds[0];
    if (token === null || userId === null || simId === undefined || desk.policyId === null) {
      throw new Error("desk missing");
    }
    const first = await sendMessage(token, { to: "+923009950081", body: "hour one" });
    await beat(desk.deviceId);
    expect((await processSend(first.message.id)).kind).toBe("dispatch");
    const second = await sendMessage(token, { to: "+923009950082", body: "hour two" });
    await beat(desk.deviceId);
    expect(await processSend(second.message.id)).toMatchObject({
      kind: "hold",
      reason: "rate_hour",
    });
    const profile = await portalProfile(token);
    const usage = await usageCounts(userId);
    expect(profile.usage).toEqual(usage);
    expect(profile.usage.hour).toBe(1);
    expect(profile.limits?.perHour).toBe(1);
    await desk.db
      .update(messages)
      .set({ status: "sent", leaseExpiresAt: new Date(0) })
      .where(eq(messages.id, first.message.id));
    await clearCaps("u", userId);
    await clearCaps("s", simId);
    await desk.db
      .update(rateLimitPolicies)
      .set({ perHour: 100, perDay: 1 })
      .where(eq(rateLimitPolicies.id, desk.policyId));
    await beat(desk.deviceId);
    expect((await processSend(second.message.id)).kind).toBe("dispatch");
    const third = await sendMessage(token, { to: "+923009950083", body: "day two" });
    await beat(desk.deviceId);
    expect(await processSend(third.message.id)).toMatchObject({ kind: "hold", reason: "rate_day" });
    await desk.db
      .update(messages)
      .set({ status: "sent", leaseExpiresAt: new Date(0) })
      .where(eq(messages.id, second.message.id));
    await desk.db
      .update(sims)
      .set({ nextSendAt: new Date(0) })
      .where(eq(sims.id, simId));
    await clearCaps("u", userId);
    await clearCaps("s", simId);
    await desk.db
      .update(rateLimitPolicies)
      .set({ perDay: 100, segmentsPerDay: 1, overLimitAction: "reject" })
      .where(eq(rateLimitPolicies.id, desk.policyId));
    const fourth = await sendMessage(token, { to: "+923009950084", body: "segment one" });
    await beat(desk.deviceId);
    expect((await processSend(fourth.message.id)).kind).toBe("dispatch");
    const queued = await desk.db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.userId, userId));
    await expect(
      sendMessage(token, { to: "+923009950085", body: "segment two" }),
    ).rejects.toMatchObject({ status: 422, code: "limit_reached" });
    const still = await desk.db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.userId, userId));
    expect(still).toHaveLength(queued.length);
  }, 60_000);

  it("pauses on the kill switch and resumes the oldest message on the same SIM", async () => {
    const desk = await openDesk({
      prefix: "kil",
      adminIp: "203.0.113.159",
      deviceIp: "203.0.113.160",
      portalIp: "203.0.113.161",
      name: "Kill rack",
      sims: [{ subscriptionId: 9508, slotIndex: 0, number: "+923009950091" }],
    });
    const token = desk.portalToken;
    const simId = desk.simIds[0];
    if (token === null || simId === undefined) throw new Error("desk missing");
    try {
      const first = await sendMessage(token, { to: "+923009950101", body: "older" });
      const second = await sendMessage(token, { to: "+923009950102", body: "newer" });
      await desk.db.update(devices).set({ paused: true }).where(eq(devices.id, desk.deviceId));
      await beat(desk.deviceId);
      expect(await processSend(first.message.id)).toMatchObject({
        kind: "hold",
        reason: "kill_switch",
      });
      await desk.db.update(devices).set({ paused: false }).where(eq(devices.id, desk.deviceId));
      await desk.db.update(sims).set({ pausedByAdmin: true }).where(eq(sims.id, simId));
      await beat(desk.deviceId);
      expect(await processSend(first.message.id)).toMatchObject({
        kind: "hold",
        reason: "kill_switch",
      });
      await desk.db.update(sims).set({ pausedByAdmin: false }).where(eq(sims.id, simId));
      await desk.db
        .update(settings)
        .set({ value: { enabled: true, reason: "drill", since: new Date().toISOString() } })
        .where(eq(settings.key, "kill_switch"));
      await beat(desk.deviceId);
      expect(await processSend(first.message.id)).toMatchObject({
        kind: "hold",
        reason: "kill_switch",
      });
      expect(await processSend(second.message.id)).toMatchObject({
        kind: "hold",
        reason: "kill_switch",
      });
      await desk.db
        .update(settings)
        .set({ value: { enabled: false, reason: null, since: null } })
        .where(eq(settings.key, "kill_switch"));
      const ordered = await desk.db
        .select({ id: messages.id })
        .from(messages)
        .where(inArray(messages.id, [first.message.id, second.message.id]))
        .orderBy(asc(messages.createdAt));
      expect(ordered.map((row) => row.id)).toEqual([first.message.id, second.message.id]);
      const due = (await dueWork(200)).map((row) => row.id);
      expect(due.indexOf(first.message.id)).toBeGreaterThanOrEqual(0);
      expect(due.indexOf(first.message.id)).toBeLessThan(due.indexOf(second.message.id));
      await beat(desk.deviceId);
      expect((await processSend(first.message.id)).kind).toBe("dispatch");
      expect(
        (await desk.db.select().from(messages).where(eq(messages.id, first.message.id)))[0]?.simId,
      ).toBe(simId);
      await desk.db
        .update(messages)
        .set({ status: "sent", leaseExpiresAt: new Date(0) })
        .where(eq(messages.id, first.message.id));
      await desk.db
        .update(sims)
        .set({ nextSendAt: new Date(0) })
        .where(eq(sims.id, simId));
      await beat(desk.deviceId);
      expect((await processSend(second.message.id)).kind).toBe("dispatch");
      expect(
        (await desk.db.select().from(messages).where(eq(messages.id, second.message.id)))[0]?.simId,
      ).toBe(simId);
    } finally {
      await desk.db
        .update(settings)
        .set({ value: { enabled: false, reason: null, since: null } })
        .where(eq(settings.key, "kill_switch"));
      await desk.db.update(devices).set({ paused: false }).where(eq(devices.id, desk.deviceId));
      await desk.db.update(sims).set({ pausedByAdmin: false }).where(eq(sims.id, simId));
    }
  }, 60_000);

  it("stores a ciphertext body and fails the audit chain after one row changes", async () => {
    const desk = await openDesk({
      prefix: "sec",
      adminIp: "203.0.113.162",
      deviceIp: "203.0.113.163",
      portalIp: "203.0.113.164",
      name: "Cipher rack",
      sims: [{ subscriptionId: 9509, slotIndex: 0, number: "+923009950131" }],
    });
    const token = desk.portalToken;
    const userId = desk.userId;
    if (token === null || userId === null) throw new Error("desk missing");
    const marker = "PlaintextMarker950141";
    const peer = "+923009950141";
    const sent = await sendMessage(token, { to: peer, body: marker });
    const row = (await desk.db.select().from(messages).where(eq(messages.id, sent.message.id)))[0];
    expect(row?.wireBodyEnc).toBeTruthy();
    expect(row?.wireBodyEnc?.includes(marker)).toBe(false);
    expect(openSeal(`messages.wire_body_enc.${sent.message.id}`, row?.wireBodyEnc ?? null)).toBe(
      marker,
    );
    const hash = indexPhone(normalizePhone(peer, "PK"));
    const found = await desk.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.userId, userId), eq(conversations.peerNumberHash, hash)));
    expect(found[0]?.id).toBe(sent.conversationId);
    expect((await verifyAuditChain(desk.db)).ok).toBe(true);
    const audit = await desk.db.select().from(auditLogs).orderBy(asc(auditLogs.id));
    const last = audit[audit.length - 1];
    if (last === undefined) throw new Error("audit empty");
    let broken = false;
    try {
      await desk.db.transaction(async (tx) => {
        await tx
          .update(auditLogs)
          .set({ after: { tampered: true } })
          .where(eq(auditLogs.id, last.id));
        const result = await verifyAuditChain(tx);
        broken = result.ok === false && result.brokenAtId === last.id.toString();
        throw new Error("rollback");
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "rollback") throw error;
    }
    expect(broken).toBe(true);
    expect((await verifyAuditChain(desk.db)).ok).toBe(true);
  }, 60_000);

  it("counts a signature that crosses a segment boundary", async () => {
    const desk = await openDesk({
      prefix: "sig",
      adminIp: "203.0.113.165",
      deviceIp: "203.0.113.166",
      portalIp: "203.0.113.167",
      name: "Signature rack",
      sims: [{ subscriptionId: 9510, slotIndex: 0, number: "+923009950111" }],
    });
    const token = requiredPortal(desk.portalToken);
    const body = "a".repeat(160);
    try {
      await desk.db
        .update(settings)
        .set({ value: { enabled: true, text: "Desk" } })
        .where(eq(settings.key, "sender_signature"));
      const signed = await sendMessage(token, { to: "+923009950121", body });
      const signedRow = (
        await desk.db.select().from(messages).where(eq(messages.id, signed.message.id))
      )[0];
      const signedCount = countSegments(applySignature(body, { enabled: true, text: "Desk" }));
      expect(signedRow?.segments).toBe(signedCount.segments);
      expect(signedRow?.segments).toBeGreaterThan(countSegments(body).segments);
      await desk.db
        .update(settings)
        .set({ value: { enabled: false, text: "Desk" } })
        .where(eq(settings.key, "sender_signature"));
      const plain = await sendMessage(token, { to: "+923009950122", body });
      const plainRow = (
        await desk.db.select().from(messages).where(eq(messages.id, plain.message.id))
      )[0];
      expect(plainRow?.segments).toBe(countSegments(body).segments);
    } finally {
      await desk.db
        .update(settings)
        .set({ value: { enabled: false, text: "" } })
        .where(eq(settings.key, "sender_signature"));
    }
  }, 60_000);

  it("rejects a CSV row without consent and names an opted-out number", async () => {
    const desk = await openDesk({
      prefix: "csv",
      adminIp: "203.0.113.168",
      deviceIp: "203.0.113.169",
      portalIp: "203.0.113.170",
      name: "Import rack",
      sims: [{ subscriptionId: 9511, slotIndex: 0, number: "+923009950151" }],
    });
    const token = requiredPortal(desk.portalToken);
    await desk.db.insert(optOuts).values({
      id: uuidv7(),
      numberHash: indexPhone(normalizePhone("+923009950161", "PK")),
      scope: "global",
      source: "admin",
    });
    const result = await importContacts(
      token,
      [
        "name,number,consent_source",
        "Opted,+923009950161,verbal",
        "Clean,+923009950162,written",
        "Missing,+923009950163,",
      ].join("\n"),
    );
    expect(result.rejected.some((row) => row.reason === "consent_source")).toBe(true);
    expect(result.optedOutNumbers).toEqual(["+923009950161"]);
    expect(result.optedOut).toBe(1);
  }, 60_000);

  it("revokes a session with the expiry reason when the tick expires a block plan", async () => {
    const desk = await openDesk({
      prefix: "exp",
      adminIp: "203.0.113.171",
      deviceIp: "203.0.113.172",
      portalIp: "203.0.113.173",
      name: "Expiry rack",
      sims: [{ subscriptionId: 9512, slotIndex: 0, number: "+923009950171" }],
    });
    if (desk.userId === null) throw new Error("user missing");
    await desk.db
      .update(subscriptions)
      .set({
        endsAt: new Date(Date.now() - 60_000),
        status: "active",
        expiryBehavior: "block",
      })
      .where(eq(subscriptions.userId, desk.userId));
    await tickSubscriptions(new Date());
    const revoked = await desk.db.select().from(sessions).where(eq(sessions.userId, desk.userId));
    expect(revoked.some((row) => row.revokeReason === "expired")).toBe(true);
  }, 60_000);

  it("saves each translation provider and reports a test success and a failure", async () => {
    const admin = await readyAdmin("tr", "203.0.113.174");
    const server = await languagesServer();
    try {
      for (const provider of ["deepl", "google"] as const) {
        await updateSetting({
          token: admin.token,
          key: "translation",
          value: translationValue(provider, null),
          ip: "203.0.113.174",
          requestId: randomUUID(),
        });
        const row = (
          await admin.db.select().from(settings).where(eq(settings.key, "translation")).limit(1)
        )[0];
        expect(row?.value).toMatchObject({ provider });
      }
      await updateSetting({
        token: admin.token,
        key: "translation",
        value: translationValue("libretranslate", server.url),
        ip: "203.0.113.174",
        requestId: randomUUID(),
      });
      const saved = await admin.db
        .select()
        .from(settings)
        .where(eq(settings.key, "translation"))
        .limit(1);
      expect(saved[0]?.value).toMatchObject({ provider: "libretranslate" });
      expect(await testTranslationProvider(admin.token)).toEqual({ ok: true });
      expect(
        await translationPending({
          translationEnabled: true,
          userLanguage: "zh",
          recipientLanguage: "en",
        }),
      ).toBe(true);
      await updateSetting({
        token: admin.token,
        key: "translation",
        value: translationValue("libretranslate", "http://127.0.0.1:1"),
        ip: "203.0.113.174",
        requestId: randomUUID(),
      });
      expect(await testTranslationProvider(admin.token)).toEqual({ ok: false });
      await updateSetting({
        token: admin.token,
        key: "translation",
        value: translationValue("none", null),
        ip: "203.0.113.174",
        requestId: randomUUID(),
      });
      const none = await admin.db
        .select()
        .from(settings)
        .where(eq(settings.key, "translation"))
        .limit(1);
      expect(none[0]?.value).toMatchObject({ provider: "none" });
      expect(await testTranslationProvider(admin.token)).toEqual({ ok: false });
      expect(
        await translationPending({
          translationEnabled: true,
          userLanguage: "zh",
          recipientLanguage: "en",
        }),
      ).toBe(false);
    } finally {
      await server.close();
      await admin.db
        .update(settings)
        .set({ value: NONE_TRANSLATION })
        .where(eq(settings.key, "translation"));
    }
  }, 60_000);
});
