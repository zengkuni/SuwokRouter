import { NextResponse } from "next/server";

function logRouteError(scope, error) {
  console.error(`[${scope}]`, error);
}
import { clearConsoleLogs, getConsoleLogs, initConsoleLogCapture } from "@/lib/consoleLogBuffer";

initConsoleLogCapture();

export async function GET() {
  try {
    const logs = getConsoleLogs();
    return NextResponse.json({ success: true, logs });
  } catch (error) {
    logRouteError("Translator][ConsoleLogs][Get", error);
    return NextResponse.json({ success: false, error: "Unable to retrieve console logs" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    clearConsoleLogs();
    return NextResponse.json({ success: true });
  } catch (error) {
    logRouteError("Translator][ConsoleLogs][Delete", error);
    return NextResponse.json({ success: false, error: "Unable to clear console logs" }, { status: 500 });
  }
}
