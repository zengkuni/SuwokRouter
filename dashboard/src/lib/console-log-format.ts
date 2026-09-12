export type ConsoleLogMessageContext = {
  label?: string | null;
  source?: string | null;
};

const SOURCE_LABELS: Record<string, string> = {
  AUTH: "Account routing",
  Auth: "Authentication",
  API: "API request",
  A4_3: "Compatibility retry",
  A4_4: "Compatibility retry",
  AutoPing: "Quota monitor",
  BG_TOKEN_REFRESH: "Token refresh",
  CHAT: "Chat request",
  CLIENT: "Client detection",
  CODEX: "Codex",
  COMBO: "Model fallback",
  CTRL: "Connection",
  DATA_DIR: "Data directory",
  DB: "Database",
  FETCH: "Provider",
  FORMAT: "Format conversion",
  FUSION: "Model fusion",
  InitApp: "Server startup",
  LOCK: "Account",
  MODALITY: "Input processing",
  NetworkMonitor: "Network monitor",
  PASSTHROUGH: "Provider passthrough",
  ProjectId: "Project setup",
  PROTOBUF: "Data encoding",
  ProxyFetch: "Proxy connection",
  RESPONSE: "Provider",
  RTK: "Token optimization",
  SSE: "Streaming",
  STREAM: "Streaming",
  TLS: "Secure connection",
  TOKEN: "Token refresh",
  TOKEN_REFRESH: "Token refresh",
  TOOLDEDUP: "Tool processing",
  Tunnel: "Cloudflare tunnel",
};

const EVENT_SOURCE_LABELS: Record<string, string> = {
  DEBUG: "Details",
  DONE: "Request",
  ERROR: "Error",
  FALLBACK: "Fallback",
  FETCH: "Provider",
  LOCK: "Account",
  REQUEST: "HTTP request",
  RESPONSE: "Provider",
  RETRY: "Retry",
  START: "Request",
  STREAM: "Streaming",
  WARN: "Warning",
};

function normalize(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .trim();
}

function maskAccount(value: string): string {
  if (!value.includes("@")) return value;
  const [local, domain] = value.split("@", 2);
  if (!local || !domain) return value;
  return `${local.slice(0, 3)}…@${domain}`;
}

