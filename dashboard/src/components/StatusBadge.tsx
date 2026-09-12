"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function StatusBadge({
  tone,
  children,
  className,
  dotClassName,
  ...props
}: React.ComponentProps<typeof Badge> & {

  tone?: "ok" | "warn" | "err" | "muted";
  dotClassName?: string;
}) {
  const dot = cn(
    "size-1.5 rounded-full bg-muted-foreground/64",
    tone === "ok" && "bg-emerald-500",
    tone === "warn" && "bg-amber-500",
    tone === "err" && "bg-red-500",
    tone === "muted" && "bg-muted-foreground/64",
    dotClassName,
  );
  return (
    <Badge variant="outline" className={className} {...props}>
      <span aria-hidden="true" className={dot} />
      {children}
    </Badge>
  );
}
