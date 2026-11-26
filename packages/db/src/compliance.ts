import { randomUUID } from "node:crypto";
import {
  AppError,
  SAFE_TEXT,
  confirmationLanguage,
  countSegments,
  isTooLong,
  maskNumber,
  matchingKeyword,
  settingSchemas,
} from "@gchopro/core";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { appendAudit, type Actor } from "./audit.js";
import type { Db } from "./client.js";
import { getDb } from "./client.js";
import {
  indexPhone,
  normalizePhone,
  openSeal,
  readOptOutScope,
  readRegion,
  seal,
} from "./device-shared.js";
import { assertSudo, requireReady } from "./login.js";
import { conversations, messages, optOuts, settings, users } from "./schema.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const system = (requestId: string): Actor => ({
  userId: null,
  role: null,
  kind: "system",
  ip: null,
  requestId,
});

async function settingValue(tx: Tx, key: string): Promise<unknown> {
  const rows = await tx.select().from(settings).where(eq(settings.key, key)).limit(1);
  return rows[0]?.value;
}

export async function handleInboundKeywords(
  tx: Tx,
  input: {
    body: string;
    peerHash: string;
    e164: string;
    ownerId: string;
    simId: string;
    deviceId: string;
    conversationId: string;
    messageId: string;
  },
): Promise<void> {
  const optOutWords = settingSchemas.opt_out_keywords.safeParse(
    await settingValue(tx, "opt_out_keywords"),
  );
  const optInWords = settingSchemas.opt_in_keywords.safeParse(
    await settingValue(tx, "opt_in_keywords"),
  );
  const scope = await readOptOutScope(tx);
  const requestId = randomUUID();
  const optIn = matchingKeyword(input.body, optInWords.success ? optInWords.data : []);
  if (optIn !== null) {
    const filters = [
      eq(optOuts.numberHash, input.peerHash),
      eq(optOuts.scope, scope),
      eq(optOuts.source, "keyword"),
      isNull(optOuts.reversedAt),
    ];
    if (scope === "user") filters.push(eq(optOuts.userId, input.ownerId));
    const reversed = await tx
      .update(optOuts)
      .set({ reversedAt: new Date(), reverseReason: "keyword" })
      .where(and(...filters))
      .returning({ id: optOuts.id });
    if (reversed.length > 0) {
      await appendAudit(
        tx,
        system(requestId),
        "opt_out.keyword_reversed",
        {
          type: "opt_out",
          id: reversed[0]?.id ?? input.peerHash,
        },
        null,
        { keyword: optIn },
      );
    }
    return;
  }
  const keyword = matchingKeyword(input.body, optOutWords.success ? optOutWords.data : []);
  if (keyword === null) return;
  const filters = [
    eq(optOuts.numberHash, input.peerHash),
    eq(optOuts.scope, scope),
    isNull(optOuts.reversedAt),
  ];
  if (scope === "user") filters.push(eq(optOuts.userId, input.ownerId));
  const active = await tx
    .select({ id: optOuts.id })
    .from(optOuts)
    .where(and(...filters))
    .limit(1);
  if (active.length > 0) return;
  const optOutId = uuidv7();
  await tx.insert(optOuts).values({
    id: optOutId,
    numberHash: input.peerHash,
    numberEnc: seal(`opt_outs.number_enc.${optOutId}`, input.e164),
    scope,
    userId: scope === "user" ? input.ownerId : null,
    source: "keyword",
    keyword,
    sourceMessageId: input.messageId,
  });
  const pending = [
    eq(messages.peerNumberHash, input.peerHash),
    inArray(messages.status, ["queued", "held", "scheduled"]),
  ];
  if (scope === "user") pending.push(eq(messages.userId, input.ownerId));
  await tx
    .update(messages)
    .set({ status: "blocked", blockReason: "opted_out" })
    .where(and(...pending));
  const confirmation = settingSchemas.opt_out_confirmation.safeParse(
    await settingValue(tx, "opt_out_confirmation"),
  );
  if (confirmation.success && confirmation.data.enabled) {
    const language = confirmationLanguage(input.body);
    const text = language === "zh" ? confirmation.data.text_zh : confirmation.data.text_en;
    const counted = countSegments(text);
    if (!isTooLong(counted)) {
      const confirmationId = uuidv7();
      await tx.insert(messages).values({
        id: confirmationId,
        conversationId: input.conversationId,
        userId: input.ownerId,
        simId: input.simId,
        deviceId: input.deviceId,
        direction: "out",
        peerNumberHash: input.peerHash,
        wireBodyEnc: seal(`messages.wire_body_enc.${confirmationId}`, text),
        wireLang: language,
        encoding: counted.encoding,
        segments: counted.segments,
        status: "queued",
        queuedAt: new Date(),
        isOptOutConfirmation: true,
      });
    }
  }
  await tx
    .update(conversations)
    .set({ tags: ["opted-out"] })
    .where(eq(conversations.id, input.conversationId));
  await appendAudit(
    tx,
    system(requestId),
    "opt_out.keyword",
    { type: "opt_out", id: optOutId },
    null,
    { keyword, masked: maskNumber(input.e164) },
  );
}

