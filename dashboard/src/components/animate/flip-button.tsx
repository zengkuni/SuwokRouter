import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";

export function FlipButton({
  active,
  onToggle,
  disabled,
  className,
  activeLabel: _activeLabel = "Active",
  inactiveLabel: _inactiveLabel = "Inactive",
}: {
  active: boolean;
  onToggle: () => void;
  disabled?: boolean;
  className?: string;
  activeLabel?: string;
  inactiveLabel?: string;
}) {
  void _activeLabel;
  void _inactiveLabel;

  return (
    <Tooltip label={active ? "On" : "Off"}>
      <button
        type="button"
        role="switch"
        aria-checked={active}
        aria-label={active ? "On" : "Off"}
        disabled={disabled}
        onClick={onToggle}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 touch-manipulation",
          "transition-colors duration-150 ease-out outline-none",
          "pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-6 pointer-coarse:after:min-w-6",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          active ? "bg-primary" : "bg-muted-foreground/30",
          disabled && "cursor-not-allowed opacity-50",
          !disabled && "cursor-pointer",
          className
        )}
      >
        <span
          className={cn(
            "pointer-events-none block h-4 w-4 rounded-full bg-white",
            "transition-transform duration-150 ease-out",
            active ? "translate-x-4" : "translate-x-0"
          )}
        />
      </button>
    </Tooltip>
  );
}
