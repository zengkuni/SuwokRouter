import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  ChartColumnBig,
  ChartPie,
  ChevronDown,
  ChevronUp,
  GlobeCheck,
  House,
  Key,
  Layers2,
  Loader2,
  LogOut,
  MessagesSquare,
  PanelLeft,
  Pencil,
  RotateCwFadingClock,
  Router,
  Settings,
  SquareTerminal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Popover } from "@base-ui/react/popover";
import { fetchVersion, type VersionInfo } from "@/lib/version-api";
import { useQuery } from "@tanstack/react-query";
import { getErrorMessage, logout } from "@/lib/api";
import { fetchSettings, updateSettings } from "@/lib/settings-api";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { VersionUpdateBanner } from "@/components/VersionUpdateBanner";

type NavItem = { to: string; label: string; icon: LucideIcon };

const DASH = "/dashboard";
const PROFILE_NAME = "Sway Router";
const PROFILE_NAME_KEY = "swayrouter.profile.name";
const PROFILE_AVATAR_KEY = "swayrouter.profile.avatar";

const SIDEBAR_COLLAPSED_KEY = "swayrouter.sidebar.collapsed.v4";
const NAV_HIGHLIGHT_SPRING = {
  type: "spring" as const,
  stiffness: 460,
  damping: 36,
  mass: 0.45,
};

export const NAV_ITEMS: NavItem[] = [
  { to: `${DASH}`, label: "Dashboard", icon: House },
  { to: `${DASH}/manage-apikey`, label: "API Keys", icon: Key },
  { to: `${DASH}/provider`, label: "Providers", icon: Router },
  { to: `${DASH}/combo`, label: "Combos", icon: Layers2 },
  { to: `${DASH}/proxy`, label: "Proxy", icon: GlobeCheck },
  { to: `${DASH}/usage`, label: "Usage", icon: ChartColumnBig },
  { to: `${DASH}/quota-monitor`, label: "Quota Monitor", icon: ChartPie },
  { to: `${DASH}/cli-tools`, label: "CLI Tools", icon: SquareTerminal },
  { to: `${DASH}/sway-chat`, label: "Sway Chat", icon: MessagesSquare },
  { to: `${DASH}/settings`, label: "Settings", icon: Settings },
  { to: `${DASH}/console-log`, label: "Console Logs", icon: RotateCwFadingClock },
];

function readCollapsedState() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function writeCollapsedState(value: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(value));
  } catch {

  }
}

function readProfileName() {
  if (typeof window === "undefined") return PROFILE_NAME;
  try {
    const savedName = window.localStorage.getItem(PROFILE_NAME_KEY)?.trim();
    return savedName || PROFILE_NAME;
  } catch {
    return PROFILE_NAME;
  }
}

function writeProfileName(value: string) {
  try {
    window.localStorage.setItem(PROFILE_NAME_KEY, value);
  } catch {

  }
}

function readProfileAvatar() {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(PROFILE_AVATAR_KEY)?.trim() || "";
  } catch {
    return "";
  }
}

function writeProfileAvatar(value: string) {
  try {
    if (value) window.localStorage.setItem(PROFILE_AVATAR_KEY, value);
    else window.localStorage.removeItem(PROFILE_AVATAR_KEY);
  } catch {

  }
}

