import { randomUUID } from "node:crypto";
import { TranslationFailure, hashPassword, type TranslationProvider } from "@gchopro/core";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createUser } from "./account-service.js";
import { closeDb, getDb } from "./client.js";
import { ingestInbox } from "./device-messages.js";
import {
  authenticateDevice,
  createPairing,
  recordHeartbeat,
  registerDevice,
  reportSims,
} from "./device-service.js";
import { openSeal } from "./device-shared.js";
import { acceptAup, changePassword, login } from "./login.js";
import { listThread, processSend, sendMessage } from "./messaging.js";
import { closeRedis } from "./redis.js";
import { devices, messages, settings, users } from "./schema.js";
import { sendUntranslated, translateQueued } from "./translation-service.js";

const translating: TranslationProvider = {
  id: "libretranslate",
  async translate(input) {
    if (input.target === "en") return { text: "Hello", characters: [...input.text].length };
    return { text: "你好", characters: [...input.text].length };
  },
  async health() {
    return true;
  },
};

const failing: TranslationProvider = {
  id: "libretranslate",
  async translate() {
    throw new TranslationFailure();
  },
  async health() {
    return false;
  },
};

describe("translation", () => {
  afterAll(async () => {
    await getDb()
      .update(settings)
      .set({
        value: {
          provider: "none",
          deepl: { plan: "free" },
          google: {},
          libretranslate: { url: null },
          preview_before_send: true,
        },
      })
      .where(eq(settings.key, "translation"));
    await closeDb();
    await closeRedis();
  });

  it("sends Chinese as English, shows an inbound translation, and can send the original after a failure", async () => {
    const db = getDb();
    const adminId = uuidv7();
    const stamp = adminId.split("-").join("").slice(0, 8);
    await db.insert(users).values({
      id: adminId,
      role: "admin",
      username: `m6a${stamp}`,
      displayName: "Translation admin",
      passwordHash: await hashPassword("integration-password-1"),
      passwordChangedAt: new Date(),
      mustChangePassword: false,
      status: "active",
    });
    const actor = { userId: adminId, role: "admin", ip: "203.0.113.100", requestId: randomUUID() };
    const pairing = await createPairing(actor, "Translation rack");
    const registered = await registerDevice({
      code: pairing.code,
      name: "Translation rack",
      protocolVersion: 2,
      appVersion: "2.0.0",
      model: "Infinix X6528",
      androidSdk: 34,
      ip: "203.0.113.101",
    });
    const auth = await authenticateDevice(registered.id, registered.token);
    const reported = await reportSims(auth.device, {
      reportedAt: new Date().toISOString(),
      slotsOnDevice: 1,
      sims: [
        {
          subscriptionId: 13,
          slotIndex: 0,
          isEmbedded: false,
          carrierName: "Jazz",
          displayName: "SIM 1",
          mcc: "410",
          mnc: "01",
          countryIso: "pk",
          number: "+923009991311",
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
      username: `m6u${stamp}`,
      displayName: "Translation user",
      simId,
      userLanguage: "zh",
      recipientLanguage: "en",
      translationEnabled: true,
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
      ip: "203.0.113.102",
      userAgent: "vitest",
      requestId: randomUUID(),
    });
    if (!signedIn.ok) throw new Error("login failed");
    await changePassword({
      token: signedIn.token,
      currentPassword: password,
      newPassword: "integration-password-2",
      ip: "203.0.113.102",
      requestId: randomUUID(),
    });
    await acceptAup(signedIn.token, "203.0.113.102", randomUUID());
    const token = signedIn.token;
    await db
      .update(settings)
      .set({
        value: {
          provider: "libretranslate",
          deepl: { plan: "free" },
          google: {},
          libretranslate: { url: "http://libre.invalid" },
          preview_before_send: true,
        },
      })
      .where(eq(settings.key, "translation"));
    const beatAt = async (when: Date) => {
      await db.update(devices).set({ lastHeartbeatAt: when }).where(eq(devices.id, registered.id));
    };
    const noon = new Date();
    noon.setUTCHours(12, 0, 0, 0);
    if (noon.getTime() <= Date.now()) noon.setUTCDate(noon.getUTCDate() + 1);
    const secondAt = new Date(noon.getTime() + 20_000);
    const expiredAt = new Date(secondAt.getTime() + 3 * 60 * 1000 + 1_000);

    const sent = await sendMessage(token, { to: "+923009991301", body: "你好" });
    expect(
      await translateQueued(sent.message.id, "outbound_original", {
        provider: translating,
        delays: [0, 0, 0],
      }),
    ).toBe("done");
    await beatAt(noon);
    expect((await processSend(sent.message.id, { now: noon, random: 0.5 })).kind).toBe("dispatch");
    const wire = (await db.select().from(messages).where(eq(messages.id, sent.message.id)))[0];
    expect(openSeal(`messages.wire_body_enc.${sent.message.id}`, wire?.wireBodyEnc ?? null)).toBe(
      "Hello",
    );
    const thread = await listThread(token, sent.conversationId);
    const bubble = thread.messages.find((row) => row.id === sent.message.id);
    expect(bubble?.original).toBe("你好");
    expect(bubble?.translated).toBe("Hello");
    expect(bubble?.preferred).toBe("original");
    await db
      .update(messages)
      .set({ status: "sent", leaseExpiresAt: noon })
      .where(eq(messages.id, sent.message.id));

    await ingestInbox(registered.id, [
      {
        providerId: `in-${stamp}`,
        subscriptionId: 13,
        address: "+923009991302",
        body: "Hello",
        receivedAt: new Date().toISOString(),
      },
    ]);
    const inbound = (
      await db.select().from(messages).where(eq(messages.userId, created.user.id))
    ).find((row) => row.direction === "in");
    if (inbound === undefined) throw new Error("inbound missing");
    expect(
      await translateQueued(inbound.id, "inbound_display", {
        provider: translating,
        delays: [0, 0, 0],
      }),
    ).toBe("done");
    const inboundThread = await listThread(token, inbound.conversationId);
    const inboundBubble = inboundThread.messages.find((row) => row.id === inbound.id);
    expect(inboundBubble?.original).toBe("Hello");
    expect(inboundBubble?.translated).toBe("你好");
    expect(inboundBubble?.preferred).toBe("translated");

    const blocked = await sendMessage(token, { to: "+923009991301", body: "失败" });
    expect(
      await translateQueued(blocked.message.id, "outbound_original", {
        provider: failing,
        delays: [0, 0, 0],
      }),
    ).toBe("failed");
    await db
      .update(messages)
      .set({ queuedAt: secondAt })
      .where(eq(messages.id, blocked.message.id));
    await beatAt(secondAt);
    expect((await processSend(blocked.message.id, { now: secondAt, random: 0.5 })).kind).toBe(
      "hold",
    );
    await beatAt(expiredAt);
    expect((await processSend(blocked.message.id, { now: expiredAt, random: 0.5 })).kind).toBe(
      "fail",
    );
    expect(
      (await db.select().from(messages).where(eq(messages.id, blocked.message.id)))[0]?.failureName,
    ).toBe("TRANSLATION_TIMEOUT");
    await sendUntranslated(token, blocked.message.id);
    const againAt = new Date(expiredAt.getTime() + 20_000);
    await beatAt(againAt);
    expect((await processSend(blocked.message.id, { now: againAt, random: 0.5 })).kind).toBe(
      "dispatch",
    );
    const original = (
      await db.select().from(messages).where(eq(messages.id, blocked.message.id))
    )[0];
    expect(
      openSeal(`messages.wire_body_enc.${blocked.message.id}`, original?.wireBodyEnc ?? null),
    ).toBe("失败");

    await db
      .update(settings)
      .set({
        value: {
          provider: "none",
          deepl: { plan: "free" },
          google: {},
          libretranslate: { url: null },
          preview_before_send: true,
        },
      })
      .where(eq(settings.key, "translation"));
    await db
      .update(messages)
      .set({ status: "sent", leaseExpiresAt: againAt })
      .where(eq(messages.id, blocked.message.id));
    const plainAt = new Date(againAt.getTime() + 20_000);
    const plain = await sendMessage(token, { to: "+923009991303", body: "你好呀" });
    await beatAt(plainAt);
    expect((await processSend(plain.message.id, { now: plainAt, random: 0.5 })).kind).toBe(
      "dispatch",
    );
    const plainRow = (await db.select().from(messages).where(eq(messages.id, plain.message.id)))[0];
    expect(
      openSeal(`messages.wire_body_enc.${plain.message.id}`, plainRow?.wireBodyEnc ?? null),
    ).toBe("你好呀");
  }, 60_000);
});
