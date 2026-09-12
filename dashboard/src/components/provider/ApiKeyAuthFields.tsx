import { RippleButton } from "@/components/animate/ripple-button";
import { TextShimmer } from "@/components/animate/text-shimmer";
import { StatusBadge } from "@/components/StatusBadge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { KiroRegionField } from "./KiroAuthFields";

export function ApiKeyCredentialsFields({
  authLabel,
  apiKey,
  region,
  checking,
  keyValid,
  checkMsg,
  submitError,
  proxyPoolId,
  proxyOptions,
  showKiroRegion,
  onApiKeyChange,
  onRegionChange,
  onCheck,
  onProxyPoolChange,
}: {
  authLabel: string;
  apiKey: string;
  region: string;
  checking: boolean;
  keyValid: boolean | null;
  checkMsg: string | null;
  submitError: string | null;
  proxyPoolId: string;
  proxyOptions: Array<{ id: string; name: string }>;
  showKiroRegion: boolean;
  onApiKeyChange: (value: string) => void;
  onRegionChange: (value: string) => void;
  onCheck: () => void | Promise<void>;
  onProxyPoolChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      {showKiroRegion ? <KiroRegionField region={region} onChange={onRegionChange} /> : null}
      <label htmlFor="connection-api-key" className="text-xs font-medium text-muted-foreground">
        {authLabel}
      </label>
      <Input
        id="connection-api-key"
        type="password"
        placeholder="API Key"
        value={apiKey}
        aria-invalid={Boolean(submitError)}
        aria-describedby={submitError ? "connection-submit-error" : undefined}
        onChange={(event) => onApiKeyChange(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <RippleButton
          size="sm"
          variant="outline"
          disabled={!apiKey.trim() || checking}
          onClick={() => void onCheck()}
        >
          {checking ? <TextShimmer>Checking…</TextShimmer> : "Check"}
        </RippleButton>
        {keyValid === true ? (
          <StatusBadge tone="ok">Valid</StatusBadge>
        ) : keyValid === false ? (
          <StatusBadge tone="err">Invalid</StatusBadge>
        ) : (
          <span className="text-xs text-muted-foreground">Validate before add</span>
        )}
      </div>
      {checkMsg && keyValid === false ? (
        <p className={cn("text-xs", keyValid ? "text-success" : "text-destructive")}>
          {checkMsg}
        </p>
      ) : null}
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">Proxy pool</label>
        <Select value={proxyPoolId} onValueChange={(value) => onProxyPoolChange(value ?? "pool_none")}>
          <SelectTrigger className="w-full">
            <span className="truncate">
              {proxyOptions.find((pool) => pool.id === proxyPoolId)?.name ?? "None (direct)"}
            </span>
          </SelectTrigger>
          <SelectPopup>
            {proxyOptions.map((pool) => (
              <SelectItem key={pool.id} value={pool.id}>
                {pool.name}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
    </div>
  );
}
