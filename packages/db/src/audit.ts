import {
  AUDIT_GENESIS,
  auditDigest,
  canonicalAudit,
  redactAudit,
  type AuditActorKind,
  type AuditPayload,
} from "@gchopro/core";
import { asc, gt, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { auditLogs } from "./schema.js";

export type Actor = {
  userId: string | null;
  role: string | null;
  kind: AuditActorKind;
  ip: string | null;
  requestId: string | null;
};

type Query = Pick<Db, "execute" | "insert" | "select">;

function rowValue(result: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(result)) {
    const row = result[0];
    return row !== null && typeof row === "object" ? (row as Record<string, unknown>) : undefined;
  }
  if (result !== null && typeof result === "object" && "rows" in result) {
    const rows = result.rows;
    if (!Array.isArray(rows)) return undefined;
    const row = rows[0];
    return row !== null && typeof row === "object" ? (row as Record<string, unknown>) : undefined;
  }
  return undefined;
}

export async function appendAudit(
  db: Query,
  actor: Actor,
  action: string,
  target: { type: string | null; id: string | null },
  before: unknown,
  after: unknown,
): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(814271)`);
  const previous = await db.execute(sql`select hash from audit_logs order by id desc limit 1`);
  const prevHashValue = rowValue(previous)?.hash;
  const prevHash = typeof prevHashValue === "string" ? prevHashValue : AUDIT_GENESIS;
  const sequence = await db.execute(
    sql`select nextval(pg_get_serial_sequence('audit_logs', 'id')) as id`,
  );
  const idValue = rowValue(sequence)?.id;
  const id =
    typeof idValue === "string" || typeof idValue === "number" || typeof idValue === "bigint"
      ? String(idValue)
      : "";
  if (id.length === 0) throw new Error("audit sequence did not return an id");
  const at = new Date();
  const payload: AuditPayload = {
    id,
    at: at.toISOString(),
    actorUserId: actor.userId,
    actorRole: actor.role,
    actorIp: actor.ip,
    actorKind: actor.kind,
    action,
    targetType: target.type,
    targetId: target.id,
    before: redactAudit(before),
    after: redactAudit(after),
    requestId: actor.requestId,
    prevHash,
  };
  const hash = auditDigest(prevHash, canonicalAudit(payload));
  await db.insert(auditLogs).values({
    id: BigInt(id),
    at,
    actorUserId: actor.userId,
    actorRole: actor.role,
    actorIp: actor.ip,
    actorKind: actor.kind,
    action,
    targetType: target.type,
    targetId: target.id,
    before: payload.before,
    after: payload.after,
    requestId: actor.requestId,
    prevHash,
    hash,
  });
}

export async function verifyAuditChain(
  db: Pick<Db, "select">,
): Promise<{ ok: true } | { ok: false; brokenAtId: string }> {
  let prev = AUDIT_GENESIS;
  let cursor: bigint | null = null;
  for (;;) {
    const rows: Array<typeof auditLogs.$inferSelect> =
      cursor === null
        ? await db.select().from(auditLogs).orderBy(asc(auditLogs.id)).limit(500)
        : await db
            .select()
            .from(auditLogs)
            .where(gt(auditLogs.id, cursor))
            .orderBy(asc(auditLogs.id))
            .limit(500);
    if (rows.length === 0) return { ok: true };
    for (const row of rows) {
      const payload: AuditPayload = {
        id: row.id.toString(),
        at: row.at.toISOString(),
        actorUserId: row.actorUserId,
        actorRole: row.actorRole,
        actorIp: row.actorIp,
        actorKind: row.actorKind,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        before: row.before,
        after: row.after,
        requestId: row.requestId,
        prevHash: row.prevHash ?? AUDIT_GENESIS,
      };
      const expected = auditDigest(payload.prevHash, canonicalAudit(payload));
      if (payload.prevHash !== prev || expected !== row.hash) {
        return { ok: false, brokenAtId: payload.id };
      }
      prev = row.hash;
      cursor = row.id;
    }
    const last = rows[rows.length - 1];
    if (last === undefined) return { ok: true };
    cursor = last.id;
  }
}
