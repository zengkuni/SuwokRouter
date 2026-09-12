import { lazy, Suspense, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { PanelLeft } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { ScrollToTop } from "@/components/ScrollToTop";
import { CommandPalette } from "@/components/CommandPalette";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const SwayChat = lazy(() => import("@/pages/SwayChat"));

export function ProtectedLayout() {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isSwayChatRoute = location.pathname === "/dashboard/sway-chat";
  const [chatMounted, setChatMounted] = useState(isSwayChatRoute);

  useEffect(() => {
    if (isSwayChatRoute) setChatMounted(true);
  }, [isSwayChatRoute]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    const hideTimers = new Map<HTMLElement, number>();
    const handleScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.dataset.slot === "scroll-area-viewport") return;

      target.dataset.scrollbarVisible = "true";
      const previousTimer = hideTimers.get(target);
      if (previousTimer !== undefined) window.clearTimeout(previousTimer);
      hideTimers.set(target, window.setTimeout(() => {
        target.removeAttribute("data-scrollbar-visible");
        hideTimers.delete(target);
      }, 650));
    };

    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("scroll", handleScroll, true);
      for (const timer of hideTimers.values()) window.clearTimeout(timer);
      hideTimers.clear();
    };
  }, []);

  return (
    <TooltipProvider>
      <div className="relative flex h-svh overflow-hidden bg-background">
      {

                                             }
      <CommandPalette />
      <div className="flex h-full min-h-0 w-full min-w-0">
        <Sidebar
          mobileOpen={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          onNavigate={() => setMobileNavOpen(false)}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header
            className={cn(
              "relative flex shrink-0 items-center justify-center gap-3 border-b border-border bg-surface/90 px-3 py-2.5 backdrop-blur-sm lg:hidden",
              "pt-[max(0.5rem,env(safe-area-inset-top))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]"
            )}
          >
            <button
              type="button"
              className="absolute left-[max(0.75rem,env(safe-area-inset-left))] top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md text-foreground hover:bg-surface-hover"
              onClick={() => setMobileNavOpen(true)}
               aria-label="Open sidebar"
             >
               <PanelLeft className="h-4 w-4" />
            </button>
            <div className="flex min-w-0 max-w-[calc(100%-5rem)] items-center justify-center gap-2">
              <img
                src="/logo/sway.svg"
                alt=""
                className="h-7 w-7 shrink-0 rounded-md object-contain"
              />
              <span className="truncate text-sm font-semibold tracking-tight">
                Sway Router
              </span>
            </div>
          </header>

          <main
            className={cn(
              "flex min-h-0 flex-1 flex-col overflow-hidden",
              "p-3 sm:p-4 lg:px-6 lg:pt-6 lg:pb-3",
              "pb-[max(0.75rem,env(safe-area-inset-bottom))]"
            )}
          >
            {

              }
            <div
              className={cn(
                "min-h-0 flex-1 overscroll-y-contain",
                isSwayChatRoute
                  ? "hidden"
                  : location.pathname === "/dashboard/provider"
                    ? "overflow-hidden"
                    : "overflow-y-auto"
              )}
            >
              <Outlet />
            </div>
            {chatMounted ? (
              <div className={cn("min-h-0 flex-1", isSwayChatRoute ? "flex" : "hidden")}>
                <Suspense fallback={<div className="h-full min-h-[40vh] w-full animate-pulse rounded-xl bg-card/40" />}>
                  <SwayChat />
                </Suspense>
              </div>
            ) : null}
          </main>
          <ScrollToTop />
        </div>
      </div>
      </div>
    </TooltipProvider>
  );
}
