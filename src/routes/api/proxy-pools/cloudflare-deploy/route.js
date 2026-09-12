import { NextResponse } from "next/server";
import { createProxyPool } from "@/models";
import { logRouteError, publicError } from "@/lib/errors/publicError";
import {
  createRelayToken,
  normalizeRelayProjectName,
  publicProxyPool,
  testRelayEndpoint,
} from "@/lib/network/relay.js";

const DEPLOYMENT_ERROR = publicError("deployment");

function relayWorkerCode(relayToken) {
  return `
const RELAY_TOKEN = ${JSON.stringify(relayToken)};

export default {
  async fetch(request, env, ctx) {
    if (request.headers.get("x-sway-relay-token") !== RELAY_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized relay request" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    const target = request.headers.get("x-relay-target");
    const relayPath = request.headers.get("x-relay-path") || "/";

    if (!target || !relayPath.startsWith("/") || relayPath.startsWith("//")) {
      return new Response(JSON.stringify({ error: "Missing x-relay-target header" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    let targetUrl;
    try {
      const targetOrigin = new URL(target);
      if (targetOrigin.protocol !== "http:" && targetOrigin.protocol !== "https:") throw new Error("Unsupported target protocol");
      targetUrl = new URL(relayPath, targetOrigin.origin).toString();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid relay target" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const newRequestInit = {
      method: request.method,
      headers: new Headers(request.headers),
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      newRequestInit.body = request.body;
    }

    newRequestInit.headers.delete("x-sway-relay-token");
    newRequestInit.headers.delete("x-relay-target");
    newRequestInit.headers.delete("x-relay-path");
    newRequestInit.headers.delete("host");

    try {
      const response = await fetch(targetUrl, newRequestInit);
      return new Response(response.body, {
        status: response.status,
        headers: response.headers,
      });
    } catch (error) {
      console.error("[CloudflareRelay]", error);
      return new Response(JSON.stringify({ error: "Relay request failed" }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }
  },
};
`;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const accountId = body.accountId?.trim();
    const apiToken = body.apiToken?.trim();
    let projectName;
    try {
      projectName = normalizeRelayProjectName(body.projectName);
    } catch {
      return NextResponse.json({ error: "Project name must use lowercase letters, numbers, and hyphens" }, { status: 400 });
    }

    if (!accountId || !apiToken) {
      return NextResponse.json({ error: "Cloudflare Account ID and API Token are required" }, { status: 400 });
    }

    const relayToken = createRelayToken();

    const workerScriptUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${projectName}`;

    const formData = new FormData();
    formData.append("index.js", new Blob([relayWorkerCode(relayToken)], { type: "application/javascript+module" }), "index.js");
    formData.append("metadata", new Blob([JSON.stringify({
      main_module: "index.js",
      compatibility_date: new Date().toISOString().slice(0, 10),
      observability: { enabled: true }
    })], { type: "application/json" }), "metadata.json");

    const uploadRes = await fetch(workerScriptUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      body: formData,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.json().catch(() => ({}));
      logRouteError("ProxyPool][CloudflareUpload", err);
      return NextResponse.json(
        { error: DEPLOYMENT_ERROR },
        { status: uploadRes.status }
      );
    }

    const enableSubdomainRes = await fetch(`${workerScriptUrl}/subdomain`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled: true }),
    });

    if (!enableSubdomainRes.ok) {
      const err = await enableSubdomainRes.json().catch(() => ({}));
      logRouteError("ProxyPool][CloudflareSubdomain", err);
      return NextResponse.json({ error: DEPLOYMENT_ERROR }, { status: enableSubdomainRes.status });
    }

    let deployUrl = "";
    const subdomainRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
    });

    if (subdomainRes.ok) {
      const subdomainData = await subdomainRes.json();
      if (subdomainData.result && subdomainData.result.subdomain) {
        deployUrl = `https://${projectName}.${subdomainData.result.subdomain}.workers.dev`;
      }
    }

    if (!deployUrl) {
       return NextResponse.json(
        { error: "Worker deployed but failed to retrieve workers.dev subdomain. Make sure you have setup a workers.dev subdomain in Cloudflare Dashboard." },
        { status: 400 }
      );
    }

    const relayTest = await testRelayEndpoint(deployUrl, relayToken);
    if (!relayTest.ok) {
      throw new Error(`Cloudflare relay health check failed with status ${relayTest.status}`);
    }

    const proxyPool = await createProxyPool({
      name: projectName,
      proxyUrl: deployUrl,
      type: "cloudflare",
      noProxy: "",
      isActive: true,
      strictProxy: false,
      relayToken,
    });

    return NextResponse.json({ proxyPool: publicProxyPool(proxyPool), deployUrl }, { status: 201 });
  } catch (error) {
    logRouteError("ProxyPool][CloudflareDeploy", error);
    return NextResponse.json({ error: DEPLOYMENT_ERROR }, { status: 500 });
  }
}
