# Contributing to Archie

Thanks for your interest in Archie. This repository is the **public
distribution** of Archie: it holds the installer, the product source that the
installer builds on your server, and the documentation. This guide explains the
best way to help, depending on what you want to do.

---

## Reporting a bug

Open a **Bug Report** issue. The template asks for the essentials: your install
mode (Direct / CDN-fronted / Direct-TLS), Archie version, OS/VPS, and the exact
steps to reproduce. A clear reproduction is the single most useful thing you can
provide.

Please include relevant installer or dashboard output, but **redact secrets**
first — tokens, keys, passwords, and real client IPs should never appear in a
public issue.

## Requesting a feature

Open a **Feature Request** issue describing the problem you're trying to solve,
not just a proposed solution. Real-world context (how many users, what network
conditions, what you do today) helps prioritize.

## Reporting a security vulnerability

**Do not open a public issue.** Follow [SECURITY.md](SECURITY.md) — use GitHub's
private "Report a vulnerability" advisory flow. Security reports are handled
ahead of everything else.

---

## Submitting a change

- **Documentation** (`README.md`, `CHANGELOG.md`, `docs/`) — pull requests are
  welcome. Fix a typo, clarify a step, improve an example.

- **Product code** (`api/`, `dashboard/`, `install/`, `build/`, `deploy/`,
  `tests/`, the compose files) — please **open an issue first** describing the
  change (include a patch or diff where you can) so it can be reviewed and
  coordinated before a pull request. Accepted changes are credited in the
  changelog.

If you're unsure which applies, open an issue and ask.

---

## Conventions

- **Describe the change, not the author.** Commit messages and documentation
  should describe the change itself, not who or what produced it. No co-author
  trailers.
- **Never put secrets in source.** Server IPs, domains, Reality keypairs, tokens,
  and passwords are supplied at install time, not committed. Do not reintroduce
  hardcoded deployment values.
- **Conventional commit prefixes** for documentation PRs: `docs:`, `fix:`,
  `chore:`. Keep the subject line under ~72 characters.

---

## License

By contributing you agree that your contributions are licensed under the
repository's [LICENSE](LICENSE) (MIT).
