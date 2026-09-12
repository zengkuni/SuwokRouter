import { NextResponse } from "@/next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUERY_LENGTH = 300;
const DEFAULT_RESULT_COUNT = 5;
const MAX_RESULT_COUNT = 8;
const MAX_RESPONSE_BYTES = 1_500_000;
const MAX_TITLE_LENGTH = 180;
const MAX_URL_LENGTH = 2_000;
const MAX_SNIPPET_LENGTH = 700;
const SEARCH_TIMEOUT_MS = 10_000;
const EXA_MCP_URL = "https://mcp.exa.ai/mcp";

class SearchInputError extends Error {}
class SearchProviderError extends Error {}

function text(value, maxLength) {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function decodeHtml(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function queryInput(value) {
  if (typeof value !== "string" || !value.trim()) throw new SearchInputError("Search query is required");
  const query = value.trim();
  if (query.length > MAX_QUERY_LENGTH) throw new SearchInputError(`Search query must be ${MAX_QUERY_LENGTH} characters or fewer`);
  return query;
}

function resultCount(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_RESULT_COUNT;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > MAX_RESULT_COUNT) {
    throw new SearchInputError(`max_results must be an integer from 1 to ${MAX_RESULT_COUNT}`);
  }
  return count;
}

function safeUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const parsed = new URL(decodeHtml(value.trim()));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    parsed.hash = "";
    return parsed.toString().slice(0, MAX_URL_LENGTH);
  } catch {
    return "";
  }
}

function normalizeResult(item) {
  if (!item || typeof item !== "object") return null;
  const fallbackTitle = typeof item.Text === "string" ? item.Text.split(" - ")[0] : "";
  const title = text(item.title ?? item.name ?? item.Heading ?? fallbackTitle, MAX_TITLE_LENGTH);
  const url = safeUrl(item.url ?? item.link ?? item.FirstURL ?? item.AbstractURL);
  const snippet = text(item.snippet ?? item.description ?? item.content ?? item.Text ?? item.AbstractText, MAX_SNIPPET_LENGTH);
  if (!url || (!title && !snippet)) return null;
  return { title: title || url, url, snippet };
}

function unwrapBingUrl(value) {
  try {
    const parsed = new URL(decodeHtml(value));
    if (parsed.hostname !== "www.bing.com" || !parsed.pathname.startsWith("/ck/")) return value;
    const encoded = parsed.searchParams.get("u") || "";
    const payload = encoded.startsWith("a1") ? encoded.slice(2) : encoded;
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    return /^https?:\/\//i.test(decoded) ? decoded : value;
  } catch {
    return value;
  }
}

function uniqueResults(items, limit) {
  const seen = new Set();
  const results = [];
  for (const item of items) {
    const result = normalizeResult(item);
    if (!result || seen.has(result.url)) continue;
    seen.add(result.url);
    results.push(result);
    if (results.length >= limit) break;
  }
  return results;
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...options,
      cache: "no-store",
      signal: controller.signal,
    });
    const raw = await response.text();
    if (raw.length > MAX_RESPONSE_BYTES) throw new SearchProviderError("Search provider response was too large");
    let payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch { throw new SearchProviderError("Search provider returned invalid data"); }
    if (!response.ok) throw new SearchProviderError(`Search provider returned HTTP ${response.status}`);
    return payload;
  } catch (error) {
    if (error instanceof SearchProviderError) throw error;
    if (error?.name === "AbortError") throw new SearchProviderError("Search provider timed out");
    throw new SearchProviderError("Search provider could not be reached");
  } finally {
    clearTimeout(timeout);
  }
}

async function requestText(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...options,
      cache: "no-store",
      signal: controller.signal,
    });
    const raw = await response.text();
    if (raw.length > MAX_RESPONSE_BYTES) throw new SearchProviderError("Search provider response was too large");
    if (!response.ok) throw new SearchProviderError(`Search provider returned HTTP ${response.status}`);
    return raw;
  } catch (error) {
    if (error instanceof SearchProviderError) throw error;
    if (error?.name === "AbortError") throw new SearchProviderError("Search provider timed out");
    throw new SearchProviderError("Search provider could not be reached");
  } finally {
    clearTimeout(timeout);
  }
}

function parseMcpMessage(raw) {
  for (const block of String(raw || "").split(/\n\s*\n/)) {
    const dataLine = block.split(/\r?\n/).find((line) => line.startsWith("data:"));
    if (!dataLine) continue;
    try {
      const payload = JSON.parse(dataLine.slice(5).trim());
      if (payload?.error) throw new SearchProviderError("Search provider returned an MCP error");
      if (payload?.result) return payload.result;
    } catch (error) {
      if (error instanceof SearchProviderError) throw error;
    }
  }
  throw new SearchProviderError("Search provider returned no results");
}

async function searchTavily(query, limit, apiKey) {
  const payload = await requestJson("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      topic: "general",
      max_results: limit,
      include_answer: false,
      include_raw_content: false,
    }),
  });
  const results = uniqueResults(Array.isArray(payload?.results) ? payload.results : [], limit);
  return { provider: "tavily", results };
}

