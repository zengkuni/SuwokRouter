import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { TextShimmer } from "@/components/animate/text-shimmer";
import { RippleButton } from "@/components/animate/ripple-button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getErrorMessage, login, fetchAuthStatus } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";

export default function Login() {
  const navigate = useNavigate();
  const setToken = useAuthStore((s) => s.setToken);
  const setAuthMeta = useAuthStore((s) => s.setAuthMeta);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [defaultPasswordActive, setDefaultPasswordActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAuthStatus()
      .then((s) => {
        if (!cancelled && s.authMode === "password") {
          setDefaultPasswordActive(s.defaultPasswordActive);
        }
      })
      .catch(() => {

      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await login(password);
      if (res.mustChangePassword) {

        navigate("/setup", { replace: true });
        return;
      }

      setToken("dashboard-session");
      setAuthMeta({ authenticated: true, hasPassword: true });
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, "Login failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm border-border bg-card">
        <CardHeader className="text-center">
          <img
            src="/logo/sway.svg"
            alt="Sway Router"
            className="mx-auto mb-2 h-12 w-12 rounded-xl object-contain"
          />
          <CardTitle className="text-xl">Sway Router</CardTitle>
          <p className="text-sm text-muted-foreground">Dashboard login</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                required
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {defaultPasswordActive && !error ? (
              <p className="text-xs text-muted-foreground">
                First login? The default password is{" "}
                <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">
                  123456
                </code>
                . Set a new one after signing in.
              </p>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <RippleButton type="submit" className="w-full" disabled={loading}>
              {loading ? <TextShimmer>Authenticating…</TextShimmer> : "Login"}
            </RippleButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
