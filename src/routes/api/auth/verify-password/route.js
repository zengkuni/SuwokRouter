import { NextResponse } from "next/server";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(request) {
  try {
    const body = await request.json();
    const password = typeof body?.password === "string" ? body.password : "";

    if (!password) {
      return NextResponse.json(
        { error: "Current password is required" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const verified = await verifyDashboardPassword(password);
    if (!verified) {
      return NextResponse.json(
        {
          error: {
            message: "Invalid current password",
            code: "invalid_current_password",
          },
        },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json({ verified: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[Auth][VerifyPassword]", error);
    return NextResponse.json(
      { error: "Unable to verify current password" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