function formatNumber(value: string): string {
  const numeric = Number(value.replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric.toLocaleString("en-US") : value;
}

function formatBytes(value: string): string {
  const bytes = Number(value.replace(/,/g, "").replace(/B$/i, ""));
  if (!Number.isFinite(bytes)) return value;
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(value: string): string {
  const milliseconds = Number(value.replace(/,/g, ""));
  if (!Number.isFinite(milliseconds)) return value;
  if (milliseconds >= 1000) return `${(milliseconds / 1000).toFixed(2).replace(/\.00$/, "")}s`;
  return `${milliseconds}ms`;
}

function formatValue(value: string, key: string): string {
  if (key.toLowerCase().includes("account") || key.toLowerCase() === "acc") {
    return maskAccount(value);
  }
  if (/^(?:in|out|input|output|active|due|excluded|emitted|recvLines|chunks|messages|tools)$/i.test(key)) {
    return formatNumber(value);
  }
  if (/^(?:body|bytes|size)$/i.test(key) && /^\d+(?:B)?$/i.test(value)) {
    return formatBytes(value);
  }
  if (/^(?:dur|duration|ttft|connectTimeout|stallTimeout)$/i.test(key) && /^(?:\d+)(?:ms)?$/i.test(value)) {
    return formatDuration(value.replace(/ms$/i, ""));
  }
  return value;
}

function formatKeyValueSegment(segment: string): string {
  return segment.replace(
    /(?<![?&/:])\b([A-Za-z][A-Za-z0-9_-]*)=([^ |·,]+)(?=\s*(?:\||·|,|$))/g,
    (_, key: string, value: string) => `${key}: ${formatValue(value, key)}`,
  );
}

function formatDetails(details: string): string {
  return details
    .split(/\s+·\s+|\s*\|\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (/^FMT:\s*/i.test(part)) {
        return part.replace(/^FMT:\s*/i, "Format: ").replace(/→/g, " → ");
      }
      if (/^THINK:/i.test(part)) return part.replace(/^THINK:/i, "Reasoning: ");
      if (/^ACC:/i.test(part)) return `Account: ${maskAccount(part.replace(/^ACC:/i, "").trim())}`;
      if (/^(?:STREAM|stream)$/i.test(part)) return "Streaming response";
      if (/^JSON$/i.test(part)) return "JSON response";
      const messageMatch = part.match(/^(\d+)\s+MSG$/i);
      if (messageMatch) return `${formatNumber(messageMatch[1])} messages`;
      const toolMatch = part.match(/^(\d+)\s+TOOL$/i);
      if (toolMatch) return `${formatNumber(toolMatch[1])} tools`;
      if (/^attempt=/i.test(part)) return part.replace(/^attempt=/i, "Attempt: ");
      if (/^reason=/i.test(part)) {
        const reason = part.replace(/^reason=/i, "").trim();
        return `Reason: ${reason === "initial" ? "initial request" : reason}`;
      }
      if (/^TTFT\s+\d+ms$/i.test(part)) {
        return part.replace(/^TTFT\s+/i, "First token: ").replace(/^(First token:\s*)(\d+)ms$/i, (_, prefix: string, value: string) => `${prefix}${formatDuration(value)}`);
      }
      const inputMatch = part.match(/^IN\s+(\d+)$/i);
      if (inputMatch) return `Input tokens: ${formatNumber(inputMatch[1])}`;
      const outputMatch = part.match(/^OUT\s+(\d+)$/i);
      if (outputMatch) return `Output tokens: ${formatNumber(outputMatch[1])}`;
      if (/^\d+ms$/i.test(part)) return `Duration: ${formatDuration(part.slice(0, -2))}`;
      return formatKeyValueSegment(part)
        .replace(/\bttft:/gi, "First token:")
        .replace(/\bct:/gi, "Content type:")
        .replace(/\bcl:/gi, "Content length:")
        .replace(/\bdur:/gi, "Duration:")
        .replace(/\bchunks:/gi, "Chunks:")
        .replace(/\bbytes:/gi, "Bytes:")
        .replace(/\bstallTimeout:/gi, "Stall timeout:")
        .replace(/\bconnectTimeout:/gi, "Connection timeout:");
    })
    .join(" · ");
}

function formatRequestSummary(message: string): string {
  const match = message.match(/^POST\s+(.+?)\s+→\s+(.+?)(?:\s+·\s+([\s\S]+))?$/i);
  if (!match) return formatDetails(message);

  const requestType = match[3]?.match(/\b(?:STREAM|JSON)\b/i)?.[0]?.toLowerCase();
  const prefix = requestType === "stream" ? "Sent streaming request" : "Sent request";
  const summary = `${prefix}: ${match[1]} → ${match[2]}`;
  const details = match[3] ? formatDetails(match[3]) : "";
  return details ? `${summary} · ${details}` : summary;
}

function formatProviderFetch(message: string): string {
  const match = message.match(/^([A-Z0-9_-]+)\s+→\s+([^·|]+)(?:\s+(?:·|\|)\s+([\s\S]+))?$/i);
  if (!match) return formatDetails(message);
  const details = match[3] ? formatDetails(match[3]) : "";
  return `Connecting to ${match[1]} at ${match[2].trim()}${details ? ` · ${details}` : ""}`;
}

function formatProviderResponse(message: string): string {
  const match = message.match(/^([A-Z0-9_-]+)\s+(\d{3})(?:\s+·\s+([\s\S]+))?$/i);
  if (!match) return formatDetails(message);
  const details = match[3] ? formatDetails(match[3]) : "";
  return `Provider response: ${match[1]} returned ${match[2]}${details ? ` · ${details}` : ""}`;
}

function formatCompletedRequest(message: string): string {
  const parts = message.split(/\s+·\s+/).map((part) => part.trim()).filter(Boolean);
  if (!parts.length || !/^\d+ms$/i.test(parts[0])) return formatDetails(message);
  const [duration, ...details] = parts;
  return `Request completed in ${formatDuration(duration.slice(0, -2))}${details.length ? ` · ${formatDetails(details.join(" · "))}` : ""}`;
}

function formatRetry(message: string): string {
  const compatibility = message.match(/^A4\.[34](?:\s+)?(?:·\s+)?(.+)$/i);
  if (compatibility) {
    const detail = compatibility[1]
      .replace(/^pre-content\s+/i, "before response content: ")
      .replace(/\bauth-error\b/gi, "provider authentication failed")
      .replace(/socket close/gi, "connection closed")
      .replace(/^reactive refresh\s*/i, "refreshing provider credentials: ")
      .replace(/^without\s+/i, "without unsupported field ")
      .replace(/socket retry succeeded/i, "connection retry succeeded")
      .replace(/retry succeeded/i, "retry succeeded");
    return `Compatibility retry · ${detail}`;
  }
  if (/^TOKEN REFRESHED/i.test(message)) return message.replace(/^TOKEN REFRESHED/i, "Provider credentials refreshed");
  if (/^pre-stripped\s+\(cached\)/i.test(message)) {
    return message
      .replace(/^pre-stripped\s+\(cached\)\s*/i, "Compatibility settings applied · removed ")
      .replace(/:\s*/, " fields: ");
  }
  if (/^retry after strip/i.test(message)) return message.replace(/^retry after strip/i, "Compatibility retry failed after removing");
  if (/^preview failed/i.test(message)) return message.replace(/^preview failed/i, "Response preview failed").replace(/\s*\(non-fatal\)/i, "");
  if (/^FALLBACK/i.test(message)) return formatDetails(message.replace(/^FALLBACK\s*/i, ""));
  return formatDetails(message);
}

function formatFallback(message: string): string {
  const match = message.match(/^⇄\s*ACC:([^\s]+)\s+UNAVAILABLE\s+\((\d{3})\)\s+→\s+NEXT ACCOUNT/i);
  if (match) return `Account ${maskAccount(match[1])} is unavailable (${match[2]}); trying the next account`;
  return formatRetry(message);
}

function formatAuth(message: string): string {
  let match = message.match(/^([^|]+)\|\s*total connections:\s*(\d+),\s*(?:excludeIds|excluded accounts):\s*([^,]+),\s*model:\s*(.+)$/i);
  if (match) return `${match[1].trim()} has ${formatNumber(match[2])} accounts · excluded: ${match[3].trim()} · model: ${match[4].trim()}`;
  match = message.match(/^([^|]+)\|\s*available:\s*(\d+)\/(\d+)$/i);
  if (match) return `${match[1].trim()} account availability: ${formatNumber(match[2])} of ${formatNumber(match[3])}`;
  match = message.match(/^([^|]+)\|\s*pinned to\s+([^\s]+)\s+\(([^)]+)\)/i);
  if (match) return `${match[1].trim()} is using account ${match[3]} (${match[2]})`;
  match = message.match(/^([^|]+)\|\s*cache-affine\(([^)]+)\)\s+→\s+(.+)$/i);
  if (match) return `${match[1].trim()} selected a sticky account (${match[2]}) · ${match[3]}`;
  match = message.match(/^([^|]+)\|\s*all\s+(\d+)\s+accounts locked for\s+(.+?)\s+\(([^)]+)\)/i);
  if (match) return `${match[1].trim()}: all ${formatNumber(match[2])} accounts are locked for ${match[3]} · available ${match[4]}`;
  match = message.match(/^([^|]+)\|\s*account pool busy\s+\((\d+) candidates,\s*queue=(\d+)\)/i);
  if (match) return `${match[1].trim()}: account pool is busy · ${formatNumber(match[2])} candidates · queue limit ${formatNumber(match[3])}`;
  if (/^No credentials for/i.test(message)) return message.replace(/^No credentials for/i, "No credentials are configured for");
  if (/^No active credentials for provider:/i.test(message)) return message.replace(/^No active credentials for provider:/i, "No active credentials are available for provider:");
  return formatGeneric(message);
}

