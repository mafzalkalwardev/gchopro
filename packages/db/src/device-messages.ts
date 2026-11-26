import {
  AppError,
  SAFE_TEXT,
  aggregateReport,
  classifyFailure,
  type StatusReport,
} from "@gchopro/core";
import { and, asc, eq, gt } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import type { Db } from "./client.js";
import { getDb } from "./client.js";
import { handleInboundKeywords } from "./compliance.js";
import { noteSendOutcome } from "./device-service.js";
import { requeueSameSim } from "./messaging.js";
import { publishUser } from "./redis.js";
import { indexPhone, normalizePhone, openSeal, readRegion, seal } from "./device-shared.js";
import { alerts, conversations, messagePartReports, messages, sims, users } from "./schema.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function pendingWork(deviceId: string) {
  const now = new Date();
  const rows = await getDb()
    .select({
      id: messages.id,
      simId: messages.simId,
      body: messages.wireBodyEnc,
      segments: messages.segments,
      leaseExpiresAt: messages.leaseExpiresAt,
      peer: messages.peerNumberHash,
      conversationId: messages.conversationId,
      subscriptionId: sims.subscriptionId,
      slotIndex: sims.slotIndex,
      dispatchedAt: messages.dispatchedAt,
    })
    .from(messages)
    .innerJoin(sims, eq(sims.id, messages.simId))
    .where(
      and(
        eq(messages.deviceId, deviceId),
        eq(messages.status, "dispatched"),
        gt(messages.leaseExpiresAt, now),
      ),
    )
    .orderBy(asc(messages.dispatchedAt));
  const seen = new Set<string>();
  const chosen = [];
  for (const row of rows) {
    if (seen.has(row.simId)) continue;
    seen.add(row.simId);
    const conversation = await getDb()
      .select({ enc: conversations.peerNumberEnc })
      .from(conversations)
      .where(eq(conversations.id, row.conversationId))
      .limit(1);
    const address = openSeal(
      `conversations.peer_number_enc.${row.conversationId}`,
      conversation[0]?.enc ?? null,
    );
    chosen.push({
      id: row.id,
      subscriptionId: row.subscriptionId,
      slotIndex: row.slotIndex,
      address: address ?? "",
      body: openSeal(`messages.wire_body_enc.${row.id}`, row.body) ?? "",
      segments: row.segments ?? 1,
      leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? now.toISOString(),
    });
  }
  return { messages: chosen, pollAgainMs: 3000 };
}

async function partCounts(tx: Tx, messageId: string) {
  const rows = await tx
    .select({ event: messagePartReports.event, partIndex: messagePartReports.partIndex })
    .from(messagePartReports)
    .where(eq(messagePartReports.messageId, messageId));
  const sent = new Set<number>();
  const failed = new Set<number>();
  const delivered = new Set<number>();
  for (const row of rows) {
    if (row.event === "sent") sent.add(row.partIndex);
    if (row.event === "failed" || row.event === "delivery_failed") failed.add(row.partIndex);
    if (row.event === "delivered") delivered.add(row.partIndex);
  }
  return { sent: sent.size, failed: failed.size, delivered: delivered.size };
}

export async function applyStatusReports(deviceId: string, reports: StatusReport[]) {
  const db = getDb();
  let status: "dispatched" | "sent" | "delivered" | "failed" = "dispatched";
  const outcomes: {
    simId: string;
    outcome: "sent" | "failed" | "delivered";
    failureName: string | null;
    failureCode: number | null;
    isRetest: boolean;
  }[] = [];
  const live: {
    userId: string;
    messageId: string;
    status: string;
    simId: string;
    attempts: number;
    failureClass: string | null;
    deliveryFailed: boolean;
  }[] = [];
  await db.transaction(async (tx) => {
    for (const report of reports) {
      const rows = await tx.select().from(messages).where(eq(messages.id, report.id)).limit(1);
      const message = rows[0];
      if (message === undefined || message.deviceId !== deviceId) {
        throw new AppError(404, "not_found", SAFE_TEXT.not_found);
      }
      await tx
        .insert(messagePartReports)
        .values({
          messageId: report.id,
          event: report.event,
          partIndex: report.partIndex,
          resultCode: report.resultCode ?? null,
          resultName: report.resultName ?? null,
          reportedAt: new Date(report.at),
        })
        .onConflictDoNothing();
      const counts = await partCounts(tx, report.id);
      status = aggregateReport({ partCount: report.partCount, ...counts });
      const simRows = await tx.select().from(sims).where(eq(sims.id, message.simId)).limit(1);
      const failureName = report.resultName ?? null;
      const failureClass =
        status === "failed"
          ? classifyFailure(failureName ?? "unknown", simRows[0]?.serviceState ?? null)
          : null;
      await tx
        .update(messages)
        .set({
          status,
          partsSent: counts.sent,
          partsDelivered: counts.delivered,
          sentAt:
            status === "sent" || status === "delivered" ? new Date(report.at) : message.sentAt,
          deliveredAt: status === "delivered" ? new Date(report.at) : message.deliveredAt,
          failedAt: status === "failed" ? new Date(report.at) : message.failedAt,
          failureName: status === "failed" ? failureName : message.failureName,
          failureCode: status === "failed" ? (report.resultCode ?? null) : message.failureCode,
          failureClass: status === "failed" ? failureClass : message.failureClass,
        })
        .where(eq(messages.id, message.id));
      if (status === "sent" || status === "delivered" || status === "failed") {
        outcomes.push({
          simId: message.simId,
          outcome: status,
          failureName,
          failureCode: report.resultCode ?? null,
          isRetest: message.isRetest,
        });
        live.push({
          userId: message.userId,
          messageId: message.id,
          status,
          simId: message.simId,
          attempts: message.attempts,
          failureClass,
          deliveryFailed: report.event === "delivery_failed",
        });
      }
    }
  });
  for (const outcome of outcomes) await noteSendOutcome(outcome);
  for (const item of live) {
    await publishUser(item.userId, {
      type: "message.status",
      messageId: item.messageId,
      status: item.status,
    });
    if (item.status === "failed") {
      await requeueSameSim(
        item.messageId,
        item.simId,
        item.attempts,
        item.failureClass ?? "unknown",
        item.deliveryFailed,
      );
    }
  }
  return { ok: true, status };
}

