import { RippleButton } from "@/components/animate/ripple-button";
import { TextShimmer } from "@/components/animate/text-shimmer";
import { StatusBadge } from "@/components/StatusBadge";
import { cn } from "@/lib/utils";

export function CodeBuddyTokenFields({
  token,
  onTokenChange,
  checking,
  tokenValid,
  checkMsg,
  onCheck,
}: {
  token: string;
  onTokenChange: (value: string) => void;
  checking: boolean;
  tokenValid: boolean | null;
  checkMsg: string | null;
  onCheck: () => void | Promise<void>;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Paste an access token or a refresh token. For automatic renewal, use a refresh token; it keeps the connection alive after the access token expires.
      </p>
      <div className="space-y-1.5">
        <label htmlFor="codebuddy-token" className="text-xs font-medium text-muted-foreground">
          Access or Refresh Token
        </label>
        <textarea
          id="codebuddy-token"
          className="min-h-20 w-full resize-y rounded-md border border-input bg-surface px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Paste an access token or refresh token…"
          value={token}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onTokenChange(event.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <RippleButton
          size="sm"
          variant="outline"
          disabled={!token.trim() || checking}
          onClick={() => void onCheck()}
        >
          {checking ? <TextShimmer>Checking…</TextShimmer> : "Check"}
        </RippleButton>
        {tokenValid === true ? (
          <StatusBadge tone="ok">Valid</StatusBadge>
        ) : tokenValid === false ? (
          <StatusBadge tone="err">Invalid</StatusBadge>
        ) : (
          <span className="text-xs text-muted-foreground">Validate before add</span>
        )}
      </div>
      {checkMsg && tokenValid === false ? (
        <p className={cn("text-xs", "text-destructive")} role="alert">
          {checkMsg}
        </p>
      ) : null}
      {!token.trim() ? (
        <p className="text-xs text-muted-foreground" role="status">
          An access token or refresh token is required.
        </p>
      ) : null}
    </div>
  );
}
