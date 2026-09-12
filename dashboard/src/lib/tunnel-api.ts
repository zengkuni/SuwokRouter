import { api, getErrorMessage } from "@/lib/api";

export type CloudflareTunnelStatus = {
  enabled: boolean;
  settingsEnabled: boolean;
  tunnelUrl: string;
  shortId: string;
  publicUrl: string;
  running: boolean;
};

export type DownloadStatus = {
  downloading: boolean;
  progress: number;
};

export type TunnelStatusResponse = {
  tunnel: CloudflareTunnelStatus;
  download: DownloadStatus;
};

export async function fetchTunnelStatus(): Promise<TunnelStatusResponse> {
  const { data } = await api.get<TunnelStatusResponse>("/tunnel/status");
  return data;
}

export async function enableTunnel(): Promise<{
  success: boolean;
  tunnelUrl?: string;
  shortId?: string;
  publicUrl?: string;
  error?: string;
}> {
  try {
    const { data } = await api.post("/tunnel/enable");
    return data;
  } catch (err) {
    return { success: false, error: getErrorMessage(err, "Failed to enable tunnel") };
  }
}

export async function disableTunnel(): Promise<{ success: boolean; error?: string }> {
  try {
    const { data } = await api.post("/tunnel/disable");
    return data;
  } catch (err) {
    return { success: false, error: getErrorMessage(err, "Failed to disable tunnel") };
  }
}

const CLIENT_PING_TIMEOUT_MS = 5000;

export async function clientPingUrl(url: string): Promise<boolean> {
  if (!url) return false;
  try {
    const res = await fetch(`${url}/api/health`, {
      mode: "cors",
      cache: "no-store",
      signal: AbortSignal.timeout(CLIENT_PING_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function clientPingAny(...urls: Array<string | undefined>): Promise<boolean> {
  const checks = urls.filter(Boolean).map((u) => clientPingUrl(u!));
  if (!checks.length) return false;
  return new Promise((resolve) => {
    let pending = checks.length;
    checks.forEach((p) =>
      p.then((ok) => {
        if (ok) resolve(true);
        else if (--pending === 0) resolve(false);
      })
    );
  });
}

export function maskKey(fullKey: string): string {
  if (!fullKey || fullKey.length <= 10) return fullKey || "";
  return fullKey.slice(0, 6) + "•".repeat(fullKey.length - 10) + fullKey.slice(-4);
}
