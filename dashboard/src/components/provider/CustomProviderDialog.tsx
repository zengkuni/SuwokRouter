import { useEffect, useState } from "react";
import { RippleButton } from "@/components/animate/ripple-button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { getErrorMessage } from "@/lib/api";
import { type AvailableProvider } from "@/lib/connections-api";

export function CustomProviderDialog({
  open,
  onOpenChange,
  onCreate,
  initial,
  submitLabel = "Create",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: AvailableProvider | null;
  submitLabel?: string;
  onCreate: (body: {
    name: string;
    prefix: string;
    baseUrl?: string;
    type: "openai-compatible" | "anthropic-compatible";
    apiType?: "chat" | "responses";
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [kind, setKind] = useState<"openai-compatible" | "anthropic-compatible">(
    "openai-compatible"
  );
  const [apiType, setApiType] = useState<"chat" | "responses">("chat");

  useEffect(() => {
    if (!open || !initial) return;
    setName(initial.name || "");
    setPrefix(initial.alias || "");
    setBaseUrl(initial.baseUrl || "");
    setKind(initial.nodeType === "anthropic-compatible" ? "anthropic-compatible" : "openai-compatible");
    setApiType(initial.apiType === "responses" ? "responses" : "chat");
    setError(null);
    setLoading(false);
  }, [open, initial]);

  const isEditing = Boolean(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initial) return;
    setName("");
    setPrefix("");
    setBaseUrl("");
    setKind("openai-compatible");
    setApiType("chat");
    setError(null);
    setLoading(false);
  }, [open, initial]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit custom provider" : "Custom provider"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 px-6 pb-4">
          <div className="space-y-1.5">
            <label htmlFor="custom-provider-name" className="text-xs font-medium text-muted-foreground">
              Name
            </label>
            <Input
              id="custom-provider-name"
              placeholder="My provider"
              value={name}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "custom-provider-error" : undefined}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="custom-provider-prefix" className="text-xs font-medium text-muted-foreground">
              Prefix
            </label>
            <Input
              id="custom-provider-prefix"
              placeholder="my-llm"
              value={prefix}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "custom-provider-error" : undefined}
              onChange={(e) => {
                setPrefix(e.target.value);
                setError(null);
              }}
            />
            <p className="text-[10px] text-muted-foreground/70">
              Must be unique across custom providers.
            </p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="custom-provider-base-url" className="text-xs font-medium text-muted-foreground">
              Base URL
            </label>
            <Input
              id="custom-provider-base-url"
              placeholder="https://api.example.com/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">API format</p>
            <Segmented
              size="sm"
              value={kind}
              onChange={setKind}
              options={[
                { value: "openai-compatible", label: "OpenAI" },
                { value: "anthropic-compatible", label: "Claude" },
              ]}
            />
          </div>
          {kind === "openai-compatible" ? (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                Endpoint style (OpenAI only)
              </p>
              <Segmented
                size="sm"
                value={apiType}
                onChange={setApiType}
                options={[
                  { value: "chat", label: "Chat" },
                  { value: "responses", label: "Responses" },
                ]}
              />
            </div>
          ) : (
            <p className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
              Claude-compatible nodes use the Messages API only — no Chat /
              Responses toggle (BACKEND custom nodes).
            </p>
          )}
          {error ? <p id="custom-provider-error" className="text-sm text-destructive" role="alert">{error}</p> : null}
        </div>
        <DialogFooter>
          <RippleButton variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </RippleButton>
          <RippleButton
            disabled={loading}
            onClick={() => {
              if (!name.trim() || !prefix.trim()) {
                setError("Name and prefix required");
                return;
              }
              setLoading(true);
              void onCreate({
                name: name.trim(),
                prefix: prefix.trim().toLowerCase().replace(/\s+/g, "-"),
                baseUrl: baseUrl.trim() || undefined,
                type: kind,
                apiType: kind === "openai-compatible" ? apiType : undefined,
              })
                .catch((submitError) => {
                  setError(getErrorMessage(submitError, "Failed to save custom provider"));
                })
                .finally(() => setLoading(false));
            }}
          >
            {submitLabel}
          </RippleButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
