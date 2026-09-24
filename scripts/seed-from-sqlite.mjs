#!/usr/bin/env bun
// One-time seed: SQLite data file -> Postgres.
//
// Run once before switching DB_URL away from the SQLite file (or right after
// a fresh Postgres volume) so existing connections/settings/combos/usage
// survive the Swap B cutover. Idempotent: every insert is an upsert, so a
// re-run repairs partial state instead of duplicating rows.
//
//   bun scripts/seed-from-sqlite.mjs [path-to-data.sqlite] [--dry-run]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { createPostgresAdapter } from "../src/lib/db/adapters/postgresAdapter.js";
import { SCHEMA_STATEMENTS } from "../src/lib/db/schema.pg.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const sqlitePath = args.find((a) => !a.startsWith("--")) || path.join(
  process.env.SUWOK_DATA_DIR || path.join(os.homedir(), process.platform === "win32" ? "AppData/Roaming/.suwokrouter" : ".suwokrouter"),
  "db",
  "data.sqlite"
);

const BATCH = 500;

// Table -> primary key columns (mirrors schema.pg.js).
const PRIMARY_KEYS = {
  _meta: ["key"],
  settings: ["id"],
  providerConnections: ["id"],
  providerNodes: ["id"],
  proxyPools: ["id"],
  apiKeys: ["id"],
  combos: ["id"],
  kv: ["scope", "key"],
  usageHistory: ["id"],
  usageDaily: ["dateKey"],
  requestDetails: ["id"],
  account_model_locks: ["connectionId", "modelId"],
};

// _meta keys owned by the migration machinery; the PG migrations set these.
const META_SKIP = new Set(["schemaVersion", "backupSchemaVersion"]);

function upsertSql(table, columns) {
  const pk = PRIMARY_KEYS[table];
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  const updates = columns
    .filter((c) => !pk.includes(c))
    .map((c) => `${c} = excluded.${c}`)
    .join(", ");
  const conflict = pk.join(", ");
  // Unquoted identifiers everywhere: the schema DDL is unquoted, so Postgres
  // stores everything lowercase. A quoted "usageHistory" would not resolve.
  const colList = columns.join(", ");
  return updates
    ? `INSERT INTO ${table} (${colList}) VALUES (${placeholders}) ON CONFLICT (${conflict}) DO UPDATE SET ${updates}`
    : `INSERT INTO ${table} (${colList}) VALUES (${placeholders}) ON CONFLICT (${conflict}) DO NOTHING`;
}

if (!fs.existsSync(sqlitePath)) {
  console.error(`sqlite file not found: ${sqlitePath}`);
  process.exit(1);
}

const sqlite = new Database(sqlitePath, { readonly: true });
const pg = createPostgresAdapter({ url: process.env.DB_URL });
if (!process.env.DB_URL) {
  console.error("DB_URL is required");
  process.exit(1);
}

const tables = sqlite
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
  .all()
  .map((r) => r.name)
  .filter((t) => PRIMARY_KEYS[t]);

console.log(`seed ${sqlitePath} -> ${process.env.DB_URL.replace(/\/\/([^:]+):[^@]+@/, "//$1:***@")}${dryRun ? " (dry-run)" : ""}`);

if (!dryRun) {
  // The schema must exist before the copy.
  for (const stmt of SCHEMA_STATEMENTS) await pg.exec(stmt);
}

let totalRows = 0;
for (const table of tables) {
  let rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
  if (table === "_meta") rows = rows.filter((r) => !META_SKIP.has(r.key));
  if (!rows.length) {
    console.log(`  ${table}: 0 rows`);
    continue;
  }
  const columns = Object.keys(rows[0]);
  const sql = upsertSql(table, columns);
  if (dryRun) {
    console.log(`  ${table}: ${rows.length} rows`);
    totalRows += rows.length;
    continue;
  }
  await pg.transaction(async () => {
    await pg.run(`DELETE FROM ${table}`);
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      for (const row of batch) {
        await pg.run(sql, columns.map((c) => (row[c] === undefined ? null : row[c])));
      }
    }
  });
  totalRows += rows.length;
  console.log(`  ${table}: ${rows.length} rows`);
}

if (!dryRun && tables.includes("usageHistory")) {
  // Explicit ids were copied; push the sequence past them or the next insert
  // collides.
  await pg.run(`SELECT setval(pg_get_serial_sequence('usageHistory', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM usageHistory), 1))`);
  console.log("  usageHistory sequence advanced");
}

console.log(`seed complete: ${totalRows} rows${dryRun ? " (dry-run, nothing written)" : ""}`);
await pg.close();
sqlite.close();
