# Changelog

All notable changes to Sway Router are documented here.

## [Unreleased]

### Fixed

- Fix **Grok CLI (Grok Build) streaming rejected with `426 Your Grok CLI version (0.2.99) is outdated`**: xAI now requires client version 1.0.13+, so the announced client version (`GROK_CLI_VERSION`, which also derives the `grok-shell/<version>` user agent) is bumped to 1.0.13 — applied to streaming, token, model-list, billing, and gRPC quota requests through the shared config.
- Fix the **Grok CLI quota monitor** showing a fake exhausted `On-demand 1/1 (0% remaining)` quota: unified-billing accounts (`isUnifiedBillingUser`) send `onDemandCap {val: 0}` / `onDemandUsed {val: 0}`, which the parser misread as an exhausted promo. The parser no longer fabricates a quota from a zero cap, and the weekly window now comes from the authoritative `GetGrokCreditsConfig` gRPC-web response, which is fetched whenever the billing payload carries no allowance quota (not only when it is empty) and merged instead of replacing real on-demand/prepaid entries. The gRPC frame decoder also no longer reports `0% used` when the usage-ratio field is absent; a credits config that only carries the usage-period window is treated as "no usage yet this period" (mirrors CodexBar), and the deprecated legacy `used` field is honored for `monthlyLimit` budgets.
- Fix the **Grok CLI quota monitor stuck at 100%** on free-tier accounts: the tier is now read from the CLI-proxy settings (`GET /v1/settings` → `subscription_tier_display`, alongside `subscriptionTier` and the billing config), and a free account no longer gets a fabricated `Weekly SuperGrok 0/100` pool (its `creditUsagePercent: 0` is a proto3 default, not a measured pool). Free accounts instead show the real metered spend from the plain `GET /v1/billing` ledger (`used` cents converted to USD, `Monthly metered` with the billing-cycle reset, unlimited when there is no on-demand cap), and the quota card now renders the `used` value and unit for unlimited quotas instead of a bare "Unlimited". All Cent-valued Grok quotas (`monthlyLimit`, `onDemandCap/Used`, `prepaidBalance`) are converted to USD and labelled `unit: "USD"`.
- Harden **Grok CLI quota monitor** tier detection (mirrors grok2api's CLI adapter): the tier now resolves through a chain — CLI `/v1/settings` display name, the `/v1/user` subscription object, billing plan fields, and finally the access token's `tier` JWT claim (numeric `0=Free … 6=SuperGrok Lite`). When no source names a tier, a successful billing snapshot with every paid field at zero is inferred as a Free account (xAI omits the plan name there), while any positive paid field (`monthlyLimit`, `onDemand*`, `prepaidBalance`) keeps the account paid. Free accounts also gain a locally measured **rolling token quota** (`Tokens (rolling 5h, est.)`, counted from this router's own request log, cap estimated) next to the metered USD spend, so the card shows real consumption even though the cap is an estimate.
- Fix the **long-uptime `router_capacity_exhausted` lock**: the admission limiter used its startup RSS to size memory water marks and treated any sample over them as pressure, shrinking the concurrency target with no way back once the allocator settled at a higher steady state — the router only recovered by restarting. The limiter no longer treats RSS growth as capacity pressure at all: RSS is a constant-basis gate (cgroup limit / machine memory from the shared resource profile) that only rejects **new** admissions at the critical water mark, lets queued requests settle when memory drops, and never permanently shrinks the target. A new `readRss` seam keeps the regression tests deterministic.

### Added

- Import a grok.com `sso` cookie directly on the **Grok CLI (Grok Build)** provider: a new **SSO** / **Bulk SSO** mode in the Add Connection dialog pastes `sso=` values (bare token, `sso=` prefix, or a full cookie header) and exchanges each one into real Grok Build OAuth credentials through the xAI device authorization flow — including the previously missing `consent_token` step on the approval POST. The connection is stored as an OAuth account labelled with the grok.com account email and refreshes with the grok-cli refresh token. `grok-web` keeps its cheap identity-only cookie validation.
- Make every **copy** button work outside `localhost` — in Docker/server deployments reached over plain HTTP the Clipboard API does not exist, so the copy buttons (console logs "Copy", API key copy, gateway/URL copy, model ID copy, code blocks, chat response copy, tunnel URL, connection error copy) failed silently. All of them now go through the shared `copyText` helper with the legacy `execCommand` fallback and show a real error toast when copying is impossible.

### Antigravity

- Show the **plan badge** on the quota monitor: the account headline renders as `[Plan] email` on a single line, each tier with its own color (Free=slate, Plus=sky, Pro=violet, Ultra=amber, Enterprise=rose). The tier is read from `loadCodeAssist` and normalized through a tier map (`free-tier`→Free, `standard-tier`/`g1-pro-tier`→Pro, `g1-plus-tier`→Plus, `g1-ultra-tier`/`helium`→Ultra, Enterprise IDs/names→Enterprise).
- Prefer `paidTier` over `currentTier` for the plan badge: `currentTier.id` stays `free-tier` even on paying accounts, so a Google AI Plus subscriber showed "Free".
- Keep the plan badge visible when the quota API fails (401/403 or a thrown request): the tier is now resolved once from the subscription info and attached to every return path of `getAntigravityUsage`.
- Support **Gemini 3.8 and 3.7 models** — `gemini-3.8-flash-{high,medium,low}` (exact-level upstream IDs) and `gemini-3.7-flash-{high,medium,low}` (tiered IDs), with the Code Assist client announcing IDE version 2.5.5.

### Grok CLI

- Show a **Bot** badge on the provider connections list for accounts whose access token carries the bot-flag claim (`bot_flag_source`/`bfs`, numeric 1/2 — mirrors grok2api's CLI adapter).

### Chat tools

- Let the built-in chat **curl** tool reach `localhost`, `127.0.0.1`, and LAN targets when `SSRF_ALLOW_PRIVATE=true` is set, so self-hosted routers can have the agent probe their own services. Cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`) stay blocked even with the flag. Documented in both READMEs.
- Ship **ripgrep** in the Docker image so the chat shell tool's `rg` subcommand works out of the box (the image previously lacked the binary, and `rg` failed with `Executable not found`). Native (non-Docker) installs now get a clear error naming `ripgrep` as the missing dependency instead of an opaque `ENOENT`.
- Let the chat **curl** tool call the router's **own** API without an API key and without `SSRF_ALLOW_PRIVATE`: requests to `http://127.0.0.1:<PORT>` (loopback + own port) bypass the SSRF guard and carry the internal CLI token accepted by `dashboardGuard`'s local-only check. Other hosts never receive the token, and other private targets stay blocked unless the flag is set. This lets you instruct the agent to query `/api/models`, `/api/combos`, `/api/usage`, etc. and reason over router state.
- The chat **shell** tool's `rg` search now accepts safe flags (`-i`, `-l`, `-n`, `-w`, `-F`, `-c`, `-t <type>`, `-g <glob>`); rejected flags, shell operators, and overflow path lists return instructions showing the supported syntax.
- The chat agent's system prompt now carries a **Router API skills** section (endpoint catalog: `/api/models`, `/api/combos`, `/api/providers`, `/api/usage`, `/api/health/ready`, `/v1/chat/completions`, the correct loopback base for the curl tool, and the ranking procedure). Key fact encoded: models/combos/connections live in the router database, not the workspace filesystem.
- Added `SKILL.md` at the repo root — a generated catalog of every API endpoint with its auth class and a usage guide for the chat agent (generated by `bun run skills:api` from `src/routes/**/route.*` and `src/dashboardGuard.js`; shipped in the Docker image). The chat agent's system prompt points to it, and it is the source of truth for "which endpoint answers this router question".

## [1.0.8] - 2026-09-26

### Fixed

- Make the OAuth **Copy link** button work on Docker deployments reached over plain HTTP: `navigator.clipboard` only exists in a secure context, so copying now falls back to the legacy `execCommand` path and reports a failure instead of staying silent.
- Show how many provider connections are hidden behind pagination and add a **Load more** button: the sidebar counts every account (459 for the busiest custom node) while the connection list only rendered the first 50 and loaded the rest solely on scroll-to-bottom.
- Fix CodeBuddy model tests failing with `CodeBuddy 11128: first message is not system prompt`: the generic model-test route now uses the CodeBuddy Intl probe shape, and both CodeBuddy executors prepend a system prompt when the caller sent none.

[1.0.8]: https://github.com/zengkuni/SuwokRouter/releases/tag/v1.0.8

## [1.0.7] - 2026-09-26

### Added

- Label CodeBuddy connections with the account email collected from the CodeBuddy server (`GET /v2/accounts`) during device login and Access Token import, then the account name, then `CodeBuddy-1`, `CodeBuddy-2`, … when neither is available.
- Port upstream SwayRouter v1.0.7: stop fallback on non-retryable request statuses (400/405/413/415/422) and cancellations (499) without cooling the account, turn aborted combo requests into a terminal 499, replace the CodeBuddy CN/Intl model catalogs with the real ones, drop CodeBuddy API-key mode (device + Access Token only), add package-aware quota status (an exhausted CodeBuddy package no longer marks the account limited) with 60s quota refresh, and line numbers in the CodeBuddy token field.
- Add a safe **Migrate from 9Router** flow with local database detection and
  9Router JSON import.
- Add migration previews, selectable data scopes, conflict handling, automatic
  database backups, transaction rollback, and animated progress states.
- Keep imported accounts inactive by default and normalize legacy CodeBuddy
  provider data to Sway Router's built-in provider.

### Fixed

- Prevent 9Router backups from being mistaken for regular Sway Router restores.
- Keep routing settings, dashboard security, gateway keys, usage history, and
  request logs out of the 9Router migration by default.

[1.0.7]: https://github.com/zengkuni/SwayRouter/releases/tag/v1.0.7

## [1.0.4] - 2026-09-19

- Add OpenCode Free, Zen, and Go support with official endpoints, model discovery, and authentication validation.
- Handle OpenCode fingerprint headers, tool compatibility, streaming, Responses, and Anthropic Messages transports.
- Keep OpenCode keyless Free setup clear by hiding connection controls when no API key is required.

[1.0.4]: https://github.com/zengkuni/SwayRouter/releases/tag/v1.0.4

## [1.0.3] - 2026-09-13

- Improve mobile and tablet responsiveness across the dashboard.
- Fix provider connection and model lists being clipped or difficult to scroll on iOS.
- Improve mobile status visibility and Sway Chat layout behavior.

[1.0.3]: https://github.com/zengkuni/SwayRouter/releases/tag/v1.0.3

## [1.0.1] - 2026-09-12

- Publish the Sway Router package as `swayrouter` on npm.
- Add global CLI uninstall instructions to the English and Indonesian README files.

[1.0.1]: https://github.com/zengkuni/SwayRouter/releases/tag/v1.0.1

## [1.0.0] - 2026-09-12

Sway Router is the new project identity, package name, and CLI name.

- Use `swayrouter` for global installation and daily commands.
- Use `SwayRouter` for the repository and release links.
- Store fresh runtime data under the Sway Router data directory and use Sway Router
  environment and internal identifiers throughout the app.
- Rename the dashboard chat workspace to Sway Chat at `/dashboard/sway-chat`.

[1.0.0]: https://github.com/zengkuni/SwayRouter/releases/tag/v1.0.0

## [1.2.0] - 2026-09-10

### Highlights

- Perplexity AI runs through the official Router API with live model discovery.
- Supports OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages.
- Keeps provider setup simple with one API key and one dashboard entry.
- Refreshes the English and Indonesian provider documentation.

[1.2.0]: https://github.com/zengkuni/SwayRouter/releases/tag/v1.2.0

## [1.1.0] - 2026-09-10

### Changed

- Preserve caller-provided system and developer instructions across provider
  adapters without router-owned identity or repair prompts.
- Remove legacy OAuth cloaking, fake tool declarations, and hidden prompt
  replacements from provider compatibility paths.
- Keep native response-format requests intact for OpenAI-compatible providers.

### Tests

- Add prompt-transparency regression coverage for the main provider adapters.

[1.1.0]: https://github.com/zengkuni/SwayRouter/releases/tag/v1.1.0

## [1.0.10] - 2026-09-09

### Fixed

- Make provider routing and Thinking Mode controls fit narrow mobile, tablet,
  and iPad Pro layouts without clipping.
- Add responsive E2E coverage for iPad Pro, iPad Air, tablet, and mobile
  viewport sizes.

### Documentation

- Document the 9Router migration sources, selectable data scopes, preview,
  duplicate handling, safety backup, and inactive-account defaults in both
  README files.

[1.0.10]: https://github.com/zengkuni/SwayRouter/releases/tag/v1.0.10

## [1.0.9] - 2026-09-09

### Fixed

- Prevent duplicate Windows tray hosts when Sway Router is started more than
  once or restarted from the dashboard.
- Keep legacy 9Router provider mappings internal while making migration
  previews clearer about imported, handled, duplicate, and skipped data.
- Explain skipped custom models as provider references missing from the backup.

[1.0.9]: https://github.com/zengkuni/SwayRouter/releases/tag/v1.0.9

## [1.0.8] - 2026-09-09

### Fixed

- Keep local OAuth callbacks aligned when the dashboard is opened through
  either `localhost` or `127.0.0.1`.

[1.0.8]: https://github.com/zengkuni/SwayRouter/releases/tag/v1.0.8

## [1.0.6] - 2026-09-08

### Fixed

- Restore Antigravity's bundled desktop OAuth application credentials and use
  the provider's supported authorization-code exchange.
- Show a clear retry message when an OAuth callback succeeds but token exchange
  fails.
- Show a native checked state for the tray auto-start toggle.
- Re-read the actual auto-start state after enabling or disabling it so the
  tray menu cannot show a stale status.
- Show a continuously moving progress bar while the CLI installs an update.
- Keep package-manager output from making the interactive update flow look stuck.
- Add a compact animated progress bar for CLI start, restart, and stop actions.
- Stack progress feedback below the action label for clearer terminal output.
- Keep the Windows system tray alive after the terminal closes.
- Make `start -b`, `--tray`, and Windows auto-start use the detached tray host.
- Keep native runtime status and stop checks fast and deterministic on Windows.

### Highlights

- OpenAI-, Anthropic-, Gemini-, and Ollama-compatible HTTP APIs.
- Provider, account, model, routing, combo, proxy, quota, usage, and log
  management from one responsive dashboard.
- OAuth, API-key, device-code, access-token, refresh-token, cookie, and custom
  provider connection flows.
- Multi-account routing, quota-aware selection, fallback, retries, request
  translation, and automatic token refresh.
- SQLite persistence, backup and restore, automatic runtime secrets, global Bun
  CLI, Docker deployment, and standalone binaries.

[1.0.6]: https://github.com/zengkuni/SwayRouter/releases/tag/v1.0.6
