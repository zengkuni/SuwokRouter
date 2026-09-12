import { cn } from "@/lib/utils";

type Status = "healthy" | "degraded" | "down" | "unknown" | "active" | "inactive";

const colorMap: Record<Status, string> = {
  healthy: "bg-success",
  active: "bg-success",
  degraded: "bg-warning",
  down: "bg-destructive",
  inactive: "bg-muted-foreground",
  unknown: "bg-muted-foreground",
};

export function StatusDot({
  status = "unknown",
  className,
  pulse = true,
}: {
  status?: Status;
  className?: string;
  pulse?: boolean;
}) {
  return (
    <span className={cn("relative inline-flex h-2.5 w-2.5", className)}>
      {pulse && (status === "healthy" || status === "active") && (
        <span
          className={cn(
            "absolute inline-flex h-full w-full animate-ping rounded-full opacity-40",
            colorMap[status]
          )}
        />
      )}
      <span
        className={cn(
          "relative inline-flex h-2.5 w-2.5 rounded-full",
          colorMap[status]
        )}
      />
    </span>
  );
}
