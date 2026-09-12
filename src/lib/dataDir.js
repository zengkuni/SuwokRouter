import fs from "node:fs";
import path from "path";
import os from "os";
import { env } from "./env.ts";

const APP_NAME = ".swayrouter";

function defaultDir() {
  const base = process.platform === "win32"
    ? (process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"))
    : os.homedir();
  return path.join(base, APP_NAME);
}

function secureDirectory(dir) {
  try {
    if (process.platform !== "win32") fs.chmodSync(dir, 0o700);
  } catch (error) {
    if (process.env.NODE_ENV === "production") throw error;
  }
  return dir;
}

export function getDataDir() {
  const configured = env.dataDir;
  if (!configured) return secureDirectory(defaultDir());

  if (process.platform === "win32" && /^\//.test(configured)) {
    console.warn(`[DATA_DIR] '${configured}' is a Unix path on Windows → fallback to default`);
    return defaultDir();
  }

  try {
    fs.mkdirSync(configured, { recursive: true });
    return secureDirectory(configured);
  } catch (e) {
    if (e?.code === "EACCES" || e?.code === "EPERM") {
      console.warn(`[DATA_DIR] '${configured}' not writable → fallback to the platform default data directory`);
      return defaultDir();
    }
    throw e;
  }
}

export const DATA_DIR = getDataDir();
