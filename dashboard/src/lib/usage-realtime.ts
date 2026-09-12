import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { probeEnabled } from "@/lib/live-mode";

const USAGE_QUERY_KEYS = new Set([
  "usage-stats",
  "usage-history",
  "usage-chart",
  "usage-heatmap",
  "usage-request-details",
  "request-detail",
]);

export function useUsageRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!probeEnabled()) return;

    let stopped = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1000;

    const refreshQueries = () => {
      refreshTimer = null;
      if (stopped) return;
      void queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === "string" && USAGE_QUERY_KEYS.has(key);
        },
      });
    };

    const scheduleRefresh = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(refreshQueries, 0);
    };

    const scheduleRetry = () => {
      if (stopped || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 10000);
    };

    const connect = () => {
      if (stopped || source) return;
      const next = new EventSource("/api/usage/stream");
      source = next;

      next.onopen = () => {
        if (stopped || source !== next) return;
        retryDelay = 1000;
      };

      next.onmessage = () => {
        if (stopped || source !== next) return;
        scheduleRefresh();
      };

      next.onerror = () => {
        if (source !== next) return;
        next.close();
        source = null;
        scheduleRetry();
      };
    };

    connect();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (refreshTimer) clearTimeout(refreshTimer);
      retryTimer = null;
      refreshTimer = null;
      source?.close();
      source = null;
    };
  }, [queryClient]);
}
