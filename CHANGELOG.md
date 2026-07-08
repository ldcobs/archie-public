# Changelog

Notable changes to Archie, by release. Each release ships a checksum-verified
installer package (`archie-<version>.tgz` + `.sha256`).

## v0.1.5 — 2026-07-08

- Add-on integrations validate live credentials in the setup wizard:
  - **AbuseIPDB** — key checked against the reporting API.
  - **Telegram** — bot token checked, with an optional test message.
  - **SMTP** — connection, STARTTLS/SSL, and login checked.
- Telegram setup reminds you to `/start` your bot before testing.

## v0.1.4 — 2026-07-08

- Installer reliability improvements for the post-install dashboard check.

## v0.1.3 — 2026-07-08

- Direct-mode installs verify the dashboard locally once setup completes.
- Setup values are applied to the running dashboard automatically.
- Added the Archie favicon.

## v0.1.2 — 2026-07-07

- First public release.
- Deployment values (server IP, domain, keys) are supplied at install time —
  never baked into the source.
