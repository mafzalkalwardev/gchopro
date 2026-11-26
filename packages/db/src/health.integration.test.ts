import { randomUUID } from "node:crypto";
import { hashPassword } from "@gchopro/core";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createUser } from "./account-service.js";
import { deliverPendingAlerts, sweepDeviceAlerts } from "./alerts-service.js";
import { closeDb, getDb } from "./client.js";
import { applyStatusReports, ingestInbox } from "./device-messages.js";
import {
  authenticateDevice,
  createPairing,
  recordHeartbeat,
  registerDevice,
  reportSims,
  retestSim,
} from "./device-service.js";
import { indexPhone } from "./device-shared.js";
import { acceptAup, changePassword, login } from "./login.js";
import { processSend, sendMessage } from "./messaging.js";
import { closeRedis } from "./redis.js";
import { alerts, devices, messages, optOuts, settings, sims, users } from "./schema.js";

describe("health and compliance", () => {
  afterAll(async () => {
    await getDb()
      .update(settings)
      .set({
        value: { email: { enabled: false, to: [] }, telegram: { enabled: false, chat_id: null } },
      })
      .where(eq(settings.key, "alerts"));
    await getDb().update(settings).set({ value: [] }).where(eq(settings.key, "test_numbers"));
    await closeDb();
    await closeRedis();
  });

  it("opts out, pauses a suspected suspension, and resolves device alerts", async () => {
    const db = getDb();
    const adminId = uuidv7();
    const stamp = adminId.split("-").join("").slice(0, 8);
    await db.insert(users).values({
      id: adminId,
      role: "admin",
      username: `m5a${stamp}`,
      displayName: "Health admin",
      passwordHash: await hashPassword("integration-password-1"),
      passwordChangedAt: new Date(),
      mustChangePassword: false,
      status: "active",
    });
    const actor = { userId: adminId, role: "admin", ip: "203.0.113.90", requestId: randomUUID() };
    const pairing = await createPairing(actor, "Health rack");
    const registered = await registerDevice({
      code: pairing.code,
      name: "Health rack",
      protocolVersion: 2,
      appVersion: "2.0.0",
      model: "Infinix X6528",
      androidSdk: 34,
      ip: "203.0.113.91",
    });
    const auth = await authenticateDevice(registered.id, registered.token);
    const reported = await reportSims(auth.device, {
      reportedAt: new Date().toISOString(),
      slotsOnDevice: 1,
      sims: [
        {
          subscriptionId: 12,
          slotIndex: 0,
          isEmbedded: false,
          carrierName: "Jazz",
          displayName: "SIM 1",
          mcc: "410",
          mnc: "01",
          countryIso: "pk",
          number: "+923009991211",
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
    const created = await createUser(actor, {
      username: `m5u${stamp}`,
      displayName: "Health user",
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
      ip: "203.0.113.92",
      userAgent: "vitest",
      requestId: randomUUID(),
    });
    if (!signedIn.ok) throw new Error("login failed");
    await changePassword({
      token: signedIn.token,
      currentPassword: password,
      newPassword: "integration-password-2",
      ip: "203.0.113.92",
      requestId: randomUUID(),
    });
    await acceptAup(signedIn.token, "203.0.113.92", randomUUID());
    const token = signedIn.token;
    const beatAt = async (when: Date) => {
      await db.update(devices).set({ lastHeartbeatAt: when }).where(eq(devices.id, registered.id));
    };
    const noon = new Date();
    noon.setUTCHours(12, 0, 0, 0);
    if (noon.getTime() <= Date.now()) noon.setUTCDate(noon.getUTCDate() + 1);

    const queued = await sendMessage(token, { to: "+923009991201", body: "Hello there" });
    await ingestInbox(registered.id, [
      {
        providerId: `stop-${stamp}`,
        subscriptionId: 12,
        address: "+923009991201",
        body: "STOP",
        receivedAt: new Date().toISOString(),
      },
    ]);
    const stopped = (await db.select().from(messages).where(eq(messages.id, queued.message.id)))[0];
    expect(stopped?.status).toBe("blocked");
    expect(stopped?.blockReason).toBe("opted_out");
    const confirmation = await db
      .select()
      .from(messages)
      .where(and(eq(messages.userId, created.user.id), eq(messages.isOptOutConfirmation, true)));
    expect(confirmation).toHaveLength(1);
    await expect(sendMessage(token, { to: "+923009991201", body: "Again" })).rejects.toMatchObject({
      code: "opted_out",
    });
    await beatAt(noon);
    const confirmationSend = await processSend(confirmation[0]?.id ?? "", {
      now: noon,
      random: 0.5,
    });
    expect(confirmationSend.kind).not.toBe("block");
    await ingestInbox(registered.id, [
      {
        providerId: `start-${stamp}`,
        subscriptionId: 12,
        address: "+923009991201",
        body: "START",
        receivedAt: new Date().toISOString(),
      },
    ]);
    const stoppedHash = indexPhone("+923009991201");
    const activeKeyword = await db
      .select()
      .from(optOuts)
      .where(
        and(
          eq(optOuts.numberHash, stoppedHash),
          eq(optOuts.source, "keyword"),
          isNull(optOuts.reversedAt),
        ),
      );
    expect(activeKeyword).toHaveLength(0);

    const adminOptOut = uuidv7();
    await db.insert(optOuts).values({
      id: adminOptOut,
      numberHash: indexPhone("+923009991202"),
      scope: "global",
      source: "admin",
    });
    await ingestInbox(registered.id, [
      {
        providerId: `start-admin-${stamp}`,
        subscriptionId: 12,
        address: "+923009991202",
        body: "START",
        receivedAt: new Date().toISOString(),
      },
    ]);
    const still = (await db.select().from(optOuts).where(eq(optOuts.id, adminOptOut)))[0];
    expect(still?.reversedAt).toBeNull();

    const parked = await sendMessage(token, { to: "+923009991204", body: "Stay on this SIM" });
    const firstAt = new Date(noon.getTime() + 30 * 60 * 1000);
    const secondAt = new Date(firstAt.getTime() + 20_000);
    const failSignal = async (body: string, when: Date) => {
      const message = await sendMessage(token, { to: "+923009991203", body });
      await beatAt(when);
      expect((await processSend(message.message.id, { now: when, random: 0.5 })).kind).toBe(
        "dispatch",
      );
      await beatAt(new Date());
      await applyStatusReports(registered.id, [
        {
          id: message.message.id,
          event: "failed",
          partIndex: 0,
          partCount: 1,
          subscriptionId: 12,
          resultName: "RESULT_ERROR_LIMIT_EXCEEDED",
          at: when.toISOString(),
        },
      ]);
    };
    await failSignal("Signal one", firstAt);
    await failSignal("Signal two", secondAt);
    const sim = (await db.select().from(sims).where(eq(sims.id, simId)))[0];
    expect(sim?.health).toBe("suspected_suspended");
    const held = (await db.select().from(messages).where(eq(messages.id, parked.message.id)))[0];
    expect(held?.status).toBe("held");
    expect(held?.holdReason).toBe("sim_unhealthy");
    expect(held?.simId).toBe(simId);
    const suspension = await db
      .select()
      .from(alerts)
      .where(eq(alerts.dedupeKey, `sim_suspected_suspended:${simId}`));
    expect(suspension).toHaveLength(1);
    expect(suspension[0]?.severity).toBe("critical");
    await db
      .update(settings)
      .set({
        value: {
          email: { enabled: true, to: ["ops@example.com"] },
          telegram: { enabled: true, chat_id: "100" },
        },
      })
      .where(eq(settings.key, "alerts"));
    const notices: string[] = [];
    const sent = await deliverPendingAlerts({
      email: async (input) => {
        notices.push(input.text);
      },
      telegram: async (input) => {
        notices.push(input.text);
      },
    });
    expect(sent).toBeGreaterThan(0);
    expect(notices.some((text) => text.includes("sim_suspected_suspended"))).toBe(true);
    expect(notices.some((text) => text.includes("+923009991211"))).toBe(false);
    const again: string[] = [];
    await deliverPendingAlerts({
      email: async (input) => {
        again.push(input.text);
      },
      telegram: async (input) => {
        again.push(input.text);
      },
    });
    expect(again.some((text) => text.includes("sim_suspected_suspended"))).toBe(false);

    await db
      .update(settings)
      .set({ value: ["+923009991299"] })
      .where(eq(settings.key, "test_numbers"));
    const failedTest = await retestSim(actor, simId, "+923009991299");
    await beatAt(new Date());
    await applyStatusReports(registered.id, [
      {
        id: failedTest.messageId,
        event: "failed",
        partIndex: 0,
        partCount: 1,
        subscriptionId: 12,
        resultName: "RESULT_ERROR_GENERIC_FAILURE",
        at: new Date().toISOString(),
      },
    ]);
    expect((await db.select().from(sims).where(eq(sims.id, simId)))[0]?.health).toBe(
      "suspected_suspended",
    );
    const passedTest = await retestSim(actor, simId, "+923009991299");
    await beatAt(new Date());
    await applyStatusReports(registered.id, [
      {
        id: passedTest.messageId,
        event: "sent",
        partIndex: 0,
        partCount: 1,
        subscriptionId: 12,
        at: new Date().toISOString(),
      },
    ]);
    expect((await db.select().from(sims).where(eq(sims.id, simId)))[0]?.health).toBe("active");
    expect(
      (await db.select().from(messages).where(eq(messages.id, parked.message.id)))[0]?.status,
    ).toBe("queued");

    await db
      .update(devices)
      .set({ lastHeartbeatAt: new Date(Date.now() - 20 * 60 * 1000), battery: 10, charging: false })
      .where(eq(devices.id, registered.id));
    await sweepDeviceAlerts();
    await sweepDeviceAlerts();
    const offline = await db
      .select()
      .from(alerts)
      .where(
        and(eq(alerts.dedupeKey, `device_offline:${registered.id}`), isNull(alerts.resolvedAt)),
      );
    const battery = await db
      .select()
      .from(alerts)
      .where(
        and(eq(alerts.dedupeKey, `device_battery_low:${registered.id}`), isNull(alerts.resolvedAt)),
      );
    expect(offline).toHaveLength(1);
    expect(battery).toHaveLength(1);
    await recordHeartbeat(auth.device, {
      battery: 80,
      charging: true,
      network: "wifi",
      appVersion: "2.0.0",
      androidSdk: 34,
      activeModemCount: 1,
    });
    expect(
      (
        await db
          .select()
          .from(alerts)
          .where(eq(alerts.dedupeKey, `device_offline:${registered.id}`))
      )[0]?.resolvedAt,
    ).not.toBeNull();
    expect(
      (
        await db
          .select()
          .from(alerts)
          .where(eq(alerts.dedupeKey, `device_battery_low:${registered.id}`))
      )[0]?.resolvedAt,
    ).not.toBeNull();
  }, 60_000);
});
