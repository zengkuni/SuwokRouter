import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CircleAlert,
  FileJson,
  FolderSearch,
  Loader2,
} from "lucide-react";
import { RippleButton } from "@/components/animate/ripple-button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/api";
import {
  DEFAULT_NINE_ROUTER_MIGRATION_OPTIONS,
  fetchNineRouterDetection,
  migrateFromNineRouter,
  previewNineRouterMigration,
  type NineRouterMigrationOptions,
  type NineRouterMigrationPreview,
  type NineRouterMigrationSource,
} from "@/lib/nine-router-migration-api";

type MigrationView =
  | "configure"
  | "previewing"
  | "preview"
  | "migrating"
  | "ready"
  | "error";
type MigrationStep = "analyzing" | "migrating" | "refreshing" | "done";

const MIGRATION_STEPS: Array<{
  key: MigrationStep;
  label: string;
  description: string;
}> = [
  {
    key: "analyzing",
    label: "Analyze source",
    description: "Validate 9Router data and resolve conflicts.",
  },
  {
    key: "migrating",
    label: "Back up and migrate",
    description: "Create a safety backup, then import the selected data.",
  },
  {
    key: "refreshing",
    label: "Refresh dashboard",
    description: "Reload providers, models, combos, and settings.",
  },
  {
    key: "done",
    label: "Done",
    description: "The migrated data is ready to review.",
  },
];

const OPTION_ROWS: Array<{
  key: keyof NineRouterMigrationOptions;
  label: string;
  description: string;
}> = [
  {
    key: "providerAccounts",
    label: "Provider accounts and credentials",
    description: "Compatible provider logins, tokens, and API keys.",
  },
  {
    key: "customProviders",
    label: "Custom providers",
    description: "Compatible OpenAI, Anthropic, and embedding endpoints.",
  },
  {
    key: "customModels",
    label: "Custom models",
    description: "Models whose provider is available after migration.",
  },
  {
    key: "combos",
    label: "Combos",
    description: "Combo routes with compatible model references.",
  },
  {
    key: "routingSettings",
    label: "Routing settings",
    description: "Provider and combo routing behavior. Off by default.",
  },
  {
    key: "activateAccounts",
    label: "Activate imported accounts immediately",
    description: "Leave off to review accounts before routing traffic.",
  },
];

const SECTION_LABELS: Record<
  keyof NineRouterMigrationPreview["sections"],
  string
> = {
  providerAccounts: "Provider accounts",
  customProviders: "Custom providers",
  customModels: "Custom models",
  combos: "Combos",
  routingSettings: "Routing settings",
};

const WARNING_TITLES: Record<string, string> = {
  ACCOUNT_PROVIDER_UNAVAILABLE: "Some accounts skipped",
  EMPTY_COMBO: "Some combos skipped",
  ORPHAN_CUSTOM_MODEL: "Some custom models skipped",
  UNSUPPORTED_ACCOUNT_PROVIDER: "Some accounts skipped",
  UNSUPPORTED_CUSTOM_PROVIDER: "Some providers skipped",
};

const REFRESH_QUERY_KEYS = [
  "settings",
  "providers",
  "providers-available",
  "nodes",
  "custom-models",
  "combos",
] as const;

function isBusy(view: MigrationView) {
  return view === "previewing" || view === "migrating";
}

