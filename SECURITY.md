# Security policy

## Supported versions

Security fixes target the latest published Sway Router release.

## Report a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do
not open a public issue for credential exposure, authentication bypasses,
remote code execution, or other sensitive findings.

Include the affected version, impact, reproduction steps, and any suggested
mitigation. Remove real provider credentials, tokens, cookies, personal data,
and production URLs from the report whenever possible.

## Deployment baseline

- Keep the data directory private and persistent.
- Bind to localhost unless remote access is intentional and protected.
- Replace the initial dashboard password during first-run setup.
- Keep generated or externally managed runtime secrets stable and private.
- Back up the SQLite database before upgrades or restores.
