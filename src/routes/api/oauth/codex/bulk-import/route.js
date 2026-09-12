import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { extractCodexAccountInfo } from "@/lib/oauth/providers";
import { logRouteError, publicError } from "@/lib/errors/publicError";

const IMPORT_ERROR = publicError("oauth", "Unable to import account");

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    logRouteError("CodexBulkImport][Parse", err);
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  let accounts;
  if (Array.isArray(body)) {
    accounts = body;
  } else if (body && typeof body === "object" && Array.isArray(body.accounts)) {
    accounts = body.accounts;
  } else if (body && typeof body === "object") {
    accounts = [body];
  } else {
    accounts = null;
  }

  if (!Array.isArray(accounts) || accounts.length === 0) {
    return NextResponse.json(
      { error: "No accounts provided" },
      { status: 400 }
    );
  }

  const results = [];
  let success = 0;
  let failed = 0;

  for (let i = 0; i < accounts.length; i++) {
    const raw = accounts[i];
    try {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("Item is not an object");
      }

      const {
        id: _id,
        provider: _provider,
        authType: _authType,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...item
      } = raw;

      if (!item.accessToken || typeof item.accessToken !== "string") {
        throw new Error("Missing accessToken");
      }

      const psd = item.providerSpecificData || {};
      const needsEmail = !item.email;
      const needsAccountId = !psd.chatgptAccountId;
      const needsPlanType = !psd.chatgptPlanType;

      if (needsEmail || needsAccountId || needsPlanType) {
        const info = extractCodexAccountInfo(item.idToken || item.accessToken) || {};
        if (needsEmail && info.email) item.email = info.email;
        if (needsAccountId && info.chatgptAccountId) {
          psd.chatgptAccountId = info.chatgptAccountId;
        }
        if (needsPlanType && info.chatgptPlanType) {
          psd.chatgptPlanType = info.chatgptPlanType;
        }
      }
      if (Object.keys(psd).length > 0) {
        item.providerSpecificData = psd;
      }

      if (!item.expiresAt && typeof item.expiresIn === "number" && item.expiresIn > 0) {
        item.expiresAt = new Date(Date.now() + item.expiresIn * 1000).toISOString();
      }

      if (item.testStatus === undefined) item.testStatus = "active";
      if (item.isActive === undefined) item.isActive = true;
      if (!item.lastRefreshAt) item.lastRefreshAt = new Date().toISOString();

      const created = await createProviderConnection({
        provider: "codex",
        authType: "oauth",
        ...item,
      });

      results.push({ index: i, ok: true, id: created.id });
      success++;
    } catch (e) {
      logRouteError(`CodexBulkImport][Item:${i}`, e);
      results.push({ index: i, ok: false, error: IMPORT_ERROR });
      failed++;
    }
  }

  return NextResponse.json({ success, failed, results });
}