function formatStreamingMessage(message: string): string {
  let match = message.match(/^flush\s*·\s*provider=([^·]+)\s*·\s*model=([^·]+)\s*·\s*recvLines=(\d+)\s*·\s*emitted=(\d+)\s*·\s*events=\[([^\]]*)\]/i);
  if (match) {
    return `Stream summary: ${match[1].trim()} · model ${match[2].trim()} · received ${formatNumber(match[3])} lines · emitted ${formatNumber(match[4])} events · events: ${match[5] || "none"}`;
  }

  match = message.match(/^pipe start\s*·\s*stallTimeout=(\d+)ms/i);
  if (match) return `Stream started · stall timeout: ${formatDuration(match[1])}`;

  match = message.match(/^chunk\s+#(\d+)\s*·\s*size=(\d+)B\s*·\s*gap=(\d+)ms\s*·\s*total=(\d+)B/i);
  if (match) {
    return `Received stream chunk ${match[1]} · ${formatBytes(match[2])} · ${formatDuration(match[3])} since previous · ${formatBytes(match[4])} total`;
  }

  match = message.match(/^upstream EOF\s*·\s*chunks=(\d+)\s*·\s*bytes=(\d+)\s*·\s*dur=(\d+)ms/i);
  if (match) {
    return `Provider stream ended · ${formatNumber(match[1])} chunks · ${formatBytes(match[2])} · ${formatDuration(match[3])}`;
  }

  match = message.match(/^STALL TIMEOUT\s+(\d+)ms\s+\|\s+chunks=(\d+)\s+\|\s+bytes=(\d+)\s+\|\s+sinceLast=(\d+)ms/i);
  if (match) {
    return `Stream stalled for ${formatDuration(match[4])} · timeout ${formatDuration(match[1])} · ${formatNumber(match[2])} chunks · ${formatBytes(match[3])}`;
  }

  match = message.match(/^(complete|error|disconnect)(?::\s*)?(.+)$/i);
  if (match) return `Stream ${match[1].toLowerCase()}: ${formatDetails(match[2])}`;
  return formatDetails(message);
}

