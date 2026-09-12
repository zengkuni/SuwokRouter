const CLIENT_TOOL_IDS = Object.freeze({
  claude: "claude",
  "claude-code": "claude",
  claude_code: "claude",
  codex: "codex",
  opencode: "opencode",
  cline: "cline",
  cursor: "cursor",
  "github-copilot": "copilot",
  copilot: "copilot",
  hermes: "hermes",
  aider: "aider",
});

const CLAUDE_FAMILIES = new Set(["opus", "sonnet", "haiku", "fable", "mythos"]);

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const sourceModel = clean(entry.sourceModel ?? entry.source_model);
  const targetModel = clean(entry.targetModel ?? entry.target_model);
  if (!sourceModel || !targetModel) return null;
  return { sourceModel, targetModel, enabled: entry.enabled !== false };
}

export function normalizeCliModelMappings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [toolId, snapshot] of Object.entries(value)) {
    if (!snapshot || typeof snapshot !== "object") continue;
    const entries = Array.isArray(snapshot.entries)
      ? snapshot.entries.map(normalizeEntry).filter(Boolean)
      : [];
    result[toolId] = { enabled: snapshot.enabled !== false, entries };
  }
  return result;
}

export function clientToolId(clientId) {
  return CLIENT_TOOL_IDS[clean(clientId).toLowerCase()] || clean(clientId).toLowerCase();
}

function familyFor(model) {
  const lower = clean(model).toLowerCase();
  for (const family of CLAUDE_FAMILIES) {
    if (lower.includes(family)) return family;
  }
  return null;
}

function matchesClaudeFamily(sourceModel, requestedModel) {
  const source = clean(sourceModel).toLowerCase();
  const requested = clean(requestedModel).toLowerCase();
  if (!source || !requested) return false;
  if (source === requested) return true;
  const sourceFamily = familyFor(source);
  const requestedFamily = familyFor(requested);
  return Boolean(sourceFamily && sourceFamily === requestedFamily);
}

export function resolveCliModelMapping(clientId, sourceModel, mappings) {
  const source = clean(sourceModel);
  if (!source) return sourceModel;
  const toolId = clientToolId(clientId);
  const all = normalizeCliModelMappings(mappings);
  const snapshot = all[toolId];
  if (!snapshot?.enabled) return sourceModel;

  const exact = snapshot.entries.find((entry) => entry.enabled && entry.sourceModel === source);
  if (exact) return exact.targetModel;

  if (toolId === "claude") {
    const family = snapshot.entries.find(
      (entry) => entry.enabled && matchesClaudeFamily(entry.sourceModel, source),
    );
    if (family) return family.targetModel;
  }
  return sourceModel;
}

export { CLIENT_TOOL_IDS, CLAUDE_FAMILIES };
