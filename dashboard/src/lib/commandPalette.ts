import { BUILTIN_PROVIDER_CATALOG } from "@/lib/provider-catalog";
import { NAV_ITEMS } from "@/components/Sidebar";

export type PaletteCommand = {
  id: string;
  label: string;

  group: "Page" | "Provider" | "MCP tool";

  to: string;

  keywords?: string[];

  iconKey?: string;
};

function pageCommands(): PaletteCommand[] {
  return NAV_ITEMS.map((n) => ({
    id: `page:${n.to}`,
    label: n.label,
    group: "Page" as const,
    to: n.to,
    iconKey: "page",
  }));
}

function providerCommands(): PaletteCommand[] {
  return BUILTIN_PROVIDER_CATALOG.map((p) => ({
    id: `provider:${p.id}`,
    label: p.name,
    group: "Provider" as const,
    to: "/dashboard/provider",
    keywords: [p.id, p.alias].filter(Boolean) as string[],
    iconKey: `provider:${p.id}`,
  }));
}

const LOCAL_MCP = [
  { name: "exa", title: "Exa", toolNames: ["web_search_exa", "web_fetch_exa"] },
  { name: "tavily", title: "Tavily", toolNames: ["tavily_search", "tavily_extract", "tavily_crawl", "tavily_map"] },
  { name: "browsermcp", title: "Browser MCP", toolNames: ["browser_navigate", "browser_snapshot", "browser_click", "browser_type", "browser_screenshot", "browser_get_console_logs", "browser_wait", "browser_press_key", "browser_go_back", "browser_go_forward"] },
];

function mcpToolCommands(servers: typeof LOCAL_MCP): PaletteCommand[] {
  const out: PaletteCommand[] = [];
  for (const s of servers) {
    out.push({
      id: `mcp:${s.name}`,
      label: s.title,
      group: "MCP tool",
      to: "/dashboard/cli-tools",
      keywords: [s.name],
      iconKey: "mcp",
    });
    for (const tn of s.toolNames) {
      out.push({
        id: `mcp:${s.name}:${tn}`,
        label: `${tn}`,
        group: "MCP tool",
        to: "/dashboard/cli-tools",
        keywords: [s.name, tn],
        iconKey: "mcp",
      });
    }
  }
  return out;
}

export function buildCommands(): PaletteCommand[] {
  return [...pageCommands(), ...providerCommands(), ...mcpToolCommands(LOCAL_MCP)];
}

export function fuzzyScore(query: string, s: string): number {
  const q = query.toLowerCase();
  const text = s.toLowerCase();
  if (!q) return 0;
  if (text.includes(q)) {

    return text.indexOf(q);
  }
  let qi = 0;
  let score = 0;
  let run = 0;
  let last = -1;
  for (let ti = 0; ti < text.length && qi < q.length; ti++) {
    if (text[ti] === q[qi]) {

      score += ti - (last >= 0 ? last : 0);
      run = last >= 0 && ti === last + 1 ? run + 1 : 0;
      score -= run * 2;
      last = ti;
      qi++;
    }
  }
  if (qi < q.length) return Number.POSITIVE_INFINITY;
  return score + 1;
}

export function commandScore(cmd: PaletteCommand, query: string): number {
  const candidates = [cmd.label, cmd.id, ...(cmd.keywords ?? [])];
  let best = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const s = fuzzyScore(query, c);
    if (s < best) best = s;
  }
  return best;
}

const GROUP_RANK: Record<PaletteCommand["group"], number> = { Page: 0, Provider: 1, "MCP tool": 2 };

export function parseQuery(query: string): { mode: "all" | "provider"; q: string } {
  const raw = query.trim();
  if (raw.startsWith(">")) return { mode: "provider", q: raw.slice(1).trim() };
  return { mode: "all", q: raw };
}

export function rankCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const { mode, q } = parseQuery(query);
  const pool = mode === "provider" ? commands.filter((c) => c.group === "Provider") : commands;
  if (!q) {
    return [...pool].sort((a, b) =>
      GROUP_RANK[a.group] - GROUP_RANK[b.group] || a.label.localeCompare(b.label),
    );
  }
  const scored = pool
    .map((c) => ({ c, s: commandScore(c, q) }))
    .filter((x) => Number.isFinite(x.s));
  scored.sort((a, b) => a.s - b.s || a.c.label.localeCompare(b.c.label));
  return scored.map((x) => x.c);
}

export function mergeRemoteMcp(
  base: PaletteCommand[],
  servers: Array<{ name?: string; title?: string; toolNames?: string[] }>,
): PaletteCommand[] {
  const known = new Set(base.filter((c) => c.group === "MCP tool").map((c) => c.id));
  const extra: PaletteCommand[] = [];
  for (const s of servers) {
    const name = (s.name || "").toLowerCase();
    const title = s.title || s.name || "";
    if (!name) continue;
    const serverId = `mcp:${name}`;
    if (!known.has(serverId)) {
      extra.push({ id: serverId, label: title, group: "MCP tool", to: "/dashboard/cli-tools", keywords: [name], iconKey: "mcp" });
    }
    const tools = Array.isArray(s.toolNames) ? s.toolNames : [];
    for (const tn of tools) {
      const tid = `mcp:${name}:${tn}`;
      if (known.has(tid)) continue;
      extra.push({ id: tid, label: tn, group: "MCP tool", to: "/dashboard/cli-tools", keywords: [name, tn], iconKey: "mcp" });
    }
  }
  return base.length ? [...base, ...extra] : extra;
}

export type RemoteMcpServer = {
  name?: string;
  title?: string;
  toolNames?: string[];
};

export async function fetchRemoteMcp(): Promise<RemoteMcpServer[]> {
  try {
    const res = await fetch("/api/cli-tools/cowork-mcp-registry", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { servers?: RemoteMcpServer[] };
    return Array.isArray(data?.servers) ? data.servers : [];
  } catch {
    return [];
  }
}
