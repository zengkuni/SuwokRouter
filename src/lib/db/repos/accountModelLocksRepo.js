import { getAdapter } from "../driver.js";

export const LOCK_MODEL_ALL = "__all";

export function lockModelId(model) {
  return model ? String(model) : LOCK_MODEL_ALL;
}

export async function recordLock(connectionId, model, { tier, reason, expiresAt } = {}) {
  if (!connectionId) return;
  const db = await getAdapter();
  const modelId = lockModelId(model);
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO account_model_locks(connectionId, modelId, tier, reason, expiresAt, createdAt, updatedAt)
     VALUES($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(connectionId, modelId) DO UPDATE SET
       tier = excluded.tier, reason = excluded.reason,
       expiresAt = excluded.expiresAt, updatedAt = excluded.updatedAt`,
    [connectionId, modelId, tier || null, reason || null, expiresAt, now, now]
  );
}

export async function clearLock(connectionId, model) {
  if (!connectionId) return;
  const db = await getAdapter();
  await db.run(`DELETE FROM account_model_locks WHERE connectionId = $1 AND modelId = $2`,
    [connectionId, lockModelId(model)]);
}

export async function clearAllLocksForConnection(connectionId) {
  if (!connectionId) return;
  const db = await getAdapter();
  await db.run(`DELETE FROM account_model_locks WHERE connectionId = $1`, [connectionId]);
}

export async function getActiveLocks(filter = {}) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const where = [];
  const params = [];
  const ph = () => `$${params.length + 1}`;
  where.push(`expiresAt > ${ph()}`);
  params.push(now);
  if (filter.connectionId) { where.push(`connectionId = ${ph()}`); params.push(filter.connectionId); }
  if (filter.model !== undefined) { where.push(`modelId = ${ph()}`); params.push(lockModelId(filter.model)); }
  const rows = await db.all(
    `SELECT connectionId, modelId, tier, reason, expiresAt FROM account_model_locks WHERE ${where.join(" AND ")} ORDER BY expiresAt ASC`,
    params
  );
  return rows || [];
}

export async function isLocked(connectionId, model) {
  const db = await getAdapter();
  const now = new Date().toISOString();

  const row = await db.get(
    `SELECT 1 FROM account_model_locks
     WHERE connectionId = $1 AND modelId IN ($2, $3) AND expiresAt > $4 LIMIT 1`,
    [connectionId, lockModelId(model), LOCK_MODEL_ALL, now]
  );
  return !!row;
}

export async function countActiveLocks() {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const row = await db.get(`SELECT COUNT(*) AS c FROM account_model_locks WHERE expiresAt > $1`, [now]);
  return row?.c || 0;
}

export async function reapExpired() {
  const db = await getAdapter();
  const now = new Date().toISOString();
  await db.run(`DELETE FROM account_model_locks WHERE expiresAt <= $1`, [now]);
}
