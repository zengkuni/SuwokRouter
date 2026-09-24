import fs from "node:fs";
import path from "node:path";
import { BACKUPS_DIR, ensureDirs } from "./paths.js";
import { timestampSlug, getAppVersion } from "./version.js";

const KEEP_BACKUPS = 3;

const BACKUP_EXCLUDE_TABLES = ["requestDetails"];

function applyPrivateMode(target, mode) {
  if (process.platform === "win32") return;
  try {
    fs.chmodSync(target, mode);
  } catch (error) {
    if (process.env.NODE_ENV === "production") throw error;
  }
}

export function makeBackupDir(label) {
  ensureDirs();
  const ver = getAppVersion();
  const slug = `${label}-${ver}-${timestampSlug()}`;
  const dir = path.join(BACKUPS_DIR, slug);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  applyPrivateMode(dir, 0o700);
  return dir;
}

export function backupFile(srcPath, destDir, destName = null) {
  if (!fs.existsSync(srcPath)) return null;
  const name = destName || path.basename(srcPath);
  const dest = path.join(destDir, name);
  fs.copyFileSync(srcPath, dest, { mode: 0o600 });
  applyPrivateMode(dest, 0o600);
  return dest;
}

// Postgres backup: one JSON file per table (rows as-is), plus a manifest.
// Portable and dependency-free — no pg_dump client needed in the app image.
// requestDetails is excluded: it is high-volume, low-value telemetry.
export async function backupDbLite(adapter, destDir, destName = null) {
  const tables = await adapter.all(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
       AND table_name <> ALL($1)`,
    [BACKUP_EXCLUDE_TABLES]
  );
  const dumped = [];
  for (const { table_name: table } of tables) {
    const rows = await adapter.all(`SELECT * FROM ${table}`);
    const dest = path.join(destDir, `${table}.json`);
    fs.writeFileSync(dest, JSON.stringify(rows), { mode: 0o600 });
    applyPrivateMode(dest, 0o600);
    dumped.push({ table, rows: rows.length });
  }
  const manifest = {
    product: "suwokrouter",
    driver: "postgres",
    createdAt: new Date().toISOString(),
    tables: dumped,
  };
  const manifestPath = path.join(destDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  applyPrivateMode(manifestPath, 0o600);
  return destDir;
}

// Restore a backupDbLite dump: truncate then insert every table. Column list
// is taken from each row so schema drift between dump and restore surfaces as
// a clear error instead of silent data loss.
export async function restoreDbBackup(adapter, backupDir) {
  const manifestPath = path.join(backupDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error(`backup manifest not found: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  for (const { table } of manifest.tables) {
    const file = path.join(backupDir, `${table}.json`);
    if (!fs.existsSync(file)) continue;
    const rows = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!rows.length) continue;
    const columns = Object.keys(rows[0]);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    await adapter.transaction(async () => {
      await adapter.run(`DELETE FROM ${table}`);
      for (const row of rows) {
        await adapter.run(
          `INSERT INTO ${table}(${columns.join(", ")}) VALUES(${placeholders})`,
          columns.map((c) => row[c])
        );
      }
    });
  }
  return manifest.tables.length;
}

export function pruneOldBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return;
  const entries = fs.readdirSync(BACKUPS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, full: path.join(BACKUPS_DIR, e.name), mtime: fs.statSync(path.join(BACKUPS_DIR, e.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const old of entries.slice(KEEP_BACKUPS)) {
    try { fs.rmSync(old.full, { recursive: true, force: true }); } catch {}
  }
}
