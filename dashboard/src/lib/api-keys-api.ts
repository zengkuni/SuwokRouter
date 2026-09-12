import { api } from "@/lib/api";

export type ApiKey = {
  id: string;
  name: string;

  machineId?: string;

  prefix?: string;
  keyPrefix?: string;

  key?: string;
  isActive?: boolean;
  isDefault?: boolean;
  createdAt?: string;
};

export type CreateApiKeyInput = {
  name?: string;
};

export type UpdateApiKeyInput = {
  isActive?: boolean;
};

export async function listApiKeys(opts?: {
  includeRevoked?: boolean;
}): Promise<ApiKey[]> {
  const { data } = await api.get<{ keys: ApiKey[] }>("/keys", {
    params: opts?.includeRevoked ? { includeRevoked: 1 } : undefined,
  });
  return (data.keys ?? []).map(normalizeKey);
}

export async function createApiKey(
  body: CreateApiKeyInput
): Promise<{ key: ApiKey; message?: string }> {

  const name = body.name?.trim() || "default";
  const { data } = await api.post<{
    key?: string;
    id?: string;
    name?: string;
    machineId?: string;
    isDefault?: boolean;
  }>("/keys", { name });
  const created: ApiKey = {
    id: data.id ?? `key_${Math.random().toString(36).slice(2, 10)}`,
    name: data.name ?? name,
    prefix: data.key ? data.key.slice(0, 10) : undefined,
    key: data.key,
    isActive: true,
    isDefault: data.isDefault === true,
    createdAt: new Date().toISOString(),
  };
  return {
    key: created,
    message: "Save this key now — it will not be shown again.",
  };
}

export async function updateApiKey(
  id: string,
  body: UpdateApiKeyInput
): Promise<ApiKey> {

  const { data } = await api.put<{ key: ApiKey }>(
    `/keys/${encodeURIComponent(id)}`,
    { isActive: body.isActive }
  );
  return normalizeKey(data.key);
}

export async function deleteApiKeyPermanent(id: string): Promise<void> {
  await api.delete(`/keys/${encodeURIComponent(id)}`);
}

export async function rotateApiKey(id: string): Promise<ApiKey> {
  const { data } = await api.put<{ key: ApiKey }>(
    `/keys/${encodeURIComponent(id)}`,
    { rotate: true },
  );
  return normalizeKey(data.key);
}

export async function getApiKeyRaw(id: string): Promise<string> {

  const { data } = await api.get<{ key: ApiKey }>(
    `/keys/${encodeURIComponent(id)}`
  );
  return data.key?.key || "";
}

export async function getActiveGatewayApiKey(): Promise<string> {
  const keys = await listApiKeys({ includeRevoked: false });
  const active = keys.find((key) => key.isActive !== false);
  if (!active) return "";
  if (active.key) return active.key;
  return active.id ? getApiKeyRaw(active.id) : "";
}

function normalizeKey(k: ApiKey): ApiKey {

  const derived = k.key ? maskPrefix(k.key) : undefined;
  return {
    ...k,
    prefix: k.prefix || k.keyPrefix || derived,
    keyPrefix: k.keyPrefix || k.prefix || derived,
  };
}

export function displayPrefix(k: ApiKey): string {
  if (k.prefix || k.keyPrefix) return k.prefix || k.keyPrefix || "";
  if (k.key) return maskPrefix(k.key);
  return "swy-••••";
}

function maskPrefix(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 11) return trimmed;
  const scheme = trimmed.startsWith("sk-") ? "sk-" : trimmed.slice(0, 3);
  return trimmed.length > 14 ? `${scheme}${trimmed.slice(3, 11)}…` : trimmed;
}
