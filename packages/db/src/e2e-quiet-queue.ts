import { loadEnv } from "@gchopro/core";
import { inArray } from "drizzle-orm";
import { closeDb, getDb } from "./client.js";
import { messages } from "./schema.js";

const env = loadEnv();
if (env.APP_ENV !== "development" || env.NODE_ENV === "production") {
  throw new Error("the browser suite is the only place that clears waiting sends");
}

const cleared = await getDb()
  .update(messages)
  .set({ status: "cancelled" })
  .where(inArray(messages.status, ["queued", "held", "scheduled"]))
  .returning({ id: messages.id });

process.stdout.write(`cleared ${cleared.length} leftover sends\n`);
await closeDb();
