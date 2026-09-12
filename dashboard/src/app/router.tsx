import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { AuthGuard } from "@/app/AuthGuard";
import { ProtectedLayout } from "@/app/layout";

const Login = lazy(() => import("@/pages/Login"));
const Setup = lazy(() => import("@/pages/Setup"));
const OAuthCallback = lazy(() => import("@/pages/OAuthCallback"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const ManageApiKey = lazy(() => import("@/pages/ManageApiKey"));
const Provider = lazy(() => import("@/pages/Provider"));
const Keys = lazy(() => import("@/pages/Keys"));
const Combo = lazy(() => import("@/pages/Combo"));
const Proxy = lazy(() => import("@/pages/Proxy"));
const Usage = lazy(() => import("@/pages/Usage"));
const CliTools = lazy(() => import("@/pages/CliTools"));
const Settings = lazy(() => import("@/pages/Settings"));
const ConsoleLog = lazy(() => import("@/pages/ConsoleLog"));
const QuotaMonitor = lazy(() => import("@/pages/QuotaMonitor"));

function PageFallback() {

  return (
    <div className="h-full min-h-[40vh] w-full animate-pulse rounded-xl bg-card/40" />
  );
}

function L({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

const DASH = "/dashboard";

export const router = createBrowserRouter([
  {
    path: "/login",
    element: (
      <L>
        <Login />
      </L>
    ),
  },
  {
    path: "/setup",
    element: (
      <L>
        <Setup />
      </L>
    ),
  },
  {
    path: "/callback",
    element: (
      <L>
        <OAuthCallback />
      </L>
    ),
  },
  {
    element: <AuthGuard />,
    children: [
      {
        element: <ProtectedLayout />,
        children: [
          {
            path: DASH,
            element: (
              <L>
                <Dashboard />
              </L>
            ),
          },
          {
            path: `${DASH}/manage-apikey`,
            element: (
              <L>
                <ManageApiKey />
              </L>
            ),
          },
          {
            path: `${DASH}/provider`,
            element: (
              <L>
                <Provider />
              </L>
            ),
          },
          {
            path: `${DASH}/keys`,
            element: (
              <L>
                <Keys />
              </L>
            ),
          },
          {
            path: `${DASH}/combo`,
            element: (
              <L>
                <Combo />
              </L>
            ),
          },
          {
            path: `${DASH}/proxy`,
            element: (
              <L>
                <Proxy />
              </L>
            ),
          },
          {
            path: `${DASH}/usage`,
            element: (
              <L>
                <Usage />
              </L>
            ),
          },
          {
            path: `${DASH}/cli-tools`,
            element: (
              <L>
                <CliTools />
              </L>
            ),
          },
          {
            path: `${DASH}/settings`,
            element: (
              <L>
                <Settings />
              </L>
            ),
          },
          {
            path: `${DASH}/console-log`,
            element: (
              <L>
                <ConsoleLog />
              </L>
            ),
          },
          {
            path: `${DASH}/quota-monitor`,
            element: (
              <L>
                <QuotaMonitor />
              </L>
            ),
          },
          {
            path: `${DASH}/sway-chat`,
            element: null,
          },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to={DASH} replace /> },
]);
