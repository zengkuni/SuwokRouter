#!/usr/bin/env bun

import { initDb } from "../src/lib/db/index.js";
import { getAdapter } from "../src/lib/db/driver.js";
import { saveRequestUsage, flushUsageBuffer } from "../src/lib/db/repos/usageRepo.js";

const N = 1000;
const CONCURRENCY = 50;
const PROVIDER = "bench";
const STAMP = `bench-${Date.now()}`;
const ISO = new Date().toISOString();

function pct(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}
function fmtLat(lat) {
  lat.sort((a, b) => a - b);
  return {
    p50: +pct(lat, 50).toFixed(3),
    p95: +pct(lat, 95).toFixed(3),
    p99: +pct(lat, 99).toFixed(3),
    total: +lat.reduce((s, v) => s + v, 0).toFixed(1),
  };
}

function baselineInsertOne(db, entry) {
  const tokens = entry.tokens || {};
  const promptTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
  const completionTokens = tokens.completion_tokens || tokens.output_tokens || 0;
  db.transaction(() => {
    const existing = db.get(
      `SELECT id, endpoint FROM usageHistory
       WHERE timestamp = ? AND COALESCE(provider,'') = COALESCE(?, '')
         AND COALESCE(model,'') = COALESCE(?, '') AND COALESCE(connectionId,'') = COALESCE(?, '')
         AND COALESCE(apiKey,'') = COALESCE(?, '') AND promptTokens = ? AND completionTokens = ?
       ORDER BY id DESC LIMIT 1`,
      [entry.timestamp, entry.provider || null, entry.model || null, entry.connectionId || null, entry.apiKey || null, promptTokens, completionTokens]
    );
    if (existing) {
      if (!existing.endpoint && entry.endpoint) db.run(`UPDATE usageHistory SET endpoint = ? WHERE id = ?`, [entry.endpoint, existing.id]);
      return;
    }
    db.run(
      `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entry.timestamp, entry.provider || null, entry.model || null, entry.connectionId || null, entry.apiKey || null, entry.endpoint || null, promptTokens, completionTokens, entry.cost || 0, entry.status || "ok", "{}", "{}"]
    );

    const d = new Date(entry.timestamp);
    const dateKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    const dayRow = db.get(`SELECT data FROM usageDaily WHERE dateKey = ?`, [dateKey]);
    const day = dayRow ? JSON.parse(dayRow.data) : { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, byProvider:{}, byModel:{}, byAccount:{}, byApiKey:{}, byEndpoint:{} };
    day.requests = (day.requests||0)+1; day.promptTokens = (day.promptTokens||0)+promptTokens; day.completionTokens = (day.completionTokens||0)+completionTokens; day.cost = (day.cost||0)+(entry.cost||0);
    if (entry.provider) { day.byProvider[entry.provider] = day.byProvider[entry.provider] || {requests:0,promptTokens:0,completionTokens:0,cost:0}; const p=day.byProvider[entry.provider]; p.requests++; p.promptTokens+=promptTokens; p.completionTokens+=completionTokens; p.cost+=(entry.cost||0); }
    db.run(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?) ON CONFLICT(dateKey) DO UPDATE SET data = excluded.data`, [dateKey, JSON.stringify(day)]);
    const cur = db.get(`SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'`);
    db.run(`INSERT INTO _meta(key, value) VALUES('totalRequestsLifetime', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String((cur ? parseInt(cur.value,10):0)+1)]);
  });
}

async function benchBaselineLatency() {
  const db = await getAdapter();
  const lat = new Array(N);
  for (let i = 0; i < N; i++) {
    const entry = { provider: PROVIDER, model: `${STAMP}-base-${i}`, tokens: { prompt_tokens: 10, completion_tokens: 5 }, timestamp: ISO, apiKey: "bench-key" };
    const t0 = performance.now();
    baselineInsertOne(db, entry);
    lat[i] = performance.now() - t0;
  }
  return fmtLat(lat);
}

async function benchBufferedLatency() {
  const lat = new Array(N);
  for (let i = 0; i < N; i++) {
    const model = `${STAMP}-buf-${i}`;
    const t0 = performance.now();
    await saveRequestUsage({
      provider: PROVIDER, model,
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      timestamp: ISO, apiKey: "bench-key",
    });
    lat[i] = performance.now() - t0;
  }
  await flushUsageBuffer();
  return fmtLat(lat);
}

async function benchBaselineThru() {
  const db = await getAdapter();
  const t0 = performance.now();
  for (let wave = 0; wave < N / CONCURRENCY; wave++) {
    const tasks = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      const idx = wave * CONCURRENCY + i;
      const entry = { provider: PROVIDER, model: `${STAMP}-tb-${idx}`, tokens: { prompt_tokens: 10, completion_tokens: 5 }, timestamp: ISO, apiKey: "bench-key" };
      tasks.push(Promise.resolve().then(() => baselineInsertOne(db, entry)));
    }
    await Promise.all(tasks);
  }
  return performance.now() - t0;
}

async function benchBufferedThru() {
  const t0 = performance.now();
  for (let wave = 0; wave < N / CONCURRENCY; wave++) {
    const tasks = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      const idx = wave * CONCURRENCY + i;
      const model = `${STAMP}-tu-${idx}`;
      tasks.push(saveRequestUsage({
        provider: PROVIDER, model,
        tokens: { prompt_tokens: 10, completion_tokens: 5 },
        timestamp: ISO, apiKey: "bench-key",
      }));
    }
    await Promise.all(tasks);
  }
  await flushUsageBuffer();
  return performance.now() - t0;
}

async function cleanup(db) {
  try {
    db.run(`DELETE FROM usageHistory WHERE provider = ? AND model LIKE ?`, [PROVIDER, `${STAMP}%`]);
  } catch (e) { console.warn(`[cleanup] ${e.message}`); }
}

async function main() {
  await initDb();
  const db = await getAdapter();
  console.log(`\n[bench] N=${N} concurrency=${CONCURRENCY} provider=${PROVIDER} stamp=${STAMP}`);

  console.log(`\n[1/4] Baseline hot-path latency (serial, per-call txn)…`);
  const baseLat = await benchBaselineLatency();
  console.log(`      p50=${baseLat.p50}ms p95=${baseLat.p95}ms p99=${baseLat.p99}ms`);

  console.log(`\n[2/4] Buffered hot-path latency (serial, saveRequestUsage)…`);

  await saveRequestUsage({ provider: PROVIDER, model: `${STAMP}-warm`, tokens: { prompt_tokens: 1, completion_tokens: 1 }, timestamp: ISO });
  await flushUsageBuffer();
  const bufLat = await benchBufferedLatency();
  console.log(`      p50=${bufLat.p50}ms p95=${bufLat.p95}ms p99=${bufLat.p99}ms`);
  const latPass = bufLat.p95 < 2;
  console.log(`      p95 < 2ms target: ${latPass ? "PASS ✓" : "FAIL ✗"} (${bufLat.p95}ms)`);

  console.log(`\n[3/4] Baseline sustained throughput (concurrency=${CONCURRENCY})…`);
  const baseThru = await benchBaselineThru();
  console.log(`      total wall-clock=${baseThru.toFixed(1)}ms`);

  console.log(`\n[4/4] Buffered sustained throughput (concurrency=${CONCURRENCY})…`);
  const bufThru = await benchBufferedThru();
  console.log(`      total wall-clock=${bufThru.toFixed(1)}ms`);
  const thruRatio = bufThru > 0 ? baseThru / bufThru : 0;
  console.log(`      buffered/baseline speedup: ${thruRatio.toFixed(2)}x`);
  const thruPass = bufThru < baseThru;
  console.log(`      buffered faster than baseline: ${thruPass ? "PASS ✓" : "FAIL ✗"}`);

  console.log(`\n[result] latency p95<2ms: ${latPass ? "PASS" : "FAIL"} | throughput win: ${thruPass ? "PASS" : "FAIL"}`);
  await cleanup(db);
  const remaining = db.get(`SELECT COUNT(*) c FROM usageHistory WHERE provider = ? AND model LIKE ?`, [PROVIDER, `${STAMP}%`]);
  console.log(`[cleanup] bench rows remaining: ${remaining?.c ?? "?"} (should be 0)\n`);

  if (!latPass || !thruPass) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`[bench] fatal:`, e);
  process.exit(2);
});
