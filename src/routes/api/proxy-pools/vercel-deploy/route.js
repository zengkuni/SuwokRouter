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

const VERCEL_API = "https://api.vercel.com";

function relayFunctionCode(relayToken) {
  return `
export const config = { runtime: "edge" };

const RELAY_TOKEN = ${JSON.stringify(relayToken)};

export default async function handler(req) {
  if (req.headers.get("x-sway-relay-token") !== RELAY_TOKEN) {
    return new Response(JSON.stringify({ error: "Unauthorized relay request" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const target = req.headers.get("x-relay-target");
  const relayPath = req.headers.get("x-relay-path") || "/";
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

  const headers = new Headers(req.headers);
  headers.delete("x-sway-relay-token");
  headers.delete("x-relay-target");
  headers.delete("x-relay-path");
  headers.delete("host");

  const response = await fetch(targetUrl, {
    method: req.method,
    headers,
    body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
  });

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}
`;
}

async function pollDeployment(deploymentId, token, maxMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const res = await fetch(`${VERCEL_API}/v13/deployments/${deploymentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.readyState === "READY") return data;
    if (data.readyState === "ERROR" || data.readyState === "CANCELED") {
      throw new Error(`Deployment failed: ${data.readyState}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Deployment timed out");
}

export async function POST(request) {
  try {
    const body = await request.json();
    const vercelToken = body.vercelToken?.trim();
    let projectName;
    try {
      projectName = normalizeRelayProjectName(body.projectName);
    } catch {
      return NextResponse.json({ error: "Project name must use lowercase letters, numbers, and hyphens" }, { status: 400 });
    }

    if (!vercelToken) {
      return NextResponse.json({ error: "Vercel API token is required" }, { status: 400 });
    }

    const relayToken = createRelayToken();

    const deployRes = await fetch(`${VERCEL_API}/v13/deployments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: projectName,
        files: [
          {
            file: "api/relay.js",
            data: relayFunctionCode(relayToken),
          },
          {
            file: "package.json",
            data: JSON.stringify({ name: projectName, version: "1.0.0" }),
          },
          {
            file: "vercel.json",
            data: JSON.stringify({
              rewrites: [{ source: "/(.*)", destination: "/api/relay" }],
            }),
          },
        ],
        projectSettings: {
          framework: null,
        },
        target: "production",
      }),
    });

    if (!deployRes.ok) {
      const err = await deployRes.json().catch(() => ({}));
      logRouteError("ProxyPool][VercelCreate", err);
      return NextResponse.json(
        { error: DEPLOYMENT_ERROR },
        { status: deployRes.status }
      );
    }

    const deployment = await deployRes.json();
    const deploymentId = deployment.id || deployment.uid;

    const projectId = deployment.projectId || projectName;
    await fetch(`${VERCEL_API}/v9/projects/${projectId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ssoProtection: null }),
    });

    const ready = await pollDeployment(deploymentId, vercelToken);
    const rawDeployUrl = ready.url || deployment.url;
    if (!rawDeployUrl) throw new Error("Vercel deployment did not return a URL");
    const deployUrl = rawDeployUrl.startsWith("http") ? rawDeployUrl : `https://${rawDeployUrl}`;

    const relayTest = await testRelayEndpoint(deployUrl, relayToken);
    if (!relayTest.ok) {
      throw new Error(`Vercel relay health check failed with status ${relayTest.status}`);
    }

    const proxyPool = await createProxyPool({
      name: projectName,
      proxyUrl: deployUrl,
      type: "vercel",
      noProxy: "",
      isActive: true,
      strictProxy: false,
      relayToken,
    });

    return NextResponse.json({ proxyPool: publicProxyPool(proxyPool), deployUrl }, { status: 201 });
  } catch (error) {
    logRouteError("ProxyPool][VercelDeploy", error);
    return NextResponse.json({ error: DEPLOYMENT_ERROR }, { status: 500 });
  }
}