export function NineRouterMigrationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<NineRouterMigrationSource>("local");
  const [file, setFile] = useState<File | null>(null);
  const [options, setOptions] = useState<NineRouterMigrationOptions>({
    ...DEFAULT_NINE_ROUTER_MIGRATION_OPTIONS,
  });
  const [view, setView] = useState<MigrationView>("configure");
  const [preview, setPreview] = useState<NineRouterMigrationPreview | null>(null);
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<MigrationStep>("analyzing");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const detectionQuery = useQuery({
    queryKey: ["nine-router-detection"],
    queryFn: fetchNineRouterDetection,
    enabled: open,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!open) return;
    const detection = detectionQuery.data;
    if (detection && !detection.available && source === "local") setSource("json");
  }, [detectionQuery.data, open, source]);

  useEffect(() => {
    if (open) return;
    setSource("local");
    setFile(null);
    setOptions({ ...DEFAULT_NINE_ROUTER_MIGRATION_OPTIONS });
    setView("configure");
    setPreview(null);
    setPassword("");
    setStep("analyzing");
    setMessage("");
    setError("");
    if (fileRef.current) fileRef.current.value = "";
  }, [open]);

  function updateOption(key: keyof NineRouterMigrationOptions, checked: boolean) {
    setOptions((current) => {
      const next = { ...current, [key]: checked };
      if (key === "customModels" && checked) next.customProviders = true;
      if (key === "customProviders" && !checked) next.customModels = false;
      return next;
    });
  }

  function chooseSource(next: NineRouterMigrationSource) {
    if (isBusy(view)) return;
    setSource(next);
    setPreview(null);
    setError("");
    setView("configure");
  }

  const hasSelectedData = options.providerAccounts
    || options.customProviders
    || options.customModels
    || options.combos
    || options.routingSettings;
  const canPreview = hasSelectedData && (
    source === "local" ? detectionQuery.data?.available === true : Boolean(file)
  );

  async function runPreview() {
    if (!canPreview || isBusy(view)) return;
    setView("previewing");
    setStep("analyzing");
    setMessage("Checking compatibility and resolving conflicts…");
    setError("");
    try {
      const result = await previewNineRouterMigration({ source, file, options });
      setOptions(result.options);
      setPreview(result);
      setMessage("");
      setView("preview");
    } catch (caught) {
      const nextError = getErrorMessage(caught, "Could not analyze the 9Router data");
      setError(nextError);
      setMessage(nextError);
      setView("configure");
      toast.error(nextError);
    }
  }

  async function runMigration() {
    if (!preview || preview.totalReady < 1 || !password.trim() || isBusy(view)) return;
    setView("migrating");
    setStep("migrating");
    setMessage("Creating a safety backup and importing selected data…");
    setError("");
    try {
      const result = await migrateFromNineRouter({ source, file, options, password });
      if (!result.success) throw new Error(result.message || "Migration failed");
      setStep("refreshing");
      setMessage("Refreshing dashboard data…");
      await Promise.all(
        REFRESH_QUERY_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey: [queryKey] })),
      );
      setPassword("");
      setStep("done");
      setMessage(result.message || "9Router data migrated successfully.");
      setView("ready");
      toast.success(result.message || "Migration complete");
    } catch (caught) {
      const nextError = getErrorMessage(caught, "9Router migration failed");
      setError(nextError);
      setMessage(nextError);
      setView("error");
      toast.error(nextError);
    }
  }

  const activeIndex = MIGRATION_STEPS.findIndex((item) => item.key === step);
  const showProgress = view === "previewing" || view === "migrating" || view === "ready" || view === "error";
  const localAvailable = detectionQuery.data?.available === true;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isBusy(view)) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-2xl" showCloseButton={!isBusy(view)}>
        <DialogHeader>
          <DialogTitle>
            {view === "preview"
              ? "Migration preview"
              : view === "ready"
                ? "Migration complete"
                : view === "error"
                  ? "Migration needs attention"
                  : "Migrate from 9Router"}
          </DialogTitle>
          <DialogDescription>
            {view === "configure"
              ? "Choose a source and what you want to bring into Sway Router. Existing Sway Router data stays in place."
              : view === "preview"
                ? "Review what will be added before making any changes."
                : view === "ready"
                  ? "A safety backup was created before your selected data was imported."
                  : view === "error"
                    ? "No partial migration was kept. Review the error and try again."
                    : "Keep this window open while Sway Router checks and migrates the data."}
          </DialogDescription>
        </DialogHeader>

        {view === "configure" ? (
          <>
            <DialogPanel className="space-y-5">
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  aria-pressed={source === "local"}
                  disabled={detectionQuery.isLoading || !localAvailable}
                  onClick={() => chooseSource("local")}
                  className={`flex min-h-20 items-start gap-3 rounded-xl border p-3 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
                    source === "local"
                      ? "border-primary/60 bg-primary/10"
                      : "border-border bg-surface hover:bg-muted/60"
                  }`}
                >
                  {detectionQuery.isLoading ? (
                    <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
                  ) : (
                    <FolderSearch className="mt-0.5 size-4 shrink-0" />
                  )}
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">Local installation</span>
                    <span className="mt-0.5 block break-all text-xs text-muted-foreground">
                      {detectionQuery.isLoading
                        ? "Looking for 9Router…"
                        : localAvailable
                          ? detectionQuery.data?.location || "9Router database found"
                          : detectionQuery.data?.localOnly
                            ? "Only available on the router machine"
                            : "No local database found"}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-pressed={source === "json"}
                  onClick={() => chooseSource("json")}
                  className={`flex min-h-20 items-start gap-3 rounded-xl border p-3 text-left transition-colors duration-150 ${
                    source === "json"
                      ? "border-primary/60 bg-primary/10"
                      : "border-border bg-surface hover:bg-muted/60"
                  }`}
                >
                  <FileJson className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">9Router JSON backup</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      Use an exported backup from this or another device.
                    </span>
                  </span>
                </button>
              </div>

              {source === "json" ? (
                <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{file?.name || "No file selected"}</p>
                    <p className="text-xs text-muted-foreground">Choose a 9Router JSON export.</p>
                  </div>
                  <RippleButton size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                    Choose JSON
                  </RippleButton>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={(event) => {
                      const nextFile = event.target.files?.[0] || null;
                      setFile(nextFile);
                      setError("");
                    }}
                  />
                </div>
              ) : null}

              <div className="space-y-2">
                {OPTION_ROWS.map((option) => {
                  const dependencyLocked = option.key === "customProviders" && options.customModels;
                  return (
                    <label
                      key={option.key}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 p-3 transition-colors duration-150 hover:bg-muted/40"
                    >
                      <Checkbox
                        checked={options[option.key]}
                        disabled={dependencyLocked}
                        onCheckedChange={(checked) => updateOption(option.key, checked === true)}
                        aria-label={option.label}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{option.label}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {dependencyLocked
                            ? "Required while Custom models is selected."
                            : option.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>

              {error ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </p>
              ) : null}
            </DialogPanel>
            <DialogFooter>
              <RippleButton variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </RippleButton>
              <RippleButton onClick={() => void runPreview()} disabled={!canPreview}>
                Preview migration
              </RippleButton>
            </DialogFooter>
          </>
        ) : view === "preview" && preview ? (
          <>
            <DialogPanel className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(Object.entries(preview.sections) as Array<[
                  keyof NineRouterMigrationPreview["sections"],
                  NineRouterMigrationPreview["sections"][keyof NineRouterMigrationPreview["sections"]],
                ]>).map(([key, section]) => (
                  <div key={key} className="rounded-xl border border-border bg-surface p-3.5">
                    <p className="truncate text-xs font-medium text-muted-foreground">{SECTION_LABELS[key]}</p>
                    <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
                      {section.ready.toLocaleString()}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">ready to import</p>
                    <div className="mt-2 flex min-h-5 flex-wrap gap-1.5 text-[10px]">
                      {section.resolved ? (
                        <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-primary">
                          {section.resolved.toLocaleString()} handled
                        </span>
                      ) : null}
                      {section.duplicates ? (
                        <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-muted-foreground">
                          {section.duplicates.toLocaleString()} already here
                        </span>
                      ) : null}
                      {section.skipped ? (
                        <span className="rounded-full border border-warning/25 bg-warning/10 px-2 py-0.5 text-warning-foreground">
                          {section.skipped.toLocaleString()} skipped
                        </span>
                      ) : null}
                      {!section.resolved && !section.duplicates && !section.skipped ? (
                        <span className="text-muted-foreground">All clear</span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>

              {preview.warnings.length > 0 ? (
                <div className="space-y-2 rounded-xl border border-warning/30 bg-warning/10 p-3">
                  {preview.warnings.map((warning) => (
                    <div key={warning.code} className="flex items-start gap-3 rounded-lg border border-warning/20 bg-background/20 p-2.5 text-warning-foreground">
                      <CircleAlert className="mt-0.5 size-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                          <p className="text-xs font-medium">
                            {WARNING_TITLES[warning.code] || "Import note"}
                          </p>
                          <span className="text-[10px] font-medium uppercase tracking-wide text-warning-foreground/75">
                            {warning.count.toLocaleString()} affected
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-warning-foreground/85">{warning.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              <label className="block space-y-1.5">
                <span className="text-xs text-muted-foreground">Dashboard password</span>
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="Enter password to confirm"
                />
              </label>
              <p className="text-xs text-muted-foreground">
                Imported accounts stay inactive unless you selected immediate activation. Existing Sway Router data will not be replaced.
              </p>
            </DialogPanel>
            <DialogFooter>
              <RippleButton
                variant="outline"
                onClick={() => {
                  setPassword("");
                  setView("configure");
                }}
              >
                Back
              </RippleButton>
              <RippleButton
                onClick={() => void runMigration()}
                disabled={!password.trim() || preview.totalReady < 1}
              >
                Migrate {preview.totalReady.toLocaleString()} items
              </RippleButton>
            </DialogFooter>
          </>
        ) : showProgress ? (
          <>
            <DialogPanel className="space-y-4">
              <div className="space-y-3" aria-live="polite">
                {MIGRATION_STEPS.map((item, index) => {
                  const complete = view === "ready" || index < activeIndex;
                  const failed = view === "error" && index === activeIndex;
                  const current = (view === "previewing" || view === "migrating") && index === activeIndex;
                  return (
                    <div key={item.key} className="flex gap-3">
                      <div
                        className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors duration-150 ${
                          complete
                            ? "border-success/40 bg-success/12 text-success"
                            : failed
                              ? "border-destructive/40 bg-destructive/12 text-destructive"
                              : current
                                ? "border-primary/50 bg-primary/12 text-primary"
                                : "border-border bg-surface text-muted-foreground"
                        }`}
                      >
                        {complete ? (
                          <Check className="size-4" />
                        ) : failed ? (
                          <CircleAlert className="size-4" />
                        ) : current ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <span className="size-1.5 rounded-full bg-current opacity-60" />
                        )}
                      </div>
                      <div className="min-w-0 pt-0.5">
                        <p className="text-sm font-medium">{item.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {failed ? error : current ? message : item.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div
                className={`rounded-lg border px-3 py-2 text-xs transition-colors duration-150 ${
                  view === "error"
                    ? "border-destructive/25 bg-destructive/8 text-destructive"
                    : view === "ready"
                      ? "border-success/25 bg-success/8 text-success"
                      : "border-border bg-surface text-muted-foreground"
                }`}
              >
                {message}
              </div>
            </DialogPanel>
            {!isBusy(view) ? (
              <DialogFooter>
                {view === "error" && preview ? (
                  <RippleButton
                    variant="outline"
                    onClick={() => {
                      setPassword("");
                      setView("preview");
                    }}
                  >
                    Back to preview
                  </RippleButton>
                ) : null}
                <RippleButton onClick={() => onOpenChange(false)}>
                  {view === "ready" ? "Done" : "Close"}
                </RippleButton>
              </DialogFooter>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
