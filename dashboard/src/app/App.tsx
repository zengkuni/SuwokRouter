import { Component, type ErrorInfo, type ReactNode } from "react";
import { RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { Toaster } from "@/components/ui/toast";
import { router } from "@/app/router";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

class RootErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI crash:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-foreground">
          <p className="text-sm font-medium">Something crashed the UI</p>
          <pre className="max-w-xl overflow-auto rounded-lg border border-border bg-card p-3 text-xs text-destructive">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-surface-hover"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <RootErrorBoundary>
      <MotionConfig reducedMotion="user">
        <QueryClientProvider client={queryClient}>
          <Toaster>
            <RouterProvider router={router} />
          </Toaster>
        </QueryClientProvider>
      </MotionConfig>
    </RootErrorBoundary>
  );
}
