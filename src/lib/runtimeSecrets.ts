import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const APP_DATA_DIR = ".swayrouter";
const SECRET_DIRECTORY = "auth";

const SECRET_SPECS = {
  JWT_SECRET: { file: "jwt-secret", bytes: 48 },
  API_KEY_SECRET: { file: "api-key-secret", bytes: 48 },
  MACHINE_ID_SALT: { file: "machine-id-salt", bytes: 32 },
} as const;

type RuntimeSecretName = keyof typeof SECRET_SPECS;
type EnvironmentSource = Record<string, string | undefined>;

function defaultDataDir(source: EnvironmentSource): string {
  const base = process.platform === "win32"
    ? (source.APPDATA || path.join(os.homedir(), "AppData", "Roaming"))
    : os.homedir();
  return path.join(base, APP_DATA_DIR);
}

function configuredDataDir(source: EnvironmentSource): string {
  const configured = String(source.DATA_DIR || "").trim();
  if (!configured) return defaultDataDir(source);
  if (process.platform === "win32" && /^\//.test(configured)) {
    return defaultDataDir(source);
  }
  return path.resolve(configured);
}

function prepareSecretDirectory(source: EnvironmentSource, override?: string): string {
  const preferred = override ? path.resolve(override) : configuredDataDir(source);
  const fallback = defaultDataDir(source);

  try {
    const directory = path.join(preferred, SECRET_DIRECTORY);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") fs.chmodSync(directory, 0o700);
    return directory;
  } catch (error) {
    if (preferred === fallback || !["EACCES", "EPERM", "EROFS"].includes(String((error as NodeJS.ErrnoException)?.code))) {
      throw error;
    }
    const directory = path.join(fallback, SECRET_DIRECTORY);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") fs.chmodSync(directory, 0o700);
    return directory;
  }
}

function readPersistedSecret(file: string): string | null {
  try {
    const value = fs.readFileSync(file, "utf8").trim();
    if (value.length < 32) {
      throw new Error(`Runtime secret file is invalid: ${file}`);
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  }
}

function writeNewSecret(file: string, value: string): string {
  let descriptor: number | null = null;
  let created = false;
  try {
    descriptor = fs.openSync(file, "wx", 0o600);
    created = true;
    fs.writeFileSync(descriptor, `${value}\n`, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    if (process.platform !== "win32") fs.chmodSync(file, 0o600);
    return value;
  } catch (error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch {}
    }
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
      const existing = readPersistedSecret(file);
      if (existing) return existing;
    }
    if (created) {
      try { fs.unlinkSync(file); } catch {}
    }
    throw error;
  }
}

function loadOrCreateSecret(directory: string, name: RuntimeSecretName): string {
  const spec = SECRET_SPECS[name];
  const file = path.join(directory, spec.file);
  const existing = readPersistedSecret(file);
  if (existing) return existing;

  if (name === "JWT_SECRET") {
    const legacy = readPersistedSecret(path.join(path.dirname(directory), "jwt-secret"));
    if (legacy) return writeNewSecret(file, legacy);
  }

  return writeNewSecret(file, crypto.randomBytes(spec.bytes).toString("base64url"));
}

export function ensureRuntimeSecrets(
  source: EnvironmentSource = process.env,
  options: { dataDir?: string } = {},
): EnvironmentSource {
  const resolved = { ...source };
  const missing = (Object.keys(SECRET_SPECS) as RuntimeSecretName[])
    .filter((name) => !String(source[name] || "").trim());
  if (missing.length === 0) return resolved;

  const directory = prepareSecretDirectory(source, options.dataDir);
  for (const name of missing) {
    resolved[name] = loadOrCreateSecret(directory, name);
  }
  return resolved;
}

export function installRuntimeSecrets(source: EnvironmentSource = process.env): EnvironmentSource {
  const resolved = ensureRuntimeSecrets(source);
  for (const name of Object.keys(SECRET_SPECS) as RuntimeSecretName[]) {
    if (!String(source[name] || "").trim()) source[name] = resolved[name];
  }
  return source;
}
