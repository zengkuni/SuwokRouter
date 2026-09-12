import { useEffect, useRef, useState } from "react";
import { RippleButton } from "@/components/animate/ripple-button";
import { TextShimmer } from "@/components/animate/text-shimmer";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  autoImportCursor,
  getOAuthRedirectUri,
  pollDeviceCode,
  pollOAuthStatus,
  registerOAuthSession,
  startDeviceCode,
  startOAuth,
  startOAuthProxy,
  stopOAuthProxy,
  testCodeBuddyToken,
  testProviderKey,
  type AvailableProvider,
} from "@/lib/connections-api";
import { listProxyPools, type ProxyPool } from "@/lib/admin-extras-api";
import { connectionCtaLabel, connectionCtaShort } from "@/lib/providers-mock";
import { type AuthFlow } from "@/lib/providers";
import {
  clearOAuthCallback,
  createOAuthCallbackMessage,
  getOAuthCallbackStorageKey,
  parseOAuthCallbackInput,
  parseOAuthCallbackStorageValue,
  readOAuthCallback,
  storeOAuthCallbackProvider,
  validateOAuthCallbackMessage,
  type OAuthCallbackPayload,
} from "@/lib/oauth-callback";
import { getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ApiKeyCredentialsFields } from "./ApiKeyAuthFields";
import { AuthLinkFields } from "./AuthLinkFields";
import { AuthModeSelector } from "./AuthModeSelector";
import { ApiKeyEntryTabs, BulkApiKeyFields } from "./BulkApiKeyFields";
import { ImportTokenFields } from "./ImportTokenFields";
import { CodeBuddyTokenFields } from "./CodeBuddyTokenFields";
import {
  KiroAuthSelector,
  KiroImportFields,
} from "./KiroAuthFields";
import {
  parseCodeBuddyTokenLines,
  type BulkKeyRow,
  type CodeBuddyTokenRow,
  type KiroAuthMode,
} from "./auth-dialog-types";
export type { KiroAuthMode } from "./auth-dialog-types";

const PKCE_OAUTH_PROVIDERS = new Set(["claude", "codex", "xai"]);
const CODEBUDDY_RESULT_HOLD_MS = 200;

export type AddConnectionSubmit = {
  name: string;

  authFlow?: AuthFlow;
  apiKey?: string;
  importToken?: string;
  codeBuddyToken?: string;
  codeBuddyTokens?: Array<{
    credentialToken?: string;
    accessToken?: string;
    refreshToken?: string;
    name?: string;
    autoName?: boolean;
  }>;
  machineId?: string;
  oauthCode?: string;
  oauthState?: string;
  oauthCodeVerifier?: string;
  oauthRedirectUri?: string;
  deviceCode?: string;
  deviceCodeVerifier?: string;
  proxyPoolId?: string | null;
  kiroAuthMode?: KiroAuthMode;
  kiroRegion?: string;
  kiroRefreshToken?: string;
  kiroClientId?: string;
  kiroClientSecret?: string;
  kiroProfileArn?: string;
  kiroCliProxyJson?: string;
  alreadySaved?: boolean;
  autoName?: boolean;
  bulkKeys?: Array<{ name: string; apiKey: string; autoName?: boolean }>;
};

const BULK_RESULT_HOLD_MS = 1000;

