import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { RippleButton } from "@/components/animate/ripple-button";
import { Field } from "@/components/provider/Field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { testConnection, type Connection } from "@/lib/connections-api";
import { getErrorMessage } from "@/lib/api";
import { resolveAuthFlow } from "@/lib/providers";
import { cn } from "@/lib/utils";

export function EditDialog({
  conn,
  onOpenChange,
  onSave,
}: {
  conn: Connection | null;
  onOpenChange: (o: boolean) => void;
  onSave: (name: string, newKey: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [testStatus, setTestStatus] = useState<{
    label: string;
    ok: boolean;
  } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (conn) {
      setName(conn.name || "");
      setNewKey("");
      setTestStatus(null);
    }
  }, [conn]);

  const authType = String(conn?.authType || "").trim().toLowerCase();
  const storedAuthMethod =
    typeof conn?.providerSpecificData?.authMethod === "string"
      ? conn.providerSpecificData.authMethod.trim().toLowerCase()
      : "";

  const effectiveAuthType = authType || storedAuthMethod;
  const inferredFlow = conn ? resolveAuthFlow(conn.provider) : "apikey";
  const isApiKeyConnection =
    effectiveAuthType === "apikey" ||
    effectiveAuthType === "api_key" ||
    effectiveAuthType === "api-key" ||
    (!effectiveAuthType && inferredFlow === "apikey");
  const authLabel =
    effectiveAuthType.includes("oauth") ||
    effectiveAuthType === "access_token" ||
    (!effectiveAuthType && (inferredFlow === "oauth" || inferredFlow === "device"))
      ? "OAuth"
      : effectiveAuthType.includes("cookie")
        ? "Cookie"
        : effectiveAuthType === "local" ||
            effectiveAuthType === "none" ||
            (!effectiveAuthType && inferredFlow === "local")
          ? "No authentication"
          : effectiveAuthType.includes("import") || effectiveAuthType === "imported"
            ? "Imported token"
            : isApiKeyConnection
              ? "API Key"
              : effectiveAuthType || "Managed credentials";

  async function onTestConnection() {
    if (!conn) return;
    setTesting(true);
    setTestStatus(null);
    try {
      const data = await testConnection(conn.id);
      const ok = data.valid === true;
      setTestStatus({
        label: ok ? "Active" : data.error || "Failed",
        ok,
      });
    } catch (err) {
      setTestStatus({ label: getErrorMessage(err, "Test failed"), ok: false });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Dialog open={Boolean(conn)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit connection</DialogTitle>
          <DialogDescription>{conn?.name || conn?.id?.slice(0, 8)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-6">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {isApiKeyConnection ? (
            <Field label="API Key" hint="Leave empty to keep current key">
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="sk-… or paste new key"
                  className="flex-1"
                />
                <RippleButton
                  size="sm"
                  variant="outline"
                  disabled={testing}
                  aria-busy={testing}
                  aria-label={testing ? "Testing connection" : "Test connection"}
                  className="min-w-14 justify-center"
                  onClick={() => void onTestConnection()}
                >
                  {testing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : "Test"}
                </RippleButton>
              </div>
              {testStatus ? (
                <p
                  className={cn(
                    "mt-1 text-[11px]",
                    testStatus.ok ? "text-success" : "text-destructive"
                  )}
                >
                  {testStatus.label}
                </p>
              ) : null}
            </Field>
          ) : (
            <Field label="Authentication">
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/25 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{authLabel}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Credentials are managed by this connection.
                  </p>
                </div>
                <RippleButton
                  size="sm"
                  variant="outline"
                  disabled={testing}
                  aria-busy={testing}
                  aria-label={testing ? "Testing connection" : "Test connection"}
                  className="min-w-14 justify-center"
                  onClick={() => void onTestConnection()}
                >
                  {testing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : "Test"}
                </RippleButton>
              </div>
              {testStatus ? (
                <p
                  className={cn(
                    "mt-1 text-[11px]",
                    testStatus.ok ? "text-success" : "text-destructive"
                  )}
                >
                  {testStatus.label}
                </p>
              ) : null}
            </Field>
          )}
        </div>
        <DialogFooter>
          <RippleButton variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </RippleButton>
          <RippleButton
            disabled={loading}
            onClick={() => {
              setLoading(true);
              void onSave(name.trim(), newKey).finally(() => setLoading(false));
            }}
          >
            Save
          </RippleButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
