import { randomUUID } from "node:crypto";
import { AppError, hashPassword } from "@gchopro/core";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createUser } from "./account-service.js";
import { clearCaps } from "./caps.js";
import { closeDb, getDb } from "./client.js";
import { applyStatusReports, ingestInbox, pendingWork } from "./device-messages.js";
import {
  authenticateDevice,
  createPairing,
  recordHeartbeat,
  registerDevice,
  reportSims,
} from "./device-service.js";
import { indexPhone } from "./device-shared.js";
import { acceptAup, changePassword, login } from "./login.js";
import { savePortalTemplate } from "./catalog.js";
import { listThread, processSend, promoteScheduled, sendGroup, sendMessage } from "./messaging.js";
import { closeRedis, openUserEvents } from "./redis.js";
import { messages, optOuts, settings, sims, users, devices } from "./schema.js";

const OPEN = new Date("2026-06-01T12:00:00.000Z");

describe("paced messaging", () => {
  afterAll(async () => {
    await getDb()
      .update(settings)
      .set({ value: { enabled: false, reason: null, since: null } })
      .where(eq(settings.key, "kill_switch"));
    await closeDb();
    await closeRedis();
  });

  it("sends, reports, paces, and retries on the same SIM", async () => {
    const db = getDb();
    const adminId = uuidv7();
    const stamp = adminId.split("-").join("").slice(0, 8);
    await db.insert(users).values({
      id: adminId,
      role: "admin",
      username: `m4a${stamp}`,
      displayName: "Messaging admin",
      passwordHash: await hashPassword("integration-password-1"),
      passwordChangedAt: new Date(),
      mustChangePassword: false,
      status: "active",
    });
    const actor = { userId: adminId, role: "admin", ip: "203.0.113.80", requestId: randomUUID() };
    const pairing = await createPairing(actor, "Messaging rack");
    const registered = await registerDevice({
      code: pairing.code,
      name: "Messaging rack",
      protocolVersion: 2,
      appVersion: "2.0.0",
      model: "Infinix X6528",
      androidSdk: 34,
      ip: "203.0.113.81",
    });
    const auth = await authenticateDevice(registered.id, registered.token);
    const reported = await reportSims(auth.device, {
      reportedAt: new Date().toISOString(),
      slotsOnDevice: 1,
      sims: [
        {
          subscriptionId: 11,
          slotIndex: 0,
          isEmbedded: false,
          carrierName: "Jazz",
          displayName: "SIM 1",
          mcc: "410",
          mnc: "01",
          countryIso: "pk",
          number: "+923009990111",
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
      username: `m4u${stamp}`,
      displayName: "Messaging user",
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
      ip: "203.0.113.82",
      userAgent: "vitest",
      requestId: randomUUID(),
    });
    if (!signedIn.ok) throw new Error("login failed");
    await changePassword({
      token: signedIn.token,
      currentPassword: password,
      newPassword: "integration-password-2",
      ip: "203.0.113.82",
      requestId: randomUUID(),
    });
    await acceptAup(signedIn.token, "203.0.113.82", randomUUID());
    const token = signedIn.token;
    const beatAt = async (when: Date) => {
      await db.update(devices).set({ lastHeartbeatAt: when }).where(eq(devices.id, registered.id));
    };

    const sent = await sendMessage(token, { to: "+923009990001", body: "Desk note for the line" });
    await beatAt(OPEN);
    await db.update(sims).set({ health: "suspected_suspended" }).where(eq(sims.id, simId));
    const parked = await processSend(sent.message.id, { now: OPEN, random: 0.5 });
    expect(parked).toMatchObject({ kind: "hold", reason: "sim_unhealthy" });
    expect(
      (await db.select().from(messages).where(eq(messages.id, sent.message.id)))[0]?.simId,
    ).toBe(simId);
    await db.update(sims).set({ health: "active" }).where(eq(sims.id, simId));

    const heard: string[] = [];
    const events = openUserEvents(created.user.id, (message) => {
      heard.push(message);
    });
    await events.ready;
    const dispatched = await processSend(sent.message.id, { now: OPEN, random: 0.5 });
    expect(dispatched.kind).toBe("dispatch");
    await db
      .update(messages)
      .set({ leaseExpiresAt: new Date(Date.now() + 60_000) })
      .where(eq(messages.id, sent.message.id));
    const pending = await pendingWork(registered.id);
    expect(pending.messages.some((message) => message.id === sent.message.id)).toBe(true);
    await applyStatusReports(registered.id, [
      {
        id: sent.message.id,
        event: "sent",
        partIndex: 0,
        partCount: 1,
        subscriptionId: 11,
        at: OPEN.toISOString(),
      },
    ]);
    await ingestInbox(registered.id, [
      {
        providerId: `in-${stamp}`,
        subscriptionId: 11,
        address: "+923009990001",
        body: "reply from the line",
        receivedAt: OPEN.toISOString(),
      },
    ]);
    const started = Date.now();
    while (
      (!heard.some((message) => message.includes("message.status")) ||
        !heard.some((message) => message.includes("message.received"))) &&
      Date.now() - started < 2000
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await events.close();
    expect(heard.some((message) => message.includes("message.status"))).toBe(true);
    expect(heard.some((message) => message.includes("message.received"))).toBe(true);
    const thread = await listThread(token, sent.conversationId);
    expect(thread.messages.some((message) => message.status === "sent")).toBe(true);
    expect(thread.messages.some((message) => message.status === "received")).toBe(true);

    const key = randomUUID();
    const first = await sendMessage(token, {
      to: "+923009990001",
      body: "Once",
      idempotencyKey: key,
    });
    const second = await sendMessage(token, {
      to: "+923009990001",
      body: "Once",
      idempotencyKey: key,
    });
    expect(second.message.id).toBe(first.message.id);

    const template = await savePortalTemplate(token, {
      name: `hello-${stamp}`,
      body: "Hi {name}",
      kind: "template",
    });
    await expect(
      sendMessage(token, { to: "+923009990001", body: "Hi", templateId: template.id }),
    ).rejects.toBeInstanceOf(AppError);

    await db.insert(optOuts).values({
      id: uuidv7(),
      numberHash: indexPhone("+923009990003"),
      scope: "global",
      source: "admin",
    });
    const group = await sendGroup(token, {
      recipients: ["+923009990002", "+923009990003"],
      body: "Group note",
    });
    expect(group.messages.filter((message) => message.status === "blocked")).toHaveLength(1);
    expect(group.messages.every((message) => message.simId === simId)).toBe(true);

    const noon = new Date();
    noon.setUTCHours(12, 0, 0, 0);
    if (noon.getTime() <= Date.now()) noon.setUTCDate(noon.getUTCDate() + 1);
    const scheduled = await sendMessage(token, {
      to: "+923009990001",
      body: "Later",
      scheduledFor: noon.toISOString(),
    });
    expect(scheduled.message.status).toBe("scheduled");
    await promoteScheduled(new Date(noon.getTime() - 60_000));
    expect(
      (await db.select().from(messages).where(eq(messages.id, scheduled.message.id)))[0]?.status,
    ).toBe("scheduled");
    await promoteScheduled(noon);
    await beatAt(noon);
    expect((await processSend(scheduled.message.id, { now: noon, random: 0.5 })).kind).toBe(
      "dispatch",
    );

    const base = new Date(noon.getTime() + 30 * 60 * 1000);
    for (let index = 0; index < 3; index += 1) {
      const message = await sendMessage(token, { to: "+923009990004", body: `Pace ${index}` });
      const when = new Date(base.getTime() + index * 20_000);
      await beatAt(when);
      const step = await processSend(message.message.id, { now: when, random: 0.5 });
      expect(step.kind).toBe("dispatch");
    }
    const fourth = await sendMessage(token, { to: "+923009990004", body: "Pace hold" });
    const holdAt = new Date(base.getTime() + 50_000);
    await beatAt(holdAt);
    const held = await processSend(fourth.message.id, { now: holdAt, random: 0.5 });
    expect(held).toMatchObject({ kind: "hold", reason: "rate_minute" });
    await clearCaps("u", created.user.id);
    const releaseAt = new Date(base.getTime() + 80_000);
    await beatAt(releaseAt);
    const released = await processSend(fourth.message.id, { now: releaseAt, random: 0.5 });
    expect(released.kind).toBe("dispatch");

    const closed = await sendMessage(token, { to: "+923009990001", body: "Before the window" });
    const windowHeld = await processSend(closed.message.id, {
      now: new Date("2026-06-01T02:00:00.000Z"),
      random: 0,
    });
    expect(windowHeld).toMatchObject({ kind: "hold", reason: "window" });

    const retryAt = new Date(base.getTime() + 2 * 60 * 60 * 1000);
    const retry = await sendMessage(token, { to: "+923009990005", body: "Try again" });
    await beatAt(retryAt);
    expect((await processSend(retry.message.id, { now: retryAt, random: 0.5 })).kind).toBe(
      "dispatch",
    );
    await applyStatusReports(registered.id, [
      {
        id: retry.message.id,
        event: "failed",
        partIndex: 0,
        partCount: 1,
        subscriptionId: 11,
        resultName: "RESULT_ERROR_GENERIC_FAILURE",
        at: retryAt.toISOString(),
      },
    ]);
    const retried = (await db.select().from(messages).where(eq(messages.id, retry.message.id)))[0];
    expect(retried?.simId).toBe(simId);
    expect(retried?.status).toBe("queued");
    const againAt = new Date(retryAt.getTime() + 2 * 60 * 1000);
    await beatAt(againAt);
    expect((await processSend(retry.message.id, { now: againAt, random: 0.5 })).kind).toBe(
      "dispatch",
    );

    const stopped = await sendMessage(token, { to: "+923009990001", body: "Should wait" });
    await db
      .update(settings)
      .set({ value: { enabled: true, reason: "drill", since: new Date().toISOString() } })
      .where(eq(settings.key, "kill_switch"));
    await expect(
      sendMessage(token, { to: "+923009990001", body: "Blocked by the switch" }),
    ).rejects.toMatchObject({
      code: "kill_switch",
    });
    const heldSwitch = await processSend(stopped.message.id, { now: againAt, random: 0.5 });
    expect(heldSwitch).toMatchObject({ kind: "hold", reason: "kill_switch" });
  }, 60_000);
});
