import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

export function ScrollToTop({
  threshold = 280,
  className,
}: {
  threshold?: number;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [scrollEl, setScrollEl] = useState<HTMLElement | Window | null>(null);

  useEffect(() => {

    const main = document.querySelector(
      "main.min-h-0.flex-1.overflow-y-auto"
    ) as HTMLElement | null;
    const el: HTMLElement | Window = main || window;
    setScrollEl(el);

    function onScroll() {
      const top =
        el === window
          ? window.scrollY || document.documentElement.scrollTop
          : (el as HTMLElement).scrollTop;
      setVisible(top > threshold);
    }

    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [threshold]);

  function goTop() {
    if (!scrollEl) return;
    if (scrollEl === window) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      (scrollEl as HTMLElement).scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  return (
    <button
      type="button"
      aria-label="Scroll to top"
      onClick={goTop}
      className={cn(
        "fixed bottom-6 right-6 z-40 inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-foreground transition-all duration-150",
        "hover:bg-surface-hover hover:border-white/20",
        visible
          ? "pointer-events-auto translate-y-0 opacity-100"
          : "pointer-events-none translate-y-2 opacity-0",
        className
      )}
    >
      <ArrowUp className="h-4 w-4" />
    </button>
  );
}