export async function listOptOuts(token: string | undefined) {
  await requireReady(token, "admin");
  const rows = await getDb().select().from(optOuts).where(isNull(optOuts.reversedAt));
  return rows.map((row) => {
    const number =
      row.numberEnc === null ? null : openSeal(`opt_outs.number_enc.${row.id}`, row.numberEnc);
    return {
      id: row.id,
      number: number === null ? "****" : maskNumber(number),
      scope: row.scope,
      source: row.source,
      keyword: row.keyword,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

export async function createOptOut(
  token: string | undefined,
  input: { number: string; scope: "global" | "user"; userId?: string; note?: string },
  actor: Actor,
) {
  await requireReady(token, "admin");
  const db = getDb();
  const e164 = normalizePhone(input.number, await readRegion(db));
  const hash = indexPhone(e164);
  if (input.scope === "user") {
    if (input.userId === undefined) throw new AppError(400, "invalid_body", SAFE_TEXT.invalid_body);
    const owner = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    if (owner.length === 0) throw new AppError(404, "not_found", SAFE_TEXT.not_found);
  }
  const id = uuidv7();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(optOuts).values({
        id,
        numberHash: hash,
        numberEnc: seal(`opt_outs.number_enc.${id}`, e164),
        scope: input.scope,
        userId: input.scope === "user" ? (input.userId ?? null) : null,
        source: "admin",
      });
      await appendAudit(tx, actor, "opt_out.created", { type: "opt_out", id }, null, {
        scope: input.scope,
        note: input.note ?? null,
        masked: maskNumber(e164),
      });
    });
  } catch (error) {
    if (isUnique(error)) throw new AppError(409, "conflict", SAFE_TEXT.conflict);
    throw error;
  }
  return { id, number: maskNumber(e164) };
}

function isUnique(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
    return true;
  }
  if (typeof error === "object" && error !== null && "cause" in error) return isUnique(error.cause);
  return false;
}

export async function reverseOptOut(
  token: string | undefined,
  id: string,
  input: { reason: string; evidence: string },
  actor: Actor,
) {
  const session = await requireReady(token, "admin");
  if (session.sessionId === undefined)
    throw new AppError(403, "sudo_required", SAFE_TEXT.sudo_required);
  await assertSudo(session.sessionId);
  const db = getDb();
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(optOuts)
      .set({
        reversedAt: new Date(),
        reversedBy: session.userId,
        reverseReason: input.reason,
      })
      .where(and(eq(optOuts.id, id), isNull(optOuts.reversedAt)))
      .returning({ id: optOuts.id });
    if (rows.length === 0) throw new AppError(404, "not_found", SAFE_TEXT.not_found);
    await appendAudit(tx, actor, "opt_out.reversed", { type: "opt_out", id }, null, {
      reason: input.reason,
      evidence: input.evidence,
    });
  });
  return { id };
}
