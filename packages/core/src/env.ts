import { isIP } from "node:net";
import { z } from "zod";

function isHostnameLabel(label: string): boolean {
  if (label.length < 1 || label.length > 63) return false;
  if (label.startsWith("-") || label.endsWith("-")) return false;
  for (const char of label) {
    const code = char.codePointAt(0);
    if (code === undefined) return false;
    const digit = code >= 48 && code <= 57;
    const upper = code >= 65 && code <= 90;
    const lower = code >= 97 && code <= 122;
    if (!digit && !upper && !lower && code !== 45) return false;
  }
  return true;
}

function isHostname(value: string): boolean {
  if (value.length < 1 || value.length > 253) return false;
  return value.split(".").every(isHostnameLabel);
}

export class EnvError extends Error {
  readonly keys: readonly string[];

  constructor(keys: readonly string[]) {
    super(`Invalid environment: ${keys.join(", ")}`);
    this.name = "EnvError";
    this.keys = keys;
  }
}

function trimmed(value: unknown): unknown {
  return typeof value === "string" ? value.trim() : value;
}

function emptyToUndefined(value: unknown): unknown {
  if (value === undefined || value === "") return undefined;
  return typeof value === "string" ? value.trim() : value;
}

function isBase64Bytes(value: string, bytes: number): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== bytes) return false;
  return decoded.toString("base64").replace(/=+$/u, "") === value.replace(/=+$/u, "");
}

function isCidr(value: string): boolean {
  const slash = value.lastIndexOf("/");
  if (slash <= 0 || slash !== value.indexOf("/")) return false;
  const address = value.slice(0, slash);
  const prefix = Number(value.slice(slash + 1));
  const version = isIP(address);
  if (!Number.isInteger(prefix)) return false;
  if (version === 4) return prefix >= 0 && prefix <= 32;
  if (version === 6) return prefix >= 0 && prefix <= 128;
  return false;
}

function isCidrList(value: string): boolean {
  const parts = value.split(",").map((part) => part.trim());
  return parts.length > 0 && parts.every((part) => part.length > 0 && isCidr(part));
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "postgres:" || url.protocol === "postgresql:";
  } catch {
    return false;
  }
}

function isRedisUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "redis:" || url.protocol === "rediss:";
  } catch {
    return false;
  }
}

const requiredText = z.preprocess(trimmed, z.string().min(1));
const optionalText = z.preprocess(emptyToUndefined, z.string().min(1).optional());

const requiredInt = z.preprocess((value) => {
  const text = typeof value === "string" ? value.trim() : value;
  if (typeof text !== "string" || !/^[0-9]+$/u.test(text)) return text;
  return Number(text);
}, z.number().int().positive());

const optionalInt = z.preprocess((value) => {
  if (value === undefined || value === "") return undefined;
  const text = typeof value === "string" ? value.trim() : value;
  if (typeof text !== "string" || !/^[0-9]+$/u.test(text)) return text;
  return Number(text);
}, z.number().int().positive().optional());

const optionalBool = z.preprocess((value) => {
  if (value === undefined || value === "") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean().optional());

const fieldKeys = z.preprocess(trimmed, z.string()).transform((value, context) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "must be a JSON object" });
    return z.NEVER;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "must be a JSON object" });
    return z.NEVER;
  }
  const keys = new Map<string, string>();
  for (const [id, secret] of Object.entries(parsed)) {
    if (typeof secret !== "string" || !isBase64Bytes(secret, 32)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "each value must be base64 encoding 32 bytes",
      });
      return z.NEVER;
    }
    keys.set(id, secret);
  }
  if (keys.size === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "must contain at least one key" });
    return z.NEVER;
  }
  return Object.fromEntries(keys);
});

const base64Key = z.preprocess(
  trimmed,
  z.string().refine((value) => isBase64Bytes(value, 32), "must be base64 encoding 32 bytes"),
);

const bootSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]),
    APP_ENV: z.enum(["development", "staging", "production"]),
    DATABASE_URL: requiredText.refine(isPostgresUrl, "must be a postgres URL"),
    DATABASE_OWNER_URL: requiredText.refine(isPostgresUrl, "must be a postgres URL"),
    REDIS_URL: requiredText.refine(isRedisUrl, "must be a redis URL"),
    ADMIN_HOST: requiredText.refine(isHostname, "must be a hostname"),
    PORTAL_HOST: requiredText.refine(isHostname, "must be a hostname"),
    GATEWAY_HOST: requiredText.refine(isHostname, "must be a hostname"),
    PUBLIC_PORTAL_URL: requiredText.refine(isHttpUrl, "must be an http URL"),
    PUBLIC_GATEWAY_URL: requiredText.refine(isHttpUrl, "must be an http URL"),
    TRUSTED_PROXY_CIDRS: requiredText.refine(isCidrList, "must be a comma-separated CIDR list"),
    ADMIN_IP_ALLOWLIST: requiredText.refine(isCidrList, "must be a comma-separated CIDR list"),
    FIELD_ENCRYPTION_KEYS: fieldKeys,
    FIELD_ENCRYPTION_ACTIVE_KEY_ID: requiredText,
    PHONE_INDEX_KEY: base64Key,
    TOKEN_PEPPER: base64Key,
    SESSION_SECRET: base64Key,
    DEVICE_TOKEN_MAX_AGE_DAYS: requiredInt,
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]),
    SEED_ADMIN_USERNAME: optionalText,
    SEED_ADMIN_PASSWORD: optionalText,
    ADMIN_TEST_NUMBERS: optionalText,
    DEEPL_API_KEY: optionalText,
    DEEPL_API_URL: optionalText.refine(
      (value) => value === undefined || isHttpUrl(value),
      "must be an http URL",
    ),
    GOOGLE_CLOUD_PROJECT: optionalText,
    GOOGLE_TRANSLATE_CREDENTIALS_JSON: optionalText,
    LIBRETRANSLATE_URL: optionalText.refine(
      (value) => value === undefined || isHttpUrl(value),
      "must be an http URL",
    ),
    LIBRETRANSLATE_API_KEY: optionalText,
    SMTP_HOST: optionalText,
    SMTP_PORT: optionalInt,
    SMTP_USER: optionalText,
    SMTP_PASS: optionalText,
    SMTP_FROM: optionalText,
    TELEGRAM_BOT_TOKEN: optionalText,
    VAPID_PUBLIC_KEY: optionalText,
    VAPID_PRIVATE_KEY: optionalText,
    VAPID_SUBJECT: optionalText,
    BACKUP_ENABLED: optionalBool,
    BACKUP_AGE_RECIPIENT: optionalText,
    BACKUP_RCLONE_REMOTE: optionalText,
    BACKUP_RETENTION_DAYS: optionalInt,
    POSTGRES_PASSWORD: optionalText,
    GCHOPRO_APP_PASSWORD: optionalText,
    REDIS_PASSWORD: optionalText,
  })
  .superRefine((value, context) => {
    if (!(value.FIELD_ENCRYPTION_ACTIVE_KEY_ID in value.FIELD_ENCRYPTION_KEYS)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["FIELD_ENCRYPTION_ACTIVE_KEY_ID"],
        message: "must name a key in FIELD_ENCRYPTION_KEYS",
      });
    }
    const google = value.GOOGLE_TRANSLATE_CREDENTIALS_JSON;
    if (google !== undefined && !isBase64JsonObject(google)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["GOOGLE_TRANSLATE_CREDENTIALS_JSON"],
        message: "must be base64-encoded JSON",
      });
    }
  });

function isBase64JsonObject(value: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) return false;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

const seedSchema = z.object({
  SEED_ADMIN_USERNAME: z
    .string()
    .trim()
    .regex(/^[a-z0-9._-]{3,40}$/u),
  SEED_ADMIN_PASSWORD: z.string().min(1),
});

export type AppEnv = z.infer<typeof bootSchema>;
export type SeedIdentity = z.infer<typeof seedSchema>;

function keysFrom(error: z.ZodError): string[] {
  const keys = error.issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    return path.length > 0 ? path : "environment";
  });
  return [...new Set(keys)];
}

export function parseEnv(source: Record<string, string | undefined>): AppEnv {
  const result = bootSchema.safeParse(source);
  if (!result.success) throw new EnvError(keysFrom(result.error));
  return result.data;
}

export function parseSeedIdentity(source: Record<string, string | undefined>): SeedIdentity {
  const result = seedSchema.safeParse({
    SEED_ADMIN_USERNAME: source.SEED_ADMIN_USERNAME,
    SEED_ADMIN_PASSWORD: source.SEED_ADMIN_PASSWORD,
  });
  if (!result.success) throw new EnvError(keysFrom(result.error));
  return result.data;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return parseEnv(source);
}

export function assertSeedAllowed(appEnv: AppEnv["APP_ENV"]): void {
  if (appEnv === "production") {
    throw new Error("db:seed refuses APP_ENV=production");
  }
}
