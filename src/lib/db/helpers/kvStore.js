import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "./jsonCol.js";

const UPSERT_SQL = `INSERT INTO kv(scope, key, value)
  VALUES(?, ?, ?)
  ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`;

function saveValue(db, scope, key, value) {
  db.run(UPSERT_SQL, [scope, key, stringifyJson(value)]);
}

export function makeKv(scope) {
  const read = async () => getAdapter();

  return {
    async get(key, fallback = null) {
      const db = await read();
      const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [scope, key]);
      return row ? parseJson(row.value, fallback) : fallback;
    },
    async getAll() {
      const db = await read();
      const rows = db.all(`SELECT key, value FROM kv WHERE scope = ?`, [scope]);
      const out = {};
      for (const r of rows) out[r.key] = parseJson(r.value);
      return out;
    },
    async set(key, value) {
      saveValue(await read(), scope, key, value);
    },
    async setMany(obj) {
      const db = await read();
      db.transaction(() => {
        for (const [k, v] of Object.entries(obj)) {
          saveValue(db, scope, k, v);
        }
      });
    },
    async remove(key) {
      const db = await read();
      db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [scope, key]);
    },
    async clear() {
      const db = await read();
      db.run(`DELETE FROM kv WHERE scope = ?`, [scope]);
    },
  };
}
