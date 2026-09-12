import { Pencil, Plus, Trash2 } from "lucide-react";
import { ProviderBrandIcon } from "@/components/provider/ProviderBrandIcon";
import { RippleButton } from "@/components/animate/ripple-button";
import { StatusBadge } from "@/components/StatusBadge";
import { Tooltip } from "@/components/ui/tooltip";
import { FrameHeader } from "@/components/ui/frame";
import { type AvailableProvider, type Connection } from "@/lib/connections-api";
import { connectionCtaLabel } from "@/lib/providers-mock";
import { providerIcon } from "@/lib/providers";

type ProviderDetailHeaderProps = {
  selected: AvailableProvider;
  conns: Connection[];
  activeConns: Connection[];
  onEditCustom: () => void;
  onDeleteCustom: () => void;
  onAddConnection: () => void;
};

export function ProviderDetailHeader({
  selected,
  conns,
  activeConns,
  onEditCustom,
  onDeleteCustom,
  onAddConnection,
}: ProviderDetailHeaderProps) {
  return (
              <FrameHeader className="flex shrink-0 flex-row flex-wrap items-start justify-between gap-2 border-b border-border p-3 sm:gap-3 sm:p-5">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white p-1.5 outline outline-1 outline-white/30 outline-offset-2 sm:h-9 sm:w-9"
                  >
                    <ProviderBrandIcon
                      id={selected.id}
                      color="var(--background)"
                      size={24}
                      fallbackIcon={providerIcon(selected.id)}
                    />
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold sm:text-lg">
                      {selected.name}
                    </h2>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground sm:mt-1 sm:gap-2 sm:text-sm">
                      <span className="font-mono text-xs">
                        {selected.alias || selected.id}
                      </span>
                      {conns.length > 0 ? (
                        <StatusBadge tone="ok">Active</StatusBadge>
                      ) : (
                        <StatusBadge tone="muted">Idle</StatusBadge>
                      )}
                      <span>
                        {conns.length} connection
                        {conns.length === 1 ? "" : "s"}
                        {conns.filter((c) => c.healthStatus === "healthy").length > 0
                          ? ` · ${conns.filter((c) => c.healthStatus === "healthy").length} OK`
                          : ""}
                        {conns.filter((c) => c.healthStatus === "error").length > 0
                          ? ` · ${conns.filter((c) => c.healthStatus === "error").length} error${conns.filter((c) => c.healthStatus === "error").length === 1 ? "" : "s"}`
                          : ""}
                        {activeConns.length < conns.length
                          ? ` · ${conns.length - activeConns.length} off`
                          : ""}
                      </span>
                      {selected.isCustom && selected.baseUrl ? (
                        <span className="hidden truncate text-xs sm:inline">
                          {selected.baseUrl}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selected.isCustom ? (
                    <>
                      <Tooltip label="Edit custom provider">
                        <RippleButton
                          size="sm"
                          variant="outline"
                          className="px-2 sm:px-3"
                          aria-label="Edit custom provider"
                          onClick={onEditCustom}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Edit</span>
                        </RippleButton>
                      </Tooltip>
                      <Tooltip label="Remove custom provider">
                        <RippleButton
                          size="sm"
                          variant="destructive"
                          className="px-2 sm:px-3"
                          aria-label="Remove custom provider"
                          onClick={onDeleteCustom}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Remove</span>
                        </RippleButton>
                      </Tooltip>
                    </>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <RippleButton
                      size="sm"
                      className="px-2 sm:px-3"
                      onClick={onAddConnection}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">
                        {connectionCtaLabel(selected.authType, selected.noAuth)}
                      </span>
                      <span className="sm:hidden">Add</span>
                    </RippleButton>
                  </div>
                </div>
              </FrameHeader>
  );
}
