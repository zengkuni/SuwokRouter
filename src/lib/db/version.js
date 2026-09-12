import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let cachedVersion = null;

export function getAppVersion() {
  if (cachedVersion) return cachedVersion;
  const candidates = [
    path.join(process.cwd(), "package.json"),
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "package.json"),
    path.join(process.execPath, "..", "package.json"),
  ];
  for (const pkgPath of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.version) {
        cachedVersion = pkg.version;
        return cachedVersion;
      }
    } catch {

    }
  }
  cachedVersion = "0.0.0";
  return cachedVersion;
}

export function timestampSlug(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
