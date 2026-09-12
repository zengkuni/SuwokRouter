export type ModelCapabilities = {
  vision?: boolean;
  pdf?: boolean;
  audioInput?: boolean;
  videoInput?: boolean;
  imageOutput?: boolean;
  audioOutput?: boolean;
  search?: boolean;
  tools?: boolean;
  reasoning?: boolean;
  thinkingFormat?: string | null;
  thinkingCanDisable?: boolean;
  thinkingRange?: { min?: number; max?: number } | null;
  contextWindow?: number;
  maxOutput?: number;
};

export type ModelRow = {
  id: string;
  name: string;
  provider_alias?: string;
  provider_id?: string;
  owned_by?: string;
  caps?: ModelCapabilities;
  thinkingLevels?: string[];
};

export function normalizeProviderModelId(value: string, providerAlias?: string): string {
  const id = String(value || "").trim();
  if (!id) return id;

  const provider = String(providerAlias || "").trim().toLowerCase();
  const isClinePass = provider === "clinepass" || provider === "cline-pass"
    || /^(?:clinepass|cline-pass)\//i.test(id);
  if (!isClinePass) return id;

  let modelId = id.replace(/^clinepass\//i, "").replace(/^cline-pass\//i, "");
  modelId = modelId.replace(/^clinepass\//i, "").replace(/^cline-pass\//i, "");
  return `clinepass/${modelId}`;
}

const BOOLEAN_CAPABILITIES = [
  "vision", "pdf", "audioInput", "videoInput", "imageOutput",
  "audioOutput", "search", "tools", "reasoning",
] as const;

export function normalizeModelCapabilities(value: unknown): ModelCapabilities | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const caps: ModelCapabilities = {};
  for (const key of BOOLEAN_CAPABILITIES) {
    if (typeof raw[key] === "boolean") caps[key] = raw[key];
  }
  if (typeof raw.thinkingFormat === "string" || raw.thinkingFormat === null) caps.thinkingFormat = raw.thinkingFormat;
  if (typeof raw.thinkingCanDisable === "boolean") caps.thinkingCanDisable = raw.thinkingCanDisable;
  if (raw.thinkingRange && typeof raw.thinkingRange === "object" && !Array.isArray(raw.thinkingRange)) {
    const range = raw.thinkingRange as Record<string, unknown>;
    const normalized: { min?: number; max?: number } = {};
    if (Number.isFinite(Number(range.min))) normalized.min = Number(range.min);
    if (Number.isFinite(Number(range.max))) normalized.max = Number(range.max);
    caps.thinkingRange = normalized;
  } else if (raw.thinkingRange === null) caps.thinkingRange = null;
  for (const key of ["contextWindow", "maxOutput"] as const) {
    if (Number.isFinite(Number(raw[key]))) caps[key] = Number(raw[key]);
  }
  return Object.keys(caps).length ? caps : undefined;
}

export const MODEL_CAPABILITY_LABELS = [
  ["vision", "Vision"],
  ["pdf", "PDF"],
  ["audioInput", "Audio"],
  ["videoInput", "Video"],
  ["imageOutput", "Image out"],
  ["audioOutput", "Audio out"],
  ["search", "Search"],
  ["tools", "Tools"],
  ["reasoning", "Reasoning"],
] as const satisfies ReadonlyArray<readonly [keyof ModelCapabilities, string]>;

export function trueModelCapabilities(caps?: ModelCapabilities): Array<{ key: string; label: string }> {
  if (!caps) return [];
  return MODEL_CAPABILITY_LABELS.filter(([key]) => caps[key] === true).map(([key, label]) => ({ key, label }));
}

export function normalizeProviderModelRows(value: unknown, providerAlias?: string): ModelRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const item = raw as Record<string, unknown>;
    const rawId = typeof item.id === "string" ? item.id.trim() : typeof item.model === "string" ? item.model.trim() : "";
    const id = normalizeProviderModelId(rawId, providerAlias);
    if (!id) return [];
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : id;
    const thinkingLevels = Array.isArray(item.thinkingLevels)
      ? item.thinkingLevels.filter((level): level is string => typeof level === "string")
      : undefined;
    return [{
      id,
      name,
      caps: normalizeModelCapabilities(item.capabilities ?? item.caps),
      ...(thinkingLevels ? { thinkingLevels } : {}),
    }];
  });
}
function isFallbackModelName(name: string | undefined, id: string): boolean {
  if (!name) return true;
  const value = name.trim().toLowerCase();
  const modelId = id.trim().toLowerCase();
  return value === modelId
    || value === modelId.replace(/^clinepass\//, "")
    || /^cline-pass\//.test(value)
    || /^clinepass\/cline-pass\//.test(value);
}

export function mergeModelRows(rows: ModelRow[], providerAlias?: string): ModelRow[] {
  const merged = new Map<string, ModelRow>();
  for (const row of rows) {
    const id = normalizeProviderModelId(
      row.id,
      row.provider_alias || row.provider_id || row.owned_by || providerAlias,
    );
    if (!id) continue;
    const normalizedRow = id === row.id ? row : { ...row, id };
    const existing = merged.get(id);
    if (!existing) {
      merged.set(id, normalizedRow);
      continue;
    }
    const name = isFallbackModelName(existing.name, id) && !isFallbackModelName(normalizedRow.name, id)
      ? normalizedRow.name
      : existing.name || normalizedRow.name;
    merged.set(id, {
      ...existing,
      name,
      provider_alias: existing.provider_alias || normalizedRow.provider_alias,
      provider_id: existing.provider_id || normalizedRow.provider_id,
      owned_by: existing.owned_by || normalizedRow.owned_by,
      caps: { ...normalizedRow.caps, ...existing.caps },
      thinkingLevels: existing.thinkingLevels?.length
        ? existing.thinkingLevels
        : normalizedRow.thinkingLevels,
    });
  }
  return [...merged.values()];
}
