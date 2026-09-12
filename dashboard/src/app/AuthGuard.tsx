import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { fetchAuthStatus } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { TextShimmer } from "@/components/animate/text-shimmer";

export function AuthGuard() {
  const location = useLocation();
  const { authenticated, requireLogin, setAuthMeta, setAuthenticated } =
    useAuthStore();
  const [ready, setReady] = useState(false);
  const [backendDown, setBackendDown] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        const auth = await fetchAuthStatus();

        if (cancelled) return;

        setBackendDown(false);
        setAuthMeta({
          requireLogin: auth.requireLogin,
          hasPassword: auth.hasPassword,
          authenticated: auth.authenticated,
        });
        setAuthenticated(auth.authenticated);
      } catch {

        if (!cancelled) {
          setBackendDown(true);
          setAuthMeta({
            requireLogin: false,
            hasPassword: false,
            authenticated: false,
          });
          setAuthenticated(false);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [setAuthMeta, setAuthenticated]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <TextShimmer className="text-sm">Loading Sway Router…</TextShimmer>
      </div>
    );
  }

  if (backendDown) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
        <p className="text-lg font-medium text-muted-foreground">
          Backend unavailable
        </p>
        <p className="text-sm text-muted-foreground">
          Cannot reach Sway Router backend. Please check the server and try
          again.
        </p>
      </div>
    );
  }

  if (requireLogin && !authenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
