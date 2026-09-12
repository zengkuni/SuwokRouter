import { api } from "@/lib/api";

export type BackupScope = "configuration" | "full";

export type DatabaseBackup = {
  product?: "swayrouter";
  formatVersion?: number;
  backupScope?: BackupScope;
  providerCredentialsIncluded?: boolean;
  settings?: Record<string, unknown>;
  providerConnections?: unknown[];
  providerNodes?: unknown[];
  proxyPools?: unknown[];
  apiKeysRedacted?: boolean;
  apiKeys?: unknown[];
  combos?: unknown[];
  customModels?: unknown[];
  pricing?: Record<string, unknown>;
  usageHistory?: unknown[];
  usageDaily?: unknown[];
  requestDetails?: unknown[];
};

export type RestoreBackupResult = {
  success: boolean;
  message?: string;
  result?: {
    connectionsImported?: number;
    nodesImported?: number;
    poolsImported?: number;
    combosImported?: number;
    settingsImported?: boolean;
    apiKeysImported?: number;
    warnings?: string[];
  };
};

export type RestoreBackupStage = "validating" | "restoring";

function requireBackupPayload(value: unknown): DatabaseBackup {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid JSON backup file");
  }

  const payload = value as DatabaseBackup;
  if (
    payload.product !== "swayrouter" &&
    ("modelAliases" in payload || "mitmAlias" in payload || (
      payload.formatVersion === undefined &&
      payload.backupScope === undefined &&
      payload.apiKeysRedacted === undefined &&
      Array.isArray(payload.providerConnections) &&
      Array.isArray(payload.providerNodes)
    ))
  ) {
    throw new Error("This is a 9Router backup. Use Migrate from 9Router instead.");
  }
  if (
    payload.formatVersion !== undefined &&
    payload.formatVersion !== 1
  ) {
    throw new Error(`Unsupported backup format version: ${payload.formatVersion}`);
  }
  if (
    payload.backupScope !== undefined &&
    payload.backupScope !== "configuration" &&
    payload.backupScope !== "full"
  ) {
    throw new Error("Invalid backup scope");
  }
  if (
    payload.providerCredentialsIncluded !== undefined &&
    typeof payload.providerCredentialsIncluded !== "boolean"
  ) {
    throw new Error("Invalid provider credential metadata");
  }
  return payload;
}

export async function downloadBackup(password: string, scope: BackupScope = "configuration"): Promise<void> {
  const { data } = await api.get<DatabaseBackup>("/settings/database", {
    headers: { "x-swayrouter-password": password },
    params: { scope },
  });
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const date = new Date().toISOString().replace(/[:.]/g, "-");
  anchor.href = href;
  anchor.download = `sway-router-${scope === "full" ? "full-data" : "configuration"}-backup-${date}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

export async function restoreBackup(
  file: File,
  password: string,
  onStageChange?: (stage: RestoreBackupStage) => void,
): Promise<RestoreBackupResult> {
  onStageChange?.("validating");
  let payload: DatabaseBackup;
  try {
    payload = requireBackupPayload(JSON.parse(await file.text()));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Backup file is not valid JSON");
    }
    throw error;
  }

  onStageChange?.("restoring");
  const { data } = await api.post<RestoreBackupResult>(
    "/settings/database",
    { ...payload, password },
  );
  return data;
}
