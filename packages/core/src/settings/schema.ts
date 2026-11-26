import { z } from "zod";

const nullableText = z.string().max(2000).nullable();

export const settingSchemas = {
  kill_switch: z.object({
    enabled: z.boolean(),
    reason: nullableText,
    since: z.string().datetime().nullable(),
  }),
  min_gap_floor_seconds: z.number().int().min(5),
  default_policy_id: z.string().uuid(),
  default_timezone: z.string().min(1).max(80),
  default_region: z.string().length(2),
  translation: z.object({
    provider: z.enum(["none", "deepl", "google", "libretranslate"]),
    deepl: z.object({
      plan: z.enum(["free", "pro"]).optional(),
      authKey: z.string().min(1).optional(),
    }),
    google: z.object({ credentials: z.string().min(1).optional() }).optional(),
    libretranslate: z.object({
      url: z.string().url().nullable(),
      apiKey: z.string().min(1).optional(),
    }),
    preview_before_send: z.boolean(),
  }),
  opt_out_keywords: z.array(z.string().min(1).max(40)).min(1),
  opt_in_keywords: z.array(z.string().min(1).max(40)).min(1),
  opt_out_scope: z.enum(["global", "user"]),
  opt_out_confirmation: z.object({
    enabled: z.boolean(),
    text_en: z.string().min(1).max(320),
    text_zh: z.string().min(1).max(320),
  }),
  sender_signature: z.object({
    enabled: z.boolean(),
    text: z.string().max(160),
  }),
  content_rules: z.object({
    blocked_keywords: z.array(z.string().max(80)),
    block_urls: z.boolean(),
  }),
  test_numbers: z.array(z.string().min(3).max(20)),
  health: z.object({
    consecutive_failure_threshold: z.number().int().positive(),
    suspension_signal_threshold: z.number().int().positive(),
    offline_after_seconds: z.number().int().positive(),
    battery_low_percent: z.number().int().min(1).max(100),
  }),
  alerts: z.object({
    email: z.object({
      enabled: z.boolean(),
      to: z.array(z.string().email()),
    }),
    telegram: z.object({
      enabled: z.boolean(),
      chat_id: z.string().min(1).nullable(),
      botToken: z.string().min(1).optional(),
    }),
  }),
  retention: z.object({
    message_body_days: z.number().int().positive(),
    audit_days: z.number().int().positive(),
  }),
  portal: z.object({
    expiry_behavior_default: z.enum(["block", "read_only"]),
    allow_admin_support_view: z.boolean(),
  }),
  branding: z.object({
    product_name: z.string().min(1).max(80),
  }),
} as const;

export type SettingKey = keyof typeof settingSchemas;

export const SECURITY_SETTING_KEYS = ["translation", "alerts", "kill_switch"] as const;

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(settingSchemas, key);
}

export function sudoRequiredForSetting(key: string): boolean {
  return (SECURITY_SETTING_KEYS as readonly string[]).includes(key);
}

export function parseSetting(key: SettingKey, value: unknown): unknown {
  const schema = new Map(Object.entries(settingSchemas)).get(key);
  if (schema === undefined) throw new Error("Unknown setting");
  return schema.parse(value);
}

function configured(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => configured(entry));
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value).flatMap(([entryKey, entry]) => {
    const lower = entryKey.toLowerCase();
    if (
      lower.includes("secret") ||
      lower.includes("token") ||
      lower.includes("authkey") ||
      lower === "credentials" ||
      lower === "apikey"
    ) {
      return [[`${entryKey}Configured`, typeof entry === "string" && entry.length > 0] as const];
    }
    return [[entryKey, configured(entry)] as const];
  });
  return Object.fromEntries(entries);
}

export function publicSettingValue(key: string, value: unknown): unknown {
  if (sudoRequiredForSetting(key)) return configured(value);
  return value;
}
