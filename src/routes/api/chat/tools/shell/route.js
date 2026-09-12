"use server";

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "@/next/server";

const execFileAsync = promisify(execFile);
const WORKSPACE_ROOT = path.resolve(process.env.SWAY_CHAT_WORKSPACE || process.cwd());
const MAX_COMMAND_LENGTH = 500;
const MAX_OUTPUT_LENGTH = 24_000;
const MAX_FILE_LENGTH = 64_000;
const COMMAND_TIMEOUT_MS = 8_000;
const MAX_CODE_LENGTH = 6_000;
const CODE_TIMEOUT_MS = 10_000;

class ToolInputError extends Error {}

function tokenize(command) {
  if (typeof command !== "string" || !command.trim()) throw new ToolInputError("Command is required");
  if (command.length > MAX_COMMAND_LENGTH) throw new ToolInputError(`Command must be ${MAX_COMMAND_LENGTH} characters or fewer`);

  if (/[;&|<>`$()\\]/.test(command)) throw new ToolInputError("Shell operators, substitutions, and backslashes are not supported");

  const tokens = [];
  let token = "";
  let quote = "";
  for (const char of command.trim()) {
    if (quote) {
      if (char === quote) quote = "";
      else token += char;
    } else if (char === "\"" || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (token) { tokens.push(token); token = ""; }
    } else {
      token += char;
    }
  }
  if (quote) throw new ToolInputError("Unclosed quote in command");
  if (token) tokens.push(token);
  if (!tokens.length) throw new ToolInputError("Command is required");
  return tokens;
}

function resolveWorkspacePath(input = ".") {
  const requested = typeof input === "string" && input.trim() ? input.trim() : ".";
  const resolved = path.resolve(WORKSPACE_ROOT, requested);
  const relative = path.relative(WORKSPACE_ROOT, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ToolInputError("Path must stay inside the local workspace");
  }
  return resolved;
}

function isSensitivePath(input) {
  const normalized = input.replaceAll("\\", "/");
  return normalized.split("/").some((part) =>
    /^\.env(?:\.|$)/i.test(part) ||
    /\.(?:pem|key|p12|pfx)$/i.test(part) ||
    /^id_(?:rsa|ecdsa|ed25519)$/i.test(part),
  );
}

function outputResult(command, output, extra = {}) {
  const value = String(output || "").trimEnd();
  return {
    ok: true,
    command,
    cwd: ".",
    output: value ? value.slice(0, MAX_OUTPUT_LENGTH) : "(no output)",
    ...(value.length > MAX_OUTPUT_LENGTH ? { truncated: true } : {}),
    ...extra,
  };
}

async function listDirectory(command, args) {
  const options = args.filter((arg) => arg.startsWith("-"));
  if (options.some((option) => !/^-{1,2}[al]+$/.test(option))) throw new ToolInputError("Only basic ls/dir display flags are supported");
  const locations = args.filter((arg) => !arg.startsWith("-"));
  if (locations.length > 1) throw new ToolInputError("Only one directory may be listed at a time");
  const location = locations[0] || ".";
  const target = resolveWorkspacePath(location);
  const entries = await fs.readdir(target, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const output = entries.map((entry) => `${entry.isDirectory() ? "d" : "f"} ${entry.name}`).join("\n");
  return outputResult(command, output);
}

async function readFile(command, args) {
  if (args.length !== 1) throw new ToolInputError("cat/type accepts exactly one workspace file");
  if (isSensitivePath(args[0])) throw new ToolInputError("Reading credential files is not allowed");
  const target = resolveWorkspacePath(args[0]);
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new ToolInputError("The requested path is not a file");
  if (stat.size > MAX_FILE_LENGTH) throw new ToolInputError(`Files larger than ${MAX_FILE_LENGTH} bytes are not returned`);
  return outputResult(command, await fs.readFile(target, "utf8"));
}

async function searchFiles(command, args) {
  if (!args.length || args[0].startsWith("-")) throw new ToolInputError("rg requires a search pattern");
  const pattern = args[0];
  const locations = args.slice(1);
  if (locations.length > 8 || locations.some((location) => location.startsWith("-"))) {
    throw new ToolInputError("rg accepts at most eight workspace paths and no flags");
  }
  const safeLocations = locations.map((location) => {
    if (isSensitivePath(location)) throw new ToolInputError("Searching credential paths is not allowed");
    const resolved = resolveWorkspacePath(location);
    return path.relative(WORKSPACE_ROOT, resolved) || ".";
  });
  const rgArgs = [
    "--no-config", "--no-heading", "--line-number", "--color", "never",
    "--glob", "!.env*", "--glob", "!**/*.pem", "--glob", "!**/*.key", "--glob", "!**/id_rsa",
    "--", pattern, ...safeLocations,
  ];
  try {
    const { stdout, stderr } = await execFileAsync("rg", rgArgs, {
      cwd: WORKSPACE_ROOT,
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_LENGTH * 2,
      windowsHide: true,
      env: { ...process.env, RIPGREP_CONFIG_PATH: "" },
    });
    return outputResult(command, [stdout, stderr].filter(Boolean).join("\n"));
  } catch (error) {
    if (error?.code === 1) return outputResult(command, "(no matches)");
    throw new Error(error?.stderr?.trim() || error?.message || "Search failed");
  }
}

function validateGitArgs(subcommand, args) {
  const allow = {
    status: new Set(["--short", "--porcelain", "--branch"]),
    diff: new Set(["--stat", "--name-only", "--name-status", "--cached"]),
    log: new Set(["--oneline", "--decorate", "--all"]),
    show: new Set(["--stat", "--name-only"]),
    branch: new Set(["--show-current", "--list"]),
  };
  if (!allow[subcommand]) throw new ToolInputError("Only read-only git status/diff/log/show/branch are supported");
  for (const arg of args) {
    if (allow[subcommand].has(arg)) continue;
    if (subcommand === "show" && /^(?:HEAD(?:~\d+)?|[0-9a-f]{7,40})$/i.test(arg)) continue;
    throw new ToolInputError(`Unsupported git ${subcommand} argument: ${arg}`);
  }
}

async function readGit(command, args) {
  const subcommand = args.shift();
  if (!subcommand) throw new ToolInputError("git requires a read-only subcommand");
  validateGitArgs(subcommand, args);
  const gitArgs = ["--no-pager", subcommand, ...(subcommand === "diff" ? ["--no-ext-diff"] : []), ...args];
  const { stdout, stderr } = await execFileAsync("git", gitArgs, {
    cwd: WORKSPACE_ROOT,
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_LENGTH * 2,
    windowsHide: true,
    env: { ...process.env, GIT_PAGER: "cat", GIT_TERMINAL_PROMPT: "0" },
  });
  return outputResult(command, [stdout, stderr].filter(Boolean).join("\n"));
}

async function runReadOnlyCommand(command) {
  const tokens = tokenize(command);
  const executable = tokens[0].toLowerCase();
  const args = tokens.slice(1);
  if (executable === "pwd") {
    if (args.length) throw new ToolInputError("pwd does not accept arguments");
    return outputResult(command, ".");
  }
  if (executable === "ls" || executable === "dir") return listDirectory(command, args);
  if (executable === "cat" || executable === "type") return readFile(command, args);
  if (executable === "rg") return searchFiles(command, args);
  if (executable === "git") return readGit(command, args);
  throw new ToolInputError("Only pwd, ls/dir, cat/type, rg, and read-only git commands are supported");
}

async function runApprovedJavaScript(code) {
  if (typeof code !== "string" || !code.trim()) throw new ToolInputError("JavaScript code is required");
  if (code.length > MAX_CODE_LENGTH) throw new ToolInputError(`JavaScript code must be ${MAX_CODE_LENGTH} characters or fewer`);

  const safeEnv = {
    PATH: process.env.PATH || process.env.Path || "",
    Path: process.env.Path || process.env.PATH || "",
    SystemRoot: process.env.SystemRoot || "",
    TEMP: process.env.TEMP || "",
    TMP: process.env.TMP || "",
    NODE_ENV: process.env.NODE_ENV || "production",
  };
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, ["--eval", code], {
      cwd: WORKSPACE_ROOT,
      timeout: CODE_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_LENGTH * 2,
      windowsHide: true,
      env: safeEnv,
    });
    return outputResult("javascript", [stdout, stderr].filter(Boolean).join("\n"), { runtime: "javascript" });
  } catch (error) {
    const message = error?.killed || error?.signal === "SIGTERM"
      ? "JavaScript execution timed out"
      : (error?.stderr?.trim() || error?.message || "JavaScript execution failed");
    throw new Error(message);
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.mode === "execute") {
      if (body.approved !== true) {
        return NextResponse.json({
          ok: false,
          requiresApproval: true,
          action: "execute_javascript",
          warning: "This runs JavaScript in the local Sway Router workspace.",
        }, { status: 409 });
      }
      return NextResponse.json(await runApprovedJavaScript(body.code));
    }
    const result = await runReadOnlyCommand(body?.command);
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof ToolInputError ? 400 : 422;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Shell tool failed" }, { status });
  }
}
