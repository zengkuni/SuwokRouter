export function markProviderIconMissing(_providerId?: string | null): void {}

import { resolveProviderId } from "@/lib/providers";
import { BUILTIN_PROVIDER_CATALOG } from "@/lib/provider-catalog";

const KATALOG_KNOWN = new Set<string>(
  BUILTIN_PROVIDER_CATALOG.flatMap((p) => [
    p.id,
    ...(p.alias && p.alias !== p.id ? [p.alias] : []),
  ])
);

export function isBuiltinProvider(providerId?: string | null): boolean {
  if (!providerId) return false;
  const normalized = providerId.trim().toLowerCase();
  const canonical = resolveProviderId(normalized).toLowerCase();
  return KATALOG_KNOWN.has(canonical) || KATALOG_KNOWN.has(normalized);
}

export function getProviderIconSrc(providerId?: string | null): string | null {
  if (!providerId) return null;
  const normalized = providerId.trim().toLowerCase();

  if (!isBuiltinProvider(normalized)) {
    return "/providers/SwayCustom.svg";
  }

  const canonical = resolveProviderId(normalized).toLowerCase();
  if (canonical === "agentrouter") return "/providers/SwayCustom.svg";
  if (canonical === "alicode-intl" || canonical === "alims-intl") {
    return "/providers/alicode.svg";
  }
  if (canonical === "clinepass") {
    return "/providers/cline.svg";
  }
  if (canonical === "codebuddy-cn" || canonical === "codebuddy-intl") {
    return "/providers/codebuddy.svg";
  }
  if (canonical === "glm" || canonical === "glm-cn") {
    return "/providers/zai.svg";
  }
  if (canonical === "grok-cli" || canonical === "grok-web" || canonical === "xai") {
    return "/providers/grok.svg";
  }
  if (canonical === "kimchi") {
    return "/providers/kimchi.svg";
  }
  if (canonical === "minimax-cn") {
    return "/providers/minimax.svg";
  }
  if (canonical === "ollama-local") {
    return "/providers/ollama.svg";
  }
  if (canonical === "opencode-go") {
    return "/providers/opencode.svg";
  }
  if (canonical === "perplexity") {
    return "/providers/perplexity.svg";
  }
  if (canonical === "vercel-ai-gateway") {
    return "/providers/vercel.svg";
  }
  if (canonical === "vertex-partner") {
    return "/providers/vertex.svg";
  }
  if (canonical === "xiaomi-mimo" || canonical === "xiaomi-tokenplan") {
    return "/providers/mimo.svg";
  }
  if (canonical === "kilo-gateway") {
    return "/providers/kilocode.svg";
  }
  if (canonical === "gemini-cli") {
    return "/providers/geminicli.svg";
  }
  return `/providers/${canonical}.svg`;
}