export async function ingestInbox(
  deviceId: string,
  rows: {
    providerId: string;
    subscriptionId: number;
    address: string;
    body: string;
    receivedAt: string;
  }[],
) {
  const db = getDb();
  const region = await readRegion(db);
  let inserted = 0;
  let duplicates = 0;
  let unroutable = 0;
  const received: { userId: string; messageId: string }[] = [];
  await db.transaction(async (tx) => {
    for (const row of rows) {
      const existing = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.deviceId, deviceId), eq(messages.providerId, row.providerId)))
        .limit(1);
      if (existing.length > 0) {
        duplicates += 1;
        continue;
      }
      const simRows = await tx
        .select()
        .from(sims)
        .where(and(eq(sims.deviceId, deviceId), eq(sims.subscriptionId, row.subscriptionId)))
        .limit(1);
      const sim = simRows[0];
      const owners =
        sim === undefined
          ? []
          : await tx.select({ id: users.id }).from(users).where(eq(users.simId, sim.id)).limit(1);
      const owner = owners[0];
      let e164: string;
      try {
        e164 = normalizePhone(row.address, region);
      } catch (error) {
        if (error instanceof AppError) {
          unroutable += 1;
          continue;
        }
        throw error;
      }
      if (sim === undefined || owner === undefined) {
        unroutable += 1;
        await tx.insert(alerts).values({
          id: uuidv7(),
          type: "sim_state_change",
          severity: "warning",
          deviceId,
          simId: sim?.id,
          title: "Unroutable message",
          detail: { providerId: row.providerId, subscriptionId: row.subscriptionId },
          dedupeKey: `${deviceId}:unroutable:${row.providerId}`,
          notifiedChannels: [],
        });
        continue;
      }
      const peerHash = indexPhone(e164);
      const conversationRows = await tx
        .select()
        .from(conversations)
        .where(and(eq(conversations.userId, owner.id), eq(conversations.peerNumberHash, peerHash)))
        .limit(1);
      const now = new Date(row.receivedAt);
      let conversationId = conversationRows[0]?.id;
      if (conversationId === undefined) {
        conversationId = uuidv7();
        await tx.insert(conversations).values({
          id: conversationId,
          userId: owner.id,
          simId: sim.id,
          peerNumberEnc: seal(`conversations.peer_number_enc.${conversationId}`, e164),
          peerNumberHash: peerHash,
          lastMessageAt: now,
          lastPreviewEnc: seal(
            `conversations.last_preview_enc.${conversationId}`,
            row.body.slice(0, 80),
          ),
          unreadCount: 1,
        });
      } else {
        await tx
          .update(conversations)
          .set({
            lastMessageAt: now,
            unreadCount: (conversationRows[0]?.unreadCount ?? 0) + 1,
          })
          .where(eq(conversations.id, conversationId));
      }
      const messageId = uuidv7();
      await tx.insert(messages).values({
        id: messageId,
        conversationId,
        userId: owner.id,
        simId: sim.id,
        deviceId,
        direction: "in",
        peerNumberHash: peerHash,
        wireBodyEnc: seal(`messages.wire_body_enc.${messageId}`, row.body),
        status: "received",
        receivedAt: now,
        providerId: row.providerId,
      });
      await tx.update(sims).set({ lastReceiveAt: now }).where(eq(sims.id, sim.id));
      await handleInboundKeywords(tx, {
        body: row.body,
        peerHash,
        e164,
        ownerId: owner.id,
        simId: sim.id,
        deviceId,
        conversationId,
        messageId,
      });
      inserted += 1;
      received.push({ userId: owner.id, messageId });
    }
  });
  for (const item of received) {
    await publishUser(item.userId, { type: "message.received", messageId: item.messageId });
  }
  return { inserted, duplicates, unroutable };
}
