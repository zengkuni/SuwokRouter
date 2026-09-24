// Postgres 17 schema — the only persistent driver after Swap B.
//
// Deliberate port choices (diff-minimizing, semantics-preserving):
//   * JSON-bearing columns stay TEXT. Repos stringify/parse themselves
//     (stringifyJson/parseJson), and TEXT avoids double-encoding through
//     postgres.js's jsonb parser. json_extract sites cast data::jsonb at
//     query time (B5).
//   * Timestamps stay TEXT. Repos treat them as opaque ISO strings and rely
//     on lexicographic ordering, which ISO-8601 UTC preserves exactly as it
//     did under SQLite. No timestamptz coercion risk on read or write.
//   * isActive/isDefault stay INTEGER. Repos write 1/0 and compare
//     `isActive = 1`, which keeps working; boolean would break both.
//   * usageHistory.id is BIGSERIAL (inserts omit id). requestDetails.id is
//     explicit TEXT (ON CONFLICT(id) upserts).
//   * Identifiers are written unquoted, so Postgres folds them to lowercase
//     exactly like the unquoted camelCase in repo SQL. The adapter's
//     transform.column map restores camelCase row keys on read.
//
// Idempotent: every statement is IF NOT EXISTS, safe to re-run on boot.

export const SCHEMA_VERSION = 16;

export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS _meta (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS settings (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     data TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS providerConnections (
     id TEXT PRIMARY KEY,
     provider TEXT NOT NULL,
     authType TEXT NOT NULL,
     name TEXT,
     email TEXT,
     priority INTEGER,
     isActive INTEGER DEFAULT 1,
     data TEXT NOT NULL,
     createdAt TEXT NOT NULL,
     updatedAt TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS providerNodes (
     id TEXT PRIMARY KEY,
     type TEXT,
     name TEXT,
     data TEXT NOT NULL,
     createdAt TEXT NOT NULL,
     updatedAt TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS proxyPools (
     id TEXT PRIMARY KEY,
     isActive INTEGER DEFAULT 1,
     testStatus TEXT,
     data TEXT NOT NULL,
     createdAt TEXT NOT NULL,
     updatedAt TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS apiKeys (
     id TEXT PRIMARY KEY,
     key TEXT UNIQUE NOT NULL,
     name TEXT,
     machineId TEXT,
     isActive INTEGER DEFAULT 1,
     isDefault INTEGER DEFAULT 0,
     createdAt TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS combos (
     id TEXT PRIMARY KEY,
     name TEXT UNIQUE NOT NULL,
     kind TEXT,
     models TEXT NOT NULL,
     createdAt TEXT NOT NULL,
     updatedAt TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS kv (
     scope TEXT NOT NULL,
     key TEXT NOT NULL,
     value TEXT NOT NULL,
     PRIMARY KEY (scope, key)
   )`,
  `CREATE TABLE IF NOT EXISTS usageHistory (
     id BIGSERIAL PRIMARY KEY,
     timestamp TEXT NOT NULL,
     provider TEXT,
     model TEXT,
     connectionId TEXT,
     apiKey TEXT,
     endpoint TEXT,
     promptTokens INTEGER DEFAULT 0,
     completionTokens INTEGER DEFAULT 0,
     cost DOUBLE PRECISION DEFAULT 0,
     status TEXT,
     tokens TEXT,
     meta TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS usageDaily (
     dateKey TEXT PRIMARY KEY,
     data TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS requestDetails (
     id TEXT PRIMARY KEY,
     timestamp TEXT NOT NULL,
     provider TEXT,
     model TEXT,
     connectionId TEXT,
     status TEXT,
     data TEXT NOT NULL,
     trace_id TEXT,
     payload_capture TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS account_model_locks (
     connectionId TEXT NOT NULL,
     modelId TEXT NOT NULL,
     tier TEXT,
     reason TEXT,
     expiresAt TEXT NOT NULL,
     createdAt TEXT NOT NULL,
     updatedAt TEXT NOT NULL,
     PRIMARY KEY (connectionId, modelId)
   )`,

  // Indexes. isActive variants are partial: every hot query filters on
  // isActive = 1, and partial halves the index size and write cost.
  `CREATE INDEX IF NOT EXISTS idx_pc_provider ON providerConnections (provider)`,
  `CREATE INDEX IF NOT EXISTS idx_pc_provider_active ON providerConnections (provider) WHERE isActive = 1`,
  `CREATE INDEX IF NOT EXISTS idx_pc_priority ON providerConnections (provider, priority)`,
  `CREATE INDEX IF NOT EXISTS idx_pc_provider_order ON providerConnections (provider, COALESCE (priority, 999), id)`,
  `CREATE INDEX IF NOT EXISTS idx_pc_provider_active_order ON providerConnections (provider, COALESCE (priority, 999), id) WHERE isActive = 1`,
  `CREATE INDEX IF NOT EXISTS idx_pc_auth_active_order ON providerConnections (authType, COALESCE (priority, 999), id) WHERE isActive = 1`,

  `CREATE INDEX IF NOT EXISTS idx_pn_type ON providerNodes (type)`,

  `CREATE INDEX IF NOT EXISTS idx_pp_active ON proxyPools (isActive)`,
  `CREATE INDEX IF NOT EXISTS idx_pp_status ON proxyPools (testStatus)`,
  `CREATE INDEX IF NOT EXISTS idx_pp_active_partial ON proxyPools (isActive) WHERE isActive = 1`,

  `CREATE INDEX IF NOT EXISTS idx_ak_key ON apiKeys (key)`,

  `CREATE INDEX IF NOT EXISTS idx_combo_name ON combos (name)`,

  `CREATE INDEX IF NOT EXISTS idx_kv_scope ON kv (scope)`,

  `CREATE INDEX IF NOT EXISTS idx_uh_ts ON usageHistory (timestamp DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_uh_provider ON usageHistory (provider)`,
  `CREATE INDEX IF NOT EXISTS idx_uh_model ON usageHistory (model)`,
  `CREATE INDEX IF NOT EXISTS idx_uh_conn ON usageHistory (connectionId)`,

  `CREATE INDEX IF NOT EXISTS idx_rd_ts ON requestDetails (timestamp DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_rd_provider ON requestDetails (provider)`,
  `CREATE INDEX IF NOT EXISTS idx_rd_model ON requestDetails (model)`,
  `CREATE INDEX IF NOT EXISTS idx_rd_conn ON requestDetails (connectionId)`,
  `CREATE INDEX IF NOT EXISTS idx_rd_trace ON requestDetails (trace_id)`,

  `CREATE INDEX IF NOT EXISTS idx_aml_model_expires ON account_model_locks (modelId, expiresAt)`,
  `CREATE INDEX IF NOT EXISTS idx_aml_conn ON account_model_locks (connectionId)`,
];

// Postgres folds unquoted identifiers to lowercase; these are the exact
// camelCase columns the adapter must restore on read (postgres.js
// transform.column). Closed set — taken from the schema above.
export const CAMEL_COLUMNS = {
  isactive: "isActive",
  isdefault: "isDefault",
  createdat: "createdAt",
  updatedat: "updatedAt",
  datekey: "dateKey",
  teststatus: "testStatus",
  machineid: "machineId",
  prompttokens: "promptTokens",
  completiontokens: "completionTokens",
  connectionid: "connectionId",
  apikey: "apiKey",
  modelid: "modelId",
  expiresat: "expiresAt",
};

export function restoreColumnName(lowered) {
  return CAMEL_COLUMNS[lowered] ?? lowered;
}
