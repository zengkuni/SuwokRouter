import { getAdapter } from "../driver.js";

const META_READ = `SELECT value FROM _meta WHERE key = $1`;
const META_WRITE = `INSERT INTO _meta(key, value) VALUES($1, $2)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value`;

async function readMeta(adapter, key, fallback) {
  const row = await adapter.get(META_READ, [key]);
  return row ? row.value : fallback;
}

async function writeMeta(adapter, key, value) {
  await adapter.run(META_WRITE, [key, String(value)]);
}

export async function getMeta(key, fallback = null) {
  const db = await getAdapter();
  return await readMeta(db, key, fallback);
}

export async function setMeta(key, value) {
  const db = await getAdapter();
  await writeMeta(db, key, value);
}

export async function getMetaSync(adapter, key, fallback = null) {
  return await readMeta(adapter, key, fallback);
}

export async function setMetaSync(adapter, key, value) {
  await writeMeta(adapter, key, value);
}
