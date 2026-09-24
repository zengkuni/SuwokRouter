import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "./jsonCol.js";

const UPSERT_SQL = `INSERT INTO kv(scope, key, value)
  VALUES($1, $2, $3)
  ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`;

async function saveValue(db, scope, key, value) {
  await db.run(UPSERT_SQL, [scope, key, stringifyJson(value)]);
}

export function makeKv(scope) {
  const read = async () => getAdapter();

  return {
    async get(key, fallback = null) {
      const db = await read();
      const row = await db.get(`SELECT value FROM kv WHERE scope = $1 AND key = $2`, [scope, key]);
      return row ? parseJson(row.value, fallback) : fallback;
    },
    async getAll() {
      const db = await read();
      const rows = await db.all(`SELECT key, value FROM kv WHERE scope = $1`, [scope]);
      const out = {};
      for (const r of rows) out[r.key] = parseJson(r.value);
      return out;
    },
    async set(key, value) {
      await saveValue(await read(), scope, key, value);
    },
    async setMany(obj) {
      const db = await read();
      await db.transaction(async () => {
        for (const [k, v] of Object.entries(obj)) {
          await saveValue(db, scope, k, v);
        }
      });
    },
    async remove(key) {
      const db = await read();
      await db.run(`DELETE FROM kv WHERE scope = $1 AND key = $2`, [scope, key]);
    },
    async clear() {
      const db = await read();
      await db.run(`DELETE FROM kv WHERE scope = $1`, [scope]);
    },
  };
}
