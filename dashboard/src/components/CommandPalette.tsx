import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  CornerDownLeft,
  Command as CommandIcon,
  Hash,
  Search,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NAV_ITEMS } from "@/components/Sidebar";
import {
  buildCommands,
  fetchRemoteMcp,
  mergeRemoteMcp,
  parseQuery,
  rankCommands,
  type PaletteCommand,
} from "@/lib/commandPalette";
import { getProviderIconSrc } from "@/lib/provider-icon";
import { providerColor, providerIcon, resolveProviderId } from "@/lib/providers";

const SPRING = { type: "spring" as const, stiffness: 480, damping: 38, mass: 0.5 };

function isModalKey(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K");
}

function ProviderMark({ id }: { id: string }) {
  const src = getProviderIconSrc(id);
  const [failed, setFailed] = useState(!src);
  useEffect(() => setFailed(!src), [src]);
  if (!failed && src) {
    return (
      <img
        src={src}
        alt=""
        className="h-4 w-4 shrink-0 rounded object-contain"
        onError={() => setFailed(true)}
      />
    );
  }
  const canonical = resolveProviderId(id);
  const Icon = providerIcon(canonical);
  const color = providerColor(canonical);
  return <Icon className="h-4 w-4 shrink-0" style={{ color }} aria-hidden />;
}

function CommandIcon_({ cmd }: { cmd: PaletteCommand }) {
  if (cmd.group === "Page") {
    const Icon = NAV_ITEMS.find((n) => n.to === cmd.to)?.icon ?? Hash;
    return <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />;
  }
  if (cmd.group === "Provider") {

    const id = cmd.iconKey?.startsWith("provider:") ? cmd.iconKey.slice("provider:".length) : cmd.label;
    return <ProviderMark id={id} />;
  }

  return <Wrench className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />;
}

const GROUP_HINT: Record<PaletteCommand["group"], string> = {
  Page: "Page",
  Provider: "Provider",
  "MCP tool": "MCP tool",
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const fetchedRef = useRef(false);

  const base = useMemo(() => buildCommands(), []);
  const [commands, setCommands] = useState<PaletteCommand[]>(base);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isModalKey(e)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open || fetchedRef.current) return;
    fetchedRef.current = true;
    let alive = true;
    void fetchRemoteMcp().then((servers) => {
      if (!alive || !servers.length) return;
      setCommands((prev) => mergeRemoteMcp(prev, servers));
    });
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  const results = useMemo(() => rankCommands(commands, query), [commands, query]);
  const mode = parseQuery(query).mode;

  useEffect(() => {
    if (active > results.length - 1) setActive(0);
  }, [results.length, active]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-cp-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const run = useCallback(
    (cmd: PaletteCommand | undefined) => {
      if (!cmd) return;
      setOpen(false);
      setQuery("");
      navigate(cmd.to);
    },
    [navigate],
  );

  function onListKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(results[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh] sm:pt-[16vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
        >
          <button
            type="button"
            aria-label="Close command palette"
            tabIndex={-1}
            className="absolute inset-0 bg-black/32 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={SPRING}
            className="relative flex max-h-[72vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground outline-none"
          >
            <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <Input
                ref={inputRef as never}
                value={query}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onListKeyDown}
                placeholder={
                  mode === "provider"
                    ? "Search providers by name or alias…"
                    : "Search pages, providers, or MCP tools — type > to jump to a provider"
                }
                aria-label="Command palette search"
                className="border-transparent bg-transparent dark:bg-transparent"
              />
              <Badge variant="outline" size="sm" className="shrink-0 font-mono text-[10px] text-muted-foreground">
                <CommandIcon className="h-3 w-3" />K
              </Badge>
            </div>

            <div
              ref={listRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5"
              role="listbox"
              aria-label="Palette results"
            >
              {results.length === 0 ? (
                <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                  No matches{mode === "provider" ? " among providers" : ""}. {mode !== "provider" && "Try a different term or press Esc."}
                </div>
              ) : (
                <ul className="space-y-0.5">
                  {results.slice(0, 50).map((cmd, i) => (
                    <li key={cmd.id} data-cp-idx={i}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={i === active}
                        onMouseMove={() => setActive(i)}
                        onClick={() => run(cmd)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                          i === active ? "bg-white/10 text-foreground" : "text-foreground/90 hover:bg-surface-hover",
                        )}
                      >
                        <CommandIcon_ cmd={cmd} />
                        <span className="min-w-0 flex-1 truncate">
                          {cmd.label}
                          {cmd.group === "Provider" && cmd.keywords?.[1] ? (
                            <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{cmd.keywords[1]}</span>
                          ) : null}
                        </span>
                        <Badge variant="outline" size="sm" className="shrink-0 text-[10px] text-muted-foreground">
                          {GROUP_HINT[cmd.group]}
                        </Badge>
                        {i === active ? (
                          <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        ) : null}
                      </button>
                    </li>
                  ))}
                  {results.length > 50 ? (
                    <li className="px-2.5 py-1.5 text-center text-[11px] text-muted-foreground">
                      +{results.length - 50} more — refine your query
                    </li>
                  ) : null}
                </ul>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-between border-t border-border px-3.5 py-2 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-2">
                <kbd className="rounded border border-border bg-surface px-1 font-mono">↑↓</kbd> navigate
                <kbd className="rounded border border-border bg-surface px-1 font-mono">↵</kbd> open
                <kbd className="rounded border border-border bg-surface px-1 font-mono">Esc</kbd> close
              </span>
              <span className="hidden sm:inline">
                <kbd className="rounded border border-border bg-surface px-1 font-mono">&gt;</kbd> jump to provider
              </span>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
