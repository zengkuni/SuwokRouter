import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import postgres from "postgres";

const DB_URL = process.env.DB_URL || "";
const maybe = DB_URL ? describe : describe.skip;

// Contract test for the Postgres adapter. Uses a scratch table so it does not
// depend on schema.pg.test.js's lifecycle. Skipped without DB_URL (CI
// provisions the service; local dev uses the compose postgres).
maybe("postgresAdapter contract", () => {
  let adapter;
  let admin;

  beforeAll(async () => {
    if (!DB_URL) return;
    admin = postgres(DB_URL, { max: 1 });
    await admin.unsafe(`DROP TABLE IF EXISTS pg_adapter_contract_test`);
    await admin.unsafe(`
      CREATE TABLE pg_adapter_contract_test (
        id BIGSERIAL PRIMARY KEY,
        label TEXT NOT NULL,
        payload TEXT
      )
    `);
    const mod = await import("./postgresAdapter.js");
    // Own pool: other suites call closeAdapter(), which ends the shared
    // global pool — this file must not depend on it.
    const sql = postgres(DB_URL, { max: 2, onnotice: () => {} });
    adapter = mod.createPostgresAdapter({ pool: sql });
  });

  afterAll(async () => {
    if (admin) {
      await admin.unsafe(`DROP TABLE IF EXISTS pg_adapter_contract_test`);
      await admin.end();
    }
    if (adapter) await adapter.close();
  });

  test("run returns changes and lastInsertRowid from RETURNING", async () => {
    const res = await adapter.run(
      `INSERT INTO pg_adapter_contract_test(label, payload) VALUES($1, $2) RETURNING id`,
      ["a", "pa"]
    );
    expect(res.changes).toBe(1);
    expect(Number(res.lastInsertRowid)).toBeGreaterThan(0);
  });

  test("get/all round-trip and restore camelCase row keys", async () => {
    await adapter.run(
      `INSERT INTO pg_adapter_contract_test(label, payload) VALUES($1, $2)`,
      ["b", "pb"]
    );
    const row = await adapter.get(
      `SELECT id, label, payload FROM pg_adapter_contract_test WHERE label = $1`,
      ["b"]
    );
    expect(row.label).toBe("b");
    expect(row.payload).toBe("pb");
    const rows = await adapter.all(`SELECT label FROM pg_adapter_contract_test ORDER BY id`);
    expect(rows.map((r) => r.label)).toEqual(["a", "b"]);
  });

  test("get returns null for no match", async () => {
    const row = await adapter.get(
      `SELECT id FROM pg_adapter_contract_test WHERE label = $1`,
      ["nope"]
    );
    expect(row).toBeNull();
  });

  test("exec runs parameterless DDL", async () => {
    await adapter.exec(`CREATE INDEX IF NOT EXISTS pg_adapter_contract_idx ON pg_adapter_contract_test(label)`);
  });

  test("transaction commits on success", async () => {
    await adapter.transaction(async () => {
      await adapter.run(`INSERT INTO pg_adapter_contract_test(label) VALUES($1)`, ["tx-commit"]);
    });
    const row = await adapter.get(
      `SELECT label FROM pg_adapter_contract_test WHERE label = $1`,
      ["tx-commit"]
    );
    expect(row.label).toBe("tx-commit");
  });

  test("transaction rolls back on throw", async () => {
    let threw = false;
    try {
      await adapter.transaction(async () => {
        await adapter.run(`INSERT INTO pg_adapter_contract_test(label) VALUES($1)`, ["tx-rollback"]);
        throw new Error("boom");
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    const row = await adapter.get(
      `SELECT label FROM pg_adapter_contract_test WHERE label = $1`,
      ["tx-rollback"]
    );
    expect(row).toBeNull();
  });

  test("outer-handle statements inside a transaction body join the tx", async () => {
    // The 28 repo bodies call the outer `db` handle (and helpers like
    // upsert(db, ...)), NOT a passed-in tx handle. The adapter must route
    // those into the active transaction: this row must vanish on rollback.
    let threw = false;
    try {
      await adapter.transaction(async () => {
        await adapter.run(`INSERT INTO pg_adapter_contract_test(label) VALUES($1)`, ["tx-outer"]);
        throw new Error("boom");
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    const row = await adapter.get(
      `SELECT label FROM pg_adapter_contract_test WHERE label = $1`,
      ["tx-outer"]
    );
    expect(row).toBeNull();
  });

  test("concurrent transactions do not block each other", async () => {
    const t1 = adapter.transaction(async () => {
      await adapter.run(`INSERT INTO pg_adapter_contract_test(label) VALUES($1)`, ["conc-1"]);
      await new Promise((r) => setTimeout(r, 50));
      return "t1";
    });
    const t2 = adapter.transaction(async () => {
      await adapter.run(`INSERT INTO pg_adapter_contract_test(label) VALUES($1)`, ["conc-2"]);
      await new Promise((r) => setTimeout(r, 10));
      return "t2";
    });
    const results = await Promise.all([t1, t2]);
    expect(results).toEqual(["t1", "t2"]);
  });

  test("camelCase row keys restored by transform.column", async () => {
    // Repos read row.isActive / row.dateKey etc. Unquoted DDL folds to
    // lowercase; the adapter must map them back or every reader breaks.
    await adapter.exec(`DROP TABLE IF EXISTS pg_adapter_camel_test`);
    await adapter.exec(`
      CREATE TABLE pg_adapter_camel_test (
        id BIGSERIAL PRIMARY KEY,
        isActive INTEGER DEFAULT 1,
        dateKey TEXT
      )
    `);
    try {
      await adapter.run(
        `INSERT INTO pg_adapter_camel_test(isActive, dateKey) VALUES($1, $2)`,
        [1, "2026-09-24"]
      );
      const row = await adapter.get(
        `SELECT id, isActive, dateKey FROM pg_adapter_camel_test WHERE dateKey = $1`,
        ["2026-09-24"]
      );
      expect(row.isActive).toBe(1);
      expect(row.dateKey).toBe("2026-09-24");
      expect(Object.keys(row)).toEqual(["id", "isActive", "dateKey"]);
    } finally {
      await adapter.exec(`DROP TABLE IF EXISTS pg_adapter_camel_test`);
    }
  });

  test("run outside a transaction stays on the pool", async () => {
    const res = await adapter.run(
      `UPDATE pg_adapter_contract_test SET payload = $1 WHERE label = $2`,
      ["updated", "a"]
    );
    expect(res.changes).toBe(1);
    const row = await adapter.get(
      `SELECT payload FROM pg_adapter_contract_test WHERE label = $1`,
      ["a"]
    );
    expect(row.payload).toBe("updated");
  });
});
