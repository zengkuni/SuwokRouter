import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dataDir = mkdtempSync(path.join(tmpdir(), "swayrouter-e2e-"));

process.env.NODE_ENV = "production";
process.env.HOSTNAME = process.env.HOSTNAME || "127.0.0.1";
process.env.PORT = process.env.PORT || "14145";
process.env.DATA_DIR = dataDir;

delete process.env.JWT_SECRET;
delete process.env.API_KEY_SECRET;
delete process.env.MACHINE_ID_SALT;

process.once("exit", () => {
  try {
    rmSync(dataDir, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  } catch {
    // The OS will eventually clear its temporary directory if a native handle
    // is still closing during process teardown.
  }
});

await import("../src/server.ts");
