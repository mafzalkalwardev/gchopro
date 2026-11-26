import { randomUUID } from "node:crypto";
import {
  AppError,
  SAFE_TEXT,
  isSettingKey,
  parseSetting,
  publicSettingValue,
  sudoRequiredForSetting,
  type SettingKey,
} from "@gchopro/core";
import { eq } from "drizzle-orm";
import { appendAudit } from "./audit.js";
import { getDb } from "./client.js";
import { assertSudo, requireReady } from "./login.js";
import { settings } from "./schema.js";

export async function listSettings(token: string | undefined): Promise<Record<string, unknown>> {
  await requireReady(token, "admin");
  const rows = await getDb().select().from(settings);
  return Object.fromEntries(rows.map((row) => [row.key, publicSettingValue(row.key, row.value)]));
}

export async function updateSetting(input: {
  token: string | undefined;
  key: string;
  value: unknown;
  ip: string | null;
  requestId?: string;
}): Promise<unknown> {
  const session = await requireReady(input.token, "admin");
  if (!isSettingKey(input.key)) throw new AppError(404, "not_found", SAFE_TEXT.not_found);
  if (sudoRequiredForSetting(input.key)) await assertSudo(session.sessionId);
  let parsed: unknown;
  try {
    parsed = parseSetting(input.key, input.value);
  } catch {
    throw new AppError(400, "invalid_body", SAFE_TEXT.invalid_body);
  }
  const db = getDb();
  const existing = await db.select().from(settings).where(eq(settings.key, input.key)).limit(1);
  const before = existing[0]?.value ?? null;
  await db.transaction(async (tx) => {
    await tx
      .insert(settings)
      .values({ key: input.key, value: parsed, updatedBy: session.userId })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: parsed, updatedBy: session.userId, updatedAt: new Date() },
      });
    await appendAudit(
      tx,
      {
        userId: session.userId,
        role: session.role,
        kind: "admin",
        ip: input.ip,
        requestId: input.requestId ?? randomUUID(),
      },
      "settings.updated",
      { type: "setting", id: input.key },
      { value: before },
      { value: parsed },
    );
  });
  return publicSettingValue(input.key, parsed);
}

export async function setKillSwitch(input: {
  token: string | undefined;
  enabled: boolean;
  reason: string;
  ip: string | null;
}): Promise<unknown> {
  const session = await requireReady(input.token, "admin");
  await assertSudo(session.sessionId);
  const value = {
    enabled: input.enabled,
    reason: input.reason,
    since: input.enabled ? new Date().toISOString() : null,
  };
  return updateSetting({
    token: input.token,
    key: "kill_switch" satisfies SettingKey,
    value,
    ip: input.ip,
  });
}

export async function readAuditVerification(
  token: string | undefined,
): Promise<{ ok: true } | { ok: false; brokenAtId: string }> {
  await requireReady(token, "admin");
  const { verifyAuditChain } = await import("./audit.js");
  return verifyAuditChain(getDb());
}
