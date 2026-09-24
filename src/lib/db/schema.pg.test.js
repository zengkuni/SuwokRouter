import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import postgres from "postgres";

const DB_URL = process.env.DB_URL || "";

// The Postgres schema is the only persistent driver. Skip when no database is
// configured (CI provisions one via service containers; local dev uses the
// docker-compose postgres service).
const maybe = DB_URL ? describe : describe.skip;

const TABLES = [
  "_meta",
  "settings",
  "providerConnections",
  "providerNodes",
  "proxyPools",
  "apiKeys",
  "combos",
  "kv",
  "usageHistory",
  "usageDaily",
  "requestDetails",
  "account_model_locks",
];

maybe("postgres schema", () => {
  const sql = DB_URL ? postgres(DB_URL, { max: 1 }) : null;

  beforeAll(async () => {
    if (!sql) return;
    const mod = await import("./schema.pg.js");
    for (const stmt of mod.SCHEMA_STATEMENTS) {
      await sql.unsafe(stmt);
    }
  });

  afterAll(async () => {
    // Do NOT drop the tables: they are the app's real schema, shared by every
    // other suite that runs after this file in the same `bun test` process.
    // SCHEMA_STATEMENTS are all IF NOT EXISTS, so repeated runs are safe.
    if (sql) await sql.end();
  });

  test("creates all 12 tables", async () => {
    if (!sql) return;
    const rows = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
    `;
    const names = rows.map((r) => r.table_name).sort();
    // Unquoted DDL folds to lowercase in Postgres — repo SQL folds the same
    // way, so queries stay consistent.
    expect(names).toEqual([...TABLES].map((t) => t.toLowerCase()).sort());
  });

  test("usageHistory id is bigint with serial default", async () => {
    if (!sql) return;
    const [row] = await sql`
      SELECT data_type, column_default, is_nullable FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'usagehistory' AND column_name = 'id'
    `;
    expect(row.data_type).toBe("bigint");
    expect(row.column_default).toContain("nextval");
    expect(row.is_nullable).toBe("NO");
  });

  test("requestDetails id stays explicit text", async () => {
    if (!sql) return;
    const [row] = await sql`
      SELECT data_type, column_default FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'requestdetails' AND column_name = 'id'
    `;
    expect(row.data_type).toBe("text");
    expect(row.column_default).toBeNull();
  });

  test("json-bearing columns are text, not jsonb", async () => {
    if (!sql) return;
    const rows = await sql`
      SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND ((table_name = 'settings' AND column_name = 'data')
          OR (table_name = 'providerconnections' AND column_name = 'data')
          OR (table_name = 'usagehistory' AND column_name = 'tokens'))
      ORDER BY table_name
    `;
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.data_type).toBe("text");
  });

  test("isActive is integer-typed with default 1", async () => {
    if (!sql) return;
    const [row] = await sql`
      SELECT data_type, column_default FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'providerconnections' AND column_name = 'isactive'
    `;
    expect(["smallint", "integer"]).toContain(row.data_type);
    expect(row.column_default).toBe("1");
  });

  test("partial index on providerConnections(isActive) exists", async () => {
    if (!sql) return;
    const [row] = await sql`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'providerconnections' AND indexname = 'idx_pc_provider_active'
    `;
    expect(row.indexdef).toContain("WHERE");
  });

  test("SCHEMA_VERSION stays 16", async () => {
    const mod = await import("./schema.pg.js");
    expect(mod.SCHEMA_VERSION).toBe(16);
  });

  test("DDL is idempotent", async () => {
    if (!sql) return;
    const mod = await import("./schema.pg.js");
    for (const stmt of mod.SCHEMA_STATEMENTS) {
      await sql.unsafe(stmt);
    }
  });
});
