import { NextResponse } from "next/server";
import { requestShutdown } from "@/lifecycle/appLifecycle";

export async function POST() {
  const result = requestShutdown(0);

  if (result === "unavailable") {
    return NextResponse.json(
      { success: false, code: "shutdown_unavailable", message: "Shutdown handler is not ready" },
      { status: 503 },
    );
  }

  if (result === "already_requested") {
    return NextResponse.json(
      { success: false, code: "shutdown_in_progress", message: "Shutdown is already in progress" },
      { status: 409 },
    );
  }

  return NextResponse.json(
    { success: true, code: "shutdown_accepted", message: "Shutdown initiated" },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}