function formatTransform(message: string): string {
  const match = message.match(/^TRANSFORM\s*·\s*(.*)$/i);
  if (!match) return formatDetails(message);
  const details = match[1]
    .split(/\s+·\s+/)
    .map((part) => part
      .replace(/^CAVEMAN:/i, "Caveman prompt: ")
      .replace(/^PONYTAIL:/i, "Ponytail prompt: "))
    .join(" · ");
  return `Token optimization applied · ${details}`;
}

function formatGeneric(message: string): string {
  return formatKeyValueSegment(message)
    .replace(/^RESPONSE_ERROR\s+(\d{3})/i, "Provider response failed with status $1")
    .replace(/^REQUEST\s+/i, "Received request ")
    .replace(/\bFMT:/gi, "Format:")
    .replace(/\bTHINK:/gi, "Reasoning:")
    .replace(/\bACC:/gi, "Account:")
    .replace(/\bTTFT\s+(\d+)ms/gi, (_, value: string) => `First token: ${formatDuration(value)}`)
    .replace(/\bIN\s+(\d+)\b/gi, (_, value: string) => `Input tokens: ${formatNumber(value)}`)
    .replace(/\bOUT\s+(\d+)\b/gi, (_, value: string) => `Output tokens: ${formatNumber(value)}`)
    .replace(/\bCAVEMAN:/gi, "Caveman prompt:")
    .replace(/\bPONYTAIL:/gi, "Ponytail prompt:")
    .replace(/\bSSE overloaded\b/gi, "Provider temporarily overloaded")
    .replace(/\b(?:cache-affine|cache affinity)\b/gi, "sticky cache routing")
    .replace(/\bmodelLocked\b/gi, "model temporarily locked")
    .replace(/\bexcludeIds\b/gi, "excluded accounts")
    .replace(/\binputItems\b/gi, "input items")
    .replace(/\bprefetchImages\b/gi, "image preparation")
    .replace(/\bstraggler\/timeout\b/gi, "slow or timed-out response")
    .replace(/\bpanel=/gi, "panel: ")
    .replace(/\bjudge=/gi, "reviewer: ")
    .replace(/\bquorum=/gi, "minimum responses: ")
    .replace(/\bsticky=/gi, "sticky limit: ")
    .replace(/\bstrategy:/gi, "routing strategy:")
    .replace(/\bfan-out collected\b/gi, "parallel model responses collected")
    .replace(/\breturned empty content\b/gi, "returned an empty response")
    .replace(/\bpanicked\b/gi, "failed")
    .replace(/\bSTREAM\b/gi, "Streaming response")
    .replace(/\b(\d+)\s+MSG\b/gi, (_, value: string) => `${formatNumber(value)} messages`)
    .replace(/\b(\d+)\s+TOOL\b/gi, (_, value: string) => `${formatNumber(value)} tools`)
    .replace(/\s{2,}/g, " ")
    .replace(/(Account:\s+)([^\s·|]+@[^\s·|]+)/gi, (_, prefix: string, value: string) => `${prefix}${maskAccount(value)}`)
    .trim();
}

