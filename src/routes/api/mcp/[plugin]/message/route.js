import { NextResponse } from "next/server";
import { sendToChild, findPlugin } from "@/lib/mcp/stdioSseBridge";
import { logRouteError, publicError } from "@/lib/errors/publicError";

const MCP_MESSAGE_ERROR = publicError("provider", "MCP message failed");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const { plugin } = await params;
  if (!findPlugin(plugin)) {
    return NextResponse.json({ error: `Unknown plugin: ${plugin}` }, { status: 404 });
  }
  try {
    const body = await request.json();
    sendToChild(plugin, body);
    return new Response(null, { status: 202 });
  } catch (e) {
    logRouteError("McpMessage", e);
    return NextResponse.json({ error: MCP_MESSAGE_ERROR }, { status: 500 });
  }
}
