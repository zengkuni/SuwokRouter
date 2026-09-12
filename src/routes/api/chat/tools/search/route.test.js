import { afterEach, describe, expect, test } from "bun:test";
import { POST } from "./route.js";

const originalFetch = globalThis.fetch;
const originalTavilyKey = process.env.TAVILY_API_KEY;
const originalBraveKey = process.env.BRAVE_SEARCH_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalTavilyKey === undefined) delete process.env.TAVILY_API_KEY;
  else process.env.TAVILY_API_KEY = originalTavilyKey;
  if (originalBraveKey === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
  else process.env.BRAVE_SEARCH_API_KEY = originalBraveKey;
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function searchRequest(body) {
  return new Request("http://localhost/api/chat/tools/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Sway Chat web search tool", () => {
  test("validates the query before making a network request", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return jsonResponse({});
    });

    const response = await POST(searchRequest({ query: "   " }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: "Search query is required" });
    expect(called).toBe(false);
  });

  test("uses the no-key DuckDuckGo fallback and returns bounded results", async () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    let requestedUrl = "";
    globalThis.fetch = (async (input) => {
      requestedUrl = String(input);
      return jsonResponse({
        Heading: "Sway Router",
        AbstractText: "A local-first AI gateway.",
        AbstractURL: "https://example.com/sway",
        RelatedTopics: [
          { Text: "Documentation", FirstURL: "https://example.com/docs" },
          { Text: "Ignored duplicate", FirstURL: "https://example.com/sway" },
        ],
      });
    });

    const response = await POST(searchRequest({ query: "Sway Router", max_results: 2 }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(new URL(requestedUrl).hostname).toBe("api.duckduckgo.com");
    expect(body).toMatchObject({ ok: true, query: "Sway Router", provider: "duckduckgo", answer: "A local-first AI gateway." });
    expect(body.results).toHaveLength(2);
    expect(body.results[1]).toMatchObject({ title: "Documentation", url: "https://example.com/docs" });
  });

  test("uses the existing Exa MCP search provider before public fallbacks", async () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    let requestBody;
    let callCount = 0;
    globalThis.fetch = (async (_input, init) => {
      callCount += 1;
      requestBody = JSON.parse(String(init?.body));
      return new Response('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"Title: Router docs\\nURL: https://example.com/docs\\nHighlights:\\nReliable docs."}]}}\n\n', {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const response = await POST(searchRequest({ query: "router docs", max_results: 1 }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(callCount).toBe(1);
    expect(requestBody).toMatchObject({ method: "tools/call", params: { name: "web_search_exa", arguments: { query: "router docs", numResults: 1 } } });
    expect(body).toMatchObject({ ok: true, provider: "exa" });
    expect(body.results).toEqual([{ title: "Router docs", url: "https://example.com/docs", snippet: "Reliable docs." }]);
  });

  test("normalizes public Bing result links and strips HTML from snippets", async () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    globalThis.fetch = (async () => new Response(
      '<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS9kb2Nz">Docs <strong>home</strong></a></h2><p>Useful &amp; current &#183; docs</p></li>',
      { status: 200, headers: { "content-type": "text/html" } },
    ));

    const response = await POST(searchRequest({ query: "router docs", max_results: 1 }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, provider: "bing" });
    expect(body.results).toEqual([{ title: "Docs home", url: "https://example.com/docs", snippet: "Useful & current · docs" }]);
  });

  test("uses a configured Tavily key without returning it to the model", async () => {
    const secret = "server-only-test-key";
    process.env.TAVILY_API_KEY = secret;
    delete process.env.BRAVE_SEARCH_API_KEY;
    let requestBody;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return jsonResponse({ results: [{ title: "Docs", url: "https://example.com/docs", content: "Useful docs." }] });
    });

    const response = await POST(searchRequest({ query: "router docs", max_results: 1 }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(requestBody).toMatchObject({ api_key: secret, query: "router docs", max_results: 1 });
    expect(body).toMatchObject({ ok: true, provider: "tavily" });
    expect(JSON.stringify(body)).not.toContain(secret);
  });
});
