import { clientDetectionsTotal, clientDetectionConflictsTotal } from "../observability/metrics.js";

const NATIVE_PAIRS = {
  "claude": ["claude", "anthropic"],
  "gemini-cli": ["gemini-cli"],
  "antigravity": ["antigravity"],
  "codex": ["codex"],

  "cursor": ["cursor"],
  "kiro": ["kiro"],
  "hermes": ["hermes"],
};

function detectFromHeaders(headers = {}) {
  const ua = String(headers["user-agent"] || "").toLowerCase();
  const xApp = String(headers["x-app"] || "").toLowerCase();
  const openaiIntent = String(headers["openai-intent"] || "").toLowerCase();
  const initiator = String(headers["x-initiator"] || headers["X-Initiator"] || "").toLowerCase();
  const originator = String(headers["originator"] || "").toLowerCase();
  const jcodeHack = String(headers["x-jcode"] || "").toLowerCase();

  if (ua.includes("cursor")) return "cursor";

  if (ua.includes("kiro")) return "kiro";
  if (ua.includes("hermes") || ua.includes("nous")) return "hermes";
  if (ua.includes("opencode")) return "opencode";
  if (ua.includes("cline")) return "cline";

  if (ua.includes("githubcopilotchat") || openaiIntent === "conversation-panel" || initiator === "user") {
    return "github-copilot";
  }

  if (ua.includes("claude-cli") || ua.includes("claude-code") || xApp === "cli") return "claude";

  if (ua.includes("gemini-cli")) return "gemini-cli";

  if (ua.includes("codex-tui") || ua.includes("codex-cli") || ua.includes("codex_cli_rs") ||
      ua.includes("codex desktop") || originator.startsWith("codex_") || jcodeHack.startsWith("codex")) return "codex";

  if (ua.includes("deepseek-tui")) return "deepseek-tui";

  if (ua.includes("aider")) return "aider";
  return null;
}

function detectFromBody(body = {}) {
  if (!body || typeof body !== "object") return null;

  if (body.userAgent === "antigravity") return "antigravity";

  if (body.anthropic_version || (body.system !== undefined && body.system !== null && body.messages && !body.model?.includes("/"))) {

    if (body.anthropic_version) return "claude";
  }

  if (body.input && (Array.isArray(body.input) || typeof body.input === "string") && !body.messages) {
    return "codex";
  }

  if (body.instructions && body.thinking === undefined && !body.messages?.length?.some?.(() => false) && body.stream_options === undefined) {

    if (!body.messages) return "cursor";
  }

  if (body.contents && Array.isArray(body.contents)) return "gemini-cli";
  return null;
}

function detectFromPrompt(body = {}) {
  const msgs = body?.messages;
  if (!Array.isArray(msgs)) return null;
  const head = msgs.slice(0, 3);
  const text = head
    .map((m) => {
      if (!m) return "";
      const c = m.content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) return c.map((p) => (typeof p?.text === "string" ? p.text : "")).join(" ");
      if (typeof c?.text === "string") return c.text;
      return "";
    })
    .join("\n")
    .slice(0, 4000)
    .toLowerCase();
  if (!text) return null;

  if (text.includes("claude code") || text.includes("anthropic's official cli")) return "claude";
  if (text.includes("you are codex") || text.includes("openai codex cli")) return "codex";
  if (text.includes("you are gemini cli") || text.includes("google's gemini cli")) return "gemini-cli";
  if (text.includes("you are cline") || text.includes("cline, your coding agent")) return "cline";
  if (text.includes("you are opencode")) return "opencode";
  if (text.includes("agent_kiro") || text.includes("kiro aws")) return "kiro";
  if (text.includes("you are hermes") || text.includes("nous research")) return "hermes";
  return null;
}

const PATH_CLIENT = [
  [/\/v1\/messages/, "claude"],
  [/\/v1\/chat\/completions/, null],
  [/\/responses|\/v1\/responses/, "codex"],
  [/\bv1\/models\b/, "gemini-cli"],
];

function detectFromPath(path = "") {
  if (!path) return null;
  for (const [re, id] of PATH_CLIENT) {
    if (re.test(path)) return id;
  }
  return null;
}

function tallyVotes(votes) {
  const counts = new Map();
  for (const v of votes) {
    if (!v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  if (counts.size === 0) return null;
  let best = null, bestN = 0;
  for (const [id, n] of counts) {
    if (n > bestN) { best = id; bestN = n; }
  }
  return { id: best, votes: bestN, distinct: counts.size };
}

export function detectClient(headers = {}, body = {}, ctx = {}) {
  const fromHeaders = detectFromHeaders(headers);
  const fromBody = detectFromBody(body);
  const fromPrompt = detectFromPrompt(body);
  const fromPath = detectFromPath(ctx.path || "");
  const votes = [fromHeaders, fromBody, fromPrompt, fromPath];
  const signalCount = votes.filter(Boolean).length;

  const tally = tallyVotes(votes);
  if (!tally) {
    clientDetectionsTotal.inc({ client: "unknown", signals: "0" });
    return { id: null, confidence: "low", signals: 0, agrees: 0, conflicts: [] };
  }

  const conflicts = [];
  if (tally.distinct > 1) {
    const seen = new Set([tally.id]);
    for (const v of votes) {
      if (v && !seen.has(v)) { seen.add(v); conflicts.push(v); }
    }

    clientDetectionConflictsTotal.inc({ resolved: tally.id, conflicting: conflicts[0] || "?" });
  }

  clientDetectionsTotal.inc({
    client: tally.id,
    signals: String(signalCount),
  });

  const confidence =
    tally.votes >= 3 ? "high"
    : tally.votes === 2 ? "medium"
    : "low";
  return {
    id: tally.id,
    confidence,
    signals: signalCount,
    agrees: tally.votes,
    conflicts,
  };
}

export function detectClientTool(headers = {}, body = {}) {
  return detectClient(headers, body).id;
}

export function isNativePassthrough(clientTool, provider) {
  if (!clientTool) return false;
  const nativeProviders = NATIVE_PAIRS[clientTool];
  if (!nativeProviders) return false;

  const normalizedProvider = provider.startsWith("anthropic-compatible")
    ? "anthropic"
    : provider;
  return nativeProviders.includes(normalizedProvider);
}

export { NATIVE_PAIRS };
