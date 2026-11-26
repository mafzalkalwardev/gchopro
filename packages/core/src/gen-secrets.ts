import { randomBytes } from "node:crypto";

function key(): string {
  return randomBytes(32).toString("base64");
}

const active = key();
process.stdout.write(
  [
    "# Paste into .env. Do not commit these values.",
    `FIELD_ENCRYPTION_KEYS=${JSON.stringify({ k1: active })}`,
    "FIELD_ENCRYPTION_ACTIVE_KEY_ID=k1",
    `PHONE_INDEX_KEY=${key()}`,
    `TOKEN_PEPPER=${key()}`,
    `SESSION_SECRET=${key()}`,
    "",
  ].join("\n"),
);
