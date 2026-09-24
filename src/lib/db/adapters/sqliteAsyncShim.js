// Async-safe transaction shim for the synchronous SQLite drivers.
//
// bun:sqlite's `db.transaction(fn)` only accepts a synchronous fn, and a
// synchronous driver handle cannot have two open transactions at once. Once
// transaction bodies become async (Swap A), two awaited transactions would
// interleave their statements between BEGIN/COMMIT and corrupt data.
//
// This shim hand-rolls BEGIN/SAVEPOINT/COMMIT/ROLLBACK and serializes the
// handle with a chained-promise mutex, so the single-writer correctness the
// codebase relies on today is preserved. Postgres replaces this with a real
// pool in Swap B and the file is deleted.
//
// Invariants:
//  - Only one transaction body executes on the handle at a time.
//  - A throw anywhere in the body (including after an await) rolls back.
//  - Nesting uses SAVEPOINTs; an inner throw rolls back only the inner work.

function randomSavepoint() {
  return `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createAsyncTransaction(rawDb, options = {}) {
  const exec = (sql) => rawDb.exec(sql);

  // Chained-promise mutex (same pattern as selectionMutex in sse/services/auth.js).
  let tail = Promise.resolve();

  let depth = 0;

  async function runBody(fn, savepoint) {
    if (savepoint) {
      exec(`SAVEPOINT ${savepoint}`);
    } else {
      exec(`BEGIN`);
    }
    try {
      const result = await fn(makeTxApi());
      if (savepoint) {
        exec(`RELEASE ${savepoint}`);
      } else {
        exec(`COMMIT`);
      }
      return result;
    } catch (error) {
      try {
        if (savepoint) {
          exec(`ROLLBACK TO ${savepoint}`);
          exec(`RELEASE ${savepoint}`);
        } else {
          exec(`ROLLBACK`);
        }
      } catch {
        // The connection may already be in a broken state; the original error
        // is the one callers need to see.
      }
      throw error;
    }
  }

  // sql.js uses bind(array)+step(); the other drivers use run(...params).
  const isSqlJs = typeof rawDb.export === "function";
  const runStmt = (stmt, params) =>
    isSqlJs
      ? (() => {
          stmt.bind(Array.isArray(params) ? params : [params]);
          stmt.step();
          return { changes: rawDb.getRowsModified(), lastInsertRowid: 0 };
        })()
      : stmt.run(...(Array.isArray(params) ? params : [params]));
  const readStmt = (stmt, params, mode) => {
    if (!isSqlJs) {
      return mode === "one" ? stmt.get(...params) : stmt.all(...params);
    }
    stmt.bind(params);
    if (mode === "one") {
      return stmt.step() ? stmt.getAsObject() : undefined;
    }
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  };
  const freeStmt = (stmt) => {
    if (isSqlJs && typeof stmt.free === "function") stmt.free();
  };

  function makeTxApi() {
    return {
      driver: isSqlJs ? "sql.js" : (rawDb.driverName ?? "sqlite"),
      raw: rawDb,
      run: (sql, params = []) =>
        Promise.resolve().then(() => {
          const stmt = rawDb.prepare(sql);
          try {
            const r = runStmt(stmt, params);
            return {
              changes: Number(r.changes ?? 0),
              lastInsertRowid: Number(r.lastInsertRowid ?? 0),
            };
          } finally {
            freeStmt(stmt);
          }
        }),
      get: (sql, params = []) =>
        Promise.resolve().then(() => {
          const stmt = rawDb.prepare(sql);
          try {
            return readStmt(stmt, Array.isArray(params) ? params : [params], "one");
          } finally {
            freeStmt(stmt);
          }
        }),
      all: (sql, params = []) =>
        Promise.resolve().then(() => {
          const stmt = rawDb.prepare(sql);
          try {
            return readStmt(stmt, Array.isArray(params) ? params : [params], "all");
          } finally {
            freeStmt(stmt);
          }
        }),
      exec: (sql) => Promise.resolve().then(() => rawDb.exec(sql)),
    };
  }

  return function transaction(fn) {
    const savepoint = depth > 0 ? randomSavepoint() : null;
    if (savepoint) {
      // Nested: reuse the outer mutex chain, no new serialization needed.
      depth += 1;
      return runBody(fn, savepoint).finally(() => {
        depth -= 1;
      });
    }
    // Serialize against any in-flight transaction on this handle.
    const pending = tail.then(() => {
      depth = 1;
      return runBody(fn, null);
    });
    tail = pending.catch(() => {});
    return pending.finally(() => {
      depth = 0;
    });
  };
}
