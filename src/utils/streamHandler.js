import { STREAM_STALL_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { dbg, isDebugEnabled } from "./debugLog.js";

export function isGracefulNetworkClose(error) {
  const seen = new Set();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const name = String(current.name || "").toLowerCase();
    const code = String(current.code || "").toUpperCase();
    const message = String(current.message || "").toLowerCase();
    if (name === "aborterror") return true;
    if (
      code === "UND_ERR_SOCKET" ||
      code === "ECONNRESET" ||
      code === "ECONNABORTED" ||
      code === "ETIMEDOUT" ||
      code === "EPIPE" ||
      code === "ERR_STREAM_PREMATURE_CLOSE" ||
      message.includes("other side closed") ||
      message.includes("socket hang up") ||
      message.includes("econnreset") ||
      message.includes("econnaborted") ||
      message.includes("etimedout") ||
      message.includes("epipe") ||
      message.includes("premature close")
    ) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

function getTimeString() {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function createStreamController({ onDisconnect, onError, log, provider, model, reqTag = "", callerSignal = null } = {}) {
  const abortController = new AbortController();
  const startTime = Date.now();
  let disconnected = false;
  let callerAborted = false;
  let abortTimeout = null;
  let removeCallerAbort = null;

  const onCallerAbort = () => {
    if (disconnected) return;
    callerAborted = true;
    disconnected = true;
    if (abortTimeout) {
      clearTimeout(abortTimeout);
      abortTimeout = null;
    }
    try { abortController.abort(callerSignal?.reason); } catch { abortController.abort(); }
    onDisconnect?.({ reason: "caller_aborted", duration: Date.now() - startTime });
  };
  if (callerSignal) {
    if (callerSignal.aborted) onCallerAbort();
    else {
      callerSignal.addEventListener("abort", onCallerAbort, { once: true });
      removeCallerAbort = () => callerSignal.removeEventListener("abort", onCallerAbort);
    }
  }

  const logStream = (symbol, status, isError = false) => {
    const duration = Date.now() - startTime;
    const emit = isError ? log?.errorLine : log?.line;
    if (emit) emit(reqTag, symbol, `${status} · ${provider}/${model} · ${duration}ms`);
    else console.log(`[${getTimeString()}] ${symbol} ${provider}/${model} · ${status} · ${duration}ms`);
  };

  return {
    signal: abortController.signal,
    startTime,

    isConnected: () => !disconnected,
    isCallerAborted: () => callerAborted,

    handleDisconnect: (reason = "client_closed") => {
      if (disconnected) return;
      disconnected = true;
      removeCallerAbort?.();
      removeCallerAbort = null;

      logStream("WARN", `DISCONNECT · ${reason}`);
      dbg("CTRL", `${provider}/${model} | disconnect=${reason} | dur=${Date.now() - startTime}ms`);

      abortTimeout = setTimeout(() => {
        abortController.abort();
      }, 500);

      onDisconnect?.({ reason, duration: Date.now() - startTime });
    },

    handleComplete: () => {
      if (disconnected) return;
      disconnected = true;
      removeCallerAbort?.();
      removeCallerAbort = null;

      if (abortTimeout) {
        clearTimeout(abortTimeout);
        abortTimeout = null;
      }
    },

    handleError: (error) => {
      if (disconnected) return;
      disconnected = true;
      removeCallerAbort?.();
      removeCallerAbort = null;

      if (abortTimeout) {
        clearTimeout(abortTimeout);
        abortTimeout = null;
      }

      if (error.name === "AbortError") {
        logStream("WARN", "ABORTED");
        onError?.(error);
        return;
      }

      logStream("ERROR", `ERROR: ${error.message}${error.stack ? `\n    ${error.stack}` : ""}`, true);
      onError?.(error);
    },

    abort: () => abortController.abort()
  };
}

export function createDisconnectAwareStream(transformStream, streamController, onAbortTerminal = null) {
  const reader = transformStream.readable.getReader();
  const writer = transformStream.writable.getWriter();
  let terminalEmitted = false;

  const emitTerminal = (controller) => {
    if (terminalEmitted || !onAbortTerminal) return;
    terminalEmitted = true;
    try {
      const bytes = onAbortTerminal();
      if (bytes) controller.enqueue(bytes);
    } catch {                            }
  };

  return new ReadableStream({
    async pull(controller) {
      if (!streamController.isConnected()) {
        if (!streamController.isCallerAborted?.()) emitTerminal(controller);
        controller.close();
        return;
      }

      try {
        const { done, value } = await reader.read();

        if (done) {
          streamController.handleComplete();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        const wasConnected = streamController.isConnected();
        const callerAborted = streamController.isCallerAborted?.() === true;

        const msg0 = error?.message || "";
        const isControllerClosed = msg0.includes("already closed") || msg0.includes("Invalid state");
        if (!isControllerClosed && !callerAborted) streamController.handleError(error);
        reader.cancel().catch(() => {});
        writer.abort().catch(() => {});

        const isNetworkClose = isGracefulNetworkClose(error);

        try {
          if (callerAborted) {
            controller.close();
          } else if (!wasConnected || isNetworkClose || onAbortTerminal) {
            emitTerminal(controller);
            controller.close();
          } else {
            controller.error(error);
          }
        } catch (e) {                                   }
      }
    },

    cancel(reason) {
      streamController.handleDisconnect(reason || "cancelled");
      reader.cancel();
      writer.abort();
    }
  });
}

export function pipeWithDisconnect(providerResponse, transformStream, streamController, onAbortTerminal = null, stallTimeoutMs = STREAM_STALL_TIMEOUT_MS) {
  let stallTimer = null;
  let chunkCount = 0;
  let totalBytes = 0;
  let lastChunkAt = Date.now();
  const t0 = Date.now();
  const tag = "STREAM";
  const clearStall = () => {
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
  };
  const armStall = () => {
    clearStall();
    stallTimer = setTimeout(() => {
      stallTimer = null;
      dbg(tag, `STALL TIMEOUT ${stallTimeoutMs}ms | chunks=${chunkCount} | bytes=${totalBytes} | sinceLast=${Date.now() - lastChunkAt}ms`);
      streamController.handleError?.(new Error("stream stall timeout"));
      streamController.abort?.();
    }, stallTimeoutMs);
  };

  const wrappedController = {
    signal: streamController.signal,
    startTime: streamController.startTime,
    isConnected: () => streamController.isConnected(),
    handleComplete: () => { dbg(tag, `complete | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`); clearStall(); streamController.handleComplete(); },
    handleError: (e) => { dbg(tag, `error: ${e?.message} | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`); clearStall(); streamController.handleError(e); },
    handleDisconnect: (r) => { dbg(tag, `disconnect: ${r} | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`); clearStall(); streamController.handleDisconnect(r); },
    abort: () => { clearStall(); streamController.abort(); }
  };

  armStall();
  dbg(tag, `pipe start | stallTimeout=${stallTimeoutMs}ms`);

  const upstreamTap = new TransformStream({
    transform(chunk, controller) {
      chunkCount++;
      const sz = chunk?.byteLength || chunk?.length || 0;
      totalBytes += sz;
      const now = Date.now();
      const gap = now - lastChunkAt;
      lastChunkAt = now;
      if (isDebugEnabled && (chunkCount <= 5 || chunkCount % 20 === 0 || gap > 5000)) {
        dbg(tag, `chunk #${chunkCount} | size=${sz}B | gap=${gap}ms | total=${totalBytes}B`);
      }
      armStall();
      controller.enqueue(chunk);
    },
    flush() { dbg(tag, `upstream EOF | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`); clearStall(); }
  });

  const transformedBody = providerResponse.body
    .pipeThrough(upstreamTap)
    .pipeThrough(transformStream);

  return createDisconnectAwareStream(
    { readable: transformedBody, writable: { getWriter: () => ({ abort: () => Promise.resolve() }) } },
    wrappedController,
    onAbortTerminal
  );
}
