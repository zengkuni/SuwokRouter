import { useState } from "react";
import { RippleButton } from "@/components/animate/ripple-button";
import { TextShimmer } from "@/components/animate/text-shimmer";
import { StatusBadge } from "@/components/StatusBadge";
import { Segmented } from "@/components/ui/segmented";
import { Input } from "@/components/ui/input";
import { sanitizeGrokSsoToken } from "@/lib/grok-sso";

type GrokSsoMode = "single" | "bulk";

export function GrokSsoFields({
  token,
  checking,
  validCount,
  hint,
  onTokenChange,
  onCheck,
}: {
  token: string;
  checking: boolean;
  validCount: number;
  hint?: string;
  onTokenChange: (value: string) => void;
  onCheck: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<GrokSsoMode>("single");
  const tokens = token
    .split(/\r?\n/)
    .map((line) => sanitizeGrokSsoToken(line))
    .filter(Boolean);

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {hint || "Import your sso= cookie value from grok.com — it is exchanged for Grok Build OAuth access and refresh tokens, and the account email is used to label the connection."}
      </p>
      <Segmented
        value={mode}
        onChange={(value) => setMode(value as GrokSsoMode)}
        options={[
          { value: "single", label: "SSO" },
          { value: "bulk", label: "Bulk SSO" },
        ]}
      />
      {mode === "single" ? (
        <div className="space-y-1.5">
          <label htmlFor="grok-sso-token" className="text-xs font-medium text-muted-foreground">
            SSO cookie
          </label>
          <Input
            id="grok-sso-token"
            className="h-10"
            placeholder="sso=… or the bare cookie value"
            value={tokens[0] ?? ""}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onTokenChange(event.target.value)}
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          <label htmlFor="grok-sso-bulk" className="text-xs font-medium text-muted-foreground">
            SSO cookies — one per line
          </label>
          <textarea
            id="grok-sso-bulk"
            className="min-h-28 w-full resize-y overflow-x-auto whitespace-pre rounded-md border border-input bg-surface px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder={"sso=<cookie-value-1>\n<bare-cookie-value-2>"}
            value={token}
            autoComplete="off"
            spellCheck={false}
            wrap="off"
            onChange={(event) => onTokenChange(event.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            {tokens.length > 0
              ? `${tokens.length} cookie${tokens.length === 1 ? "" : "s"} ready`
              : "Accepts sso=…, a bare token, or a whole cookie header."}
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <RippleButton
          size="sm"
          variant="outline"
          disabled={tokens.length === 0 || checking}
          onClick={() => void onCheck()}
        >
          {checking ? <TextShimmer className="text-xs">Checking…</TextShimmer> : "Check"}
        </RippleButton>
        {validCount > 0 ? <StatusBadge tone="ok">{validCount} valid</StatusBadge> : null}
      </div>
    </div>
  );
}
