import { describe, expect, test } from "bun:test";
import { createBunSqliteAdapter } from "./bunSqliteAdapter.js";
import { createAsyncTransaction } from "./sqliteAsyncShim.js";

let counter = 0;

async function makeAdapter() {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = `${os.tmpdir()}/suwok-async-shim-${Date.now()}-${counter++}.sqlite`;
  fs.writeFileSync(path, Buffer.alloc(0));
  const adapter = await createBunSqliteAdapter(path);
  await adapter.exec(`CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT)`);
  return { adapter, path };
}

async function cleanup(adapter, path) {
  try { await adapter.close(); } catch {}
  try {
    const fs = await import("node:fs");
    fs.unlinkSync(path);
  } catch {}
}

describe("async transaction shim", () => {
  test("commits statements issued in an async body", async () => {
    const { adapter, path } = await makeAdapter();
    try {
      const tx = createAsyncTransaction(adapter.raw);
      await tx(async (db) => {
        await db.run(`INSERT INTO t (id, v) VALUES (?, ?)`, [1, "a"]);
        await db.run(`INSERT INTO t (id, v) VALUES (?, ?)`, [2, "b"]);
      });
      const rows = await adapter.all(`SELECT id, v FROM t ORDER BY id ASC`);
      expect(rows).toEqual([
        { id: 1, v: "a" },
        { id: 2, v: "b" },
      ]);
    } finally {
      await cleanup(adapter, path);
    }
  });

  test("rolls back when the async body throws", async () => {
    const { adapter, path } = await makeAdapter();
    try {
      const tx = createAsyncTransaction(adapter.raw);
      await expect(
        tx(async (db) => {
          await db.run(`INSERT INTO t (id, v) VALUES (?, ?)`, [1, "kept"]);
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      const row = await adapter.get(`SELECT COUNT(*) AS n FROM t`);
      expect(row.n).toBe(0);
    } finally {
      await cleanup(adapter, path);
    }
  });

  test("serializes concurrent transactions so statements never interleave", async () => {
    const { adapter, path } = await makeAdapter();
    try {
      const tx = createAsyncTransaction(adapter.raw);
      const log = [];

      const worker = async (label, id) => {
        await tx(async (db) => {
          log.push(`${label}:begin`);
          await db.run(`INSERT INTO t (id, v) VALUES (?, ?)`, [id, label]);
          // Yield mid-transaction. Without serialization another worker's
          // statements would land inside this open transaction.
          await new Promise((r) => setTimeout(r, 20));
          log.push(`${label}:end`);
        });
      };
      await Promise.all([worker("A", 1), worker("B", 2)]);

      // Interleaving would show begin,begin,end,end.
      expect(log).toEqual(["A:begin", "A:end", "B:begin", "B:end"]);
      const rows = await adapter.all(`SELECT v FROM t ORDER BY v ASC`);
      expect(rows.map((r) => r.v).sort()).toEqual(["A", "B"]);
    } finally {
      await cleanup(adapter, path);
    }
  });

  test("supports nested savepoints with partial rollback", async () => {
    const { adapter, path } = await makeAdapter();
    try {
      const tx = createAsyncTransaction(adapter.raw);
      await tx(async (db) => {
        await db.run(`INSERT INTO t (id, v) VALUES (?, ?)`, [1, "outer"]);
        try {
          await tx(async (inner) => {
            await inner.run(`INSERT INTO t (id, v) VALUES (?, ?)`, [2, "inner"]);
            throw new Error("inner-boom");
          });
        } catch (e) {
          expect(String(e.message)).toBe("inner-boom");
        }
        await db.run(`INSERT INTO t (id, v) VALUES (?, ?)`, [3, "after"]);
      });
      const rows = await adapter.all(`SELECT id, v FROM t ORDER BY id ASC`);
      expect(rows).toEqual([
        { id: 1, v: "outer" },
        { id: 3, v: "after" },
      ]);
    } finally {
      await cleanup(adapter, path);
    }
  });
});
