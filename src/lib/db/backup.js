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

export function backupDbLite(adapter, destDir, destName = "data.sqlite") {
  const dest = path.join(destDir, destName);
  try { fs.rmSync(dest, { force: true }); } catch {}
  const escaped = dest.replace(/'/g, "''");

  adapter.exec(`ATTACH DATABASE '${escaped}' AS bak`);
  try {
    const excluded = new Set(BACKUP_EXCLUDE_TABLES);
    const tables = adapter
      .all(`SELECT name, sql FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
      .filter((t) => !excluded.has(t.name));

    adapter.transaction(() => {
      for (const t of tables) {

        const createSql = t.sql.replace(/CREATE TABLE\s+/i, "CREATE TABLE bak.");
        adapter.exec(createSql);
        adapter.exec(`INSERT INTO bak.${t.name} SELECT * FROM main.${t.name}`);
      }
    });
  } finally {
    try { adapter.exec("DETACH DATABASE bak"); } catch {}
  }
  applyPrivateMode(dest, 0o600);
  return dest;
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
