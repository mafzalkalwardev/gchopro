import { randomUUID } from "node:crypto";
import { hashPassword } from "@gchopro/core";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { closeDb, getDb } from "./client.js";
import { indexPhone, openSeal, seal } from "./device-shared.js";
import { recordBackup } from "./backup-service.js";
import { systemHealth } from "./analytics-service.js";
import { deleteUserData, purgeRetention } from "./retention.js";
import { closeRedis } from "./redis.js";
import {
  auditLogs,
  contacts,
  conversations,
  messageTranslations,
  messages,
  sims,
  users,
} from "./schema.js";

describe("retention", () => {
  afterAll(async () => {
    await closeDb();
    await closeRedis();
  });

  it("purges old bodies, anonymizes a user, and records a backup time", async () => {
    const db = getDb();
    const demo = (await db.select().from(users).where(eq(users.username, "demo1")))[0];
    const admin = (await db.select().from(users).where(eq(users.username, "admin")))[0];
    if (demo?.simId === null || demo?.simId === undefined || admin === undefined) {
      throw new Error("seed user missing");
    }
    const sim = (await db.select().from(sims).where(eq(sims.id, demo.simId)))[0];
    if (sim === undefined) throw new Error("seed sim missing");
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    const conversationId = uuidv7();
    const messageId = uuidv7();
    const peer = "+923009991811";
    await db.insert(conversations).values({
      id: conversationId,
      userId: demo.id,
      simId: sim.id,
      peerNumberEnc: seal(`conversations.peer_number_enc.${conversationId}`, peer),
      peerNumberHash: indexPhone(peer),
      lastMessageAt: old,
      lastPreviewEnc: seal(`conversations.last_preview_enc.${conversationId}`, "old preview"),
    });
    await db.insert(messages).values({
      id: messageId,
      conversationId,
      userId: demo.id,
      simId: sim.id,
      deviceId: sim.deviceId,
      direction: "out",
      peerNumberHash: indexPhone(peer),
      wireBodyEnc: seal(`messages.wire_body_enc.${messageId}`, "old body"),
      status: "delivered",
      segments: 1,
      createdAt: old,
    });
    await db.insert(messageTranslations).values({
      id: uuidv7(),
      messageId,
      role: "outbound_original",
      sourceLang: "en",
      targetLang: "zh",
      sourceTextEnc: seal(`message_translations.source_text_enc.${messageId}`, "old body"),
      provider: "none",
    });
    expect(await purgeRetention()).toBeGreaterThan(0);
    const kept = (await db.select().from(messages).where(eq(messages.id, messageId)))[0];
    expect(kept?.wireBodyEnc).toBeNull();
    expect(kept?.status).toBe("delivered");
    const translated = await db
      .select()
      .from(messageTranslations)
      .where(eq(messageTranslations.messageId, messageId));
    expect(translated).toHaveLength(0);
    const thread = (
      await db.select().from(conversations).where(eq(conversations.id, conversationId))
    )[0];
    expect(thread?.lastPreviewEnc).toBeNull();

    const userId = uuidv7();
    const stamp = userId.split("-").join("").slice(0, 8);
    await db.insert(users).values({
      id: userId,
      role: "user",
      username: `m8u${stamp}`,
      displayName: "Retention user",
      passwordHash: await hashPassword("integration-password-1"),
      passwordChangedAt: new Date(),
      mustChangePassword: false,
      status: "active",
    });
    const contactId = uuidv7();
    const ownConversation = uuidv7();
    await db.insert(contacts).values({
      id: contactId,
      userId,
      nameEnc: seal(`contacts.name_enc.${contactId}`, "Ada"),
      numberEnc: seal(`contacts.number_enc.${contactId}`, "+923009991812"),
      numberHash: indexPhone("+923009991812"),
      consentSource: "existing_customer",
    });
    await db.insert(conversations).values({
      id: ownConversation,
      userId,
      simId: sim.id,
      peerNumberEnc: seal(`conversations.peer_number_enc.${ownConversation}`, "+923009991812"),
      peerNumberHash: indexPhone("+923009991812"),
      lastMessageAt: new Date(),
      lastPreviewEnc: seal(`conversations.last_preview_enc.${ownConversation}`, "hello"),
    });
    const actor = {
      userId: admin.id,
      role: "admin",
      ip: "203.0.113.120",
      requestId: randomUUID(),
    };
    await deleteUserData(actor, userId);
    const contact = (await db.select().from(contacts).where(eq(contacts.id, contactId)))[0];
    expect(openSeal(`contacts.name_enc.${contactId}`, contact?.nameEnc ?? null)).toBe("redacted");
    const hidden = (
      await db.select().from(conversations).where(eq(conversations.id, ownConversation))
    )[0];
    expect(
      openSeal(`conversations.peer_number_enc.${ownConversation}`, hidden?.peerNumberEnc ?? null),
    ).toContain("redacted:");
    expect(hidden?.lastPreviewEnc).toBeNull();
    const audited = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "user.data_deleted"), eq(auditLogs.targetId, userId)));
    expect(audited).toHaveLength(1);

    const at = new Date("2026-11-26T02:00:00.000Z");
    await recordBackup("last", at);
    const health = await systemHealth();
    expect(health.backup.lastAt).toBe(at.toISOString());
    expect(health.backup.restoreTestAt).toBeNull();
  });
});
