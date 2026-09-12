const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { discoverInstall, inspectDirectory, readDotEnv, LEGACY_BUNDLED_ERROR } = require("./discover");

describe("runtime discovery", () => {
  test("reads native .env and manifest metadata", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sway-discover-"));
    try {
      fs.mkdirSync(path.join(root, "src"));
      fs.writeFileSync(path.join(root, "src", "server.ts"), "export {};\n");
      fs.writeFileSync(path.join(root, ".env"), 'PORT="8080"\nJWT_SECRET="value"\n');
      fs.writeFileSync(path.join(root, ".swayrouter-install.json"), JSON.stringify({ mode: "native", port: 8080, dataDir: path.join(root, "data") }));
      const installation = inspectDirectory(root);
      expect(installation.mode).toBe("native");
      expect(installation.port).toBe(8080);
      expect(installation.env.JWT_SECRET).toBe("value");
      expect(readDotEnv(path.join(root, ".env")).PORT).toBe("8080");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("explicit missing directory is not discovered", () => {
    expect(discoverInstall({ dir: path.join(os.tmpdir(), "not-a-sway-install", String(Date.now())) })).toBe(null);
  });

  test("rejects legacy bundled manifests with migration guidance", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sway-bundled-"));
    try {
      fs.writeFileSync(path.join(root, ".swayrouter-install.json"), JSON.stringify({ mode: "bundled" }));
      expect(() => inspectDirectory(root)).toThrow(LEGACY_BUNDLED_ERROR);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("discovers compiled binaries without treating them as npm bundles", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sway-binary-"));
    const binaryName = process.platform === "win32" ? "swayrouter.exe" : "swayrouter";
    try {
      fs.writeFileSync(path.join(root, binaryName), "binary");
      expect(inspectDirectory(root)).toMatchObject({ mode: "binary", binaryFile: path.join(root, binaryName) });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("discovers the repository root when cli directory is supplied", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sway-source-"));
    try {
      fs.mkdirSync(path.join(root, "src"));
      fs.writeFileSync(path.join(root, "src", "server.ts"), "export {};\n");
      expect(discoverInstall({ cliDirectory: root })).toMatchObject({ mode: "native", sourceFile: path.join(root, "src", "server.ts") });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("discovers a Docker checkout", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sway-docker-"));
    try {
      fs.writeFileSync(path.join(root, "docker-compose.yml"), "services: {}\n");
      expect(inspectDirectory(root)).toMatchObject({ mode: "docker", composeFile: path.join(root, "docker-compose.yml") });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("reads single-quoted dotenv values", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sway-dotenv-"));
    try {
      const envFile = path.join(root, ".env");
      fs.writeFileSync(envFile, "VALUE='hello world'\nIGNORED=value # comment\n");
      expect(readDotEnv(envFile)).toMatchObject({ VALUE: "hello world", IGNORED: "value" });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("uses a registered data directory for a source checkout", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sway-manifest-"));
    try {
      fs.mkdirSync(path.join(root, "src"));
      fs.writeFileSync(path.join(root, "src", "server.ts"), "export {};\n");
      const dataDir = path.join(root, "data");
      fs.writeFileSync(path.join(root, ".swayrouter-install.json"), JSON.stringify({ mode: "native", dataDir }));
      expect(inspectDirectory(root)).toMatchObject({ mode: "native", dataDir });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
