# Contributing to Sway Router

Thanks for helping make Sway Router better. Bug fixes, provider integrations,
compatibility improvements, tests, docs, and focused UI work are welcome.

## Start locally

```bash
bun install --frozen-lockfile
bun install --cwd dashboard --frozen-lockfile
bun run build:dashboard
bun run dev
```

Open `http://127.0.0.1:14045/dashboard`.

## Before a pull request

```bash
bun run typecheck
bun test
bun run routes:check
bun run build:dashboard
bun run package:check
```

Run `bun run test:e2e` for dashboard or routing changes. Keep pull requests
focused, explain the behavior change, and include screenshots for visible UI
work.

Never commit real API keys, OAuth tokens, cookies, account emails, databases,
logs, or tunnel URLs. Provider fixtures must use obviously fake values.

## Provider contributions

Add provider definitions through the existing registry and shared service
layers. Keep provider-specific behavior scoped, add tests for auth/model
mapping, and document any external setup a user must perform. Do not include
personal credentials or private account responses.

By contributing, you agree that your contribution is licensed under the MIT
License in this repository.
