import { PRAGMA_SQL } from "../schema.js";
import { createStatementCache, startPeriodicTask } from "./runtimeHelpers.js";

const CHECKPOINT_INTERVAL_MS = 60 * 1000;

export async function createBunSqliteAdapter(filePath) {

  const { Database } = await import("bun:sqlite");
  const db = new Database(filePath, { create: true });
  db.exec(PRAGMA_SQL);

  const statements = createStatementCache((sql) => db.prepare(sql));
  const stopCheckpoint = startPeriodicTask(() => {
    try { db.exec("PRAGMA wal_checkpoint(PASSIVE)"); } catch {}
  }, CHECKPOINT_INTERVAL_MS);

  function gracefulClose() {
    try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {}
    try { statements.clear(); } catch {}
    try { db.close(); } catch {}
  }
  return {
    driver: "bun:sqlite",
    run(sql, params = []) {
      const r = statements.get(sql).run(...params);
      return { changes: Number(r.changes ?? 0), lastInsertRowid: Number(r.lastInsertRowid ?? 0) };
    },
    get(sql, params = []) {
      return statements.get(sql).get(...params);
    },
    all(sql, params = []) {
      return statements.get(sql).all(...params);
    },
    exec(sql) { return db.exec(sql); },
    transaction(fn) {

      const tx = db.transaction(fn);
      return tx();
    },
    checkpoint() { try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {} },
    close() {
      stopCheckpoint();
      gracefulClose();
    },
    raw: db,
  };
}