export function AddConnectionDialog({
  open,
  provider,
  flow,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  provider: AvailableProvider | null;
  flow: AuthFlow | null;
  onOpenChange: (o: boolean) => void;
  onSubmit: (body: AddConnectionSubmit) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [token, setToken] = useState("");
  const [codeBuddyToken, setCodeBuddyToken] = useState("");
  const [machineId, setMachineId] = useState("");
  const [oauthCode, setOauthCode] = useState("");
  const [proxyPoolId, setProxyPoolId] = useState("pool_none");
  const [proxyOptions, setProxyOptions] = useState<
    Array<{ id: string; name: string }>
  >(() => [{ id: "pool_none", name: "None (direct)" }]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [keyValid, setKeyValid] = useState<boolean | null>(null);
  const [checkMsg, setCheckMsg] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [authLink, setAuthLink] = useState<string | null>(null);
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [deviceCodeVerifier, setDeviceCodeVerifier] = useState<string | null>(
    null
  );
  const [userCode, setUserCode] = useState<string | null>(null);
  const [pollIntervalSec, setPollIntervalSec] = useState(5);
  const [deviceStatus, setDeviceStatus] = useState<string | null>(null);
  const [oauthState, setOauthState] = useState<string | null>(null);
  const [oauthCodeVerifier, setOauthCodeVerifier] = useState<string | null>(
    null
  );
  const [oauthRedirectUri, setOauthRedirectUri] = useState<string | null>(null);
  const [kiroAuthMode, setKiroAuthMode] = useState<KiroAuthMode>("builder-id");
  const [kiroRegion, setKiroRegion] = useState("us-east-1");
  const [kiroStartUrl, setKiroStartUrl] = useState("");
  const [kiroRefreshToken, setKiroRefreshToken] = useState("");
  const [kiroClientId, setKiroClientId] = useState("");
  const [kiroClientSecret, setKiroClientSecret] = useState("");
  const [kiroProfileArn, setKiroProfileArn] = useState("");
  const [kiroCliProxyJson, setKiroCliProxyJson] = useState("");
  const [cursorAutoImporting, setCursorAutoImporting] = useState(false);
  const [cursorAutoImportMessage, setCursorAutoImportMessage] = useState<string | null>(null);
  const [cursorAutoImportError, setCursorAutoImportError] = useState(false);
  const [entryTab, setEntryTab] = useState<"single" | "bulk">("single");
  const [bulkRaw, setBulkRaw] = useState("");
  const [bulkRows, setBulkRows] = useState<BulkKeyRow[]>([]);
  const [bulkChecking, setBulkChecking] = useState(false);
  const [bulkActiveIndex, setBulkActiveIndex] = useState<number | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [codeBuddyRows, setCodeBuddyRows] = useState<CodeBuddyTokenRow[]>([]);
  const [codeBuddyChecking, setCodeBuddyChecking] = useState(false);
  const [codeBuddyActiveIndex, setCodeBuddyActiveIndex] = useState<number | null>(null);

  function authModeLabel(providerId: string, mode: string): string {
    if (mode === "apikey") {
      return providerId === "qoder" ? "API Key (PAT)" : "API Key";
    }
    if (mode === "device") return "Device Code";
    if (mode === "import") {
      return providerId === "codebuddy-cn" || providerId === "codebuddy-intl"
        ? "AT/RT"
        : "Import Token";
    }
    return mode;
  }
  const [oauthBootError, setOauthBootError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [bootLoading, setBootLoading] = useState(false);
  const [oauthServerSide, setOauthServerSide] = useState(false);
  const pollAbortRef = useRef(false);
  const oauthProxyProviderRef = useRef<string | null>(null);
  const oauthCompletionRef = useRef(false);
  const popupRef = useRef<Window | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function setProxyState(serverSide = false) {
    setOauthServerSide(serverSide);
  }

  function clearOAuthPolling() {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  function closeOAuthPopup() {
    const popup = popupRef.current;
    popupRef.current = null;
    if (popup && !popup.closed) popup.close();
  }

  function stopActiveOAuthProxy(expectedProvider?: string) {
    const providerId = oauthProxyProviderRef.current;
    if (!providerId || (expectedProvider && providerId !== expectedProvider)) return;
    oauthProxyProviderRef.current = null;
    setProxyState(false);
    if (providerId) void stopOAuthProxy(providerId).catch(() => {});
  }
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const nameRef = useRef(name);
  nameRef.current = name;

  const isKiroProvider = provider?.id === "kiro";
  const isCodeBuddyProvider = provider?.id === "codebuddy-cn" || provider?.id === "codebuddy-intl";
  const dualMode = provider?.authModes?.length ? provider.authModes : null;
  const hasMultipleAuthModes = Boolean(dualMode && dualMode.length > 1);
  const [authMode, setAuthMode] = useState<string>(
    dualMode?.[0] ?? "auto"
  );
  const resolvedFlow: AuthFlow = isKiroProvider
    ? kiroAuthMode === "api-key" || kiroAuthMode === "import-token" || kiroAuthMode === "cli-proxy"
      ? kiroAuthMode === "api-key" ? "apikey" : "import"
      : "device"
    : dualMode && dualMode.includes(authMode)
      ? (authMode as AuthFlow)
      : flow ?? (dualMode?.includes("device") ? "device" : "apikey");
  const validBulkRows = bulkRows.filter((row) => row.valid === true);
  const activeBulkRow =
    bulkActiveIndex === null ? null : bulkRows[bulkActiveIndex] ?? null;
  const validCodeBuddyRows = codeBuddyRows.filter((row) => row.valid === true);
  const activeCodeBuddyRow =
    codeBuddyActiveIndex === null ? null : codeBuddyRows[codeBuddyActiveIndex] ?? null;

  function parseBulkLines(text: string) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.includes("|")
          ? line.split("|").map((part) => part.trim())
          : line.includes(",")
            ? line.split(",").map((part) => part.trim())
            : [line];
        return {

          name: parts.length >= 2 ? parts[0] : "",
          apiKey: parts.length >= 2 ? parts[1] : parts[0],
          valid: null as boolean | null,
          msg: undefined as string | undefined,
        };
      });
  }

  async function checkBulkKeys() {
    if (!provider) return;
    const parsed = parseBulkLines(bulkRaw);
    if (!parsed.length) return;
    setBulkChecking(true);
    const next = parsed.map((row) => ({ ...row, checking: false }));
    const seenKeys = new Set<string>();
    setBulkRows([...next]);
    setBulkActiveIndex(0);
    try {
      for (let index = 0; index < next.length; index += 1) {
        setBulkActiveIndex(index);
        const normalizedKey = next[index].apiKey.trim();
        if (seenKeys.has(normalizedKey)) {
          next[index] = {
            ...next[index],
            valid: false,
            checking: false,
            msg: "Duplicate API key in this batch",
          };
          setBulkRows([...next]);
          continue;
        }
        seenKeys.add(normalizedKey);
        next[index] = { ...next[index], checking: true };
        setBulkRows([...next]);
        try {
          const result = await testProviderKey({
            provider: provider.id,
            apiKey: next[index].apiKey,
          });
          next[index] = {
            ...next[index],
            valid: result.valid === true,
            checking: false,
            msg: result.valid === true ? "ok" : result.error || "fail",
          };
        } catch (error) {
          next[index] = {
            ...next[index],
            valid: false,
            checking: false,
            msg: getErrorMessage(error, "error"),
          };
        }
        setBulkRows([...next]);
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, BULK_RESULT_HOLD_MS);
        });
      }
    } finally {
      setBulkActiveIndex(null);
      setBulkChecking(false);
    }
  }

  async function submitBulkKeys() {
    if (!provider || !validBulkRows.length) return;
    setBulkLoading(true);
    setSubmitError(null);
    try {
      await onSubmit({
        name: provider.name,
        authFlow: "apikey",
        bulkKeys: validBulkRows.map(({ name, apiKey }, index) => {
          const explicitName = name.trim();
          return {
            name: explicitName || `swayrouter-account${index + 1}`,
            apiKey: apiKey.trim(),
            autoName: !explicitName,
          };
        }),
      });
    } catch (error) {
      setSubmitError(getErrorMessage(error, "Failed to add connections"));
    } finally {
      setBulkLoading(false);
    }
  }

  const effectiveFlow = resolvedFlow;
  const isApiKeyFlow = effectiveFlow === "apikey" || !!provider?.isCustom;
  const isOAuthFlow = effectiveFlow === "oauth";
  const isDeviceFlow = effectiveFlow === "device";
  const isAuthLinkFlow = isOAuthFlow || isDeviceFlow;
  const authFlowBooting = bootLoading && isAuthLinkFlow;

  function selectKiroAuthMode(mode: KiroAuthMode) {
    pollAbortRef.current = true;
    clearOAuthPolling();
    setKiroAuthMode(mode);
    setEntryTab("single");
    setKeyValid(null);
    setCheckMsg(null);
    setSubmitError(null);
    setOauthBootError(null);
    setDeviceCode(null);
    setDeviceCodeVerifier(null);
    setUserCode(null);
    setDeviceStatus(null);
    setAuthLink(null);
  }

  async function beginKiroDeviceAuth() {
    if (!provider || provider.id !== "kiro") return;
    const authMethod = kiroAuthMode === "iam" ? "idc" : "builder-id";
    const startUrl = kiroStartUrl.trim();
    if (authMethod === "idc" && !startUrl) {
      setOauthBootError("AWS IAM Identity Center requires a Start URL");
      return;
    }

    pollAbortRef.current = true;
    clearOAuthPolling();
    setBootLoading(true);
    setOauthBootError(null);
    setDeviceStatus(null);
    setDeviceCode(null);
    setDeviceCodeVerifier(null);
    setUserCode(null);
    setAuthLink(null);

    try {
      const res = await startDeviceCode("kiro", {
        authMethod,
        region: kiroRegion.trim() || "us-east-1",
        startUrl: startUrl || undefined,
      });
      const dc =
        (typeof res.device_code === "string" && res.device_code) ||
        (typeof res.deviceCode === "string" && res.deviceCode) ||
        null;
      if (!dc) throw new Error("Kiro did not return a device code");
      const uc =
        (typeof res.user_code === "string" && res.user_code) ||
        (typeof res.userCode === "string" && res.userCode) ||
        null;
      const vuri =
        (typeof res.verification_uri_complete === "string" && res.verification_uri_complete) ||
        (typeof res.verificationUriComplete === "string" && res.verificationUriComplete) ||
        (typeof res.verification_uri === "string" && res.verification_uri) ||
        (typeof res.verificationUri === "string" && res.verificationUri) ||
        null;
      setDeviceCode(dc);
      setUserCode(uc);
      setAuthLink(vuri);
      setDeviceCodeVerifier(typeof res.codeVerifier === "string" ? res.codeVerifier : null);
      setPollIntervalSec(typeof res.interval === "number" && res.interval > 0 ? res.interval : 5);
      setDeviceStatus("Waiting for you to authorize…");
    } catch (error) {
      setOauthBootError(getErrorMessage(error, "Failed to start Kiro authorization"));
    } finally {
      setBootLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setAuthMode(provider?.authModes?.[0] ?? "auto");
    setKiroAuthMode("builder-id");
    setKiroRegion("us-east-1");
    setKiroStartUrl("");
    setKiroRefreshToken("");
    setKiroClientId("");
    setKiroClientSecret("");
    setKiroProfileArn("");
    setKiroCliProxyJson("");
    setCodeBuddyToken("");
    setCheckMsg(null);
    setCursorAutoImporting(false);
    setCursorAutoImportMessage(null);
    setCursorAutoImportError(false);
    setEntryTab("single");
    setBulkRaw("");
    setBulkRows([]);
    setBulkActiveIndex(null);
    setCodeBuddyRows([]);
    setCodeBuddyChecking(false);
    setCodeBuddyActiveIndex(null);
  }, [open, provider?.id]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function loadPools() {
      try {
        const pools: ProxyPool[] = await listProxyPools();
        if (cancelled) return;
        setProxyOptions([
          { id: "pool_none", name: "None (direct)" },
          ...pools.map((p) => ({
            id: p.id,
            name: String(p.name || p.id),
          })),
        ]);
      } catch {

      }
    }
    void loadPools();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !provider) return;

    setName("");
    setApiKey("");
    setToken("");
    setMachineId("");
    setOauthCode("");
    setProxyPoolId("pool_none");
    setLoading(false);
    setBootLoading(false);
    setChecking(false);
    setKeyValid(null);
    setCheckMsg(null);
    setSubmitError(null);
    setLinkCopied(false);
    setOauthBootError(null);
    setDeviceStatus(null);
    setDeviceCode(null);
    setDeviceCodeVerifier(null);
    setUserCode(null);
    setOauthState(null);
    setOauthCodeVerifier(null);
    setOauthRedirectUri(null);
    setAuthLink(null);
    setEntryTab("single");
    setBulkRaw("");
    setBulkRows([]);
    setBulkActiveIndex(null);
    setBulkChecking(false);
    setBulkLoading(false);
    pollAbortRef.current = false;

    const providerId = provider.id;
    let cancelled = false;

    async function bootAuth() {
      if (effectiveFlow === "oauth") {
        setBootLoading(true);
        try {
          const redirectUri = getOAuthRedirectUri(providerId);
          const res = await startOAuth(providerId, redirectUri);
          if (cancelled) return;

          const url = res.authUrl || res.url || res.authorizeUrl || null;
          const state = typeof res.state === "string" ? res.state : null;
          const codeVerifier =
            typeof res.codeVerifier === "string" ? res.codeVerifier : null;
          const returnedRedirectUri =
            typeof res.redirectUri === "string" && res.redirectUri
              ? res.redirectUri
              : redirectUri;

          setAuthLink(typeof url === "string" ? url : null);
          setOauthState(state);
          if (state) storeOAuthCallbackProvider(state, providerId);
          setOauthCodeVerifier(codeVerifier);
          setOauthRedirectUri(returnedRedirectUri);
          oauthCompletionRef.current = false;

          const authFlowType =
            typeof res.flowType === "string" ? res.flowType : null;
          const requiresPkce =
            authFlowType === "authorization_code_pkce" ||
            PKCE_OAUTH_PROVIDERS.has(providerId);
          if (!url || !state || !returnedRedirectUri || (requiresPkce && !codeVerifier)) {
            throw new Error("OAuth provider returned incomplete authorization data");
          }

          if (providerId === "codex" || providerId === "xai") {
            const appPort =
              window.location.port ||
              (window.location.protocol === "https:" ? "443" : "80");
            try {
              const registrationState = state;
              const registrationCodeVerifier = codeVerifier;
              const registrationRedirectUri = returnedRedirectUri;
              if (!registrationState || !registrationCodeVerifier || !registrationRedirectUri) {
                throw new Error("OAuth provider returned incomplete authorization data");
              }
              const proxy = await startOAuthProxy(providerId, { appPort });
              if (!proxy.success) {
                throw new Error(
                  proxy.reason === "port_busy"
                    ? "The OAuth callback port is already in use"
                    : "The OAuth callback listener could not start"
                );
              }

              oauthProxyProviderRef.current = providerId;
              setProxyState(false);
              const registration = await registerOAuthSession(providerId, {
                state: registrationState,
                codeVerifier: registrationCodeVerifier,
                redirectUri: registrationRedirectUri,
              });
              if (registration.success !== true) {
                throw new Error("The OAuth session could not be registered");
              }
              if (cancelled) return;
              setProxyState(true);
            } catch (error) {

              setOauthBootError(
                getErrorMessage(
                  error,
                  "Automatic callback setup unavailable. Paste the browser callback code below."
                )
              );
              stopActiveOAuthProxy(providerId);
            }
          }

        } catch (err) {
          if (!cancelled) {
            setOauthBootError(getErrorMessage(err, "Failed to start OAuth"));
          }
        } finally {
          if (!cancelled) setBootLoading(false);
        }
        return;
      }

      if (effectiveFlow === "device") {
        if (providerId === "kiro") {
          if (kiroAuthMode === "builder-id") void beginKiroDeviceAuth();
          return;
        }
        setBootLoading(true);
        try {
          const res = await startDeviceCode(provider!.id);
          if (cancelled) return;
          const dc =
            (typeof res.device_code === "string" && res.device_code) ||
            (typeof res.deviceCode === "string" && res.deviceCode) ||
            null;
          const uc =
            (typeof res.user_code === "string" && res.user_code) ||
            (typeof res.userCode === "string" && res.userCode) ||
            null;
          const vuri =
            (typeof res.verification_uri_complete === "string" &&
              res.verification_uri_complete) ||
            (typeof res.verificationUriComplete === "string" &&
              res.verificationUriComplete) ||
            (typeof res.verification_uri === "string" &&
              res.verification_uri) ||
            (typeof res.verificationUri === "string" && res.verificationUri) ||
            null;
          setDeviceCode(dc);
          setUserCode(uc);
          setAuthLink(vuri);
          setDeviceCodeVerifier(
            typeof res.codeVerifier === "string" ? res.codeVerifier : null
          );
          const interval =
            typeof res.interval === "number" && res.interval > 0
              ? res.interval
              : 5;
          setPollIntervalSec(interval);
          setDeviceStatus("Waiting for you to authorize…");
        } catch (err) {
          if (!cancelled) {
            setOauthBootError(
              getErrorMessage(err, "Failed to start device code")
            );
          }
        } finally {
          if (!cancelled) setBootLoading(false);
        }
      }
    }

    void bootAuth();
    return () => {
      cancelled = true;
      pollAbortRef.current = true;
      clearOAuthPolling();
      closeOAuthPopup();
      stopActiveOAuthProxy(provider.id);
    };
  }, [open, provider, effectiveFlow, kiroAuthMode]);

  useEffect(() => {
    if (
      !open ||
      !provider ||
      effectiveFlow !== "oauth" ||
      !oauthServerSide ||
      !oauthState
    ) {
      return;
    }

    let cancelled = false;
    let attempts = 0;
    const providerId = provider.id;
    const providerName = provider.name;
    const state = oauthState;
    const maxAttempts = 200;

    const tick = async () => {
      if (cancelled || oauthCompletionRef.current) return;
      attempts += 1;
      try {
        const result = await pollOAuthStatus(providerId, state);
        if (cancelled || oauthCompletionRef.current) return;
        if (result.status === "done") {
          oauthCompletionRef.current = true;
          clearOAuthPolling();
          closeOAuthPopup();
          stopActiveOAuthProxy(providerId);
          setLoading(true);
          try {
            await onSubmitRef.current({
              name: nameRef.current.trim() || providerName,
              alreadySaved: true,
            });
          } catch {
            setOauthBootError("Connection saved, but the provider list could not refresh");
          } finally {
            setLoading(false);
          }
          return;
        }
        if (result.status === "error") {
          oauthCompletionRef.current = true;
          clearOAuthPolling();
          closeOAuthPopup();
          stopActiveOAuthProxy(providerId);
          setOauthBootError(result.error || "OAuth sign-in failed");
          return;
        }
      } catch {

      }

      if (!cancelled && !oauthCompletionRef.current && attempts < maxAttempts) {
        pollTimerRef.current = setTimeout(() => void tick(), 1500);
      } else if (!cancelled && !oauthCompletionRef.current) {
        setOauthBootError("OAuth sign-in timed out. Use the manual code fallback.");
        stopActiveOAuthProxy(providerId);
      }
    };

    pollTimerRef.current = setTimeout(() => void tick(), 750);
    return () => {
      cancelled = true;
      clearOAuthPolling();
    };
  }, [open, provider, effectiveFlow, oauthServerSide, oauthState]);

  useEffect(() => {
    if (!open || !provider || effectiveFlow !== "oauth") return;

    const providerId = provider.id;
    const providerName = provider.name;
    const state = oauthState;
    if (!state) return;

    let expectedCallbackOrigin = window.location.origin;
    if (oauthRedirectUri) {
      try {
        expectedCallbackOrigin = new URL(oauthRedirectUri).origin;
      } catch {
        return;
      }
    }

    const validatePayload = (payload: OAuthCallbackPayload) =>
      validateOAuthCallbackMessage(createOAuthCallbackMessage(payload), {
        origin: expectedCallbackOrigin,
        eventOrigin: expectedCallbackOrigin,
        expectedState: state,
        expectedProvider: providerId,
      });

    function completeCallback(payload: OAuthCallbackPayload) {
      if (oauthCompletionRef.current) return;

      if (payload.error) {
        if (payload.state) clearOAuthCallback(payload.state);
        setOauthBootError(
          payload.errorDescription || payload.error || "OAuth sign-in failed",
        );
        return;
      }
      if (!payload.code || !payload.state) return;

      clearOAuthCallback(payload.state);
      oauthCompletionRef.current = true;
      setOauthCode(payload.code);
      setDeviceStatus(null);
      setLoading(true);
      void (async () => {
        try {
          await onSubmitRef.current({
            name: nameRef.current.trim() || providerName,
            authFlow: "oauth",
            oauthCode: payload.code,
            oauthState: payload.state,
            oauthCodeVerifier: oauthCodeVerifier || undefined,
            oauthRedirectUri: oauthRedirectUri || undefined,
          });
          closeOAuthPopup();
        } catch (error) {
          oauthCompletionRef.current = false;
          setOauthBootError(
            getErrorMessage(
              error,
              "OAuth sign-in completed, but the token exchange failed. Restart the connection flow and try again.",
            ),
          );
        } finally {
          setLoading(false);
        }
      })();
    }

    function onMessage(ev: MessageEvent) {
      const payload = validateOAuthCallbackMessage(ev.data, {
        origin: expectedCallbackOrigin,
        eventOrigin: ev.origin,
        expectedState: state,
        expectedProvider: providerId,
        eventSource: ev.source,
        expectedSource: popupRef.current,
      });
      if (!payload) return;
      completeCallback(payload);
    }

    const callbackState = state;
    const callbackStorageKey = getOAuthCallbackStorageKey(callbackState);
    function consumeStoredCallback(value?: string | null) {
      const stored = value === undefined
        ? readOAuthCallback(callbackState)
        : parseOAuthCallbackStorageValue(value);
      const payload = stored ? validatePayload(stored) : null;
      if (payload) completeCallback(payload);
    }

    function onStorage(ev: StorageEvent) {
      if (ev.key !== callbackStorageKey) return;
      consumeStoredCallback(ev.newValue);
    }

    consumeStoredCallback();
    window.addEventListener("message", onMessage);
    window.addEventListener("storage", onStorage);
    const storageTimer = window.setInterval(() => consumeStoredCallback(), 500);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("storage", onStorage);
      window.clearInterval(storageTimer);
    };
  }, [
    open,
    provider,
    effectiveFlow,
    oauthState,
    oauthCodeVerifier,
    oauthRedirectUri,
  ]);

  useEffect(() => {
    return () => {
      pollAbortRef.current = true;
      clearOAuthPolling();
      closeOAuthPopup();
      stopActiveOAuthProxy();
    };
  }, []);

  useEffect(() => {
    if (
      !open ||
      !provider ||
      effectiveFlow !== "device" ||
      !deviceCode
    ) {
      return;
    }
    pollAbortRef.current = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const providerId = provider.id;
    const providerName = provider.name;
    const verifier = deviceCodeVerifier || undefined;
    const intervalMs = Math.max(2, pollIntervalSec) * 1000;

    async function tick() {
      if (stopped || pollAbortRef.current || !deviceCode) return;
      try {
        const res = await pollDeviceCode(providerId, {
          deviceCode,
          codeVerifier: verifier,
          displayName: nameRef.current.trim() || providerName,
        });
        if (stopped || pollAbortRef.current) return;
        if (res.success) {
          setDeviceStatus("Authorized — connection saved");
          setLoading(true);
          try {
            await onSubmitRef.current({
              name: nameRef.current.trim() || providerName,
              alreadySaved: true,
            });
          } catch {
            setDeviceStatus("Authorized — refresh the list if not visible");
          } finally {
            setLoading(false);
          }
          return;
        }
        if (res.pending) {
          setDeviceStatus("Still waiting for authorization…");
        } else if (res.error) {
          setDeviceStatus(res.error);
        }
      } catch (err) {
        if (!stopped) {
          setDeviceStatus(getErrorMessage(err, "Poll failed"));
        }
      }
      if (!stopped && !pollAbortRef.current) {
        timer = setTimeout(tick, intervalMs);
      }
    }

    timer = setTimeout(tick, intervalMs);
    return () => {
      stopped = true;
      pollAbortRef.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    open,
    provider?.id,
    provider?.name,
    effectiveFlow,
    deviceCode,
    deviceCodeVerifier,
    pollIntervalSec,
  ]);

  useEffect(() => {
    setKeyValid(null);
    setCheckMsg(null);
    setSubmitError(null);
  }, [apiKey]);

  if (!provider) return null;

  const cta = connectionCtaLabel(provider.authType, provider.noAuth);
  const ctaShort = connectionCtaShort(provider.authType, provider.noAuth);

  const canSubmit =
    !loading &&
    !authFlowBooting &&
    (isApiKeyFlow
      ? keyValid === true && apiKey.trim().length > 0
      : effectiveFlow === "import"
        ? isCodeBuddyProvider
          ? validCodeBuddyRows.length > 0 && !codeBuddyChecking
          : isKiroProvider
          ? kiroAuthMode === "import-token"
            ? kiroRefreshToken.trim().length > 0
            : kiroCliProxyJson.trim().length > 0
          : token.trim().length > 0 &&
            (provider?.id !== "cursor" || machineId.trim().length > 0)
        : effectiveFlow === "oauth"
          ? oauthCode.trim().length > 0
          : effectiveFlow === "device"
            ? Boolean(deviceCode)
            : effectiveFlow === "local"
              ? true
              : true);

  async function onCheckKey() {
    if (!provider || !apiKey.trim()) return;
    setChecking(true);
    setCheckMsg(null);
    try {
      const res = await testProviderKey({
        provider: provider.id,
        apiKey: apiKey.trim(),
        ...(isKiroProvider
          ? { providerSpecificData: { region: kiroRegion.trim() || "us-east-1" } }
          : {}),
      });
      const ok = res.valid === true;
      setKeyValid(ok);
      setCheckMsg(ok ? "Key valid" : res.error || "Key invalid");
    } catch (err) {
      setKeyValid(false);
      setCheckMsg(getErrorMessage(err, "Check failed"));
    } finally {
      setChecking(false);
    }
  }

  async function onCheckCodeBuddyTokens() {
    if (!provider || !codeBuddyToken.trim()) return;
    const parsed = parseCodeBuddyTokenLines(codeBuddyToken);
    if (!parsed.length) return;
    setCodeBuddyChecking(true);
    const next = parsed.map((row) => ({ ...row, checking: false }));
    const seenTokens = new Set<string>();
    setCodeBuddyRows([...next]);
    setCodeBuddyActiveIndex(0);
    try {
      for (let index = 0; index < next.length; index += 1) {
        setCodeBuddyActiveIndex(index);
        const row = next[index];
        if (row.valid === false) {
          setCodeBuddyRows([...next]);
          continue;
        }
        const fingerprint = row.credentialToken || `${row.accessToken}|${row.refreshToken}`;
        if (seenTokens.has(fingerprint)) {
          next[index] = {
            ...row,
            valid: false,
            checking: false,
            msg: "Duplicate token pair in this batch",
          };
          setCodeBuddyRows([...next]);
          continue;
        }
        seenTokens.add(fingerprint);
        next[index] = { ...row, checking: true };
        setCodeBuddyRows([...next]);
        try {
          const result = await testCodeBuddyToken({
            provider: provider.id,
            ...(row.credentialToken
              ? { credentialToken: row.credentialToken }
              : { accessToken: row.accessToken, refreshToken: row.refreshToken }),
          });
          next[index] = {
            ...row,
            valid: result.valid === true,
            checking: false,
            msg: result.valid === true ? "ok" : result.error || "Token invalid",
          };
        } catch (error) {
          next[index] = {
            ...row,
            valid: false,
            checking: false,
            msg: getErrorMessage(error, "Token validation failed"),
          };
        }
        setCodeBuddyRows([...next]);
        if (index < next.length - 1) {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, CODEBUDDY_RESULT_HOLD_MS);
          });
        }
      }
    } finally {
      setCodeBuddyActiveIndex(null);
      setCodeBuddyChecking(false);
    }
  }

  async function onAutoImportCursor() {
    if (!provider || provider.id !== "cursor") return;
    setCursorAutoImporting(true);
    setCursorAutoImportMessage(null);
    setCursorAutoImportError(false);
    try {
      const result = await autoImportCursor();
      if (!result.found || !result.accessToken || !result.machineId) {
        throw new Error(result.error || "Cursor credentials were not found on this device");
      }
      setToken(result.accessToken);
      setMachineId(result.machineId);
      setCursorAutoImportMessage("Cursor token and Machine ID filled automatically");
    } catch (error) {
      setCursorAutoImportError(true);
      setCursorAutoImportMessage(getErrorMessage(error, "Could not detect Cursor credentials"));
    } finally {
      setCursorAutoImporting(false);
    }
  }

  async function copyAuthLink() {
    if (!authLink) return;
    try {
      await navigator.clipboard.writeText(authLink);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 1500);
    } catch {

    }
  }

  function openAuthLink() {
    if (!authLink) return;
    const popup = window.open(
      authLink,
      "sway-oauth",
      "popup,width=600,height=700"
    );
    popupRef.current = popup;
    if (!popup) {
      setOauthBootError(
        "The browser blocked the authorization window. Open the URL above manually or allow popups for this dashboard."
      );
    }
  }

  async function handleSubmit() {
    if (!provider || !canSubmit) return;
    setLoading(true);
    setSubmitError(null);
    try {
      const finalName = name.trim();
      const parsedOAuth = isOAuthFlow
        ? parseOAuthCallbackInput(oauthCode, oauthState)
        : null;
      await onSubmit({
        name: finalName,
        autoName: isApiKeyFlow && !finalName,
        authFlow: effectiveFlow,
        apiKey: isApiKeyFlow ? apiKey.trim() || undefined : undefined,
        importToken: effectiveFlow === "import" && !isKiroProvider && !isCodeBuddyProvider
          ? token.trim() || undefined
          : undefined,
        codeBuddyToken: effectiveFlow === "import" && isCodeBuddyProvider
          ? validCodeBuddyRows.length === 1
            ? validCodeBuddyRows[0].credentialToken || undefined
            : undefined
          : undefined,
        codeBuddyTokens: effectiveFlow === "import" && isCodeBuddyProvider
          ? validCodeBuddyRows.map((row, index) => {
            const explicitName = validCodeBuddyRows.length === 1 ? finalName : "";
            return {
              ...(row.credentialToken
                ? { credentialToken: row.credentialToken }
                : { accessToken: row.accessToken, refreshToken: row.refreshToken }),
              name: explicitName || `swayrouter-account${index + 1}`,
              autoName: !explicitName,
            };
          })
          : undefined,
        machineId: effectiveFlow === "import" ? machineId.trim() || undefined : undefined,
        kiroAuthMode: isKiroProvider ? kiroAuthMode : undefined,
        kiroRegion: isKiroProvider ? kiroRegion.trim() || "us-east-1" : undefined,
        kiroRefreshToken: isKiroProvider ? kiroRefreshToken.trim() || undefined : undefined,
        kiroClientId: isKiroProvider ? kiroClientId.trim() || undefined : undefined,
        kiroClientSecret: isKiroProvider ? kiroClientSecret.trim() || undefined : undefined,
        kiroProfileArn: isKiroProvider ? kiroProfileArn.trim() || undefined : undefined,
        kiroCliProxyJson: isKiroProvider ? kiroCliProxyJson.trim() || undefined : undefined,
        oauthCode: parsedOAuth?.code,
        oauthState: parsedOAuth?.state,
        oauthCodeVerifier: isOAuthFlow
          ? oauthCodeVerifier || undefined
          : undefined,
        oauthRedirectUri: isOAuthFlow
          ? oauthRedirectUri || undefined
          : undefined,
        deviceCode: isDeviceFlow ? deviceCode || undefined : undefined,
        deviceCodeVerifier: isDeviceFlow
          ? deviceCodeVerifier || undefined
          : undefined,
        proxyPoolId: isApiKeyFlow ? proxyPoolId : null,
      });
    } catch (error) {
      setSubmitError(getErrorMessage(error, "Failed to add connection"));
    } finally {
      setLoading(false);
    }
  }

  const dialogCta = entryTab === "bulk" && isApiKeyFlow ? "Add connections" : cta;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {dialogCta} — {provider.name}
          </DialogTitle>
        </DialogHeader>
          <div
            className={cn(
            "px-6",
            isApiKeyFlow && entryTab === "bulk" ? "space-y-2 pb-4" : "space-y-3 pb-4",
          )}
        >
          {!isKiroProvider && hasMultipleAuthModes && dualMode ? (
            <AuthModeSelector
              value={authMode}
              modes={dualMode}
              label={(mode) => authModeLabel(provider?.id ?? "", mode)}
              onChange={(value) => {
                setAuthMode(value);
                setEntryTab("single");
                setBulkRaw("");
                setBulkRows([]);
                setBulkActiveIndex(null);
                setSubmitError(null);
              }}
            />
          ) : null}
          {isKiroProvider ? (
            <KiroAuthSelector
              value={kiroAuthMode}
              region={kiroRegion}
              startUrl={kiroStartUrl}
              onChange={selectKiroAuthMode}
              onRegionChange={setKiroRegion}
              onStartUrlChange={setKiroStartUrl}
            />
          ) : null}
          {isApiKeyFlow && !isKiroProvider ? (
            <ApiKeyEntryTabs
              value={entryTab}
              onChange={setEntryTab}
            />
          ) : null}
          {isApiKeyFlow && !isKiroProvider && entryTab === "bulk" ? (
            <BulkApiKeyFields
              raw={bulkRaw}
              rows={bulkRows}
              activeIndex={bulkActiveIndex}
              activeRow={activeBulkRow}
              checking={bulkChecking}
              validCount={validBulkRows.length}
              onRawChange={(value) => {
                setBulkRaw(value);
                setBulkRows([]);
                setBulkActiveIndex(null);
                setSubmitError(null);
              }}
              onCheck={checkBulkKeys}
            />
          ) : null}
          {entryTab === "single" ? (
            <>
          <div className="space-y-1.5">
            <label htmlFor="connection-account-name" className="text-xs font-medium text-muted-foreground">
              Account name <span className="font-normal text-muted-foreground/70">(optional)</span>
            </label>
            <Input
              id="connection-account-name"
              placeholder="Auto: swayrouter-account"
              value={name}
              aria-invalid={Boolean(submitError)}
              aria-describedby={submitError ? "connection-submit-error" : undefined}
              onChange={(e) => {
                setName(e.target.value);
                setSubmitError(null);
              }}
            />
          </div>

          {oauthBootError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
              {oauthBootError}
            </div>
          ) : null}

          {authFlowBooting ? (
            <p className="text-xs text-muted-foreground">
              <TextShimmer>Starting auth flow…</TextShimmer>
            </p>
          ) : null}

          {effectiveFlow === "import" ? (
            isCodeBuddyProvider ? (
              <CodeBuddyTokenFields
                raw={codeBuddyToken}
                rows={codeBuddyRows}
                activeIndex={codeBuddyActiveIndex}
                activeRow={activeCodeBuddyRow}
                checking={codeBuddyChecking}
                validCount={validCodeBuddyRows.length}
                onRawChange={(value) => {
                  setCodeBuddyToken(value);
                  setCodeBuddyRows([]);
                  setCodeBuddyActiveIndex(null);
                  setSubmitError(null);
                }}
                onCheck={onCheckCodeBuddyTokens}
              />
            ) : isKiroProvider ? (
              <KiroImportFields
                mode={kiroAuthMode}
                refreshToken={kiroRefreshToken}
                clientId={kiroClientId}
                clientSecret={kiroClientSecret}
                profileArn={kiroProfileArn}
                cliProxyJson={kiroCliProxyJson}
                onRefreshTokenChange={setKiroRefreshToken}
                onClientIdChange={setKiroClientId}
                onClientSecretChange={setKiroClientSecret}
                onProfileArnChange={setKiroProfileArn}
                onCliProxyJsonChange={setKiroCliProxyJson}
              />
            ) : (
              <ImportTokenFields
                providerId={provider.id}
                token={token}
                machineId={machineId}
                importing={cursorAutoImporting}
                message={cursorAutoImportMessage}
                hasError={cursorAutoImportError}
                onTokenChange={setToken}
                onMachineIdChange={setMachineId}
                onAutoImport={onAutoImportCursor}
              />
            )
          ) : effectiveFlow === "local" ? (
            <p className="text-sm text-muted-foreground">
              Local provider — no key required.
            </p>
          ) : isAuthLinkFlow ? (
            <AuthLinkFields
              isDeviceFlow={isDeviceFlow}
              isOAuthFlow={isOAuthFlow}
              isKiroIam={isKiroProvider && kiroAuthMode === "iam"}
              authLink={authLink}
              userCode={userCode}
              deviceStatus={deviceStatus}
              deviceCode={deviceCode}
              bootLoading={bootLoading}
              linkCopied={linkCopied}
              oauthCode={oauthCode}
              kiroStartUrl={kiroStartUrl}
              onStartKiroAuthorization={beginKiroDeviceAuth}
              onOpenAuthLink={openAuthLink}
              onCopyAuthLink={copyAuthLink}
              onOauthCodeChange={setOauthCode}
            />
          ) : (
            <ApiKeyCredentialsFields
              authLabel={authModeLabel(provider.id, "apikey")}
              apiKey={apiKey}
              region={kiroRegion}
              checking={checking}
              keyValid={keyValid}
              checkMsg={checkMsg}
              submitError={submitError}
              proxyPoolId={proxyPoolId}
              proxyOptions={proxyOptions}
              showKiroRegion={isKiroProvider}
              onApiKeyChange={(value) => {
                setApiKey(value);
                setSubmitError(null);
              }}
              onRegionChange={setKiroRegion}
              onCheck={onCheckKey}
              onProxyPoolChange={setProxyPoolId}
            />
          )}
          {submitError ? (
            <p id="connection-submit-error" className="text-xs text-destructive" role="alert">
              {submitError}
            </p>
          ) : null}
            </>
          ) : null}
        </div>
        <DialogFooter>
          <RippleButton variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </RippleButton>
          <RippleButton
            disabled={entryTab === "bulk" ? bulkLoading || bulkChecking || validBulkRows.length === 0 : !canSubmit}
            className={cn(
              (entryTab === "bulk" ? bulkLoading || bulkChecking || validBulkRows.length === 0 : !canSubmit) &&
                "opacity-40"
            )}
            onClick={() => void (entryTab === "bulk" ? submitBulkKeys() : handleSubmit())}
          >
            {entryTab === "bulk" ? (
              bulkLoading ? "Adding…" : "Add"
            ) : loading ? (
              <TextShimmer>
                {isDeviceFlow || isOAuthFlow ? "Waiting…" : "Saving…"}
              </TextShimmer>
            ) : isDeviceFlow ? (
              "Poll now"
            ) : isOAuthFlow && !oauthCode.trim() ? (
              "Waiting for browser…"
            ) : (
              ctaShort
            )}
          </RippleButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
