import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearDashboardAuthCookie } from "@/lib/auth/dashboardSession";

const OIDC_COOKIE_NAMES = ["oidc_state", "oidc_nonce", "oidc_code_verifier"];

export async function POST() {
  const cookieStore = await cookies();
  clearDashboardAuthCookie(cookieStore);
  for (const name of OIDC_COOKIE_NAMES) cookieStore.delete(name);
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
