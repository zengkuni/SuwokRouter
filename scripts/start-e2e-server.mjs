import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const E2E_DB_SUFFIX = "_e2e";

async function useDisposableDatabase() {
  const baseUrl = process.env.DB_URL;
  if (!baseUrl) return; // no PG configured — nothing to redirect
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    return;
  }
  const baseName = decodeURIComponent(url.pathname.slice(1)) || "postgres";
  const e2eName = `${baseName}${E2E_DB_SUFFIX}`;
  // Maintenance connection to the same server (database name is irrelevant
  // for CREATE DATABASE, but must exist — use the base db).
  const admin = (await import("postgres")).default(baseUrl, { max: 1, onnotice: () => {} });
  try {
    const exists = await admin`SELECT 1 FROM pg_database WHERE datname = ${e2eName}`;
    if (exists.length === 0) {
      await admin.unsafe(`CREATE DATABASE "${e2eName}"`);
    }
  } finally {
    await admin.end();
  }
  url.pathname = `/${encodeURIComponent(e2eName)}`;
  process.env.DB_URL = url.toString();
}


const dataDir = mkdtempSync(path.join(tmpdir(), "suwokrouter-e2e-"));

process.env.NODE_ENV = "production";
process.env.HOSTNAME = process.env.HOSTNAME || "127.0.0.1";
process.env.PORT = process.env.PORT || "14145";
process.env.DATA_DIR = dataDir;

// Postgres is the only driver: the e2e run must not touch the dev database
// (it needs a fresh install for the setup flow). Derive a disposable
// database on the same server and point DB_URL at it.
await useDisposableDatabase();

delete process.env.JWT_SECRET;
delete process.env.API_KEY_SECRET;
delete process.env.MACHINE_ID_SALT;

process.once("exit", () => {
  try {
    rmSync(dataDir, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  } catch {
    // The OS will eventually clear its temporary directory if a native handle
    // is still closing during process teardown.
  }
});


await import("../src/server.ts");