export function Sidebar({
  mobileOpen = false,
  onNavigate,
  onClose,
}: {

  mobileOpen?: boolean;
  onNavigate?: () => void;
  onClose?: () => void;
}) {
  const versionQ = useQuery({
    queryKey: ["version"],
    queryFn: fetchVersion,
    retry: false,
    staleTime: 60 * 60 * 1000,
  });
  const info: VersionInfo | undefined = versionQ.data;
  const settingsQ = useQuery({
    queryKey: ["settings"],
    queryFn: fetchSettings,
    retry: false,
    staleTime: 60 * 60 * 1000,
  });
  const serverProfileName = settingsQ.data?.profileName?.trim() || "";
  const serverProfileAvatar = settingsQ.data?.profileAvatar?.trim() || "";

  const [menuOpen, setMenuOpen] = useState(false);
  const [profileName, setProfileName] = useState(readProfileName);
  const [profileAvatar, setProfileAvatar] = useState(readProfileAvatar);
  const [renameOpen, setRenameOpen] = useState(false);
  const [draftProfileName, setDraftProfileName] = useState(profileName);
  const [profileNameSaving, setProfileNameSaving] = useState(false);
  const [profileNameError, setProfileNameError] = useState("");
  const [collapsed, setCollapsed] = useState(readCollapsedState);
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches,
  );
  const [signingOut, setSigningOut] = useState(false);
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const isCollapsed = isDesktop && collapsed;
  const hasUpdate = Boolean(info?.updateAvailable && info.latestVersion && info.updateSupported);
  const previousCollapsed = useRef(isCollapsed);

  useEffect(() => {
    if (!menuOpen) setSigningOut(false);
  }, [menuOpen]);

  useEffect(() => {
    writeCollapsedState(collapsed);
  }, [collapsed]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const handleMediaChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);

    setIsDesktop(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleMediaChange);
    return () => mediaQuery.removeEventListener("change", handleMediaChange);
  }, []);

  useEffect(() => {
    if (previousCollapsed.current !== isCollapsed) {
      setMenuOpen(false);
      previousCollapsed.current = isCollapsed;
    }
  }, [isCollapsed]);

  useEffect(() => {
    if (!settingsQ.isSuccess) return;

    if (serverProfileName) {
      setProfileName(serverProfileName);
      writeProfileName(serverProfileName);
      return;
    }

    const legacyName = readProfileName();
    if (legacyName !== PROFILE_NAME) {
      void updateSettings({ profileName: legacyName }).catch(() => {});
    }
  }, [serverProfileName, settingsQ.isSuccess]);

  useEffect(() => {
    if (!settingsQ.isSuccess) return;
    setProfileAvatar(serverProfileAvatar);
    writeProfileAvatar(serverProfileAvatar);
  }, [serverProfileAvatar, settingsQ.isSuccess]);

  function openRenameDialog() {
    setMenuOpen(false);
    setProfileNameError("");
    setDraftProfileName(profileName);
    setRenameOpen(true);
  }

  async function saveProfileName() {
    const nextName = draftProfileName.trim().replace(/\s+/g, " ");
    if (!nextName || profileNameSaving) return;

    setProfileNameSaving(true);
    setProfileNameError("");
    try {
      const savedSettings = await updateSettings({ profileName: nextName });
      const savedName = savedSettings.profileName?.trim() || nextName;
      setProfileName(savedName);
      writeProfileName(savedName);
      setRenameOpen(false);
      toast.success("Profile renamed");
    } catch (error) {
      setProfileNameError(getErrorMessage(error, "Unable to save profile name"));
    } finally {
      setProfileNameSaving(false);
    }
  }

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout();
    } catch {

    } finally {
      useAuthStore.getState().clearAuth();
      setMenuOpen(false);
      navigate("/login", { replace: true });
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close sidebar"
        className={cn(
          "fixed inset-0 z-40 bg-black/60 transition-opacity duration-200 lg:hidden",
          mobileOpen
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        )}
        onClick={onClose}
      />

      <aside
        className={cn(

          "fixed inset-y-0 left-0 z-50 flex w-[min(18rem,86vw)] flex-col overflow-hidden border-r border-border bg-muted lg:bg-muted/72",
          "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
          "transition-[width,transform] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] [will-change:width,transform] motion-reduce:transition-none",
          "lg:relative lg:inset-auto lg:left-0 lg:m-0 lg:h-full lg:flex-none lg:rounded-r-3xl",
          isCollapsed ? "lg:w-[65px]" : "lg:w-64",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <div
          className={cn(
            "shrink-0 pb-3 pt-5",
          )}
        >
          <div className="flex min-w-0 items-center">
            <div className="flex h-8 w-16 shrink-0 items-center justify-center">
              <Tooltip label="Open sidebar" side="right" sideOffset={10} disabled={!isCollapsed}>
                <button
                  type="button"
                  onClick={() => {
                    if (!isCollapsed) return;
                    setMenuOpen(false);
                    setCollapsed(false);
                  }}
                  aria-label={isCollapsed
                    ? hasUpdate
                      ? "Open sidebar, update available"
                      : "Open sidebar"
                    : "Sway Router"}
                  className="group/brand relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-100 touch-manipulation hover:bg-surface-hover"
                >
                  <img
                    src="/logo/sway.svg"
                    alt=""
                    className={cn(
                      "h-8 w-8 rounded-lg object-contain transition-opacity duration-150 ease-out",
                      isCollapsed && "lg:group-hover/brand:opacity-0 lg:group-focus-visible/brand:opacity-0",
                    )}
                  />
                  <PanelLeft
                    aria-hidden="true"
                    className={cn(
                      "pointer-events-none absolute h-4 w-4 text-muted-foreground opacity-0 transition-opacity duration-150 ease-out",
                      isCollapsed && "lg:group-hover/brand:opacity-100 lg:group-focus-visible/brand:opacity-100",
                    )}
                    />
                  {isCollapsed && hasUpdate ? (
                    <span
                      className="pointer-events-none absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-muted bg-destructive"
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              </Tooltip>
            </div>

            <div
              className={cn(
                "min-w-0 flex-1 overflow-hidden transition-[opacity,transform] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] [will-change:opacity,transform] motion-reduce:transition-none",
                isCollapsed && "lg:pointer-events-none lg:-translate-x-2 lg:opacity-0",
              )}
            >
              <span className="block truncate text-sm font-semibold leading-tight tracking-tight">
                Sway Router
              </span>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>Version</span>
                <span className="tabular-nums text-muted-foreground/80">{info?.currentVersion ?? "1.0.0"}</span>
              </div>
            </div>

            <Tooltip label="Collapse sidebar" side="right" sideOffset={10} disabled={isCollapsed}>
              <button
                type="button"
                className={cn(
                  "hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:inline-flex",
                  isCollapsed && "lg:hidden",
                )}
                onClick={() => setCollapsed((value) => !value)}
                aria-label="Collapse sidebar"
              >
                <PanelLeft className="h-4 w-4" />
              </button>
            </Tooltip>
            <button
              type="button"
              className="ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-200 hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
              onClick={onClose}
              aria-label="Close sidebar"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div
          className="mx-3 shrink-0 border-t border-border/70"
          aria-hidden="true"
        />

        <nav
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3 pt-1",
          )}
        >
          <div className="space-y-0.5">
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
              <Tooltip key={to} label={label} side="right" sideOffset={10} disabled={!isCollapsed}>
                <NavLink
                  to={to}
                  end={to === `${DASH}`}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      "group relative flex min-h-10 w-full items-center py-2 pr-3 text-sm transition-[background-color,color] duration-200 ease-out",
                      "touch-manipulation hover:bg-surface-hover/70",
                      isActive
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive ? (
                        <motion.span
                          layoutId={`nav-highlight-${isCollapsed ? "collapsed" : "expanded"}`}
                          layout
                          className="pointer-events-none absolute inset-y-0 left-2 right-2 origin-left rounded-xl bg-white/12"
                          transition={reduceMotion ? { duration: 0 } : NAV_HIGHLIGHT_SPRING}
                        />
                      ) : null}
                      <span className="relative z-10 flex h-6 w-16 shrink-0 items-center justify-center">
                        <Icon className="h-[1.05rem] w-[1.05rem] shrink-0" />
                      </span>
                      <span
                        className={cn(
                          "relative z-10 min-w-0 flex-1 truncate whitespace-nowrap transition-[opacity,transform] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] [will-change:opacity,transform] motion-reduce:transition-none",
                          isCollapsed && "lg:pointer-events-none lg:-translate-x-2 lg:opacity-0",
                        )}
                      >
                        {label}
                      </span>
                    </>
                  )}
                </NavLink>
              </Tooltip>
            ))}
          </div>
        </nav>

        <div
          className={cn(
            "shrink-0 border-t border-border/70 pb-3 pt-3",
          )}
        >
          <VersionUpdateBanner collapsed={isCollapsed} />

          {isCollapsed ? (
            <Popover.Root
              open={menuOpen}
              onOpenChange={(open) => setMenuOpen(open)}
            >
              <Popover.Trigger
                aria-label="Open account menu"
                className="group/profile relative flex h-10 w-full items-center justify-center rounded-xl transition-colors duration-100 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <img
                  src={profileAvatar || "/logo/avatar.svg"}
                  alt={profileName}
                  className="h-8 w-8 rounded-lg object-cover transition-transform duration-150 ease-out group-hover/profile:scale-[1.03]"
                />
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner
                  side="right"
                  align="end"
                  sideOffset={10}
                  className="z-[100]"
                >
                  <Popover.Popup className="flex w-52 origin-[var(--transform-origin)] flex-col gap-2 rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-xl outline-none transition-[opacity,transform] duration-150 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
                    <div className="px-2 py-1">
                      <p className="truncate text-sm font-semibold">{profileName}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">Administrator</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSignOut()}
                      disabled={signingOut}
                      className="flex h-9 w-full items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-2.5 text-sm text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50 disabled:pointer-events-none disabled:opacity-64"
                    >
                      {signingOut ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                      ) : (
                        <LogOut className="h-4 w-4 shrink-0" />
                      )}
                      <span>{signingOut ? "Signing out…" : "Sign out"}</span>
                    </button>
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
          ) : (
            <Tooltip label="Account menu" side="right" sideOffset={10}>
              <div className="group/profile relative flex min-h-12 w-full items-center rounded-xl py-2 pr-3 transition-colors duration-100 touch-manipulation hover:bg-surface-hover">
                <button
                  type="button"
                  onClick={() => setMenuOpen((value) => !value)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label={menuOpen ? "Close account menu" : "Open account menu"}
                  className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <span className="relative z-10 flex h-8 w-16 shrink-0 items-center justify-center">
                  <img
                    src={profileAvatar || "/logo/avatar.svg"}
                    alt={profileName}
                    className="pointer-events-none h-8 w-8 shrink-0 rounded-lg object-cover"
                  />
                </span>
                <span className="group/profile-name pointer-events-none relative z-10 min-w-0 flex-1 overflow-hidden transition-[opacity,transform] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] [will-change:opacity,transform] motion-reduce:transition-none">
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="min-w-0 truncate text-sm font-semibold leading-tight tracking-tight">
                      {profileName}
                    </span>
                    <Tooltip label="Rename profile" side="right" sideOffset={8}>
                      <button
                        type="button"
                        onClick={openRenameDialog}
                        aria-label="Rename profile"
                        className="pointer-events-auto relative z-20 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[opacity,transform,background-color,color] duration-150 ease-out group-hover/profile-name:opacity-100 group-focus-within/profile-name:opacity-100 focus-visible:opacity-100 hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    </Tooltip>
                  </span>
                  <span className="mt-0.5 block truncate text-xs leading-tight text-muted-foreground">
                    Administrator
                  </span>
                </span>
                <span className="relative z-10 shrink-0 pointer-events-none text-muted-foreground transition-[opacity,transform] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] [will-change:opacity,transform] motion-reduce:transition-none">
                  {menuOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                </span>
              </div>
            </Tooltip>
          )}

          {!isCollapsed ? (
            <AnimatePresence initial={false}>
              {menuOpen ? (
                <motion.div
                  initial={{ opacity: 0, height: 0, y: 4 }}
                  animate={{ opacity: 1, height: "auto", y: 0 }}
                  exit={{ opacity: 0, height: 0, y: 4 }}
                  transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.55 }}
                  className="mx-3 overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => void handleSignOut()}
                    disabled={signingOut}
                    className="mt-1.5 flex h-10 w-full items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 text-sm text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50"
                  >
                    {signingOut ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    ) : (
                      <LogOut className="h-4 w-4 shrink-0" />
                    )}
                    <span>{signingOut ? "Signing out…" : "Sign out"}</span>
                  </button>
                </motion.div>
              ) : null}
            </AnimatePresence>
          ) : null}
        </div>

      </aside>

      <Dialog
        open={renameOpen}
        onOpenChange={(open) => {
          setRenameOpen(open);
          setProfileNameError("");
          if (open) setDraftProfileName(profileName);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename profile</DialogTitle>
            <DialogDescription>
              Choose the name shown in the sidebar profile.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 px-6 pb-2">
            <label htmlFor="profile-name" className="text-xs font-medium text-muted-foreground">
              Profile name
            </label>
            <Input
              id="profile-name"
              value={draftProfileName}
              onChange={(event) => setDraftProfileName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveProfileName();
              }}
              maxLength={40}
              autoFocus
            />
            {profileNameError ? (
              <p role="alert" className="text-xs text-destructive">
                {profileNameError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)} disabled={profileNameSaving}>
              Cancel
            </Button>
            <Button
              onClick={() => void saveProfileName()}
              disabled={!draftProfileName.trim()}
              loading={profileNameSaving}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
