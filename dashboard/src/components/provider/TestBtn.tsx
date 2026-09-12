import { Loader2 } from "lucide-react";
import { RippleButton } from "@/components/animate/ripple-button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function TestBtn({
  busy,
  onTest,
  onStop,
  label = "Test",
  disabled,
  compact,
}: {
  busy: boolean;
  onTest: () => void;
  onStop: () => void;
  label?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  if (busy) {
    return (
      <Tooltip label="Cancel test" disabled={!compact}>
        <RippleButton
          size="sm"
          variant="outline"
          onClick={onStop}
          aria-label={compact ? "Cancel test" : undefined}
          className={cn(compact && "h-7 w-7 p-0", !compact && "gap-1.5")}
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {!compact ? "Cancel" : null}
        </RippleButton>
      </Tooltip>
    );
  }
  return (
    <Tooltip label={label} disabled={!compact}>
      <RippleButton
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={onTest}
        aria-label={compact ? label : undefined}
        className={compact ? "h-7 px-2 text-[11px]" : undefined}
      >
        {label}
      </RippleButton>
    </Tooltip>
  );
}
