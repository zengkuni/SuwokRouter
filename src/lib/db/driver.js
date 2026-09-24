import { loadEnv } from "../env.js";
import { createPostgresAdapter } from "./adapters/postgresAdapter.js";

// Postgres is the only persistent driver. DB_URL is required; there is no
// local file fallback (Swap B removed the SQLite adapters and schema).

if (!global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false };
const state = global._dbAdapter;

function rememberAdapter(adapter) {
  state.instance = adapter;
  return adapter;
}

function resetAdapterState() {
  state.instance = null;
  state.initPromise = null;
}

export async function initAdapter() {
  // Read env lazily: the module-level singleton would freeze DB_URL at first
  // import, which breaks tests that manipulate process.env.
  const env = loadEnv();
  if (!env.dbUrl) {
    throw new Error(
      "[DB] DB_URL is required — Postgres is the only driver. Example: postgres://user:pass@127.0.0.1:5432/suwokrouter"
    );
  }

  const adapter = createPostgresAdapter({ url: env.dbUrl });

  if (!state.logged) {
    const redacted = env.dbUrl.replace(/\/\/([^:]+):[^@]+@/, "//$1:***@");
    console.log(`[DB] Driver: postgres | url: ${redacted}`);
    state.logged = true;
  }

  const { runMigrationOnce } = await import("./migrate.js");
  await runMigrationOnce(adapter);
  return adapter;
}

export async function getAdapter() {
  if (state.instance) return state.instance;
  if (!state.initPromise) state.initPromise = initAdapter().then(rememberAdapter);
  return state.initPromise;
}

// Closes the ADAPTER STATE only. The pool is a process-lifetime singleton
// shared by every adapter: ending it here would kill adapters other suites
// still hold. Process shutdown calls closePostgresPool() (B6 graceful exit).
export async function closeAdapter() {
  const adapter = state.instance || (await state.initPromise?.catch(() => null));
  resetAdapterState();
  if (adapter?.close) {
    try {
      await adapter.close();
    } catch {}
  }
}

export function getAdapterSync() {
  if (!state.instance) throw new Error("[DB] adapter not initialized — await getAdapter() first");
  return state.instance;
}

// Test-only: inject a prebuilt adapter so suites run against an isolated
// database without touching the real one.
export async function setAdapterForTest(adapter) {
  state.instance = adapter;
  state.initPromise = Promise.resolve(adapter);
}
