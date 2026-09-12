# Changelog

All notable changes to Sway Router are documented here.

## [1.0.0] - 2026-09-12

Sway Router is the new project identity, package name, and CLI name.

- Use `swayrouter` for global installation and daily commands.
- Use `SwayRouter` for the repository and release links.
- Store fresh runtime data under the Sway Router data directory and use Sway Router
  environment and internal identifiers throughout the app.
- Rename the dashboard chat workspace to Sway Chat at `/dashboard/sway-chat`.

[1.0.0]: https://github.com/envielxyz/SwayRouter/releases/tag/v1.0.0

## [1.2.0] - 2026-09-10

### Highlights

- Perplexity AI runs through the official Router API with live model discovery.
- Supports OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages.
- Keeps provider setup simple with one API key and one dashboard entry.
- Refreshes the English and Indonesian provider documentation.

[1.2.0]: https://github.com/envielxyz/SwayRouter/releases/tag/v1.2.0

## [1.1.0] - 2026-09-10

### Changed

- Preserve caller-provided system and developer instructions across provider
  adapters without router-owned identity or repair prompts.
- Remove legacy OAuth cloaking, fake tool declarations, and hidden prompt
  replacements from provider compatibility paths.
- Keep native response-format requests intact for OpenAI-compatible providers.

### Tests

- Add prompt-transparency regression coverage for the main provider adapters.

[1.1.0]: https://github.com/envielxyz/SwayRouter/releases/tag/v1.1.0

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

[1.0.10]: https://github.com/envielxyz/SwayRouter/releases/tag/v1.0.10

## [1.0.9] - 2026-09-09

### Fixed

- Prevent duplicate Windows tray hosts when Sway Router is started more than
  once or restarted from the dashboard.
- Keep legacy 9Router provider mappings internal while making migration
  previews clearer about imported, handled, duplicate, and skipped data.
- Explain skipped custom models as provider references missing from the backup.

[1.0.9]: https://github.com/envielxyz/SwayRouter/releases/tag/v1.0.9

## [1.0.8] - 2026-09-09

### Fixed

- Keep local OAuth callbacks aligned when the dashboard is opened through
  either `localhost` or `127.0.0.1`.

[1.0.8]: https://github.com/envielxyz/SwayRouter/releases/tag/v1.0.8

## [1.0.7] - 2026-09-09

### Added

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

[1.0.7]: https://github.com/envielxyz/SwayRouter/releases/tag/v1.0.7

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

[1.0.6]: https://github.com/envielxyz/SwayRouter/releases/tag/v1.0.6
