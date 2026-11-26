import { AppError, SAFE_TEXT, settingSchemas } from "@gchopro/core";
import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { appendAudit } from "./audit.js";
import { getDb } from "./client.js";
import { indexPhone, seal, type AdminActor } from "./device-shared.js";
import {
  contactGroups,
  contacts,
  conversations,
  messageTranslations,
  messages,
  settings,
  users,
} from "./schema.js";

const BATCH = 500;

async function rawSetting(key: string): Promise<unknown> {
  const rows = await getDb().select().from(settings).where(eq(settings.key, key)).limit(1);
  return rows[0]?.value;
}

export async function purgeRetention(now = new Date()): Promise<number> {
  const parsed = settingSchemas.retention.safeParse(await rawSetting("retention"));
  const days = parsed.success ? parsed.data.message_body_days : 180;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const db = getDb();
  let total = 0;
  for (;;) {
    const batch = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(lt(messages.createdAt, cutoff), isNotNull(messages.wireBodyEnc)))
      .limit(BATCH);
    if (batch.length === 0) break;
    const ids = batch.map((row) => row.id);
    await db.transaction(async (tx) => {
      await tx.update(messages).set({ wireBodyEnc: null }).where(inArray(messages.id, ids));
      await tx.delete(messageTranslations).where(inArray(messageTranslations.messageId, ids));
    });
    total += ids.length;
    if (batch.length < BATCH) break;
  }
  await db
    .update(conversations)
    .set({ lastPreviewEnc: null })
    .where(and(lt(conversations.lastMessageAt, cutoff), isNotNull(conversations.lastPreviewEnc)));
  return total;
}

export async function deleteUserData(actor: AdminActor, userId: string): Promise<void> {
  const db = getDb();
  const owners = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const owner = owners[0];
  if (owner === undefined || owner.role !== "user") {
    throw new AppError(404, "not_found", SAFE_TEXT.not_found);
  }
  await db.transaction(async (tx) => {
    const bodies = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.userId, userId));
    const messageIds = bodies.map((row) => row.id);
    if (messageIds.length > 0) {
      await tx.update(messages).set({ wireBodyEnc: null }).where(inArray(messages.id, messageIds));
      await tx
        .delete(messageTranslations)
        .where(inArray(messageTranslations.messageId, messageIds));
    }
    const threads = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.userId, userId));
    for (const thread of threads) {
      const marker = `redacted:${thread.id}`;
      await tx
        .update(conversations)
        .set({
          peerNumberEnc: seal(`conversations.peer_number_enc.${thread.id}`, marker),
          peerNumberHash: indexPhone(marker),
          lastPreviewEnc: null,
          contactId: null,
        })
        .where(eq(conversations.id, thread.id));
    }
    const people = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.userId, userId));
    for (const person of people) {
      const marker = `redacted:${person.id}`;
      await tx
        .update(contacts)
        .set({
          nameEnc: seal(`contacts.name_enc.${person.id}`, "redacted"),
          numberEnc: seal(`contacts.number_enc.${person.id}`, marker),
          numberHash: indexPhone(marker),
        })
        .where(eq(contacts.id, person.id));
    }
    const groups = await tx
      .select({ id: contactGroups.id })
      .from(contactGroups)
      .where(eq(contactGroups.userId, userId));
    for (const group of groups) {
      await tx
        .update(contactGroups)
        .set({ name: `redacted-${group.id.slice(0, 8)}` })
        .where(eq(contactGroups.id, group.id));
    }
    await appendAudit(
      tx,
      {
        userId: actor.userId,
        role: actor.role,
        kind: "admin",
        ip: actor.ip,
        requestId: actor.requestId,
      },
      "user.data_deleted",
      { type: "user", id: userId },
      null,
      { messages: messageIds.length, conversations: threads.length, contacts: people.length },
    );
  });
}
