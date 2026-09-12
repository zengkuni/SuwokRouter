import { EventEmitter } from "events";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config.js";

const consoleLevels = ["log", "info", "warn", "error", "debug"];

if (!global._consoleLogBufferState) {
  global._consoleLogBufferState = {
    logs: [],
    entries: [],
    patched: false,
    originals: {},
    emitter: new EventEmitter(),
  };
  global._consoleLogBufferState.emitter.setMaxListeners(50);
}

const state = global._consoleLogBufferState;

if (!state.emitter) {
  state.emitter = new EventEmitter();
  state.emitter.setMaxListeners(50);
}

if (!state.entries) state.entries = state.logs.map((line) => ({ line, ts: 0 }));
if (!state.pendingLines) state.pendingLines = [];
if (!state.flushTimer) state.flushTimer = null;

const FLUSH_INTERVAL_MS = 100;
const MAX_BATCH_LINES = 50;

function flushPendingLines() {
  state.flushTimer = null;
  if (!state.pendingLines.length) return;

  const lines = state.pendingLines.splice(0, state.pendingLines.length);
  state.emitter.emit("lines", lines);
}

function scheduleFlush() {
  if (state.flushTimer) return;
  state.flushTimer = setTimeout(flushPendingLines, FLUSH_INTERVAL_MS);
  state.flushTimer?.unref?.();
}

function toLogLine(level, args) {
  return args.map(formatArg).join(" ");
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(str) {
  return str.replace(ANSI_RE, "");
}

const EMOJI_RE = /[\p{Emoji_Presentation}\p{Extended_Pictographic}�️‍]/gu;

function stripDecorativeEmoji(str) {
  return str.replace(EMOJI_RE, "").replace(/[ \t]{2,}/g, " ").trim();
}

function formatArg(arg) {
  if (typeof arg === "string") return stripDecorativeEmoji(stripAnsi(arg));
  if (arg instanceof Error) return stripDecorativeEmoji(stripAnsi(arg.stack || arg.message || String(arg)));
  try {
    return stripDecorativeEmoji(stripAnsi(JSON.stringify(arg)));
  } catch {
    return stripDecorativeEmoji(stripAnsi(String(arg)));
  }
}

function appendLine(line) {
  const entry = { line, ts: Date.now() };
  state.logs.push(line);
  state.entries.push(entry);
  const maxLines = CONSOLE_LOG_CONFIG.maxLines;
  if (state.logs.length > maxLines) {
    state.logs = state.logs.slice(-maxLines);
    state.entries = state.entries.slice(-maxLines);
  }
  state.pendingLines.push(entry);
  if (state.pendingLines.length >= MAX_BATCH_LINES) {
    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
    flushPendingLines();
  } else {
    scheduleFlush();
  }
}

export function initConsoleLogCapture() {
  if (state.patched) return;

  for (const level of consoleLevels) {
    state.originals[level] = console[level];
    console[level] = (...args) => {
      appendLine(toLogLine(level, args));
      state.originals[level](...args);
    };
  }

  state.patched = true;
}

export function getConsoleLogs() {
  return [...state.logs];
}

export function getConsoleEntries() {
  return state.entries.map((entry) => ({ ...entry }));
}

export function clearConsoleLogs() {
  state.logs = [];
  state.entries = [];
  state.pendingLines = [];
  if (state.flushTimer) {
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }
  state.emitter.emit("clear");
}

export function getConsoleEmitter() {
  return state.emitter;
}
