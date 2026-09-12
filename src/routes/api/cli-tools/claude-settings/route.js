"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { DEFAULT_PLUGINS } from "@/shared/constants/coworkPlugins";

const execAsync = promisify(exec);

const EXA_PLUGIN = DEFAULT_PLUGINS.find((p) => p.name === "exa");
const buildExaMcpEntry = () => ({
  type: EXA_PLUGIN.transport,
  url: EXA_PLUGIN.url,
});

const getClaudeSettingsPath = () => {
  const homeDir = os.homedir();
  return path.join(homeDir, ".claude", "settings.json");
};

const getClaudeJsonPath = () => path.join(os.homedir(), ".claude.json");

const readClaudeJson = async () => {
  try {
    const content = await fs.readFile(getClaudeJsonPath(), "utf-8");
    return JSON.parse(content.replace(/,(\s*[}\]])/g, "$1"));
  } catch {
    return null;
  }
};

const writeClaudeJsonMcp = async (mcpServers) => {
  const filePath = getClaudeJsonPath();
  let data = {};
  try {
    data = JSON.parse(await fs.readFile(filePath, "utf-8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (mcpServers && Object.keys(mcpServers).length > 0) {
    data.mcpServers = { ...(data.mcpServers || {}), ...mcpServers };
  } else if (data.mcpServers) {
    delete data.mcpServers.exa;
    if (Object.keys(data.mcpServers).length === 0) delete data.mcpServers;
  }
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
};

const checkClaudeInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where claude" : "which claude";
    const env = isWindows
      ? { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` }
      : process.env;
    await execAsync(command, { windowsHide: true, env });
    return true;
  } catch {
    try {
      await fs.access(getClaudeSettingsPath());
      return true;
    } catch {
      return false;
    }
  }
};

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

function hasSwayRouterFromSettings(settings) {
  return isSwayRouterBaseUrl(settings?.env?.ANTHROPIC_BASE_URL);
}

const readSettings = async () => {
  try {
    const settingsPath = getClaudeSettingsPath();
    const content = await fs.readFile(settingsPath, "utf-8");

    const stripped = content.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(stripped);
  } catch (error) {
    return null;
  }
};

export async function GET() {
  try {
    const isInstalled = await checkClaudeInstalled();

    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        settings: null,
        message: "Claude CLI is not installed",
      });
    }

    const settings = await readSettings();
    const hasSwayRouter = hasSwayRouterFromSettings(settings);
    const claudeJson = await readClaudeJson();

    return NextResponse.json({
      installed: true,
      settings: settings,
      hasSwayRouter,
      exaMcpEnabled: !!claudeJson?.mcpServers?.exa,
      settingsPath: getClaudeSettingsPath(),
    });
  } catch (error) {
    console.log("Error checking claude settings:", error);
    return NextResponse.json(
      { error: "Failed to check claude settings" },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const { env, exaMcpEnabled, maxContextTokens } = await request.json();

    if (!env || typeof env !== "object") {
      return NextResponse.json(
        { error: "Invalid env object" },
        { status: 400 }
      );
    }

    const settingsPath = getClaudeSettingsPath();
    const claudeDir = path.dirname(settingsPath);

    await fs.mkdir(claudeDir, { recursive: true });

    let currentSettings = {};
    try {
      const content = await fs.readFile(settingsPath, "utf-8");
      currentSettings = JSON.parse(content);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    if (env.ANTHROPIC_BASE_URL) {
      env.ANTHROPIC_BASE_URL = env.ANTHROPIC_BASE_URL.endsWith("/v1")
        ? env.ANTHROPIC_BASE_URL
        : `${env.ANTHROPIC_BASE_URL}/v1`;
    }

    const newSettings = {
      ...currentSettings,
      hasCompletedOnboarding: true,
      env: {
        ...(currentSettings.env || {}),
        ...env,
      },
    };

    if (maxContextTokens) {
      newSettings.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(maxContextTokens);
    } else {
      delete newSettings.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS;
    }

    await fs.writeFile(settingsPath, JSON.stringify(newSettings, null, 2));

    if (EXA_PLUGIN) {
      const shouldEnableExa = exaMcpEnabled !== false;
      await writeClaudeJsonMcp(shouldEnableExa ? { exa: buildExaMcpEntry() } : null);
    }

    return NextResponse.json({
      success: true,
      message: "Settings updated successfully",
    });
  } catch (error) {
    console.log("Error updating claude settings:", error);
    return NextResponse.json(
      { error: "Failed to update claude settings" },
      { status: 500 }
    );
  }
}

const RESET_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_DEFAULT_FABLE_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "API_TIMEOUT_MS",
  "CLAUDE_CODE_MAX_CONTEXT_TOKENS",
];

export async function DELETE() {
  try {
    const settingsPath = getClaudeSettingsPath();

    let currentSettings = {};
    try {
      const content = await fs.readFile(settingsPath, "utf-8");
      currentSettings = JSON.parse(content);
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({
          success: true,
          message: "No settings file to reset",
        });
      }
      throw error;
    }

    if (currentSettings.env) {
      RESET_ENV_KEYS.forEach((key) => {
        delete currentSettings.env[key];
      });

      if (Object.keys(currentSettings.env).length === 0) {
        delete currentSettings.env;
      }
    }

    await writeClaudeJsonMcp(null);

    await fs.writeFile(settingsPath, JSON.stringify(currentSettings, null, 2));

    return NextResponse.json({
      success: true,
      message: "Settings reset successfully",
    });
  } catch (error) {
    console.log("Error resetting claude settings:", error);
    return NextResponse.json(
      { error: "Failed to reset claude settings" },
      { status: 500 }
    );
  }
}
