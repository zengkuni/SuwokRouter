import postgres from "postgres";
import { AsyncLocalStorage } from "node:async_hooks";
import { restoreColumnName } from "../schema.pg.js";

// Postgres adapter — the only driver after Swap B.
//
// Transaction model: repo bodies (and helpers like upsert(db, ...)) call the
// OUTER adapter handle, not a passed-in tx handle. postgres.js does not route
// outer queries into an active sql.begin, so the adapter tracks the current
// transaction in an AsyncLocalStorage: inside transaction(), every
// run/get/all/exec on any adapter bound to this pool executes on the tx
// connection; outside, on the pool. Same pattern Drizzle uses. Repos stay
// unchanged and transactions stay atomic.

const txStorage = new AsyncLocalStorage();

const POOL_OPTIONS = {
  max: 25,
  idle_timeout: 30,
  connect_timeout: 10,
  max_lifetime: 1800,
  // postgres.js wants { to, from, parse, serialize } per type. int8
  // (BIGSERIAL/COUNT) -> Number or every count compare in repos breaks;
  // numeric -> Number; date family -> ISO strings.
  types: {
    bigint: { to: 20, from: [20], parse: (v) => Number(v), serialize: (v) => String(v) },
    numeric: { to: 1700, from: [1700], parse: (v) => Number(v), serialize: (v) => String(v) },
    timestamp: { to: 1114, from: [1114], parse: (v) => new Date(v).toISOString(), serialize: (v) => new Date(v).toISOString() },
    timestamptz: { to: 1184, from: [1184], parse: (v) => new Date(v).toISOString(), serialize: (v) => new Date(v).toISOString() },
    date: { to: 1082, from: [1082], parse: (v) => new Date(v).toISOString(), serialize: (v) => new Date(v).toISOString() },
  },
  transform: {
    // undefined params become NULL instead of a driver error.
    value: (value) => (value === undefined ? null : value),
  },
  onnotice: () => {},
};

// Postgres folds unquoted identifiers to lowercase; repos read camelCase.
// Done here (not via pool transform) so any pool — app singleton or a
// test-owned one — yields camelCase row keys.
function camelize(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    const out = {};
    for (const key of Object.keys(row)) out[restoreColumnName(key)] = row[key];
    return out;
  });
}

// ownsPool: false for the shared singleton (its lifetime is the process);
// true for a caller-supplied pool, whose close() really ends it.
// postgres.js throws UNDEFINED_VALUE on undefined params (SQLite drivers
// bound them as NULL). Normalize at the boundary so repos keep passing
// possibly-undefined JSON fields straight through.
function normParams(params) {
  if (!Array.isArray(params)) return [];
  return params.map((p) => (p === undefined ? null : p));
}

// postgres.js errors carry a readonly `query`; attach ours safely.
function attachQuery(e, query) {
  try { Object.defineProperty(e, "sqlText", { value: query, configurable: true }); } catch {}
}

function createAdapter(sql, ownsPool = false) {
  // Every method resolves the pool lazily through the ALS store so a single
  // adapter object serves both plain and transactional statements.
  const active = () => txStorage.getStore() ?? sql;

  return {
    driver: "postgres",
    raw: sql,

    async run(query, params = []) {
      try {
        const res = await active().unsafe(query, normParams(params));
        // No repo reads lastInsertRowid today; expose it when the SQL carries
        // RETURNING id (BIGSERIAL inserts in usageHistory).
        return { changes: res.count ?? 0, lastInsertRowid: res[0]?.id ?? null };
      } catch (e) { attachQuery(e, query); throw e; }
    },

    async get(query, params = []) {
      let rows;
      try { rows = camelize(await active().unsafe(query, normParams(params))); }
      catch (e) { attachQuery(e, query); throw e; }
      return rows[0] ?? null;
    },

    async all(query, params = []) {
      try { return camelize(await active().unsafe(query, normParams(params))); }
      catch (e) { attachQuery(e, query); throw e; }
    },

    async exec(query) {
      await active().unsafe(query, []);
    },

    async transaction(fn) {
      // A transaction cannot nest inside another one on the same pool: the
      // inner statement would otherwise target a fresh pool connection.
      const current = txStorage.getStore();
      if (current) {
        // Already inside a tx: join it. Repos never nest (verified), this is
        // a guard, not a feature.
        return fn(createAdapter(current));
      }
      return sql.begin(async (tx) => {
        const txAdapter = createAdapter(tx);
        return txStorage.run(tx, () => fn(txAdapter));
      });
    },

    async checkpoint() {
      // SQLite-only concern; CHECKPOINT needs superuser on PG.
    },

    async close() {
      if (ownsPool) await sql.end({ timeout: 5 });
    },
  };
}

function getPool(url) {
  const key = "_suwokPgSql";
  if (!globalThis[key]) {
    globalThis[key] = postgres(url, POOL_OPTIONS);
  }
  return globalThis[key];
}

export function createPostgresAdapter({ url, pool } = {}) {
  if (pool) return createAdapter(pool, true);
  if (!url) throw new Error("createPostgresAdapter requires url or pool");
  return createAdapter(getPool(url), false);
}

export async function closePostgresPool() {
  const key = "_suwokPgSql";
  const pool = globalThis[key];
  if (pool) {
    globalThis[key] = undefined;
    await pool.end({ timeout: 5 });
  }
}

export { POOL_OPTIONS };
