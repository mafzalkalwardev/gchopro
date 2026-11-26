import {
  AppError,
  PhoneError,
  SAFE_TEXT,
  decryptField,
  deviceTokenHash,
  encryptField,
  loadEnv,
  phoneIndex,
  settingSchemas,
  toE164,
  type SimHealth,
} from "@gchopro/core";
import { eq } from "drizzle-orm";
import type { Db } from "./client.js";
import { settings } from "./schema.js";

export type AdminActor = {
  userId: string;
  role: string;
  ip: string | null;
  requestId: string;
  sessionId?: string;
};

export type HealthSettings = {
  consecutive_failure_threshold: number;
  suspension_signal_threshold: number;
  offline_after_seconds: number;
  battery_low_percent: number;
};

const HEALTH_DEFAULT: HealthSettings = {
  consecutive_failure_threshold: 3,
  suspension_signal_threshold: 2,
  offline_after_seconds: 90,
  battery_low_percent: 20,
};

type Query = Pick<Db, "select">;

export function blank(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function cryptoEnv(): {
  keys: Record<string, string>;
  keyId: string;
  key: string;
  pepper: string;
  phoneKey: string;
  gatewayUrl: string;
  maxTokenAgeDays: number;
  testNumbers: string | undefined;
} {
  const env = loadEnv();
  const key = new Map(Object.entries(env.FIELD_ENCRYPTION_KEYS)).get(
    env.FIELD_ENCRYPTION_ACTIVE_KEY_ID,
  );
  if (key === undefined) throw new AppError(500, "internal", "The request failed.");
  return {
    keys: env.FIELD_ENCRYPTION_KEYS,
    keyId: env.FIELD_ENCRYPTION_ACTIVE_KEY_ID,
    key,
    pepper: env.TOKEN_PEPPER,
    phoneKey: env.PHONE_INDEX_KEY,
    gatewayUrl: env.PUBLIC_GATEWAY_URL,
    maxTokenAgeDays: env.DEVICE_TOKEN_MAX_AGE_DAYS,
    testNumbers: env.ADMIN_TEST_NUMBERS,
  };
}

export function tokenHash(token: string): string {
  return deviceTokenHash(cryptoEnv().pepper, token);
}

export function seal(aad: string, plaintext: string): string {
  const env = cryptoEnv();
  return encryptField(env.key, env.keyId, aad, plaintext);
}

export function openSeal(aad: string, encoded: string | null): string | null {
  if (encoded === null) return null;
  try {
    return decryptField(cryptoEnv().keys, aad, encoded);
  } catch {
    return null;
  }
}

export function indexPhone(e164: string): string {
  return phoneIndex(cryptoEnv().phoneKey, e164);
}

export function normalizePhone(raw: string, region: string): string {
  try {
    return toE164(raw, region);
  } catch (error) {
    if (error instanceof PhoneError)
      throw new AppError(400, "invalid_body", SAFE_TEXT.invalid_body);
    throw error;
  }
}

export async function readHealth(db: Query): Promise<HealthSettings> {
  const rows = await db.select().from(settings).where(eq(settings.key, "health")).limit(1);
  const parsed = settingSchemas.health.safeParse(rows[0]?.value);
  return parsed.success ? parsed.data : HEALTH_DEFAULT;
}

export async function readRegion(db: Query): Promise<string> {
  const rows = await db.select().from(settings).where(eq(settings.key, "default_region")).limit(1);
  const parsed = settingSchemas.default_region.safeParse(rows[0]?.value);
  return parsed.success ? parsed.data : "PK";
}

export async function readKeywords(db: Query): Promise<string[]> {
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "opt_out_keywords"))
    .limit(1);
  const parsed = settingSchemas.opt_out_keywords.safeParse(rows[0]?.value);
  return parsed.success ? parsed.data : [];
}

export async function readOptOutScope(db: Query): Promise<"global" | "user"> {
  const rows = await db.select().from(settings).where(eq(settings.key, "opt_out_scope")).limit(1);
  const parsed = settingSchemas.opt_out_scope.safeParse(rows[0]?.value);
  return parsed.success ? parsed.data : "global";
}

export async function killSwitchOn(db: Query): Promise<boolean> {
  const rows = await db.select().from(settings).where(eq(settings.key, "kill_switch")).limit(1);
  const parsed = settingSchemas.kill_switch.safeParse(rows[0]?.value);
  return parsed.success ? parsed.data.enabled : false;
}

export async function defaultPolicyId(db: Query): Promise<string | null> {
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "default_policy_id"))
    .limit(1);
  const parsed = settingSchemas.default_policy_id.safeParse(rows[0]?.value);
  return parsed.success ? parsed.data : null;
}

export function isHealth(value: string): value is SimHealth {
  return (
    value === "active" ||
    value === "no_service" ||
    value === "absent" ||
    value === "locked" ||
    value === "suspected_suspended" ||
    value === "error" ||
    value === "paused_admin" ||
    value === "inactive" ||
    value === "retired"
  );
}
