import { AnimatePresence, motion } from "motion/react";
import { Ban, Check, Copy, Pin, PinOff, Plus, Power, Trash2 } from "lucide-react";
import { RippleButton } from "@/components/animate/ripple-button";
import { StatusBadge } from "@/components/StatusBadge";
import { TestBtn } from "@/components/provider/TestBtn";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip } from "@/components/ui/tooltip";
import { TabsContent } from "@/components/ui/tabs";
import { type AvailableProvider } from "@/lib/connections-api";
import { trueModelCapabilities, type ModelRow } from "@/lib/model-capabilities";
import { cn } from "@/lib/utils";

type ModelTestResult = {
  ok: boolean;
  label: string;
  message: string;
};

type ProviderModelsPanelProps = {
  selected: AvailableProvider;
  visibleModels: ModelRow[];
  models: ModelRow[];
  modelNames: Map<string, string>;
  modelsLoading: boolean;
  modelsUnavailable: boolean;
  importingModels: boolean;
  testConnId: string | undefined;
  batchKind: "conn" | "model" | null;
  modelTestLock: boolean;
  testingModels: Set<string>;
  modelQuery: string;
  newModel: string;
  addingModel: boolean;
  modelResults: Record<string, ModelTestResult>;
  pinnedFor: string[];
  copied: string | null;
  onImportModels: () => void | Promise<void>;
  onTestAllModels: () => void | Promise<void>;
  onStopTests: () => void;
  onStopModel: (modelId: string) => void;
  onModelQueryChange: (value: string) => void;
  onNewModelChange: (value: string) => void;
  onAddModel: () => void | Promise<void>;
  onTogglePin: (modelId: string) => void;
  onCopyModelId: (modelId: string) => void | Promise<void>;
  onTestModel: (modelId: string, connectionId: string | undefined) => void | Promise<void>;
  onRemoveModel: (modelId: string) => void | Promise<void>;
  disabledModelIds: Set<string>;
  onToggleDisabled: (modelId: string) => void | Promise<void>;
};

