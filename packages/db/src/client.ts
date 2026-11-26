import { loadEnv } from "@gchopro/core";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Db = PostgresJsDatabase<typeof schema>;

let cached: { db: Db; close: () => Promise<void> } | undefined;

export function getDb(): Db {
  if (cached) return cached.db;
  const env = loadEnv();
  const client = postgres(env.DATABASE_URL, { max: 10 });
  const db = drizzle(client, { schema });
  cached = { db, close: () => client.end() };
  return db;
}

export async function closeDb(): Promise<void> {
  if (!cached) return;
  await cached.close();
  cached = undefined;
}
