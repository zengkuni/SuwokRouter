import { NextResponse } from "next/server";
import REGISTRY from "open-sse/providers/registry/index.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const providers = REGISTRY.filter((r) => !r.hidden)
      .map((r) => {
        const display = r.display || {};
        const staticModels = ["codebuddy-cn", "codebuddy-intl"].includes(r.id)
          && Array.isArray(r.models)
          ? r.models.map((model) => ({
            id: model.id,
            name: model.name || model.id,
          }))
          : [];

        const authType =
          r.authType ||
          (Array.isArray(r.authModes) && r.authModes.length
            ? r.authModes[0]
            : null) ||
          (r.hasOAuth || r.category === "oauth"
            ? "oauth"
            : null) ||
          (r.noAuth ? "none" : null) ||
          (r.category === "webCookie" ? "cookie" : "apikey");
        return {
          id: r.id,
          name: display.name || r.name || r.id,
          alias: r.uiAlias || r.alias || r.id,
          category: r.category,
          authType,
          ...(Array.isArray(r.authModes) && r.authModes.length
            ? { authModes: r.authModes }
            : {}),
          ...(r.noAuth ? { noAuth: true } : {}),
          ...(r.hasOAuth ? { hasOAuth: true } : {}),
          ...(r.passthroughModels ? { passthroughModels: true } : {}),
          ...(r.thinkingConfig ? { thinkingConfig: r.thinkingConfig } : {}),
          ...(staticModels.length ? { models: staticModels } : {}),
          ...(display.color ? { color: display.color } : {}),
          ...(display.icon ? { icon: display.icon } : {}),
          ...(display.textIcon ? { textIcon: display.textIcon } : {}),
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    return NextResponse.json({ providers });
  } catch (error) {
    console.error("[providers/catalog]", error);
    return NextResponse.json(
      { error: "Failed to build provider catalog" },
      { status: 500 }
    );
  }
}
