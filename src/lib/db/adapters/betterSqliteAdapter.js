import Database from "better-sqlite3";
import { PRAGMA_SQL } from "../schema.js";
import { createStatementCache, startPeriodicTask } from "./runtimeHelpers.js";

const CHECKPOINT_INTERVAL_MS = 60 * 1000;

export function createBetterSqliteAdapter(filePath) {
  const db = new Database(filePath);
  db.exec(PRAGMA_SQL);

  const statements = createStatementCache((sql) => db.prepare(sql));
  const stopCheckpoint = startPeriodicTask(() => {
    try { db.pragma("wal_checkpoint(PASSIVE)"); } catch {}
  }, CHECKPOINT_INTERVAL_MS);

  function gracefulClose() {
    try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch {}
    try { statements.clear(); } catch {}
    try { db.close(); } catch {}
  }

  return {
    driver: "better-sqlite3",
    run(sql, params = []) { return statements.get(sql).run(...params); },
    get(sql, params = []) { return statements.get(sql).get(...params); },
    all(sql, params = []) { return statements.get(sql).all(...params); },
    exec(sql) { return db.exec(sql); },
    transaction(fn) { return db.transaction(fn)(); },
    checkpoint() { try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch {} },
    close() {
      stopCheckpoint();
      gracefulClose();
    },
    raw: db,
  };
}
