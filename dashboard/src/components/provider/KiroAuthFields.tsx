import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import type { KiroAuthMode } from "./auth-dialog-types";

export const KIRO_AUTH_OPTIONS: Array<{
  value: KiroAuthMode;
  label: string;
  mobileLabel: string;
  description: string;
}> = [
  {
    value: "builder-id",
    label: "Builder ID",
    mobileLabel: "Builder ID",
    description: "Personal AWS account",
  },
  {
    value: "iam",
    label: "AWS IAM",
    mobileLabel: "AWS IAM",
    description: "Enterprise AWS SSO",
  },
  {
    value: "api-key",
    label: "API Key",
    mobileLabel: "API Key",
    description: "Long-lived Kiro / CodeWhisperer key",
  },
  {
    value: "import-token",
    label: "Token",
    mobileLabel: "Token",
    description: "Paste a refresh token from Kiro",
  },
  {
    value: "cli-proxy",
    label: "CLIProxyAPI",
    mobileLabel: "CLI Proxy",
    description: "Paste auth JSON from CLIProxyAPI / Kiro",
  },
];

export function KiroAuthSelector({
  value,
  region,
  startUrl,
  onChange,
  onRegionChange,
  onStartUrlChange,
}: {
  value: KiroAuthMode;
  region: string;
  startUrl: string;
  onChange: (value: KiroAuthMode) => void;
  onRegionChange: (value: string) => void;
  onStartUrlChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Segmented
        size="sm"
        value={value}
        onChange={onChange}
        options={KIRO_AUTH_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
          mobileLabel: option.mobileLabel,
          hint: option.description,
        }))}
        className="w-full"
      />
      {value === "iam" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            placeholder="AWS region (default: us-east-1)"
            value={region}
            onChange={(event) => onRegionChange(event.target.value)}
          />
          <Input
            placeholder="AWS Start URL (https://...)"
            value={startUrl}
            onChange={(event) => onStartUrlChange(event.target.value)}
          />
        </div>
      ) : null}
    </div>
  );
}

export function KiroImportFields({
  mode,
  refreshToken,
  clientId,
  clientSecret,
  profileArn,
  cliProxyJson,
  onRefreshTokenChange,
  onClientIdChange,
  onClientSecretChange,
  onProfileArnChange,
  onCliProxyJsonChange,
}: {
  mode: KiroAuthMode;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  profileArn: string;
  cliProxyJson: string;
  onRefreshTokenChange: (value: string) => void;
  onClientIdChange: (value: string) => void;
  onClientSecretChange: (value: string) => void;
  onProfileArnChange: (value: string) => void;
  onCliProxyJsonChange: (value: string) => void;
}) {
  if (mode === "import-token") {
    return (
      <div className="space-y-2">
        <textarea
          className="min-h-28 w-full rounded-md border border-input bg-surface px-3 py-2 font-mono text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
          placeholder="Kiro refresh token (aorAAAAAG...)"
          value={refreshToken}
          onChange={(event) => onRefreshTokenChange(event.target.value)}
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            placeholder="Client ID (optional for IAM)"
            value={clientId}
            onChange={(event) => onClientIdChange(event.target.value)}
          />
          <Input
            type="password"
            placeholder="Client secret (optional for IAM)"
            value={clientSecret}
            onChange={(event) => onClientSecretChange(event.target.value)}
          />
        </div>
        <Input
          placeholder="Profile ARN (optional)"
          value={profileArn}
          onChange={(event) => onProfileArnChange(event.target.value)}
        />
      </div>
    );
  }

  if (mode === "cli-proxy") {
    return (
      <textarea
        className="min-h-36 w-full rounded-md border border-input bg-surface px-3 py-2 font-mono text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
        placeholder="Paste CLIProxyAPI Kiro auth JSON…"
        value={cliProxyJson}
        onChange={(event) => onCliProxyJsonChange(event.target.value)}
      />
    );
  }

  return null;
}

export function KiroRegionField({
  region,
  onChange,
}: {
  region: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      placeholder="AWS region (default: us-east-1)"
      value={region}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
