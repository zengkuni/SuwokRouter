import { describe, expect, test } from "bun:test";
import {
  buildCommands,
  commandScore,
  fuzzyScore,
  mergeRemoteMcp,
  parseQuery,
  rankCommands,
  type PaletteCommand,
} from "@/lib/commandPalette";

const PAGES = ["Dashboard", "API Keys", "Providers", "Combos", "Proxy", "Usage", "Quota Monitor", "CLI Tools", "Sway Chat", "Settings", "Console Logs"];

describe("A7.4 command palette — sources", () => {
  test("buildCommands emits every page + every catalog provider + local MCP tools", () => {
    const cmds = buildCommands();

    const pages = cmds.filter((c) => c.group === "Page");
    const providers = cmds.filter((c) => c.group === "Provider");
    const mcp = cmds.filter((c) => c.group === "MCP tool");
    expect(pages.length).toBe(11);
    expect(pages.map((p) => p.label).sort()).toEqual([...PAGES].sort());
    expect(mcp.length).toBe(3 + 2 + 4 + 10);

    for (const p of pages) expect(p.to.startsWith("/dashboard")).toBe(true);

    expect(new Set(providers.map((p) => p.to))).toEqual(new Set(["/dashboard/provider"]));
    expect(new Set(mcp.map((p) => p.to))).toEqual(new Set(["/dashboard/cli-tools"]));
  });
});

describe("A7.4 command palette — fuzzy ranking", () => {
  test("empty query lists pages first, then providers, then MCP tools (A-Z within group)", () => {
    const ranked = rankCommands(buildCommands(), "");
    const firstPage = ranked.findIndex((c) => c.group === "Page");
    const firstProv = ranked.findIndex((c) => c.group === "Provider");
    const firstMcp = ranked.findIndex((c) => c.group === "MCP tool");
    expect(firstPage).toBeLessThan(firstProv);
    expect(firstProv).toBeLessThan(firstMcp);
  });

  test("a page query surfaces the matching page near the top", () => {
    const ranked = rankCommands(buildCommands(), "usage");

    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].group).toBe("Page");
    expect(ranked[0].label.toLowerCase()).toContain("usage");
  });

  test("a provider alias query matches the provider by alias/id, not just name", () => {

    const ranked = rankCommands(buildCommands(), "cx");
    const hit = ranked.find((c) => c.group === "Provider");
    expect(hit).toBeDefined();
    expect(hit!.keywords?.includes("cx")).toBe(true);
  });

  test("the `>` prefix switches to provider-only mode so the alias jump is clean", () => {

    expect(parseQuery(">claude")).toEqual({ mode: "provider", q: "claude" });
    expect(parseQuery(">  cc  ")).toEqual({ mode: "provider", q: "cc" });
    expect(parseQuery("claude")).toEqual({ mode: "all", q: "claude" });

    const ranked = rankCommands(buildCommands(), ">usage");

    expect(ranked.every((c) => c.group === "Provider")).toBe(true);
    expect(ranked.find((c) => c.group === "Page")).toBeUndefined();
  });

  test("`>claude` jumps to a Claude/Anthropic provider", () => {
    const ranked = rankCommands(buildCommands(), ">claude");
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].group).toBe("Provider");
    expect(ranked[0].label.toLowerCase()).toContain("claude");
  });

  test("an MCP tool query matches tool names", () => {
    const ranked = rankCommands(buildCommands(), "tavily_search");
    const hit = ranked.find((c) => c.group === "MCP tool");
    expect(hit).toBeDefined();
    expect(hit!.id).toBe("mcp:tavily:tavily_search");
  });
});

describe("A7.4 command palette — fuzzyScore primitives", () => {
  test("exact substring beats subsequence and non-matches score Infinity", () => {

    expect(fuzzyScore("abc", "abc")).toBe(0);

    expect(fuzzyScore("bc", "abcd")).toBe(1);

    expect(fuzzyScore("ac", "abcd")).toBeGreaterThanOrEqual(1);

    expect(fuzzyScore("xyz", "abcd")).toBe(Number.POSITIVE_INFINITY);
  });

  test("commandScore takes the best across label + keywords", () => {
    const cmd: PaletteCommand = {
      id: "provider:deepseek",
      label: "DeepSeek",
      group: "Provider",
      to: "/dashboard/provider",
      keywords: ["deepseek", "ds"],
    };
    expect(commandScore(cmd, "deepseek")).toBe(0);
    expect(Number.isFinite(commandScore(cmd, "ds"))).toBe(true);
    expect(commandScore(cmd, "zzz")).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("A7.4 command palette — remote MCP merge", () => {
  test("mergeRemoteMcp adds new servers/tools and dedupes the local set", () => {
    const base = buildCommands();
    const before = base.filter((c) => c.group === "MCP tool").length;
    const merged = mergeRemoteMcp(base, [

      { name: "exa", title: "Exa", toolNames: ["web_search_exa", "web_fetch_exa", "web_crawl_exa"] },

      { name: "github", title: "GitHub", toolNames: ["create_issue", "search_repos"] },

      { title: "Nope" },
    ]);
    const after = merged.filter((c) => c.group === "MCP tool");

    expect(after.length).toBe(before + 4);
    expect(merged.find((c) => c.id === "mcp:exa:web_crawl_exa")).toBeDefined();
    expect(merged.find((c) => c.id === "mcp:github")).toBeDefined();
    expect(merged.find((c) => c.id === "mcp:github:create_issue")).toBeDefined();
    expect(merged.find((c) => c.id === "mcp:github:search_repos")).toBeDefined();

    expect(base.filter((c) => c.group === "MCP tool").length).toBe(before);
  });
});
