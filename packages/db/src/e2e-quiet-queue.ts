import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv } from "@gchopro/core";
import { eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "./client.js";
import { messages, settings } from "./schema.js";

const env = loadEnv();
if (env.APP_ENV !== "development" || env.NODE_ENV === "production") {
  throw new Error("the browser suite is the only place that clears waiting sends");
}

const db = getDb();
await db
  .update(settings)
  .set({ value: { enabled: false, reason: null, since: null } })
  .where(eq(settings.key, "kill_switch"));
const cleared = await db
  .update(messages)
  .set({ status: "cancelled" })
  .where(inArray(messages.status, ["queued", "held", "scheduled"]))
  .returning({ id: messages.id });

const line = `cleared ${cleared.length} leftover sends`;
process.stdout.write(`${line}\n`);
appendFileSync(join(tmpdir(), "gchopro-e2e-worker.log"), `${new Date().toISOString()} ${line}\n`);
await closeDb();
