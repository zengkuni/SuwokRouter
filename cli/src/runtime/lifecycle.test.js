const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const lifecycle = require("./lifecycle");

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

describe("runtime lifecycle helpers", () => {
  test("waitForReady requires a successful HTTP readiness response", async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(503);
      response.end("not ready");
    });
    const port = await listen(server);
    try {
      expect(await lifecycle.waitForReady(port, { timeoutMs: 100, intervalMs: 10 })).toBe(false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("parses Docker running and stopped status", () => {
    expect(lifecycle.parseDockerStatus("").running).toBe(false);
    expect(lifecycle.parseDockerStatus("[]").running).toBe(false);
    expect(lifecycle.parseDockerStatus(JSON.stringify([{ State: "running" }])).running).toBe(true);
    expect(lifecycle.parseDockerStatus(JSON.stringify([{ Status: "Up 2 minutes" }])).running).toBe(true);
    expect(lifecycle.parseDockerStatus(JSON.stringify([{ State: "exited" }])).running).toBe(false);
    expect(lifecycle.parseDockerStatus("swayrouter   Up 2 minutes").running).toBe(true);
  });

  test("waits for readiness on the configured host", async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200);
      response.end("ready");
    });
    const port = await listen(server);
    try {
      expect(await lifecycle.waitForReady(port, { host: "0.0.0.0", timeoutMs: 100 })).toBe(true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("rejects legacy PID records as unmanaged", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sway-lifecycle-"));
    const installation = { installDir: process.cwd(), dataDir };
    const file = lifecycle.pidFile(installation);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${process.pid}\n`);
    try {
      expect(lifecycle.status(installation).running).toBe(false);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("status and stop are idempotent without a managed PID", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sway-lifecycle-"));
    const installation = { installDir: process.cwd(), dataDir, mode: "native", sourceFile: path.join(process.cwd(), "src", "server.ts") };
    const marker = path.join(dataDir, "keep.txt");
    fs.writeFileSync(marker, "keep");
    try {
      expect(lifecycle.status(installation)).toMatchObject({ running: false, pid: null });
      expect(lifecycle.stop(installation)).toMatchObject({ stopped: false });
      expect(fs.readFileSync(marker, "utf8")).toBe("keep");
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("records a compiled binary in managed PID metadata", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sway-lifecycle-"));
    const installation = { installDir: process.cwd(), dataDir, mode: "binary", binaryFile: path.join(process.cwd(), "swayrouter") };
    const file = lifecycle.pidFile(installation);
    try {
      lifecycle.writePid?.(installation, process.pid);
      if (fs.existsSync(file)) expect(JSON.parse(fs.readFileSync(file, "utf8")).executable).toContain("swayrouter");
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("defaults native CLI launches to production without requiring an env file", () => {
    const installation = {
      mode: "native",
      installDir: process.cwd(),
      sourceFile: path.join(process.cwd(), "src", "server.ts"),
      dataDir: path.join(os.tmpdir(), "sway-cli-production-env"),
      env: {},
    };

    expect(lifecycle.buildNativeEnv(installation, {}, {})).toMatchObject({
      NODE_ENV: "production",
      PORT: "14045",
      HOSTNAME: "127.0.0.1",
      DATA_DIR: installation.dataDir,
    });
    expect(lifecycle.buildNativeEnv({ ...installation, env: { NODE_ENV: "development" } }, {}, {}).NODE_ENV)
      .toBe("development");
  });
});
