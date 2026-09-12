import { getAdapter } from "../driver.js";

const META_READ = `SELECT value FROM _meta WHERE key = ?`;
const META_WRITE = `INSERT INTO _meta(key, value) VALUES(?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value`;

function readMeta(adapter, key, fallback) {
  const row = adapter.get(META_READ, [key]);
  return row ? row.value : fallback;
}

function writeMeta(adapter, key, value) {
  adapter.run(META_WRITE, [key, String(value)]);
}

export async function getMeta(key, fallback = null) {
  const db = await getAdapter();
  return readMeta(db, key, fallback);
}

export async function setMeta(key, value) {
  const db = await getAdapter();
  writeMeta(db, key, value);
}

export function getMetaSync(adapter, key, fallback = null) {
  return readMeta(adapter, key, fallback);
}

export function setMetaSync(adapter, key, value) {
  writeMeta(adapter, key, value);
}
