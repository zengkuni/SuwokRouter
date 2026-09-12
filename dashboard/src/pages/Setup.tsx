import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { TextShimmer } from "@/components/animate/text-shimmer";
import { RippleButton } from "@/components/animate/ripple-button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getErrorMessage } from "@/lib/api";
import { updateSettings } from "@/lib/settings-api";
import { useAuthStore } from "@/stores/authStore";

export default function Setup() {
  const navigate = useNavigate();
  const setToken = useAuthStore((s) => s.setToken);
  const setAuthMeta = useAuthStore((s) => s.setAuthMeta);

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {

      await updateSettings({ newPassword: password });
      setToken("dashboard-session");
      setAuthMeta({
        authenticated: true,
        hasPassword: true,
        requireLogin: true,
      });
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, "Setup failed"));
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
          <CardTitle className="text-xl">Welcome to Sway Router</CardTitle>
          <p className="text-sm text-muted-foreground">
            Set your dashboard password
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoFocus
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
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <RippleButton type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <TextShimmer>Setting up…</TextShimmer>
              ) : (
                "Set Password & Continue"
              )}
            </RippleButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
