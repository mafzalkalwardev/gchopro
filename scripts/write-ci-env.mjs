import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const b64 = () => randomBytes(32).toString("base64");
const hex = () => randomBytes(24).toString("hex");
const field = b64();
const owner = hex();
const app = hex();
const redis = hex();

const lines = [
  "NODE_ENV=test",
  "APP_ENV=development",
  `DATABASE_URL=postgres://gchopro_app:${app}@127.0.0.1:5432/gchopro`,
  `DATABASE_OWNER_URL=postgres://gchopro_owner:${owner}@127.0.0.1:5432/gchopro`,
  `REDIS_URL=redis://:${redis}@127.0.0.1:6379/0`,
  "ADMIN_HOST=admin.localhost",
  "PORTAL_HOST=portal.localhost",
  "GATEWAY_HOST=gw.localhost",
  "PUBLIC_PORTAL_URL=http://portal.localhost:3000",
  "PUBLIC_GATEWAY_URL=http://gw.localhost:3000",
  "TRUSTED_PROXY_CIDRS=127.0.0.1/32",
  "ADMIN_IP_ALLOWLIST=127.0.0.1/32",
  `FIELD_ENCRYPTION_KEYS='${JSON.stringify({ k1: field })}'`,
  "FIELD_ENCRYPTION_ACTIVE_KEY_ID=k1",
  `PHONE_INDEX_KEY=${b64()}`,
  `TOKEN_PEPPER=${b64()}`,
  `SESSION_SECRET=${b64()}`,
  "DEVICE_TOKEN_MAX_AGE_DAYS=30",
  "LOG_LEVEL=info",
  "SEED_ADMIN_USERNAME=admin",
  `SEED_ADMIN_PASSWORD=${hex()}`,
  `SEED_DEMO_PASSWORD=${hex()}`,
  `SEED_OPS_PASSWORD=${hex()}`,
  `POSTGRES_PASSWORD=${owner}`,
  `GCHOPRO_APP_PASSWORD=${app}`,
  `REDIS_PASSWORD=${redis}`,
];

writeFileSync(".env", `${lines.join("\n")}\n`, { mode: 0o600 });