export function humanizeConsoleLogMessage(
  message: string,
  context: ConsoleLogMessageContext = {},
): string {
  const normalized = normalize(message);
  if (!normalized) return "";

  const label = context.label?.toUpperCase() || "";
  const source = context.source?.toUpperCase() || "";

  if (label === "START") return formatRequestSummary(normalized);
  if (label === "FETCH" || source === "FETCH") return formatProviderFetch(normalized);
  if (label === "RESPONSE" || source === "RESPONSE") return formatProviderResponse(normalized);
  if (label === "DONE") return formatCompletedRequest(normalized);
  if (label === "REQUEST") return formatGeneric(normalized);
  const normalizedSource = source.replace(/\./g, "_");
  if (label === "RETRY" || normalizedSource === "A4_3" || normalizedSource === "A4_4") return formatRetry(normalized);
  if (label === "FALLBACK" || source === "FALLBACK") return formatFallback(normalized);
  if (source === "AUTH") return formatAuth(normalized);
  if (label === "STREAM" || source === "SSE" || source === "STREAM" || source === "CTRL") return formatStreamingMessage(normalized);
  if (/^POST\s+/i.test(normalized)) return formatRequestSummary(normalized);
  if (/^TRANSFORM\s*·/i.test(normalized)) return formatTransform(normalized);
  if (/^(?:flush|pipe start|chunk\s+#|upstream EOF|STALL TIMEOUT|complete|error|disconnect)/i.test(normalized)) {
    return formatStreamingMessage(normalized);
  }
  return formatGeneric(normalized);
}

export function displayConsoleSource(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) return "Runtime";
  return EVENT_SOURCE_LABELS[trimmed.toUpperCase()]
    || SOURCE_LABELS[trimmed]
    || SOURCE_LABELS[trimmed.toUpperCase().replace(/\./g, "_")]
    || trimmed
      .replace(/[_:-]+/g, " ")
      .replace(/\b\w/g, (character) => character.toUpperCase());
}
