const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

const LEVEL = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase?.()] ?? LOG_LEVELS.INFO;
const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

const USE_COLOR = process.env.NO_COLOR === undefined
  && (process.env.FORCE_COLOR === "1" || process.stdout?.isTTY === true);

function color(value, code) {
  return USE_COLOR ? `${code}${value}${ANSI.reset}` : value;
}

function formatTime() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

export function formatLine(tag, label, message) {
  const tagText = tag ? color(tag, ANSI.cyan) : "--";
  const labelColors = {
    START: ANSI.green,
    FETCH: ANSI.cyan,
    RESPONSE: ANSI.green,
    RETRY: ANSI.yellow,
    DONE: ANSI.green,
    WARN: ANSI.yellow,
    ERROR: ANSI.red,
    FALLBACK: ANSI.magenta,
    LOCK: ANSI.yellow,
    DEBUG: ANSI.dim,
  };
  const labelText = labelColors[label] ? color(label, labelColors[label]) : label;
  return `[${formatTime()}] ${tagText} ${labelText} ${message}`;
}

const REQ_TAGS = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"];
let tagCursor = 0;

export function nextTag() {
  const tag = REQ_TAGS[tagCursor % REQ_TAGS.length];
  tagCursor++;
  return tag;
}

export function tagForSession(seed) {
  if (!seed) return nextTag();
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return REQ_TAGS[Math.abs(h) % REQ_TAGS.length];
}

export function line(tag, symbol, message) {
  if (LEVEL > LOG_LEVELS.INFO) return;
  console.log(formatLine(tag, symbol, message));
}

export function errorLine(tag, symbol, message) {
  console.log(formatLine(tag, symbol, message));
}

export function fmtThink(intent) {
  if (!intent || !intent.mode) return null;
  if (intent.mode === "none") return "off";
  if (intent.mode === "auto") return "auto";
  if (intent.mode === "budget") {
    const k = intent.budget >= 1000 ? `${Math.round(intent.budget / 1000)}k` : `${intent.budget}`;
    return k;
  }
  if (intent.mode === "level") return intent.level;
  return null;
}

function formatData(data) {
  if (!data) return "";
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

export function debug(tag, message, data) {
  if (LEVEL <= LOG_LEVELS.DEBUG) {
    const dataStr = data ? ` ${formatData(data)}` : "";
    console.log(`[${formatTime()}] DEBUG [${tag}] ${message}${dataStr}`);
  }
}

export function info(tag, message, data) {
  if (LEVEL <= LOG_LEVELS.INFO) {
    const dataStr = data ? ` ${formatData(data)}` : "";
    console.log(`[${formatTime()}] INFO [${tag}] ${message}${dataStr}`);
  }
}

export function warn(tag, message, data) {
  if (LEVEL <= LOG_LEVELS.WARN) {
    const dataStr = data ? ` ${formatData(data)}` : "";
    console.warn(`[${formatTime()}] WARN [${tag}] ${message}${dataStr}`);
  }
}

export function error(tag, message, data) {
  if (LEVEL <= LOG_LEVELS.ERROR) {
    const dataStr = data ? ` ${formatData(data)}` : "";
    console.log(`[${formatTime()}] ERROR [${tag}] ${message}${dataStr}`);
  }
}

export function request(method, path, extra) {
  const dataStr = extra ? ` ${formatData(extra)}` : "";
  console.log(`\x1b[36m[${formatTime()}] REQUEST ${method} ${path}${dataStr}\x1b[0m`);
}

export function response(status, duration, extra) {
  const label = status < 400 ? "RESPONSE" : "RESPONSE_ERROR";
  const dataStr = extra ? ` ${formatData(extra)}` : "";
  console.log(`[${formatTime()}] ${label} ${status} (${duration}ms)${dataStr}`);
}

export function stream(event, data) {
  const dataStr = data ? ` ${formatData(data)}` : "";
  console.log(`[${formatTime()}] STREAM ${event}${dataStr}`);
}

export function maskKey(key) {
  if (!key || key.length < 8) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
