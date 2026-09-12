import { api } from "@/lib/api";

export type NineRouterMigrationSource = "local" | "json";

export type NineRouterMigrationOptions = {
  providerAccounts: boolean;
  customProviders: boolean;
  customModels: boolean;
  combos: boolean;
  routingSettings: boolean;
  activateAccounts: boolean;
};

export const DEFAULT_NINE_ROUTER_MIGRATION_OPTIONS: NineRouterMigrationOptions = {
  providerAccounts: true,
  customProviders: true,
  customModels: true,
  combos: true,
  routingSettings: false,
  activateAccounts: false,
};

export type NineRouterDetection = {
  available: boolean;
  localOnly?: boolean;
  location?: string;
  counts?: {
    providerAccounts?: number;
    customProviders?: number;
    customModels?: number;
    combos?: number;
  };
};

export type NineRouterMigrationSection = {
  found: number;
  ready: number;
  resolved: number;
  duplicates: number;
  skipped: number;
};

export type NineRouterMigrationPreview = {
  options: NineRouterMigrationOptions;
  sections: Record<
    "providerAccounts" | "customProviders" | "customModels" | "combos" | "routingSettings",
    NineRouterMigrationSection
  >;
  warnings: Array<{ code: string; message: string; count: number }>;
  totalReady: number;
};

export type NineRouterMigrationResult = {
  success: boolean;
  message?: string;
  backupCreated?: boolean;
  result?: Omit<NineRouterMigrationPreview, "options">;
};

type NineRouterPayload = Record<string, unknown>;

function isObject(value: unknown): value is NineRouterPayload {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireNineRouterPayload(value: unknown): NineRouterPayload {
  if (!isObject(value)) throw new Error("The selected file is not valid JSON data");
  if (value.product === "swayrouter") {
    throw new Error("This is an Sway Router backup. Use Import JSON instead.");
  }
  const looksLikeNineRouter = "modelAliases" in value
    || "mitmAlias" in value
    || (
      Array.isArray(value.providerConnections)
      && Array.isArray(value.providerNodes)
      && Array.isArray(value.combos)
      && Array.isArray(value.customModels)
      && value.formatVersion === undefined
      && value.backupScope === undefined
    );
  if (!looksLikeNineRouter) throw new Error("This file is not a supported 9Router backup");
  return value;
}

async function readNineRouterFile(file: File): Promise<NineRouterPayload> {
  try {
    return requireNineRouterPayload(JSON.parse(await file.text()));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("The selected file is not valid JSON");
    throw error;
  }
}

async function sourcePayload(source: NineRouterMigrationSource, file?: File | null) {
  if (source === "local") return undefined;
  if (!file) throw new Error("Choose a 9Router JSON backup first");
  return await readNineRouterFile(file);
}

export async function fetchNineRouterDetection(): Promise<NineRouterDetection> {
  const { data } = await api.get<NineRouterDetection>("/settings/migrate-9router");
  return data;
}

export async function previewNineRouterMigration(input: {
  source: NineRouterMigrationSource;
  file?: File | null;
  options: NineRouterMigrationOptions;
}): Promise<NineRouterMigrationPreview> {
  const payload = await sourcePayload(input.source, input.file);
  const { data } = await api.post<{ success: boolean; preview: NineRouterMigrationPreview }>(
    "/settings/migrate-9router",
    { action: "preview", source: input.source, payload, options: input.options },
  );
  return data.preview;
}

export async function migrateFromNineRouter(input: {
  source: NineRouterMigrationSource;
  file?: File | null;
  options: NineRouterMigrationOptions;
  password: string;
}): Promise<NineRouterMigrationResult> {
  const payload = await sourcePayload(input.source, input.file);
  const { data } = await api.post<NineRouterMigrationResult>(
    "/settings/migrate-9router",
    {
      action: "migrate",
      source: input.source,
      payload,
      options: input.options,
      password: input.password,
    },
  );
  return data;
}
