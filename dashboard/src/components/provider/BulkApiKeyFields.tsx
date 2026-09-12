import { AnimatePresence, motion } from "motion/react";
import { Check, Loader2, X } from "lucide-react";
import { RippleButton } from "@/components/animate/ripple-button";
import { StatusBadge } from "@/components/StatusBadge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BulkKeyRow } from "./auth-dialog-types";

export function ApiKeyEntryTabs({
  value,
  onChange,
}: {
  value: "single" | "bulk";
  onChange: (value: "single" | "bulk") => void;
}) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as "single" | "bulk")}>
      <TabsList className="w-full">
        <TabsTrigger value="single" className="flex-1">
          Single API Key
        </TabsTrigger>
        <TabsTrigger value="bulk" className="flex-1">
          Bulk API Key
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

export function BulkApiKeyFields({
  raw,
  rows,
  activeIndex,
  activeRow,
  checking,
  validCount,
  onRawChange,
  onCheck,
}: {
  raw: string;
  rows: BulkKeyRow[];
  activeIndex: number | null;
  activeRow: BulkKeyRow | null;
  checking: boolean;
  validCount: number;
  onRawChange: (value: string) => void;
  onCheck: () => void | Promise<void>;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        1 key per line; optionally use <code>name|key</code>. Unnamed rows receive <code>swayrouter-account1…N</code> automatically.
      </p>
      <textarea
        id="bulk-api-keys"
        className="min-h-36 w-full rounded-md border border-input bg-surface px-3 py-2 font-mono text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-xs"
        placeholder={"name|sk-1\nsk-2"}
        value={raw}
        onChange={(event) => onRawChange(event.target.value)}
      />
      {checking && activeRow ? (
        <div className="overflow-hidden px-1" role="status" aria-live="polite">
          <AnimatePresence initial={false} mode="wait">
            <motion.div
              key={`${activeIndex}-${activeRow.checking ? "checking" : activeRow.valid === true ? "valid" : "error"}`}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: 0.32, ease: "easeOut" }}
              className="flex min-h-8 items-center gap-2 px-2 py-1 text-xs"
            >
              {activeRow.checking ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
              ) : activeRow.valid === true ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-success" />
              ) : (
                <X className="h-3.5 w-3.5 shrink-0 text-destructive" />
              )}
              <span className="shrink-0 font-medium">
                {activeRow.checking ? "Checking" : activeRow.valid === true ? "Valid" : "Error"}
              </span>
              <span className="min-w-0 truncate font-medium">{activeRow.name}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
                {activeRow.apiKey.slice(0, 14)}…
              </span>
              <span className="shrink-0 text-muted-foreground">
                {(activeIndex ?? 0) + 1} / {rows.length}
              </span>
            </motion.div>
          </AnimatePresence>
        </div>
      ) : !checking && rows.length > 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="flex flex-wrap items-center gap-2 px-0 py-0 text-xs"
          role="status"
          aria-live="polite"
        >
          <StatusBadge tone="ok">Valid: {validCount} API Key</StatusBadge>
          <StatusBadge tone="err">
            Error: {rows.filter((row) => row.valid === false).length} API Key
          </StatusBadge>
        </motion.div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <RippleButton
          size="sm"
          variant="outline"
          disabled={!raw.trim() || checking}
          onClick={() => void onCheck()}
        >
          {checking ? (
            <span className="inline-flex items-center gap-0.5">
              <span>Checking</span>
              <span className="inline-flex w-3 justify-start" aria-hidden="true">
                <span className="animate-pulse">.</span>
                <span className="animate-pulse [animation-delay:150ms]">.</span>
                <span className="animate-pulse [animation-delay:300ms]">.</span>
              </span>
            </span>
          ) : (
            "Check all"
          )}
        </RippleButton>
      </div>
    </div>
  );
}