export function ProviderModelsPanel({
  selected,
  visibleModels,
  models,
  modelNames,
  modelsLoading,
  modelsUnavailable,
  importingModels,
  testConnId,
  batchKind,
  modelTestLock,
  testingModels,
  modelQuery,
  newModel,
  addingModel,
  modelResults,
  pinnedFor,
  copied,
  onImportModels,
  onTestAllModels,
  onStopTests,
  onStopModel,
  onModelQueryChange,
  onNewModelChange,
  onAddModel,
  onTogglePin,
  onCopyModelId,
  onTestModel,
  onRemoveModel,
  disabledModelIds,
  onToggleDisabled,
}: ProviderModelsPanelProps) {
  return (
                  <TabsContent value="models" className="min-h-0 flex-1 basis-0">
                    <ScrollArea
                      overscrollContain
                      scrollFade
                      scrollbarGutter
                      className="h-full"
                    >
                    <div className="space-y-3 p-3 sm:p-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">
                          {visibleModels.length} models
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {selected.id === "codebuddy-cn" || selected.id === "codebuddy-intl" ? (
                            <span className="self-center text-xs text-muted-foreground">
                              Add models manually
                            </span>
                          ) : selected.id !== "qoder" ? (
                            <Tooltip label={testConnId ? "Fetch GET {base}/models with this connection’s key" : "Needs a connection (API key) on this provider — or set base URL on a custom node"}>
                              <RippleButton
                                size="sm"
                                variant="outline"
                                disabled={importingModels}
                                onClick={() => void onImportModels()}
                              >
                                {importingModels ? "Importing…" : "Import"}
                              </RippleButton>
                            </Tooltip>
                          ) : null}
                          {models.length > 0 ? (
                            <TestBtn

                              busy={batchKind === "model"}
                              label="Test all"
                              disabled={
                                !testConnId ||
                                modelTestLock ||
                                (batchKind !== null && batchKind !== "model") ||
                                (testingModels.size > 0 && batchKind !== "model")
                              }
                              onTest={() => void onTestAllModels()}
                              onStop={onStopTests}
                            />
                          ) : null}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Input
                          placeholder="Search models…"
                          value={modelQuery}
                          onChange={(e) => onModelQueryChange(e.target.value)}
                          className="min-w-0 flex-1"
                        />
                        <Input
                          placeholder="model-id"
                          value={newModel}
                          disabled={addingModel}
                          onChange={(e) => onNewModelChange(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            void onAddModel();
                          }}
                          className="min-w-0 flex-1"
                        />
                        <RippleButton
                          size="sm"
                          variant="outline"
                          disabled={addingModel || !newModel.trim()}
                          onClick={() => void onAddModel()}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add
                        </RippleButton>
                      </div>
                      {modelsLoading ? (
                        <p className="text-sm text-muted-foreground">Loading models…</p>
                      ) : visibleModels.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          {modelQuery.trim()
                            ? "No models match your search."
                            : modelsUnavailable
                              ? "Upstream model catalog unavailable — add a slug above or retry."
                              : "No models — add a slug above."}
                        </p>
                      ) : (
                        <motion.div layout className="space-y-1">
                          {visibleModels.map((row) => {
                            const m = row.id;
                            const r = modelResults[m];
                            const checking = testingModels.has(m);
                            const capabilities = trueModelCapabilities(row.caps);

                            const busy = batchKind === "model" || checking;
                            const isPinned = pinnedFor.includes(m);
                            const isDisabled = disabledModelIds.has(m);
                            return (
                              <motion.div
                                key={m}
                                layout
                                transition={{
                                  layout: {
                                    type: "spring",
                                    stiffness: 520,
                                    damping: 36,
                                    mass: 0.4,
                                  },
                                }}
                                className={cn(
                                  "rounded-md border border-border bg-background px-2.5 py-2 hover:border-foreground/30",
                                  isDisabled && "border-warning/40 bg-warning/[0.03]",
                                )}
                              >
                                <div className="group flex flex-wrap items-center gap-1.5">
                                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                                    {modelNames.get(m) ? (
                                      <span className="min-w-0 max-w-[45%] truncate text-xs font-medium">
                                        {modelNames.get(m)}
                                      </span>
                                    ) : null}
                                    <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                                      {m}
                                    </code>
                                    {isDisabled ? <Badge size="sm" variant="warning">Disabled</Badge> : null}
                                    {checking || r ? (
                                      <div className="flex shrink-0 items-center gap-1">
                                        {checking ? (
                                          <span
                                            className="inline-flex items-center gap-0.5 text-[10px] text-foreground/90"
                                            aria-live="polite"
                                            aria-label={`Checking ${m}`}
                                          >
                                            <span>Checking</span>
                                            <span className="inline-flex w-3 justify-start" aria-hidden="true">
                                              <span className="animate-pulse">.</span>
                                              <span className="animate-pulse [animation-delay:150ms]">.</span>
                                              <span className="animate-pulse [animation-delay:300ms]">.</span>
                                            </span>
                                          </span>
                                        ) : null}
                                        {r ? (
                                          <Tooltip label={r.message || r.label}>
                                            <StatusBadge
                                              tone={r.ok ? "ok" : "err"}
                                              className="max-w-[9rem] truncate text-[10px]"
                                            >
                                              {r.label}
                                            </StatusBadge>
                                          </Tooltip>
                                        ) : null}
                                      </div>
                                    ) : null}
                                    {capabilities.length > 0 ? (
                                      <div
                                        className="order-last flex min-w-0 w-full shrink-0 flex-nowrap items-center gap-1 overflow-x-auto pb-0.5 sm:order-none sm:w-auto sm:flex-wrap sm:overflow-visible sm:pb-0"
                                        aria-label="Model capabilities"
                                      >
                                        {capabilities.map((capability) => (
                                          <Tooltip key={capability.key} label={capability.label}>
                                            <Badge
                                              size="sm"
                                              variant="outline"
                                              aria-label={capability.label}
                                              className="shrink-0"
                                            >
                                              {capability.label}
                                            </Badge>
                                          </Tooltip>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                  <div className="flex w-full shrink-0 items-center justify-end gap-1 border-t border-border/60 pt-1.5 sm:w-auto sm:justify-start sm:border-0 sm:pt-0">
                                    <Tooltip label={isPinned ? "Unpin" : "Pin to top"}>
                                      <button
                                        type="button"
                                        aria-label={isPinned ? "Unpin model" : "Pin model to top"}
                                        onClick={() => onTogglePin(m)}
                                        className={cn(
                                          "inline-flex h-7 w-7 items-center justify-center rounded-md border p-0 transition-colors duration-150",
                                          isPinned
                                            ? "border-transparent bg-white/15 text-foreground"
                                            : "border-transparent text-muted-foreground hover:border-border hover:bg-surface-hover hover:text-foreground"
                                        )}
                                      >
                                      <AnimatePresence initial={false} mode="wait">
                                        <motion.span
                                          key={isPinned ? "pinned" : "unpinned"}
                                          initial={{ opacity: 0, scale: 0.7, rotate: -18 }}
                                          animate={{ opacity: 1, scale: 1, rotate: 0 }}
                                          exit={{ opacity: 0, scale: 0.7, rotate: 18 }}
                                          transition={{ duration: 0.14 }}
                                          className="block"
                                        >
                                          {isPinned ? (
                                            <Pin className="h-3.5 w-3.5" />
                                          ) : (
                                            <PinOff className="h-3.5 w-3.5" />
                                          )}
                                        </motion.span>
                                      </AnimatePresence>
                                      </button>
                                    </Tooltip>
                                    <Tooltip label={copied === m ? "Copied" : "Copy model ID"}>
                                      <button
                                        type="button"
                                        aria-label="Copy model ID"
                                        className="inline-flex h-7 w-7 items-center justify-center rounded-md p-0 text-muted-foreground transition-colors duration-100 hover:bg-surface-hover hover:text-foreground"
                                        onClick={() => void onCopyModelId(m)}
                                      >
                                      {copied === m ? (
                                        <Check className="h-3.5 w-3.5" />
                                      ) : (
                                        <Copy className="h-3.5 w-3.5" />
                                      )}
                                      </button>
                                    </Tooltip>
                                    <Tooltip label={isDisabled ? "Enable routing for model" : "Disable routing for model"}>
                                      <button
                                        type="button"
                                        aria-label={isDisabled ? "Enable routing for model" : "Disable routing for model"}
                                        aria-pressed={isDisabled}
                                        onClick={() => void onToggleDisabled(m)}
                                        className={cn(
                                          "inline-flex h-7 w-7 items-center justify-center rounded-md p-0 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground",
                                          isDisabled && "text-warning hover:text-warning",
                                        )}
                                      >
                                        {isDisabled ? <Power className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                                      </button>
                                    </Tooltip>
                                    <span className="sm:hidden">
                                      <TestBtn
                                        compact
                                        busy={busy}
                                        disabled={
                                          !testConnId ||
                                          modelTestLock ||
                                          batchKind === "conn" ||
                                          (!checking && testingModels.size >= 4)
                                        }
                                        onTest={() =>
                                          void onTestModel(m, testConnId)
                                        }
                                        onStop={() =>
                                          batchKind === "model"
                                            ? onStopTests()
                                            : onStopModel(m)
                                        }
                                      />
                                    </span>
                                    <span className="hidden sm:inline-flex">
                                      <TestBtn
                                        busy={busy}
                                        disabled={
                                          !testConnId ||
                                          modelTestLock ||
                                          batchKind === "conn" ||
                                          (!checking && testingModels.size >= 4)
                                        }
                                        onTest={() =>
                                          void onTestModel(m, testConnId)
                                        }
                                        onStop={() =>
                                          batchKind === "model"
                                            ? onStopTests()
                                            : onStopModel(m)
                                        }
                                      />
                                    </span>
                                    <Tooltip label="Remove">
                                      <button
                                        type="button"
                                        aria-label="Remove model"
                                        className="inline-flex h-7 w-7 items-center justify-center rounded-md p-0 text-muted-foreground transition-colors duration-100 hover:bg-surface-hover hover:text-destructive"
                                        onClick={() => void onRemoveModel(m)}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </Tooltip>
                                  </div>
                                </div>
                              </motion.div>
                            );
                          })}
                        </motion.div>
                      )}
                    </div>
                    </ScrollArea>
                  </TabsContent>
  );
}
