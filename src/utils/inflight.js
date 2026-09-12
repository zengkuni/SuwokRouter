import { statsEmitter, getActiveRequests } from "@/lib/usageDb";

const DEFAULT_THROTTLE_MS  = 2000;
const DEFAULT_MAX_CLIENTS  = 10;
const DEFAULT_KEEPALIVE_MS = 25000;

const activeClients = new Set();

export function buildInflightSnapshot(active) {
  const byProvider = {};
  const byAccount = {};
  let total = 0;

  for (const req of active) {
    total += req.count;
    byProvider[req.provider] = (byProvider[req.provider] || 0) + req.count;
    if (!byAccount[req.account]) byAccount[req.account] = {};
    byAccount[req.account][req.provider] = (byAccount[req.account][req.provider] || 0) + req.count;
  }

  return {
    timestamp: new Date().toISOString(),
    total,
    byProvider,
    byAccount,
    requests: active,
  };
}

export function createInflightStream(opts = {}) {
  const throttleMs  = opts.throttleMs  ?? DEFAULT_THROTTLE_MS;
  const maxClients  = opts.maxClients  ?? DEFAULT_MAX_CLIENTS;
  const keepaliveMs = opts.keepaliveMs ?? DEFAULT_KEEPALIVE_MS;
  const eventSource = opts.statsEmitter ?? statsEmitter;
  const readActiveRequests = opts.getActiveRequests ?? getActiveRequests;

  if (activeClients.size >= maxClients) {
    return {
      stream: null,
      status: 429,
      cleanup: () => {},
    };
  }

  const encoder = new TextEncoder();
  let closed = false;
  let controllerRef = null;
  let lastPushAt = 0;
  let throttleTimer = null;
  let keepaliveTimer = null;

  const enqueue = (data) => {
    if (closed || !controllerRef) return;
    try {
      controllerRef.enqueue(encoder.encode(data));
    } catch {
      cleanup();
    }
  };

  const sendSnapshot = async () => {
    if (closed) return;
    try {
      const result = await readActiveRequests();

      const active = result?.activeRequests ?? [];
      const snapshot = buildInflightSnapshot(active);
      enqueue(`data: ${JSON.stringify(snapshot)}\n\n`);
      lastPushAt = Date.now();
    } catch {

    }
  };

  const onPending = () => {
    if (closed) return;
    const now = Date.now();
    const elapsed = now - lastPushAt;
    if (elapsed >= throttleMs) {

      sendSnapshot();
    } else if (!throttleTimer) {

      throttleTimer = setTimeout(() => {
        throttleTimer = null;
        sendSnapshot();
      }, throttleMs - elapsed);
    }

  };

  const cleanup = () => {
    if (closed) return;
    closed = true;
    activeClients.delete(cleanup);
    eventSource.off("pending", onPending);
    if (throttleTimer) { clearTimeout(throttleTimer); throttleTimer = null; }
    if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
    controllerRef = null;
  };

  const stream = new ReadableStream({
    start(controller) {
      controllerRef = controller;
      activeClients.add(cleanup);

      sendSnapshot();

      eventSource.on("pending", onPending);

      keepaliveTimer = setInterval(() => {
        if (closed) { clearInterval(keepaliveTimer); return; }
        enqueue(": ping\n\n");
      }, keepaliveMs);
    },

    cancel() {
      cleanup();
    },
  });

  return { stream, status: 200, cleanup };
}

export function __resetInflightForTests() {
  activeClients.clear();
}
