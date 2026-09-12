import { getActiveGatewayApiKey } from "@/lib/api-keys-api";
import type { ModelInfo } from "@/lib/cli-tools-api";

type ModelsPayload = {
  data?: Array<{
    id?: string;
    name?: string;
    owned_by?: string;
  }>;
};

export async function listGatewayModels(): Promise<ModelInfo[]> {
  const apiKey = await getActiveGatewayApiKey().catch(() => "");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch("/v1/models", {
    credentials: "include",
    headers,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string } | string; message?: string }
      | null;
    const error = payload?.error;
    const message =
      typeof error === "string"
        ? error
        : error?.message || payload?.message || `Models request failed (${response.status})`;
    throw new Error(message);
  }

  const payload = (await response.json()) as ModelsPayload;
  return (payload.data ?? []).flatMap((model) => {
    const id = typeof model.id === "string" ? model.id.trim() : "";
    if (!id) return [];
    const provider =
      typeof model.owned_by === "string" && model.owned_by
        ? model.owned_by
        : id.includes("/")
          ? id.split("/", 1)[0]
          : "other";
    return [{ id, name: model.name?.trim() || id, provider }];
  });
}
