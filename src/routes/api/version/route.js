import pkg from "../../../../package.json" with { type: "json" };
import { checkForUpdate } from "@/lib/update/version.js";

export async function GET() {
  const version = await checkForUpdate();
  return Response.json({
    ...version,
    currentVersion: pkg.version,
    serverTime: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
