import { RippleButton } from "@/components/animate/ripple-button";
import { TextShimmer } from "@/components/animate/text-shimmer";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function ImportTokenFields({
  providerId,
  token,
  machineId,
  importing,
  message,
  hasError,
  onTokenChange,
  onMachineIdChange,
  onAutoImport,
}: {
  providerId: string;
  token: string;
  machineId: string;
  importing: boolean;
  message: string | null;
  hasError: boolean;
  onTokenChange: (value: string) => void;
  onMachineIdChange: (value: string) => void;
  onAutoImport: () => void | Promise<void>;
}) {
  return (
    <div className="space-y-2">
      {providerId === "cursor" ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <RippleButton
              size="sm"
              variant="outline"
              disabled={importing}
              onClick={() => void onAutoImport()}
            >
              {importing ? <TextShimmer>Detecting…</TextShimmer> : "Auto-detect from this device"}
            </RippleButton>
            <span className="text-[11px] text-muted-foreground">Reads Cursor&apos;s local state.vscdb</span>
          </div>
          {message ? (
            <p className={cn("text-xs", hasError ? "text-destructive" : "text-success")} role="status">
              {message}
            </p>
          ) : null}
        </div>
      ) : null}
      <textarea
        className="min-h-28 w-full rounded-md border border-input bg-surface px-3 py-2 font-mono text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
        placeholder="Access token…"
        value={token}
        onChange={(event) => onTokenChange(event.target.value)}
      />
      {providerId === "cursor" ? (
        <Input
          placeholder="Machine ID (cursorAuth machine id)"
          value={machineId}
          onChange={(event) => onMachineIdChange(event.target.value)}
        />
      ) : null}
    </div>
  );
}
