import { randomUUID } from "node:crypto";
import { hashPassword, zonedDay } from "@gchopro/core";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createUser } from "./account-service.js";
import {
  analyticsExport,
  analyticsSeries,
  openSupportView,
  recordWorkerBeat,
  rollupStats,
  systemHealth,
} from "./analytics-service.js";
import { closeDb, getDb } from "./client.js";
import { ingestInbox } from "./device-messages.js";
import {
  authenticateDevice,
  createPairing,
  recordHeartbeat,
  registerDevice,
  reportSims,
} from "./device-service.js";
import { acceptAup, changePassword, login } from "./login.js";
import { listConversations, patchConversation, sendMessage } from "./messaging.js";
import { closeRedis } from "./redis.js";
import { auditLogs, devices, messages, settings, users } from "./schema.js";

describe("analytics", () => {
  afterAll(async () => {
    await getDb()
      .update(settings)
      .set({ value: { expiry_behavior_default: "block", allow_admin_support_view: false } })
      .where(eq(settings.key, "portal"));
    await closeDb();
    await closeRedis();
  });

  it("rolls up a SIM without re-tests and escapes the export", async () => {
    const db = getDb();
    const adminId = uuidv7();
    const stamp = adminId.split("-").join("").slice(0, 8);
    await db.insert(users).values({
      id: adminId,
      role: "admin",
      username: `m7a${stamp}`,
      displayName: "Analytics admin",
      passwordHash: await hashPassword("integration-password-1"),
      passwordChangedAt: new Date(),
      mustChangePassword: false,
      status: "active",
    });
    const actor = {
      userId: adminId,
      role: "admin",
      ip: "203.0.113.110",
      requestId: randomUUID(),
    };
    const pairing = await createPairing(actor, "Analytics rack");
    const registered = await registerDevice({
      code: pairing.code,
      name: "Analytics rack",
      protocolVersion: 2,
      appVersion: "2.0.0",
      model: "Infinix X6528",
      androidSdk: 34,
      ip: "203.0.113.111",
    });
    const auth = await authenticateDevice(registered.id, registered.token);
    const reported = await reportSims(auth.device, {
      reportedAt: new Date().toISOString(),
      slotsOnDevice: 1,
      sims: [
        {
          subscriptionId: 14,
          slotIndex: 0,
          isEmbedded: false,
          carrierName: "Jazz",
          displayName: "SIM 1",
          mcc: "410",
          mnc: "01",
          countryIso: "pk",
          number: "+923009991411",
          simState: "SIM_STATE_READY",
          serviceState: "STATE_IN_SERVICE",
          signalLevel: 4,
        },
      ],
    });
    const simId = reported.sims[0]?.simId;
    if (simId === undefined) throw new Error("sim missing");
    await recordHeartbeat(auth.device, {
      battery: 80,
      charging: true,
      network: "wifi",
      appVersion: "2.0.0",
      androidSdk: 34,
      activeModemCount: 1,
    });
    await db
      .update(devices)
      .set({ lastHeartbeatAt: new Date() })
      .where(eq(devices.id, registered.id));
    const created = await createUser(actor, {
      username: `m7u${stamp}`,
      displayName: "Analytics user",
      simId,
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
      ip: "203.0.113.112",
      userAgent: "vitest",
      requestId: randomUUID(),
    });
    if (!signedIn.ok) throw new Error("login failed");
    await changePassword({
      token: signedIn.token,
      currentPassword: password,
      newPassword: "integration-password-2",
      ip: "203.0.113.112",
      requestId: randomUUID(),
    });
    await acceptAup(signedIn.token, "203.0.113.112", randomUUID());
    const token = signedIn.token;
    const queued = await sendMessage(token, { to: "+923009991401", body: "Hello there" });
    const sentAt = new Date();
    const deliveredAt = new Date(sentAt.getTime() + 5000);
    await db
      .update(messages)
      .set({ status: "delivered", sentAt, deliveredAt })
      .where(eq(messages.id, queued.message.id));
    const sent = (await db.select().from(messages).where(eq(messages.id, queued.message.id)))[0];
    if (sent === undefined) throw new Error("sent message missing");
    await db.insert(messages).values({
      id: uuidv7(),
      conversationId: sent.conversationId,
      userId: sent.userId,
      simId: sent.simId,
      deviceId: sent.deviceId,
      direction: "out",
      peerNumberHash: sent.peerNumberHash,
      status: "failed",
      failureName: "=cmd",
      segments: 1,
    });
    await db.insert(messages).values({
      id: uuidv7(),
      conversationId: sent.conversationId,
      userId: sent.userId,
      simId: sent.simId,
      deviceId: sent.deviceId,
      direction: "out",
      peerNumberHash: sent.peerNumberHash,
      status: "sent",
      segments: 1,
      isRetest: true,
    });
    await ingestInbox(registered.id, [
      {
        providerId: `in-${stamp}`,
        subscriptionId: 14,
        address: "+923009991401",
        body: "Reply",
        receivedAt: new Date().toISOString(),
      },
    ]);
    await rollupStats();
    const day = zonedDay(new Date(), "Asia/Karachi");
    const report = await analyticsSeries({
      from: day,
      to: day,
      granularity: "day",
      userId: created.user.id,
      simId,
    });
    expect(report.totals).toMatchObject({
      sent: 1,
      delivered: 1,
      failed: 1,
      received: 1,
      deliveryRatio: 1,
      avgDeliverySec: 5,
    });
    expect(report.series[0]?.sent).toBe(1);
    expect(report.topFailureReasons[0]?.name).toBe("=cmd");
    const csv = await analyticsExport({ from: day, to: day, scope: "users" });
    expect(csv).toContain(`"'=cmd"`);
    await recordWorkerBeat();
    const health = await systemHealth();
    expect(health.db).toBe(true);
    expect(health.redis).toBe(true);
    expect(health.worker.lastBeatAt).not.toBeNull();
    expect(health.backup.lastAt).toBeNull();
    await patchConversation(token, sent.conversationId, { archived: true, tags: ["later"] });
    const archived = await listConversations(token, {
      filter: "archived",
      tag: "later",
      q: "991401",
    });
    expect(archived.conversations.some((row) => row.id === sent.conversationId)).toBe(true);
    await db
      .update(settings)
      .set({ value: { expiry_behavior_default: "block", allow_admin_support_view: true } })
      .where(eq(settings.key, "portal"));
    const support = await openSupportView(actor, created.user.id);
    expect(support.messages.some((row) => row.body === "Hello there")).toBe(true);
    const viewed = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "support.viewed"), eq(auditLogs.targetId, created.user.id)));
    expect(viewed).toHaveLength(1);
    await db
      .update(settings)
      .set({ value: { expiry_behavior_default: "block", allow_admin_support_view: false } })
      .where(eq(settings.key, "portal"));
    await expect(openSupportView(actor, created.user.id)).rejects.toMatchObject({ status: 404 });
  }, 60_000);
});
