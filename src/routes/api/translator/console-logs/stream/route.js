import { getConsoleEntries, getConsoleEmitter, initConsoleLogCapture } from "@/lib/consoleLogBuffer";

export const dynamic = "force-dynamic";

initConsoleLogCapture();

export async function GET(request) {
  const encoder = new TextEncoder();
  const emitter = getConsoleEmitter();
  const state = {
    closed: false,
    send: null,
    sendLines: null,
    sendClear: null,
    keepalive: null,
    abortHandler: null,
    ready: false,
    pending: [],
  };

  const cleanup = () => {
    if (state.closed) return;
    state.closed = true;
    if (state.send) emitter.off("line", state.send);
    if (state.sendLines) emitter.off("lines", state.sendLines);
    if (state.sendClear) emitter.off("clear", state.sendClear);
    if (state.keepalive) clearInterval(state.keepalive);
    if (state.abortHandler) request.signal.removeEventListener("abort", state.abortHandler);
  };

  state.abortHandler = cleanup;
  request.signal.addEventListener("abort", state.abortHandler, { once: true });

  const stream = new ReadableStream({
    start(controller) {
      const enqueueEvent = (event) => {
        if (state.closed) return;
        if (!state.ready) {
          state.pending.push(event);
          return;
        }
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          cleanup();
        }
      };

      state.send = (line) => enqueueEvent({ type: "line", line });
      state.sendLines = (lines) => {
        if (Array.isArray(lines) && lines.length > 0) {
          enqueueEvent({ type: "lines", lines });
        }
      };

      state.sendClear = () => enqueueEvent({ type: "clear" });

      emitter.on("line", state.send);
      emitter.on("lines", state.sendLines);
      emitter.on("clear", state.sendClear);

      const buffered = getConsoleEntries();
      if (buffered.length > 0) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "init", entries: buffered })}\n\n`));
      }

      state.ready = true;
      for (const event of state.pending.splice(0, state.pending.length)) {
        enqueueEvent(event);
      }

      state.keepalive = setInterval(() => {
        if (state.closed) { clearInterval(state.keepalive); return; }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, 25000);
    },

    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
