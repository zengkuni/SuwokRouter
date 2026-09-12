"use client";

import type { ReactElement, ReactNode } from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "@/lib/utils";

type TooltipSide = "top" | "right" | "bottom" | "left";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <TooltipPrimitive.Provider delay={450} closeDelay={100}>{children}</TooltipPrimitive.Provider>;
}

export function Tooltip({
  label,
  children,
  side = "top",
  sideOffset = 8,
  disabled = false,
  className,
}: {
  label: ReactNode;
  children: ReactElement;
  side?: TooltipSide;
  sideOffset?: number;
  disabled?: boolean;
  className?: string;
}) {
  if (disabled || label == null || label === "") return children;

  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger
        render={children}
        delay={450}
        aria-label={typeof label === "string" ? label : undefined}
      />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner side={side} sideOffset={sideOffset} className="z-[100]">
          <TooltipPrimitive.Popup
            className={cn(
              "relative origin-[var(--transform-origin)] rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground transition-[opacity,transform] duration-150 ease-out",
              "data-ending-style:-translate-y-1 data-ending-style:opacity-0 data-starting-style:-translate-y-1 data-starting-style:opacity-0",
              className,
            )}
          >
            {label}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
