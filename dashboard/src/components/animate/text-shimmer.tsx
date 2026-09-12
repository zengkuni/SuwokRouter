import { cn } from "@/lib/utils";

export function TextShimmer({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-block text-muted-foreground", className)}>
      {children}
    </span>
  );
}
