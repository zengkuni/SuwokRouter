// Valkey/Redis client — process-lifetime singleton, lazily connected.
//
// REDIS_URL unset → getRedis() returns null and every cache/lock consumer
// uses its in-memory backend. REDIS_URL set but the server is down →
// commands fail fast (maxRetriesPerRequest: 1); consumers decide fail-open
// vs fail-closed per call site (request paths fail open to today's
// behavior, refresh locks fail closed).

import Redis from "ioredis";
import { loadEnv } from "../env.js";

let client = null;
let connecting = null;

function readRedisUrl() {
  // Lazy read: the module-level env singleton can freeze REDIS_URL in tests.
  try { return loadEnv().redisUrl || ""; } catch { return process.env.REDIS_URL || ""; }
}

export function getRedis() {
  if (client || connecting) return client;
  const url = readRedisUrl();
  if (!url) return null;
  connecting = new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    connectTimeout: 5_000,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  });
  connecting.on("error", () => {}); // never crash the process on redis errors
  client = connecting;
  connecting = null;
  return client;
}

// "connecting"/"reconnecting" count as available: ioredis queues commands
// until the handshake finishes, and maxRetriesPerRequest bounds the wait.
// Only a closed client means "use the memory backend".
export function isRedisAvailable() {
  return Boolean(client && client.status !== "end" && client.status !== "close");
}

export async function closeRedis() {
  if (!client) return;
  const current = client;
  client = null;
  try { await current.quit(); } catch { current.disconnect(); }
}
