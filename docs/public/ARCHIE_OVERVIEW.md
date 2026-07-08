# Archie — Product Overview

Archie is a self-hosted **VPN management and security operations platform**. It
combines multi-protocol VPN provisioning with a real-time security intelligence
layer, giving an operator one place to run access, monitor threats, and respond —
without editing server configuration by hand.

---

## What Archie is

Most VPN panels stop at provisioning: create a key, hand out a link. Archie does
that, and adds the operational layer around it — who is connected, from where,
whether a key is being shared, what is attacking the host, and what to do about
it.

It is built to be **installed by one operator and run for a team, a customer, or
a community** on a host they control.

### Core capabilities

- **Multi-protocol VPN provisioning.** A single identity can be served over
  several transport protocols (modern TLS-camouflaged, WebSocket/gRPC behind a
  CDN, high-throughput UDP, and native WireGuard), so clients connect reliably
  across different networks and censorship conditions.
- **Access key management.** Create, edit, rotate, disable, and group keys.
  Per-key traffic limits, expiry, and device policy are enforced automatically.
- **Invite & onboarding.** Generate a branded invite link or QR; the recipient
  self-provisions through a guided onboarding page with the right client app for
  their device. Invites can be delivered by email.
- **Security operations.** Live connection tracking, an attack map, threat
  monitoring, automated banning, IP reputation, and device-level approval and
  blocking with shared-key detection.
- **Operator-grade UX.** Dashboard with live metrics and charts, role-based
  access for multiple operators, and a multi-language interface.

---

## Who it is for

- **Individuals and small teams** who want a private, reliable VPN they fully
  control.
- **Operators running access for a customer or community**, who need invites,
  traffic limits, device policy, and abuse controls.
- **Security-conscious deployments** that want visibility into who is connecting
  and what is attacking the host, not just a connection toggle.

---

## What makes Archie different

1. **A real security operations layer**, not just a connection panel: attack
   map, threat monitoring, automated banning, IP reputation, and device approval
   with shared-key detection.
2. **A real authorization model**: signed sessions, a role ladder
   (viewer → operator → admin → owner), and server-side verification on every
   privileged action.
3. **Multi-engine by design**: several VPN transports are first-class, so
   connectivity degrades gracefully instead of failing when one protocol is
   blocked.
4. **Turnkey onboarding**: branded invites, per-device client guidance, and
   email delivery — provisioning a user does not require the operator to assemble
   configuration by hand.

---

## Product direction

Archie's near-term direction is **distribution readiness** — making it
straightforward for any operator to install and run on their own host — followed
by horizontal scale, where access can be served from more than one location.
