import { parseSSELine, hasValuableContent } from "../utils/streamHelpers.js";
import { isGracefulNetworkClose } from "../utils/streamHandler.js";
import { FORMATS } from "../translator/formats.js";

const DEFAULT_MAX_EVENTS  = 8;
const DEFAULT_MAX_BYTES   = 16384;
const DEFAULT_DEADLINE_MS = 20000;

export function classifySSEEvent(parsed, sourceFormat) {
  if (!parsed) return "neutral";

  if (parsed.done === true) return "neutral";

  if (parsed.error) return "error";
  if (parsed.type === "error") return "error";
  if (parsed.error_code || parsed.error_message) return "error";

  if (parsed.candidates?.[0]?.finishReason &&
      parsed.candidates[0].finishReason !== "STOP" &&
      parsed.candidates[0].finishReason !== "FINISH_REASON_UNSPECIFIED") {
    return "error";
  }

  if (hasValuableContent(parsed, sourceFormat)) return "content";

  return "neutral";
}

export function isAuthError(parsed) {
  if (!parsed) return false;
  const errObj = parsed.error;
  if (!errObj || typeof errObj !== "object") return false;

  const code = String(errObj.code || errObj.type || "").toLowerCase();
  const msg  = String(errObj.message || "").toLowerCase();

  return (
    code.includes("auth") ||
    code.includes("401")  ||
    code.includes("unauthorized") ||
    msg.includes("unauthorized")  ||
    msg.includes("401")           ||
    msg.includes("expired")       ||
    msg.includes("invalid_token") ||
    msg.includes("token_expired") ||
    msg.includes("expired_token")
  );
}

export function createReplayStream(prefixChunks, restReader, pendingRead = null) {
  let prefixIndex = 0;
  let reading = false;
  let settled = false;
  let firstRead = pendingRead;

  const close = (controller) => {
    if (settled) return;
    settled = true;
    try { controller.close(); } catch {                                  }
  };

  const readRest = () => {
    if (firstRead) {
      const read = firstRead;
      firstRead = null;
      return read;
    }
    return restReader.read();
  };

  return new ReadableStream({
    async pull(controller) {
      if (settled || reading) return;

      if (prefixIndex < prefixChunks.length) {
        try {
          controller.enqueue(prefixChunks[prefixIndex++]);
        } catch {
          settled = true;
        }
        return;
      }

      reading = true;
      try {
        const { done, value } = await readRest();
        if (settled) return;
        if (done) {
          close(controller);
          return;
        }
        try { controller.enqueue(value); } catch { settled = true; }
      } catch (err) {
        if (settled) return;
        settled = true;
        try { controller.error(err); } catch {                                  }
      } finally {
        reading = false;
      }
    },
    cancel() {
      settled = true;
      firstRead = null;
      restReader.cancel().catch(() => {});
    },
  });
}

export async function previewSSEPrefix(providerResponse, sourceFormat, opts = {}) {
  const maxEvents  = opts.maxEvents  ?? DEFAULT_MAX_EVENTS;
  const maxBytes   = opts.maxBytes   ?? DEFAULT_MAX_BYTES;
  const deadlineMs = opts.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const log        = opts.log        ?? null;
  const reqTag     = opts.reqTag     ?? "";
  const callerSignal = opts.signal ?? null;

  const body = providerResponse.body;
  if (!body) return _verdict("streamClosed", { eventsSeen: 0, bytesRead: 0 });

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const prefixChunks = [];

  let lineBuffer    = "";
  let eventLines    = [];
  let totalBytes    = 0;
  let eventsSeen    = 0;
  let committed     = false;
  let errorEvent    = null;
  let errorIsAuth   = false;
  let deadlineTimer = null;
  let deadlineHit   = false;
  let pendingRead = null;

  const deadline = new Promise((resolve) => {
    deadlineTimer = setTimeout(() => { deadlineHit = true; resolve("deadline"); }, deadlineMs);
  });
  const abortPromise = callerSignal
    ? new Promise((resolve) => {
        if (callerSignal.aborted) resolve("caller-abort");
        else callerSignal.addEventListener("abort", () => resolve("caller-abort"), { once: true });
      })
    : null;

  try {
    while (eventsSeen < maxEvents && totalBytes < maxBytes && !committed && !errorEvent) {
      pendingRead = reader.read();
      const readResult = await Promise.race([pendingRead, deadline, abortPromise].filter(Boolean));

      if (readResult === "caller-abort") {
        reader.cancel().catch(() => {});
        return _verdict("callerAbort", { eventsSeen, bytesRead: totalBytes });
      }
      if (readResult === "deadline") break;
      pendingRead = null;

      const { done, value } = readResult;
      if (done) break;

      prefixChunks.push(value);
      totalBytes += value.byteLength;

      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line === "") {

          eventsSeen += 1;
          for (const eline of eventLines) {
            const parsed = parseSSELine(eline, sourceFormat);
            const cls = classifySSEEvent(parsed, sourceFormat);

            if (cls === "content") {
              committed = true;
              break;
            }
            if (cls === "error") {
              errorEvent  = parsed;
              errorIsAuth = isAuthError(parsed);
              break;
            }
          }
          eventLines = [];
          if (committed || errorEvent) break;
        } else {
          eventLines.push(line);
        }
      }
      if (committed || errorEvent) break;
    }
  } catch (error) {
    if (callerSignal?.aborted) {
      reader.cancel().catch(() => {});
      pendingRead?.catch?.(() => {});
      return _verdict("callerAbort", { eventsSeen, bytesRead: totalBytes });
    }
    if (isGracefulNetworkClose(error)) {
      reader.cancel().catch(() => {});
      return _verdict("networkError", {
        committed,
        eventsSeen,
        bytesRead: totalBytes,
        error: error?.message || "upstream stream closed",
      });
    }
    throw error;
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }

  const events = eventsSeen;
  log?.debug?.("A4.3", `preview: events=${eventsSeen} bytes=${totalBytes} kind=${committed ? "committed" : errorEvent ? "error" : deadlineHit ? "timeout" : "streamClosed"} auth=${errorIsAuth}`);

  if (errorEvent && !committed) {

    reader.cancel().catch(() => {});
    return _verdict("error", { committed: false, splicedResponse: null, isAuthError: errorIsAuth, errorEvent, eventsSeen, bytesRead: totalBytes });
  }

  const replayBody = createReplayStream(prefixChunks, reader, pendingRead);
  const splicedResponse = new Response(replayBody, {
    status:       providerResponse.status,
    statusText:   providerResponse.statusText,
    headers:      providerResponse.headers,
  });

  const kind = committed ? "committed" : deadlineHit ? "timeout" : "streamClosed";
  return _verdict(kind, { committed, splicedResponse, isAuthError: errorIsAuth, errorEvent, eventsSeen, bytesRead: totalBytes });
}

function _verdict(kind, rest) {
  return { kind, committed: rest.committed ?? false, splicedResponse: rest.splicedResponse ?? null, isAuthError: rest.isAuthError ?? false, errorEvent: rest.errorEvent ?? null, eventsSeen: rest.eventsSeen ?? 0, bytesRead: rest.bytesRead ?? 0 };
}
