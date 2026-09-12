import { PRAGMA_SQL } from "../schema.js";
import { createStatementCache, startPeriodicTask } from "./runtimeHelpers.js";

const CHECKPOINT_INTERVAL_MS = 60 * 1000;

export async function createNodeSqliteAdapter(filePath) {

  const origEmit = process.emit;
  process.emit = function (name, data, ...rest) {
    if (name === "warning" && data?.name === "ExperimentalWarning" && /SQLite/i.test(data.message || "")) {
      return false;
    }
    return origEmit.call(process, name, data, ...rest);
  };

  const sqlite = await import("node:sqlite");
  const Database = sqlite.DatabaseSync;
  const db = new Database(filePath);

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
    driver: "node:sqlite",
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

      const sp = `sp_${Math.random().toString(36).slice(2)}`;
      db.exec(`SAVEPOINT ${sp}`);
      try {
        const r = fn();
        db.exec(`RELEASE ${sp}`);
        return r;
      } catch (e) {
        try { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); } catch {}
        throw e;
      }
    },
    checkpoint() { try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {} },
    close() {
      stopCheckpoint();
      gracefulClose();
    },
    raw: db,
  };
}
