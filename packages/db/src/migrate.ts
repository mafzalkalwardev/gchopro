import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "@gchopro/core";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const env = loadEnv();
const client = postgres(env.DATABASE_OWNER_URL, { max: 1 });
const db = drizzle(client);
const here = dirname(fileURLToPath(import.meta.url));

await migrate(db, { migrationsFolder: join(here, "../migrations") });
const grants = await readFile(join(here, "sql/grants.sql"), "utf8");
await client.unsafe(grants);
await client.end();
