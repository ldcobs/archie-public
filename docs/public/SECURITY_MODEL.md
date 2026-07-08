# Archie — Security Model

Archie is a security product as much as a VPN panel. This document describes the
security model at a level suitable for evaluation by operators, customers, and
collaborators. It does not include environment-specific details.

---

## 1. Authentication & authorization

- **Operator sessions** are signed and stored in secure, HTTP-only cookies.
  Session integrity is verified cryptographically on the server using
  constant-time comparison.
- **Role ladder:** `viewer → operator → admin → owner`. Each privileged action
  requires a minimum role, enforced server-side in every API handler — not only
  in the interface.
- **Bootstrap:** the first time the application runs, a guided setup step creates
  the owner account. There is **no default password**; once an owner exists,
  setup is closed.
- **Request gating:** a lightweight edge check confirms a session is present on
  every request; full verification runs in the application layer where the action
  is authorized.

### Role responsibilities (summary)

| Role | Can do |
|------|--------|
| viewer | Read dashboards and status |
| operator | Security actions, device actions, firewall/ban actions |
| admin | Account/key management, configuration, backup import/export |
| owner | Authentication administration and system ownership |

Token-bearing endpoints used by end-user clients (subscription and configuration
links) are intentionally public, because the token itself is the credential.

---

## 2. Access enforcement

- **Per-key policy** — traffic limits, expiry, and device limits — is enforced
  automatically. Keys are disabled when a limit or expiry is reached and restored
  when conditions clear.
- **Live key control.** Keys can be blocked and restored against the running
  service without interrupting unrelated, already-connected users.
- **Device policy.** Each key can require device approval, cap the number of
  simultaneous devices, and automatically reject overflow connections while
  preserving already-approved devices.

---

## 3. Anti-abuse & sharing detection

- **Shared-key detection** flags keys that show patterns consistent with sharing
  (for example, simultaneous use from unrelated networks).
- **Risk scoring** classifies keys by likelihood of abuse, combining device
  count, network/location changes, and concurrency against the key's limits.
- **Device-level controls** let an operator approve, reject, or block specific
  devices, with awareness of conflicting networks.

---

## 4. Threat monitoring & response

- **Live security surface:** an attack map, threat monitoring of access attempts,
  automated banning, and IP reputation context.
- **Protection modes** let an operator choose how aggressively automated banning
  responds, and apply that policy consistently.
- **Response actions** — temporary ban, permanent deny, device quarantine — are
  available directly from the security surface, with an audit trail for every
  action.

---

## 5. Configuration & change safety

- **Validated changes.** Configuration changes that affect the VPN service are
  validated before they are applied, and rolled back automatically if validation
  fails.
- **Atomic writes.** Stateful files are written atomically so an interrupted
  write cannot corrupt operator state.
- **Audited mutations.** Privileged actions are recorded for later review.

---

## 6. Cryptographic material

- Each installation **generates its own keys**. Keys from documentation or
  another installation are never reused; the installer refuses to do so.
- Secrets are never returned to the browser. Where a credential must be displayed
  (for example, whether an email password is set), only its presence is exposed,
  not its value.

---

## 7. Hardening guidance for operators

- Place the host behind a firewall that allows only the protocols you enabled;
  the installer emits a matching rule set.
- Use a unique domain and freshly generated certificates per installation.
- Keep operator accounts to the minimum role each person needs.
- Configure email and backups so that recovery and communication do not depend on
  a single operator's machine.

---

## 8. Scope & non-goals

Archie focuses on VPN access security and operations. It is not a full SIEM and
does not replace endpoint protection or network-wide intrusion prevention. Its
threat-intelligence enrichment is **optional**: the product remains fully usable
with all external enrichment disabled, and enrichment augments — never replaces —
Archie's own signals.
