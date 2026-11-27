import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertSeedAllowed, EnvError, parseEnv, parseSeedIdentity, requireHost } from "./env.js";

const key = Buffer.alloc(32, 7).toString("base64");

function validEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    NODE_ENV: "test",
    APP_ENV: "development",
    DATABASE_URL: "postgres://gchopro_app:local@localhost:5432/gchopro",
    DATABASE_OWNER_URL: "postgres://gchopro_owner:local@localhost:5432/gchopro",
    REDIS_URL: "redis://:local@localhost:6379/0",
    ADMIN_HOST: "admin.localhost",
    PORTAL_HOST: "portal.localhost",
    GATEWAY_HOST: "gw.localhost",
    PUBLIC_PORTAL_URL: "http://portal.localhost:3000",
    PUBLIC_GATEWAY_URL: "http://gw.localhost:3000",
    TRUSTED_PROXY_CIDRS: "127.0.0.1/32",
    ADMIN_IP_ALLOWLIST: "10.0.0.0/8,192.168.1.1/32",
    FIELD_ENCRYPTION_KEYS: JSON.stringify({ k1: key }),
    FIELD_ENCRYPTION_ACTIVE_KEY_ID: "k1",
    PHONE_INDEX_KEY: key,
    TOKEN_PEPPER: key,
    SESSION_SECRET: key,
    DEVICE_TOKEN_MAX_AGE_DAYS: "30",
    LOG_LEVEL: "info",
    ...overrides,
  };
}

describe("parseEnv", () => {
  it("accepts a complete fixture", () => {
    const env = parseEnv(validEnv());
    expect(env.APP_ENV).toBe("development");
    expect(env.DEVICE_TOKEN_MAX_AGE_DAYS).toBe(30);
    expect(env.FIELD_ENCRYPTION_KEYS.k1).toBe(key);
  });

  it("names a missing key and does not include a supplied secret", () => {
    const secret = "super-secret-value-should-not-leak";
    expect(() => parseEnv(validEnv({ SESSION_SECRET: secret, DATABASE_URL: undefined }))).toThrow(
      EnvError,
    );
    try {
      parseEnv(validEnv({ SESSION_SECRET: secret, DATABASE_URL: undefined }));
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      const message = error instanceof Error ? error.message : "";
      expect(message).toContain("DATABASE_URL");
      expect(message).not.toContain(secret);
    }
  });

  it("rejects a short field key", () => {
    expect(() =>
      parseEnv(validEnv({ PHONE_INDEX_KEY: Buffer.alloc(16).toString("base64") })),
    ).toThrow(/PHONE_INDEX_KEY/u);
  });

  it("rejects a bad CIDR", () => {
    expect(() => parseEnv(validEnv({ ADMIN_IP_ALLOWLIST: "10.0.0.0/99" }))).toThrow(
      /ADMIN_IP_ALLOWLIST/u,
    );
  });

  it("rejects an active key id that is not in the map", () => {
    expect(() => parseEnv(validEnv({ FIELD_ENCRYPTION_ACTIVE_KEY_ID: "missing" }))).toThrow(
      /FIELD_ENCRYPTION_ACTIVE_KEY_ID/u,
    );
  });

  it("treats empty optional provider keys as unset", () => {
    const env = parseEnv(validEnv({ DEEPL_API_KEY: "", SMTP_PORT: "" }));
    expect(env.DEEPL_API_KEY).toBeUndefined();
    expect(env.SMTP_PORT).toBeUndefined();
  });
});

describe("parseSeedIdentity", () => {
  it("requires the seed username and password", () => {
    expect(() => parseSeedIdentity({})).toThrow(/SEED_ADMIN_USERNAME/u);
  });
});

describe("requireHost", () => {
  it("reads one hostname without the rest of the environment", () => {
    expect(requireHost("ADMIN_HOST", { ADMIN_HOST: "localhost" })).toBe("localhost");
  });

  it("rejects a missing or non-hostname value", () => {
    expect(() => requireHost("PORTAL_HOST", {})).toThrow(EnvError);
    expect(() => requireHost("PORTAL_HOST", { PORTAL_HOST: "http://localhost" })).toThrow(EnvError);
  });
});

describe("assertSeedAllowed", () => {
  it("refuses production", () => {
    expect(() => assertSeedAllowed("production")).toThrow(/refuses APP_ENV=production/u);
  });

  it("allows development", () => {
    expect(() => assertSeedAllowed("development")).not.toThrow();
  });
});

describe(".env.example", () => {
  it("has empty values only", () => {
    const path = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env.example");
    const lines = readFileSync(path, "utf8").split(/\r?\n/u);
    const assignments = lines.filter((line) => line.length > 0 && !line.startsWith("#"));
    expect(assignments.length).toBeGreaterThan(40);
    for (const line of assignments) {
      expect(line.endsWith("="), line).toBe(true);
    }
  });
});
