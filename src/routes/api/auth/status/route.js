import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings } from "@/lib/localDb";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";

export async function GET() {
  try {
    const settings = await getSettings();
    const cookieStore = await cookies();
    const session = await getDashboardAuthSession(cookieStore.get("auth_token")?.value);
    const requireLogin = settings.requireLogin !== false;

    const defaultPasswordActive = !settings.password;

    return NextResponse.json({
      requireLogin,
      hasPassword: !!settings.password,
      defaultPasswordActive,
      displayName: "Password user",
      loginMethod: "Password",
      authenticated: !!session,
    });
  } catch {
    return NextResponse.json({
      requireLogin: true,
      hasPassword: false,
      defaultPasswordActive: false,
      displayName: "Password user",
      loginMethod: "Password",
      authenticated: false,
    });
  }
}
