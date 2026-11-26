import { decryptField, encryptField, loadEnv } from "@gchopro/core";
import postgres from "postgres";

/**
 * Rewrites field ciphertext with the active key. The previous key has to stay
 * in FIELD_ENCRYPTION_KEYS until this script finishes. Provider secrets inside
 * settings are rewritten by saving the setting again.
 */
const tables = [
  { table: "users", columns: ["totp_secret_enc"] },
  { table: "sims", columns: ["phone_number_enc"] },
  { table: "conversations", columns: ["peer_number_enc", "last_preview_enc"] },
  { table: "messages", columns: ["wire_body_enc"] },
  { table: "message_translations", columns: ["source_text_enc", "translated_text_enc"] },
  { table: "contacts", columns: ["name_enc", "number_enc"] },
  { table: "group_sends", columns: ["body_template_enc"] },
] as const;

const env = loadEnv();
const activeId = env.FIELD_ENCRYPTION_ACTIVE_KEY_ID;
const key = new Map(Object.entries(env.FIELD_ENCRYPTION_KEYS)).get(activeId);
if (key === undefined) throw new Error("active field key is missing");
const client = postgres(env.DATABASE_OWNER_URL, { max: 1 });

function cell(row: Record<string, unknown>, column: string): unknown {
  for (const [name, value] of Object.entries(row)) {
    if (name === column) return value;
  }
  return undefined;
}

for (const spec of tables) {
  let lastId: string | null = null;
  for (;;) {
    const rows: ReadonlyArray<Record<string, unknown>> =
      lastId === null
        ? await client.unsafe(`select * from ${spec.table} order by id limit 200`)
        : await client.unsafe(`select * from ${spec.table} where id > $1 order by id limit 200`, [
            lastId,
          ]);
    if (rows.length === 0) break;
    for (const row of rows) {
      const id = String(cell(row, "id"));
      lastId = id;
      for (const column of spec.columns) {
        const current = cell(row, column);
        if (typeof current !== "string" || current.length === 0) continue;
        if (current.startsWith(`v1:${activeId}:`)) continue;
        const plain = decryptField(
          env.FIELD_ENCRYPTION_KEYS,
          `${spec.table}.${column}.${id}`,
          current,
        );
        const next = encryptField(key, activeId, `${spec.table}.${column}.${id}`, plain);
        await client.unsafe(`update ${spec.table} set ${column} = $1 where id = $2`, [next, id]);
      }
    }
    if (rows.length < 200) break;
  }
}

await client.end();
process.stdout.write("reencrypt complete\n");
