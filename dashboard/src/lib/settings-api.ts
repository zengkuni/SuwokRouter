import { api } from "@/lib/api";

export type RotationStrategy = "least-inflight" | "fill-first" | "round-robin";

export type AppSettings = {

  profileName?: string;
  profileAvatar?: string;
  currency?: "USD" | "IDR";
  requireApiKey?: boolean;

  requireLogin?: boolean;

  payloadCaptureEnabled?: boolean;
  hasPassword?: boolean;
  tunnelDashboardAccess?: boolean;
  stickyRoundRobinLimit?: number;
  fallbackStrategy?: RotationStrategy;
  providerStrategies?: Record<
    string,
    {
      fallbackStrategy?: RotationStrategy;
      stickyRoundRobinLimit?: number;
    }
  >;

  providerThinking?: Record<string, string>;
  comboStrategy?: string;
  comboStickyRoundRobinLimit?: number;
  rtkEnabled?: boolean;

  cavemanEnabled?: boolean;
  cavemanLevel?: string;
  ponytailEnabled?: boolean;
  ponytailLevel?: string;
  [key: string]: unknown;
};

export async function fetchSettings() {

  const { data } = await api.get<AppSettings>("/settings");
  return data;
}

export async function updateSettings(partial: Partial<AppSettings>) {

  const { data } = await api.patch<AppSettings>("/settings", partial);
  return data;
}

export async function fetchDatabasePath() {
  const { data } = await api.get<{ dbPath?: string }>("/settings/database/path");
  return data.dbPath;
}

export async function shutdownRouter() {
  const { data } = await api.post<{
    success?: boolean;
    code?: string;
    message?: string;
  }>("/shutdown");
  return data;
}

export function getProviderStrategy(
  settings: AppSettings | undefined,
  providerId: string
): RotationStrategy {
  const per = settings?.providerStrategies?.[providerId]?.fallbackStrategy;
  if (
    per === "least-inflight" ||
    per === "fill-first" ||
    per === "round-robin"
  ) return per;
  const global = settings?.fallbackStrategy;
  if (
    global === "least-inflight" ||
    global === "fill-first" ||
    global === "round-robin"
  ) {
    return global;
  }
  return "fill-first";
}

export function getProviderStickyRoundRobin(
  settings: AppSettings | undefined,
  providerId: string
): number {
  const per =
    settings?.providerStrategies?.[providerId]?.stickyRoundRobinLimit;
  if (typeof per === "number" && per >= 1) return per;
  if (
    typeof settings?.stickyRoundRobinLimit === "number" &&
    settings.stickyRoundRobinLimit >= 1
  ) {
    return settings.stickyRoundRobinLimit;
  }
  return 1;
}
