import { histogram, counter, writeBehindBufferRows } from "@/observability/metrics.js";

const FLUSH_LATENCY = histogram({
  name: "sway_write_behind_flush_ms",
  help: "Write-behind buffer flush latency in milliseconds",
  labels: ["buffer"],
});

const COALESCED_TOTAL = counter({
  name: "sway_write_behind_writes_total",
  help: "Rows coalesced and flushed by the write-behind buffer",
  labels: ["buffer"],
});

const DEFAULT_FLUSH_MS = 20;
const DEFAULT_BATCH_SIZE = 200;
const BACKPRESSURE_ROWS = 1000;

const buffers = new Map();

export function getWriteBehindBuffer(opts) {
  const name = opts.name;
  const existing = buffers.get(name);
  if (existing) return existing;

  const state = {
    pending: [],
    lastFlush: Date.now(),
    flushing: false,
    timer: null,
    flushFn: opts.flushFn,
    flushMs: opts.flushMs ?? DEFAULT_FLUSH_MS,
    batchSize: opts.batchSize ?? DEFAULT_BATCH_SIZE,
    closed: false,
    closing: false,
    flushPromise: null,
    closePromise: null,
  };
  buffers.set(name, state);

  let api;

  function armTimer() {
    if (state.timer || state.closed || state.closing) return;
    state.timer = setTimeout(() => {
      state.timer = null;
      flush().catch(() => {});
    }, state.flushMs);
    state.timer?.unref?.();
  }

  async function flush() {
    if (state.closed || state.pending.length === 0) return;
    if (state.flushing) {
      await state.flushPromise;
      return;
    }
    state.flushing = true;

    const rows = state.pending;
    state.pending = [];
    const t0 = Date.now();
    state.flushPromise = (async () => {
      try {
        await state.flushFn(rows);
        FLUSH_LATENCY.observe({ buffer: name }, Date.now() - t0);
        COALESCED_TOTAL.inc({ buffer: name }, rows.length);
      } catch (e) {

        state.pending.unshift(...rows);
        console.error(`[writeBehind:${name}] flush failed (${e?.message ?? e}); ${rows.length} rows re-queued`);
      } finally {
        state.flushing = false;
        state.flushPromise = null;
        state.lastFlush = Date.now();
        updateGauge();

        if (state.pending.length > 0) armTimer();
      }
    })();
    await state.flushPromise;
  }

  function updateGauge() {
    try {
      writeBehindBufferRows.set({ buffer: name }, state.pending.length);
    } catch {

    }
  }

  function push(row) {
    if (state.closed || state.closing) return;
    state.pending.push(row);

    if (state.pending.length >= BACKPRESSURE_ROWS) {
      flush().catch(() => {});
      return;
    }
    if (state.pending.length >= state.batchSize) {

      if (!state.flushing) {
        if (state.timer) {
          clearTimeout(state.timer);
          state.timer = null;
        }
        flush().catch(() => {});
      }
      return;
    }
    armTimer();
  }

  async function flushImmediate() {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    await flush();
  }

  function pendingSize() {
    return state.pending.length;
  }

  async function close() {
    if (state.closed) return;
    if (state.closePromise) return state.closePromise;
    state.closing = true;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    state.closePromise = (async () => {

      await flush();
      if (state.pending.length > 0) await flush();
      state.closed = true;
      state.closing = false;
      liveBuffers.delete(name);
    })();
    return state.closePromise;
  }

  api = {
    push,
    flush,
    flushImmediate,
    pendingSize,
    close,
    get name() {
      return name;
    },
  };
  liveBuffers.set(name, api);
  return api;
}

export async function flushAllWriteBehindBuffers() {

  const closers = [];
  for (const buf of liveBuffers.values()) closers.push(buf.flushImmediate().catch(() => {}));
  await Promise.all(closers);
}

const liveBuffers = new Map();

export function __resetWriteBehindForTests() {
  for (const b of buffers.values()) {
    if (b.timer) clearTimeout(b.timer);
  }
  buffers.clear();
  liveBuffers.clear();
}
