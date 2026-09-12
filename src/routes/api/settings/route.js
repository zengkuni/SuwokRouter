import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { resetComboRotation } from "open-sse/services/combo.js";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { getDashboardAuthSession, setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { env } from "@/lib/env.ts";
import { logRouteError } from "@/lib/errors/publicError";

const SETTINGS_ERROR = "Unable to process settings request";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SETTINGS_RESPONSE_HEADERS = {
  "Cache-Control": "no-store"
};

const PROTECTED_SETTING_KEYS = ["password", "dbPath", "tunnelEnabled", "tunnelUrl"];

const CLI_MODEL_MAPPING_KEYS = new Set(["enabled", "entries"]);

function sanitizeSettingsForResponse(settings) {
  const {
    password: _password,
    oidcClientSecret: _oidcClientSecret,
    dbPath: _dbPath,
    ...safeSettings
  } = settings;
  safeSettings.oidcConfigured = !!(
    safeSettings.oidcIssuerUrl &&
    safeSettings.oidcClientId &&
    _oidcClientSecret
  );
  return safeSettings;
}

export const __test__ = { sanitizeSettingsForResponse };

function sanitizeCliModelMappings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [toolId, snapshot] of Object.entries(value)) {
    if (!/^[a-z0-9_-]{1,64}$/i.test(toolId) || !snapshot || typeof snapshot !== "object") continue;
    const entries = Array.isArray(snapshot.entries)
      ? snapshot.entries.map((entry) => ({
          sourceModel: typeof entry?.sourceModel === "string" ? entry.sourceModel.trim().slice(0, 512) : "",
          targetModel: typeof entry?.targetModel === "string" ? entry.targetModel.trim().slice(0, 512) : "",
          enabled: entry?.enabled !== false,
        })).filter((entry) => entry.sourceModel && entry.targetModel).slice(0, 256)
      : [];
    result[toolId] = { enabled: snapshot.enabled !== false, entries };
  }
  return result;
}

export async function GET() {
  try {
    const settings = await getSettings();
    const safeSettings = sanitizeSettingsForResponse(settings);

    const enableRequestLogs = env.requestLogsEnabled;
    const enableTranslator = env.translatorEnabled;

    return NextResponse.json({
      ...safeSettings,
      enableRequestLogs,
      enableTranslator,
      hasPassword: !!settings.password,
    }, { headers: SETTINGS_RESPONSE_HEADERS });

  } catch (error) {
    logRouteError("Settings][Get", error);
    return NextResponse.json({ error: SETTINGS_ERROR }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    const cookieStore = await cookies();
    const session = await getDashboardAuthSession(cookieStore.get("auth_token")?.value);
    const forcedPasswordChange = session?.mustChangePassword === true;

    if (forcedPasswordChange) {
      const keys = Object.keys(body || {});
      if (!body || typeof body !== "object" || !body.newPassword || keys.some((key) => key !== "newPassword")) {
        return NextResponse.json({ error: "Set a new dashboard password before continuing" }, { status: 403 });
      }
    }

    for (const key of PROTECTED_SETTING_KEYS) delete body[key];

    const currentSettings = await getSettings();
    if (
      currentSettings.tunnelEnabled === true &&
      (body.requireApiKey === false || body.requireLogin === false)
    ) {
      return NextResponse.json(
        { error: "Disable the Cloudflare Tunnel before turning off API key or login protection" },
        { status: 409 },
      );
    }

    if (body.newPassword) {
      const settings = await getSettings();
      const currentHash = settings.password;

      if (currentHash) {
        if (!body.currentPassword) {
          return NextResponse.json({ error: "Current password required" }, { status: 400 });
        }
        const isValid = await bcrypt.compare(body.currentPassword, currentHash);
        if (!isValid) {
          return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
        }
      } else {

        if (body.currentPassword) {
          return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
        }
      }

      const salt = await bcrypt.genSalt(10);
      body.password = await bcrypt.hash(body.newPassword, salt);
      delete body.newPassword;
      delete body.currentPassword;
    }

    if (Object.prototype.hasOwnProperty.call(body, "cliModelMappings")) {
      body.cliModelMappings = sanitizeCliModelMappings(body.cliModelMappings);
    }

    if (Object.prototype.hasOwnProperty.call(body, "profileName")) {
      body.profileName = typeof body.profileName === "string"
        ? body.profileName.trim().replace(/\s+/g, " ").slice(0, 40)
        : "";
    }

    if (Object.prototype.hasOwnProperty.call(body, "currency")) {
      body.currency = body.currency === "IDR" ? "IDR" : "USD";
    }

    if (Object.prototype.hasOwnProperty.call(body, "profileAvatar")) {
      const avatar = typeof body.profileAvatar === "string" ? body.profileAvatar.trim() : "";
      const isValidAvatar = avatar === ""
        || (avatar.length <= 700_000
          && /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/.test(avatar));
      if (!isValidAvatar) {
        return NextResponse.json(
          { error: "Profile photo must be a PNG, JPG, WEBP, or GIF up to 512 KB" },
          { status: 400 },
        );
      }
      body.profileAvatar = avatar;
    }

    if (Object.prototype.hasOwnProperty.call(body, "oidcClientSecret")) {
      if (!body.oidcClientSecret || !String(body.oidcClientSecret).trim()) {
        delete body.oidcClientSecret;
      }
    }

    const settings = await updateSettings(body);

    if (forcedPasswordChange) {

      await setDashboardAuthCookie(cookieStore, request);
    }

    if (
      Object.prototype.hasOwnProperty.call(body, "comboStrategy") ||
      Object.prototype.hasOwnProperty.call(body, "comboStickyRoundRobinLimit") ||
      Object.prototype.hasOwnProperty.call(body, "comboStrategies")
    ) {
      resetComboRotation();
    }

    if (
      Object.prototype.hasOwnProperty.call(body, "claudeAutoPing") ||
      Object.prototype.hasOwnProperty.call(body, "codexAutoPing")
    ) {

      import("@/shared/services/quotaAutoPing")
        .then(({ configureQuotaAutoPing }) => {
          configureQuotaAutoPing(settings);
        })
        .catch((error) => console.warn("[AutoPing] settings update failed:", error.message));
    }

    const safeSettings = sanitizeSettingsForResponse(settings);
    return NextResponse.json(safeSettings, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    logRouteError("Settings][Patch", error);
    return NextResponse.json({ error: SETTINGS_ERROR }, { status: 500 });
  }
}