async function searchExa(query, limit) {
  const raw = await requestText(EXA_MCP_URL, {
    method: "POST",
    headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "web_search_exa", arguments: { query, numResults: limit } },
    }),
  });
  const result = parseMcpMessage(raw);
  const content = Array.isArray(result?.content)
    ? result.content.filter((item) => item?.type === "text").map((item) => item.text).join("\n")
    : "";
  const candidates = content
    .split(/\n(?=Title:\s)/)
    .map((entry) => {
      const title = entry.match(/^Title:\s*(.+)$/m)?.[1] || "";
      const url = entry.match(/^URL:\s*(.+)$/m)?.[1] || "";
      const highlights = entry.match(/^Highlights:\s*([\s\S]*)$/m)?.[1] || entry;
      return { title, url, snippet: highlights.replace(/\n---\s*$/g, "") };
    });
  return { provider: "exa", results: uniqueResults(candidates, limit) };
}

async function searchBrave(query, limit, apiKey) {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(limit));
  url.searchParams.set("safesearch", "moderate");
  const payload = await requestJson(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
  });
  const results = uniqueResults(Array.isArray(payload?.web?.results) ? payload.web.results : [], limit);
  return { provider: "brave", results };
}

function collectDuckDuckGoTopics(topics, output) {
  if (!Array.isArray(topics)) return;
  for (const topic of topics) {
    if (Array.isArray(topic?.Topics)) collectDuckDuckGoTopics(topic.Topics, output);
    else output.push(topic);
  }
}

function stripMarkup(value) {
  return text(String(value || "").replace(/<[^>]*>/g, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">"), MAX_SNIPPET_LENGTH);
}

async function searchDuckDuckGo(query, limit) {
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("no_redirect", "1");
  url.searchParams.set("skip_disambig", "1");
  const payload = await requestJson(url, {
    headers: { Accept: "application/json", "User-Agent": "SwayRouter SwayChat/1.0" },
  });
  const candidates = [];
  if (payload?.AbstractURL || payload?.AbstractText) {
    candidates.push({
      title: payload.Heading || query,
      url: payload.AbstractURL,
      snippet: payload.AbstractText,
    });
  }
  if (payload?.DefinitionURL || payload?.Definition) {
    candidates.push({
      title: `${query} definition`,
      url: payload.DefinitionURL,
      snippet: payload.Definition,
    });
  }
  if (Array.isArray(payload?.Results)) candidates.push(...payload.Results);
  const topics = [];
  collectDuckDuckGoTopics(payload?.RelatedTopics, topics);
  candidates.push(...topics);
  return {
    provider: "duckduckgo",
    results: uniqueResults(candidates, limit),
    ...(text(payload?.AbstractText, MAX_SNIPPET_LENGTH) ? { answer: text(payload.AbstractText, MAX_SNIPPET_LENGTH) } : {}),
  };
}

async function searchBing(query, limit) {
  const url = new URL("https://www.bing.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(limit));
  url.searchParams.set("setlang", "en-US");
  const html = await requestText(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.8",
      "User-Agent": "SwayRouter SwayChat/1.0",
    },
  });
  const items = html.match(/<li\b[^>]*class=(['"])[^'"]*\bb_algo\b[^'"]*\1[^>]*>[\s\S]*?<\/li>/gi) || [];
  const candidates = items.map((item) => {
    const link = item.match(/<h2\b[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const snippet = item.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
    return {
      title: link ? decodeHtml(link[2].replace(/<[^>]*>/g, "")) : "",
      url: link ? unwrapBingUrl(link[1]) : "",
      snippet: snippet ? decodeHtml(snippet[1].replace(/<[^>]*>/g, "")) : "",
    };
  });
  return { provider: "bing", results: uniqueResults(candidates, limit) };
}

async function searchWikipedia(query, limit) {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", query);
  url.searchParams.set("srlimit", String(limit));
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  const payload = await requestJson(url, {
    headers: { Accept: "application/json", "User-Agent": "SwayRouter SwayChat/1.0" },
  });
  const results = uniqueResults(
    (Array.isArray(payload?.query?.search) ? payload.query.search : [])
      .map((item) => ({
        title: item?.title,
        url: Number.isInteger(item?.pageid) ? `https://en.wikipedia.org/?curid=${item.pageid}` : "",
        snippet: stripMarkup(item?.snippet),
      })),
    limit,
  );
  return { provider: "wikipedia", results };
}

async function searchWeb(query, limit) {
  const tavilyKey = typeof process.env.TAVILY_API_KEY === "string" ? process.env.TAVILY_API_KEY.trim() : "";
  const braveKey = typeof process.env.BRAVE_SEARCH_API_KEY === "string" ? process.env.BRAVE_SEARCH_API_KEY.trim() : "";

  if (tavilyKey) {
    try { return await searchTavily(query, limit, tavilyKey); } catch {                      }
  }
  if (braveKey) {
    try { return await searchBrave(query, limit, braveKey); } catch {                      }
  }

  try {
    const exa = await searchExa(query, limit);
    if (exa.results.length) return exa;
  } catch {                                  }
  try {
    const bing = await searchBing(query, limit);
    if (bing.results.length) return bing;
  } catch {                                  }
  try {
    const duckDuckGo = await searchDuckDuckGo(query, limit);
    if (duckDuckGo.results.length || duckDuckGo.answer) return duckDuckGo;
  } catch {                                     }
  return await searchWikipedia(query, limit);
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const query = queryInput(body?.query);
    const limit = resultCount(body?.max_results);
    const result = await searchWeb(query, limit);
    return NextResponse.json({ ok: true, query, ...result });
  } catch (error) {
    const status = error instanceof SearchInputError ? 400 : 502;
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Web search failed",
    }, { status });
  }
}
