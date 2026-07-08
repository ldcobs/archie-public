# Security Policy

## Reporting a vulnerability

Archie handles VPN credentials, operator sessions, and live network security
data. We take security reports seriously.

**Please do NOT open a public GitHub issue for security vulnerabilities.**

Instead, report vulnerabilities privately:

1. Open a **private security advisory** via GitHub's
   "Report a vulnerability" feature (Security tab → Advisories), **or**
2. Email the maintainer directly with details and reproduction steps.

Please include:
- A description of the issue and its impact
- Steps to reproduce or a proof of concept
- Affected version / commit
- Any suggested remediation

You should receive an acknowledgement within **72 hours**. Please allow
reasonable time for assessment and a fix to be coordinated before any public
disclosure. We will credit responsible reporters unless they prefer to remain
anonymous.

## Scope

In scope:
- Authentication / session bypass (e.g., forging operator cookies or roles)
- Authorization flaws (privilege escalation across the
  `viewer < operator < admin < owner` ladder)
- Injection into the inbound config-write path (config.json mutation,
  xray restart)
- Secrets exposure (env vars, Reality keys, tokens logged or returned to
  unauthenticated callers)
- Subscription / QR endpoints leaking data beyond the token holder

Out of scope:
- Self-inflicted misconfiguration (e.g., leaving `AUTH_SECRET` unset in
  production — documented as required in `.env.example`)
- Vulnerabilities in upstream dependencies (report to the upstream project)
- Theoretical attacks without a concrete reproduction against Archie

## Hardening notes for operators

- **Set `AUTH_SECRET`** to a strong random value before any deployment
  (`openssl rand -base64 32`). The dev fallback must not ship to production.
- **Set `API_AUTH_TOKEN`** so mutating routes on the Python API are guarded.
- **Generate your own Reality keypair** (`xray x25519`). Never reuse the
  reference deployment's public values.
- The dashboard runs behind nginx; ensure TLS termination is enforced and the
  session cookie's `secure` flag is honored (automatic in `NODE_ENV=production`).
