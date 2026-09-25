import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
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
  const [scrollTop, setScrollTop] = useState(0);
  const lineCount = Math.max(1, raw.split(/\r?\n/).length);

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        One account per line. Supported formats: <code>accessToken</code>, <code>refreshToken</code>, or <code>accessToken|refreshToken</code>. A single token is detected automatically. Multiple accounts receive automatic names.
      </p>
      <div className="space-y-1.5">
        <label htmlFor="codebuddy-token" className="text-xs font-medium text-muted-foreground">
          Access / Refresh Tokens
        </label>
        <div className="relative flex h-36 max-h-36 overflow-hidden rounded-md border border-input bg-surface focus-within:outline-none focus-within:ring-2 focus-within:ring-ring">
          <div
            aria-hidden="true"
            className="pointer-events-none h-36 w-10 shrink-0 overflow-hidden border-r border-border/70 bg-background/90 py-2 text-right font-mono text-xs leading-5 text-muted-foreground/75"
          >
            <div style={{ transform: `translateY(-${scrollTop}px)` }}>
              {Array.from({ length: lineCount }, (_, index) => (
                <div key={index} className="px-2">
                  {index + 1}
                </div>
              ))}
            </div>
          </div>
          <textarea
            id="codebuddy-token"
            className="h-36 max-h-36 min-h-36 min-w-0 flex-1 resize-none overflow-auto bg-transparent px-3 py-2 font-mono text-xs leading-5 text-foreground outline-none placeholder:text-muted-foreground/70"
            placeholder={"access-token-1\nrefresh-token-2\naccess-token-3|refresh-token-3"}
            value={raw}
            autoComplete="off"
            spellCheck={false}
            wrap="off"
            data-scrollbar-visible="true"
            onChange={(event) => onRawChange(event.target.value)}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          />
        </div>
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
