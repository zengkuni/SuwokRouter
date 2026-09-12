import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { RippleButton } from "@/components/animate/ripple-button";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";

export function CopyButton({
  value,
  className,
  label = "Copy",
  onCopy,
  iconOnly = false,
}: {
  value: string;
  className?: string;
  label?: string;
  onCopy?: () => void;
  iconOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      onCopy?.();
    } catch {

    }
  }

  return (
    <Tooltip label={copied ? "Copied" : label || "Copy"}>
      <RippleButton
        type="button"
        variant="outline"
        size="sm"
        onClick={handleCopy}
        className={cn(className)}
        aria-label={label || "Copy"}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {iconOnly ? null : copied ? "Copied" : label}
      </RippleButton>
    </Tooltip>
  );
}
