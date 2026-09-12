"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { parseYAML, stringifyYAML } from "confbox";

const execAsync = promisify(exec);

const getOmpDir = () => path.join(os.homedir(), ".omp", "agent");
const getModelsPath = () => path.join(getOmpDir(), "models.yml");
const getOmpBinPath = () => path.join(os.homedir(), ".bun", "bin", "omp.exe");

const SWAY_ROUTER_MATCH_HOSTS = [
  "127.0.0.1:14045",
  "localhost:14045",
  "localhost",
  "127.0.0.1",
];
const SWAY_ROUTER_URL_HOST_RE = /^(?:127\.0\.0\.1|localhost)(?::14045)?$/;

function isSwayRouterBaseUrl(baseUrl) {
  if (typeof baseUrl !== "string" || !baseUrl) return false;
  try {
    const u = new URL(baseUrl);
    return (
      u.pathname.endsWith("/v1") &&
      (SWAY_ROUTER_URL_HOST_RE.test(u.host) || SWAY_ROUTER_MATCH_HOSTS.includes(u.host))
    );
  } catch {
    return false;
  }
}

const setNestedSection = (obj, dottedKey, value) => {
  const keys = dottedKey.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== "object") {
      cur[keys[i]] = {};
    }
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
};

const deleteNestedSection = (obj, dottedKey) => {
  const keys = dottedKey.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    cur = cur?.[keys[i]];
    if (cur == null) return;
  }
  delete cur[keys[keys.length - 1]];
};

const checkOmpInstalled = async () => {
  try {
    await fs.access(getOmpBinPath());
    return true;
  } catch {
    try {
      const isWindows = os.platform() === "win32";
      const command = isWindows ? "where omp" : "which omp";
      await execAsync(command, { windowsHide: true });
      return true;
    } catch {
      try {
        await fs.access(getModelsPath());
        return true;
      } catch {
        return false;
      }
    }
  }
};

const readModels = async () => {
  try {
    const content = await fs.readFile(getModelsPath(), "utf-8");
    const parsed = parseYAML(content);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

let cachedVersion;

const getOmpVersion = async () => {
  if (cachedVersion !== undefined) return cachedVersion;
  cachedVersion = null;
  try {
    const { stdout } = await execAsync("omp --version", { windowsHide: true });
    cachedVersion = String(stdout).trim().split("\n")[0] || null;
  } catch {
    cachedVersion = null;
  }
  return cachedVersion;
};

const providerPointsAtRouter = (provider) => {
  if (!provider || typeof provider !== "object") return false;
  return isSwayRouterBaseUrl(provider.baseUrl);
};

const isFromCloudflare = (req) =>
  req.headers.get("cf-connecting-ip") !== null ||
  (req.headers.get("cf-ray") ?? "").length > 0;

const hasFamilyIpHeader = (req) => {
  try {
    const fwd = req.headers.get("x-forwarded-for") || "";
    const rightmost = fwd.split(",").pop().trim();
    if (ipHeaderIsIp(rightmost)) return true;
    const realIp = req.headers.get("x-real-ip") || "";
    return ipHeaderIsIp(realIp);
  } catch {
    return false;
  }
};

const ipHeaderIsIp = (value) =>
  /^\d+\.\d+\.\d+\.\d+$/.test(value) || /^[0-9a-f:]+$/i.test(value);

const isLocalRequest = (request) => {
  if (isFromCloudflare(request) || hasFamilyIpHeader(request)) return false;
  const url = request.headers.get("host") || "";
  const host = url.split(":").shift().toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "";
};

export async function GET(request) {
  try {
    const installed = await checkOmpInstalled();
    const config = await readModels();
    const version = await getOmpVersion();

    if (!installed) {
      return NextResponse.json({
        installed: false,
        config: null,
        models: null,
        version,
        message: "OMP (oh-my-pi) is not installed",
      });
    }

    const provider = config?.providers?.swayrouter ?? null;
    const hasSwayRouter = providerPointsAtRouter(provider);

    return NextResponse.json({
      installed: true,
      config: config ? stringifyYAML(config) : null,
      hasSwayRouter,
      connected: hasSwayRouter,
      configPath: getModelsPath(),
      version,
    });
  } catch (error) {
    console.log("Error checking omp settings:", error);
    return NextResponse.json({ error: "Failed to check omp settings" }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const collection = await request.json();
    const { baseUrl, apiKey, models } = collection || {};
    const selectedModels = Array.isArray(models)
      ? [...new Set(models.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))]
      : [];
    const configuredApiKey = typeof apiKey === "string" ? apiKey.trim() : "";

    if (!isLocalRequest(request)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!baseUrl) {
      return NextResponse.json({ error: "baseUrl is required" }, { status: 400 });
    }

    const ompDir = getOmpDir();
    const modelsPath = getModelsPath();
    await fs.mkdir(ompDir, { recursive: true });

    let parsed = {};
    try {
      const existing = await readModels();
      parsed = existing ?? {};
    } catch {              }

    const normalizedBaseUrl = baseUrl.includes("/v1")
      ? baseUrl
      : `${baseUrl.replace(/\/$/, "")}/v1`;

    const provider = {
      baseUrl: normalizedBaseUrl,
      api: "openai-completions",
      ...(configuredApiKey ? { apiKey: configuredApiKey } : { auth: "none" }),
      discovery: { type: "openai-models-list" },
      ...(selectedModels.length
        ? {
            models: selectedModels.map((id) => ({
              id,
              name: id,
            })),
          }
        : {}),
    };
    setNestedSection(parsed, "providers.swayrouter", provider);

    const content = stringifyYAML(parsed);
    await fs.writeFile(modelsPath, content);

    return NextResponse.json({
      success: true,
      message: "OMP settings applied successfully!",
      configPath: modelsPath,
    });
  } catch (error) {
    console.log("Error updating omp settings:", error);
    return NextResponse.json({ error: "Failed to update omp settings" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const modelsPath = getModelsPath();

    let parsed;
    try {
      parsed = await readModels();
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({ success: true, message: "No config file to reset" });
      }
      throw error;
    }

    if (!parsed || typeof parsed !== "object") {
      return NextResponse.json({ success: true, message: "No config file to reset" });
    }

    deleteNestedSection(parsed, "providers.swayrouter");

    if (parsed.providers && Object.keys(parsed.providers).length === 0) {
      delete parsed.providers;
    }

    const content = stringifyYAML(parsed);
    await fs.writeFile(modelsPath, content);

    return NextResponse.json({
      success: true,
      message: "Sway Router settings removed successfully",
    });
  } catch (error) {
    console.log("Error resetting omp settings:", error);
    return NextResponse.json({ error: "Failed to reset omp settings" }, { status: 500 });
  }
}
