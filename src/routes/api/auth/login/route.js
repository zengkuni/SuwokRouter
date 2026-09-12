import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";
import { isLocalRequest } from "@/dashboardGuard";
import { env } from "@/lib/env";
import { loadState } from "@/lib/tunnel/shared/state.js";
import { isTunnelHost } from "@/lib/tunnel/cloudflare/publicUrl.js";

const RESET_HINT = "Forgot password? Reset to default via Sway Router CLI → Settings → Reset Password to Default.";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function isTunnelRequest(request, settings) {
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  return isTunnelHost(host, settings, loadState());
}

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const lock = checkLock(ip);
    if (lock.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${lock.retryAfter}s. ${RESET_HINT}`, retryAfter: lock.retryAfter, resetHint: RESET_HINT },
        { status: 429, headers: { "Retry-After": String(lock.retryAfter) } }
      );
    }

    const { password } = await request.json();
    const settings = await getSettings();

    if (isTunnelRequest(request, settings) && settings.tunnelDashboardAccess !== true) {
      return NextResponse.json({ error: "Dashboard access via tunnel is disabled" }, { status: 403 });
    }

    const storedHash = settings.password;
    const localRequest = isLocalRequest(request);

    if (!storedHash && !localRequest) {
      return NextResponse.json(
        { error: "Initial setup must be completed from localhost before remote login is enabled." },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }

    let isValid = false;
    if (storedHash) {
      isValid = await bcrypt.compare(password, storedHash);
    } else {
      const initialPassword = env.initialPassword;
      isValid = typeof password === "string" && password === initialPassword;
    }

    if (isValid) {
      recordSuccess(ip);
      const cookieStore = await cookies();

      const mustChangePassword = !storedHash;
      await setDashboardAuthCookie(cookieStore, request, { mustChangePassword });

      return NextResponse.json({ success: true, mustChangePassword }, { headers: NO_STORE_HEADERS });
    }

    const { remainingBeforeLock } = recordFail(ip);
    const postLock = checkLock(ip);
    if (postLock.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${postLock.retryAfter}s. ${RESET_HINT}`, retryAfter: postLock.retryAfter, resetHint: RESET_HINT },
        { status: 429, headers: { "Retry-After": String(postLock.retryAfter) } }
      );
    }
    return NextResponse.json(
      { error: `Invalid password. ${remainingBeforeLock} attempt(s) left before lockout.`, remainingBeforeLock },
      { status: 401 }
    );
  } catch (error) {
    console.error("[Auth][Login]", error);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
