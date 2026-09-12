import { Check, Copy } from "lucide-react";
import { RippleButton } from "@/components/animate/ripple-button";
import { Input } from "@/components/ui/input";

export function AuthLinkFields({
  isDeviceFlow,
  isOAuthFlow,
  isKiroIam,
  authLink,
  userCode,
  deviceStatus,
  deviceCode,
  bootLoading,
  linkCopied,
  oauthCode,
  kiroStartUrl,
  onStartKiroAuthorization,
  onOpenAuthLink,
  onCopyAuthLink,
  onOauthCodeChange,
}: {
  isDeviceFlow: boolean;
  isOAuthFlow: boolean;
  isKiroIam: boolean;
  authLink: string | null;
  userCode: string | null;
  deviceStatus: string | null;
  deviceCode: string | null;
  bootLoading: boolean;
  linkCopied: boolean;
  oauthCode: string;
  kiroStartUrl: string;
  onStartKiroAuthorization: () => void | Promise<void>;
  onOpenAuthLink: () => void;
  onCopyAuthLink: () => void | Promise<void>;
  onOauthCodeChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
      <p className="text-xs font-medium text-muted-foreground">
        {isDeviceFlow ? "Verification" : "Authorize"}
      </p>
      {authLink ? (
        <code className="block break-all rounded-md border border-border bg-background px-2.5 py-2 font-mono text-[11px] text-foreground">
          {authLink}
        </code>
      ) : (
        <p className="text-xs text-muted-foreground">No auth URL yet</p>
      )}
      {isDeviceFlow && userCode ? (
        <p className="text-sm">
          User code:{" "}
          <span className="font-mono text-base font-semibold tracking-wider text-foreground">{userCode}</span>
        </p>
      ) : null}
      {isDeviceFlow && deviceStatus ? (
        <p className="text-xs text-muted-foreground">{deviceStatus}</p>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-1">
        {isKiroIam && !deviceCode ? (
          <RippleButton
            size="sm"
            onClick={() => void onStartKiroAuthorization()}
            disabled={bootLoading || !kiroStartUrl.trim()}
          >
            Start authorization
          </RippleButton>
        ) : null}
        <RippleButton size="sm" onClick={onOpenAuthLink} disabled={!authLink}>
          Open in browser
        </RippleButton>
        <RippleButton size="sm" variant="outline" onClick={() => void onCopyAuthLink()} disabled={!authLink}>
          {linkCopied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy link
            </>
          )}
        </RippleButton>
      </div>
      {isOAuthFlow ? (
        <div className="space-y-1.5 pt-1">
          <label className="block text-xs text-muted-foreground">
            Fallback: paste the authorization code manually if needed
          </label>
          <Input
            className="font-mono text-xs"
            placeholder="code from /callback"
            value={oauthCode}
            onChange={(event) => onOauthCodeChange(event.target.value)}
          />
        </div>
      ) : null}
      <p className="text-[11px] text-muted-foreground">
        {isOAuthFlow
          ? "Open the link → finish sign-in. The callback auto-saves the connection and updates this dialog. Manual code paste is available if needed."
          : "Open the link, enter the user code, authorize — this dialog polls automatically."}
      </p>
    </div>
  );
}
