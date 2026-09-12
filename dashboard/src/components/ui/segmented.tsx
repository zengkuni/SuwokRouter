import { useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

const SPRING = {
  type: "spring" as const,
  stiffness: 620,
  damping: 38,
  mass: 0.4,
};

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  disabled,
  size = "default",
}: {
  value: T;
  onChange: (v: T) => void;
  options: {
    value: T;
    label: string;
    mobileLabel?: string;
    compactLabel?: string;
    hint?: string;
  }[];
  className?: string;
  disabled?: boolean;
  size?: "sm" | "compact" | "default";
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicator, setIndicator] = useState({
    left: 0,
    width: 0,
    ready: false,
  });

  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );
  const hasHints = options.some((o) => Boolean(o.hint));

  useLayoutEffect(() => {
    function measure() {
      const l = listRef.current;
      const b = btnRefs.current[activeIndex];
      if (!l || !b) return;
      const lr = l.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const inset = 2;
      setIndicator({
        left: br.left - lr.left + inset,
        width: Math.max(0, br.width - inset * 2),
        ready: true,
      });
    }

    measure();

    const list = listRef.current;
    if (!list) return;
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [activeIndex, options.length, value, hasHints, size]);

  return (
    <div
      ref={listRef}
      role="tablist"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      className={cn(
        "relative grid w-full items-stretch gap-1 rounded-lg border border-border bg-muted p-1",
        className
      )}
    >
      {indicator.ready ? (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute top-1 bottom-1 z-0 rounded-md bg-white/15 ring-1 ring-white/20"
          initial={false}
          animate={{
            left: indicator.left,
            width: indicator.width,
          }}
          transition={SPRING}
        />
      ) : null}

      {options.map((opt, i) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={opt.label}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative z-10 min-w-0 flex-1 rounded-md text-center outline-none transition-colors duration-100",
              "focus-visible:ring-1 focus-visible:ring-white/20",
              size === "compact"
                ? "px-1 py-1.5"
                : "px-2.5 py-1.5",
              active
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
              disabled && "opacity-50"
            )}
          >
            {size === "compact" ? (
              <span className="block whitespace-nowrap text-[11px] font-medium">
                {opt.compactLabel ?? opt.label}
              </span>
            ) : opt.mobileLabel ? (
              <>
                <span
                  className={cn(
                    "block whitespace-nowrap font-medium sm:hidden",
                    size === "sm" ? "text-[11px]" : "text-xs"
                  )}
                >
                  {opt.mobileLabel}
                </span>
                <span
                  className={cn(
                    "hidden whitespace-nowrap font-medium sm:block",
                    size === "sm" ? "text-xs" : "text-xs"
                  )}
                >
                  {opt.label}
                </span>
              </>
            ) : (
              <span
                className={cn(
                  "block whitespace-nowrap font-medium",
                  size === "sm" ? "text-xs" : "text-xs"
                )}
              >
                {opt.label}
              </span>
            )}
            {hasHints && size === "default" ? (
              <span
                className={cn(
                  "mt-0.5 block truncate text-[10px] leading-tight",
                  active ? "text-muted-foreground" : "text-muted-foreground/60"
                )}
              >
                {opt.hint}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
