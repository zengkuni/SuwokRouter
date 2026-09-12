import { useEffect, useMemo, useState } from "react";
import { CircleAlert, Loader2 } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { getProviderIconSrc } from "@/lib/provider-icon";
import { providerName, resolveProviderId } from "@/lib/providers";
import {
  clearOAuthCallbackProvider,
  createOAuthCallbackMessage,
  getOAuthCallbackTargetOrigins,
  parseOAuthCallbackSearch,
  readOAuthCallbackProvider,
  storeOAuthCallback,
} from "@/lib/oauth-callback";

const CLOSE_DELAY_MS = 3000;

type CallbackState = "processing" | "success" | "error" | "manual";

function AnimatedCheckMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 18 18"
      className={className}
      fill="none"
      aria-hidden="true"
    >
      <path
        className="oauth-checkmark"
        d="M2.5 9.25 6.5 13.25 15.5 5"
        pathLength="1"
      />
    </svg>
  );
}

export default function OAuthCallback() {
  const payload = useMemo(
    () => parseOAuthCallbackSearch(window.location.search),
    [],
  );
  const [state, setState] = useState<CallbackState>("processing");
  const [message, setMessage] = useState("Returning to Sway Router…");

  const [callbackProviderId, setCallbackProviderId] = useState<string | undefined>(
    () =>
      payload.provider ||
      (payload.state ? readOAuthCallbackProvider(payload.state) : undefined),
  );
  const canonicalProvider = callbackProviderId
    ? resolveProviderId(callbackProviderId)
    : undefined;
  const providerLabel = canonicalProvider ? providerName(canonicalProvider) : "OAuth";
  const providerIconSrc = canonicalProvider
    ? getProviderIconSrc(canonicalProvider)
    : null;

  useEffect(() => {
    const opener = window.opener;
    const hasResult = Boolean(payload.code || payload.error);
    if (!hasResult) {
      setState("manual");
      setMessage("No OAuth result was returned. Close this tab and try again.");
      return;
    }

    const resolvedProviderId =
      payload.provider ||
      (payload.state ? readOAuthCallbackProvider(payload.state) : undefined);
    if (resolvedProviderId) setCallbackProviderId(resolvedProviderId);
    const callbackPayload = resolvedProviderId
      ? { ...payload, provider: resolvedProviderId }
      : payload;

    const stored = storeOAuthCallback(callbackPayload);
    if (payload.state) clearOAuthCallbackProvider(payload.state);

    if (!opener || opener.closed) {
      if (!stored) {
        setState("manual");
        setMessage(
          payload.errorDescription || payload.error
            ? "Authorization failed. Close this tab and retry from the provider dialog."
            : "Authorization completed. Close this tab and return to the provider dialog.",
        );
        return;
      }
      setState(payload.error ? "error" : "success");
      setMessage(
        payload.errorDescription || payload.error
          ? payload.errorDescription || payload.error || "Authorization failed."
          : "You can close this window.",
      );
      const timer = window.setTimeout(() => {
        if (!window.closed) window.close();
      }, CLOSE_DELAY_MS);
      return () => window.clearTimeout(timer);
    }

    try {
      const message = createOAuthCallbackMessage(callbackPayload);
      const targetOrigins = getOAuthCallbackTargetOrigins(window.location.origin);
      if (targetOrigins.length === 0) throw new Error("Invalid callback origin");
      for (const targetOrigin of targetOrigins) {
        opener.postMessage(message, targetOrigin);
      }
      if (payload.error) {
        setState("error");
        setMessage(payload.errorDescription || payload.error || "Authorization failed.");
      } else {
        setState("success");
        setMessage("You can close this window.");
      }
    } catch {
      if (!stored) {
        setState("manual");
        setMessage("The callback could not reach the provider dialog. Close this tab and retry.");
        return;
      }
      setState(payload.error ? "error" : "success");
      setMessage(
        payload.errorDescription || payload.error
          ? payload.errorDescription || payload.error || "Authorization failed."
          : "You can close this window.",
      );
    }

    const timer = window.setTimeout(() => {
      if (!window.closed) window.close();
    }, CLOSE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [payload]);

  const title =
    state === "success"
      ? "Connected successfully"
      : state === "error"
        ? "Connection could not be completed"
        : state === "manual"
          ? "Return to Sway Router"
        : "Completing authorization";
  const isSuccess = state === "success";
  const isError = state === "error";

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-background p-4 text-foreground">
      <Card className="w-full max-w-[420px] items-stretch border-border bg-card p-4 text-center">
        <div className="inline-flex self-start items-center gap-2 text-[13px] font-semibold tracking-[0.01em] text-foreground">
          <img
            src="/logo/sway.svg"
            alt="Sway Router"
            className="h-6 w-6 rounded-md object-contain"
          />
          <span>Sway Router</span>
        </div>

        <div className="relative mt-7 self-center">
          <div
            className={
              isSuccess && providerIconSrc
                ? "flex h-14 w-14 items-center justify-center rounded-2xl border border-white/30 bg-white outline outline-1 outline-white/15 outline-offset-2"
                : `flex h-14 w-14 items-center justify-center rounded-2xl border ${
                  isError
                    ? "border-destructive/35 bg-destructive/10 text-destructive"
                    : isSuccess
                      ? "border-success/35 bg-success/10 text-success"
                      : "border-primary/35 bg-primary/10 text-primary"
                  }`
            }
            aria-label={isSuccess ? providerLabel : undefined}
          >
            {isSuccess && providerIconSrc ? (
              <img
                src={providerIconSrc}
                alt={providerLabel}
                className="h-8 w-8 object-contain invert"
              />
            ) : isSuccess ? (
              <AnimatedCheckMark className="h-7 w-7" />
            ) : isError ? (
              <CircleAlert className="h-7 w-7" aria-hidden="true" />
            ) : (
              <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
            )}
          </div>
          {isSuccess && providerIconSrc ? (
            <span className="absolute -bottom-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-card bg-[#16a34a] text-white">
              <AnimatedCheckMark className="h-4.5 w-4.5" />
            </span>
          ) : null}
        </div>

        <CardTitle className="mt-5 text-[21px] leading-tight tracking-[-0.02em]">
          {title}
        </CardTitle>
        {!isSuccess ? (
          <p className="mt-2.5 text-sm leading-6 text-muted-foreground">{message}</p>
        ) : null}

        <div className="mt-5 inline-flex self-center items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1.5 text-[11px] leading-none text-foreground">
          <span
            className={`relative top-px h-1.5 w-1.5 shrink-0 rounded-full ${
              isError ? "bg-destructive" : isSuccess ? "bg-success" : "bg-primary"
            }`}
            aria-hidden="true"
          />
          <span className="leading-4">OAuth Success</span>
        </div>

        <p className="mt-4 text-xs leading-5 text-muted-foreground/70">
          {isSuccess
            ? "You can close this window manually."
            : "Return to the provider dialog to continue."}
        </p>
      </Card>
    </div>
  );
}
