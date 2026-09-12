import { AnimatePresence, motion } from "motion/react";
import { Check, Loader2, X } from "lucide-react";
import { RippleButton } from "@/components/animate/ripple-button";
import { TextShimmer } from "@/components/animate/text-shimmer";
import { StatusBadge } from "@/components/StatusBadge";
import type { CodeBuddyTokenRow } from "./auth-dialog-types";

export function CodeBuddyTokenFields({
  raw,
  rows,
  activeIndex,
  activeRow,
  onRawChange,
  onCheck,
  validCount,
  checking,
}: {
  raw: string;
  rows: CodeBuddyTokenRow[];
  activeIndex: number | null;
  activeRow: CodeBuddyTokenRow | null;
  onRawChange: (value: string) => void;
  onCheck: () => void | Promise<void>;
  validCount: number;
  checking: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        One account per line. Supported formats: <code>accessToken</code>, <code>refreshToken</code>, or <code>accessToken|refreshToken</code>. A single token is detected automatically. Multiple accounts receive automatic names.
      </p>
      <div className="space-y-1.5">
        <label htmlFor="codebuddy-token" className="text-xs font-medium text-muted-foreground">
          Access / Refresh Tokens
        </label>
        <textarea
          id="codebuddy-token"
          className="min-h-36 w-full resize-y overflow-x-auto whitespace-pre rounded-md border border-input bg-surface px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder={"access-token-1\nrefresh-token-2\naccess-token-3|refresh-token-3"}
          value={raw}
          autoComplete="off"
          spellCheck={false}
          wrap="off"
          onChange={(event) => onRawChange(event.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <RippleButton
          size="sm"
          variant="outline"
          disabled={!raw.trim() || checking}
          onClick={() => void onCheck()}
        >
          {checking ? <TextShimmer>Checking…</TextShimmer> : "Check all"}
        </RippleButton>
      </div>
      {checking && activeRow ? (
        <div className="overflow-hidden px-1" role="status" aria-live="polite">
          <AnimatePresence initial={false} mode="wait">
            <motion.div
              key={`${activeIndex}-${activeRow.checking ? "checking" : activeRow.valid === true ? "valid" : "error"}`}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
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
              <span className="min-w-0 flex-1 truncate">
                Account {(activeIndex ?? 0) + 1}
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
          <StatusBadge tone="ok">Valid: {validCount} account{validCount === 1 ? "" : "s"}</StatusBadge>
          <StatusBadge tone="err">
            Error: {rows.filter((row) => row.valid === false).length} account{rows.filter((row) => row.valid === false).length === 1 ? "" : "s"}
          </StatusBadge>
        </motion.div>
      ) : null}
      {!raw.trim() ? (
        <p className="text-xs text-muted-foreground" role="status">
          At least one access token or refresh token is required.
        </p>
      ) : null}
    </div>
  );
}
