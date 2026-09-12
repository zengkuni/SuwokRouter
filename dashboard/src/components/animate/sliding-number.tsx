import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { cn } from "@/lib/utils";

const SPRING = { type: "spring" as const, stiffness: 300, damping: 25 };

export function SlidingNumber({
  value,
  prefix = "",
  suffix = "",
  decimals = 0,
  locale = "id-ID",
  className,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  locale?: string;
  className?: string;
}) {
  const spring = useSpring(value, SPRING);
  const reduceMotion = useReducedMotion();
  const previousValue = useRef(value);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formatter = useRef(new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }));
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    formatter.current = new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }, [decimals, locale]);

  const display = useTransform(spring, (v) =>
    `${prefix}${formatter.current.format(Number.isFinite(v) ? v : 0)}${suffix}`
  );
  const [text, setText] = useState(
    `${prefix}${formatter.current.format(Number.isFinite(value) ? value : 0)}${suffix}`
  );

  useEffect(() => {
    spring.set(value);

    if (previousValue.current === value) return;
    previousValue.current = value;
    setIsUpdating(true);
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    pulseTimer.current = setTimeout(() => setIsUpdating(false), 220);

    return () => {
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
    };
  }, [spring, value]);

  useEffect(() => {
    const unsub = display.on("change", setText);
    return unsub;
  }, [display]);

  return (
    <motion.span
      className={cn("tabular-nums text-foreground", className)}
      animate={{
        transform: isUpdating && !reduceMotion
          ? "translateY(-1px) scale(1.015)"
          : "translateY(0) scale(1)",
      }}
      transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
    >
      {text}
    </motion.span>
  );
}
