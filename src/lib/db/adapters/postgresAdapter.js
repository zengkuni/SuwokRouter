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
  // BIGSERIAL/BIGINT come back as numbers; JSON stays TEXT in this schema, so
  // no jsonb parsing surprises. Timestamps are TEXT by design.
  types: {
    bigint: (value) => Number(value),
    numeric: (value) => Number(value),
    timestamp: (value) => new Date(value).toISOString(),
    timestamptz: (value) => new Date(value).toISOString(),
    date: (value) => new Date(value).toISOString(),
  },
  transform: {
    // Postgres folds unquoted identifiers to lowercase; repos read camelCase.
    column: (name) => restoreColumnName(name),
    // undefined params become NULL instead of a driver error.
    value: (value) => (value === undefined ? null : value),
  },
  onnotice: () => {},
};

function createAdapter(sql) {
  // Every method resolves the pool lazily through the ALS store so a single
  // adapter object serves both plain and transactional statements.
  const active = () => txStorage.getStore() ?? sql;

  return {
    driver: "postgres",
    raw: sql,

    async run(query, params = []) {
      const res = await active().unsafe(query, params);
      // No repo reads lastInsertRowid today; expose it when the SQL carries
      // RETURNING id (BIGSERIAL inserts in usageHistory).
      return { changes: res.count ?? 0, lastInsertRowid: res[0]?.id ?? null };
    },

    async get(query, params = []) {
      const rows = await active().unsafe(query, params);
      return rows[0] ?? null;
    },

    async all(query, params = []) {
      return active().unsafe(query, params);
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
      await sql.end({ timeout: 5 });
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
  if (pool) return createAdapter(pool);
  if (!url) throw new Error("createPostgresAdapter requires url or pool");
  return createAdapter(getPool(url));
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
