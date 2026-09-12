import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureRuntimeSecrets } from "./runtimeSecrets";
import { loadEnv } from "./env";

const temporaryDirectories: string[] = [];

function temporaryDataDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sway-runtime-secrets-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("runtime secret bootstrap", () => {
  test("creates persistent production secrets when no environment file exists", () => {
    const dataDir = temporaryDataDir();
    const first = ensureRuntimeSecrets({ NODE_ENV: "production", DATA_DIR: dataDir });
    const second = ensureRuntimeSecrets({ NODE_ENV: "production", DATA_DIR: dataDir });

    for (const name of ["JWT_SECRET", "API_KEY_SECRET", "MACHINE_ID_SALT"]) {
      expect(first[name]?.length).toBeGreaterThanOrEqual(32);
      expect(second[name]).toBe(first[name]);
    }

    expect(loadEnv(first).nodeEnv).toBe("production");
    expect(fs.readdirSync(path.join(dataDir, "auth")).sort()).toEqual([
      "api-key-secret",
      "jwt-secret",
      "machine-id-salt",
    ]);
  });

  test("preserves explicit environment secrets", () => {
    const dataDir = temporaryDataDir();
    const explicit = {
      NODE_ENV: "production",
      DATA_DIR: dataDir,
      JWT_SECRET: "j".repeat(48),
      API_KEY_SECRET: "k".repeat(48),
      MACHINE_ID_SALT: "m".repeat(48),
    };

    const resolved = ensureRuntimeSecrets(explicit);
    expect(resolved.JWT_SECRET).toBe(explicit.JWT_SECRET);
    expect(resolved.API_KEY_SECRET).toBe(explicit.API_KEY_SECRET);
    expect(resolved.MACHINE_ID_SALT).toBe(explicit.MACHINE_ID_SALT);
    expect(fs.existsSync(path.join(dataDir, "auth"))).toBe(false);
  });

  test("migrates the legacy dashboard JWT secret without rotating it", () => {
    const dataDir = temporaryDataDir();
    const legacy = "legacy-jwt-secret-".padEnd(48, "x");
    fs.writeFileSync(path.join(dataDir, "jwt-secret"), legacy);

    const resolved = ensureRuntimeSecrets({ NODE_ENV: "production", DATA_DIR: dataDir });
    expect(resolved.JWT_SECRET).toBe(legacy);
    expect(fs.readFileSync(path.join(dataDir, "auth", "jwt-secret"), "utf8").trim()).toBe(legacy);
});
});
