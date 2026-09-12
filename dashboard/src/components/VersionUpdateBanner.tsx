import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/api";
import { fetchVersion, updateVersion, type VersionInfo } from "@/lib/version-api";
import { toast } from "@/components/ui/toast";

export function VersionUpdateBanner({ collapsed = false }: { collapsed?: boolean }) {
  const queryClient = useQueryClient();
  const versionQ = useQuery({
    queryKey: ["version"],
    queryFn: fetchVersion,
    retry: false,
    staleTime: 60 * 60 * 1000,
  });
  const updateM = useMutation({
    mutationFn: updateVersion,
    onSuccess: (result) => {
      queryClient.setQueryData<VersionInfo>(["version"], (current) =>
        current ? { ...current, updateAvailable: false } : current,
      );
      toast.success(result.message || "Update installed. Restart the router to apply it.");
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, "Update failed"));
    },
  });

  const version = versionQ.data;
  if (!version?.updateAvailable || !version.latestVersion || !version.updateSupported) return null;

  if (collapsed) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="mx-3 mb-2 rounded-lg border border-border bg-surface p-2.5"
      role="status"
      aria-label="Version update available"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Download className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-medium leading-tight">New version available</p>
        </div>
      </div>
      <Button
        size="sm"
        onClick={() => updateM.mutate()}
        loading={updateM.isPending}
        disabled={updateM.isPending}
        className="mt-2.5 w-full text-[11px] sm:text-[11px]"
      >
        {updateM.isPending ? "Updating…" : `Update to v${version.latestVersion}`}
      </Button>
    </motion.section>
  );
}
