# Archie — Install & Operations

How to stand Archie up on a host you control, and how to operate it. This is the
operator-facing guide; placeholders such as `your-domain.example` and
`your-server-ip` stand in for your own values.

---

## 1. What you need

- A host you control: a cloud server, a virtual machine, or a local machine.
- A modern Linux distribution (Debian/Ubuntu families are the primary target;
  enterprise RPM families are supported on a best-effort basis).
- Container runtime and the standard system tools (the installer checks for these
  and helps install what is missing).
- Optionally, a domain name and/or a CDN account, depending on the install mode
  you choose below.

Archie runs as a **hybrid stack**: the VPN engines run on the host, and the
management dashboard, API, and reverse proxy run in containers alongside them.

---

## 2. Choose an install mode

One decision shapes the rest of the setup:

| Mode | Best for | Domain | Certificate | Notes |
|------|----------|--------|-------------|-------|
| **Direct** | Fastest setup; personal use; restricted networks | Not required | Not required | TLS-camouflaged + UDP + native VPN. Simplest, hardest to block. |
| **CDN-fronted** | CDN-fronted setup | Required | Provided by your CDN | Adds CDN-frontable transports; routes supported transports through your CDN. |
| **Direct-TLS** | Full protocol set without a CDN | Required | Issued automatically | Adds TLS transports using publicly trusted certificates. |

**Direct** mode is the recommended starting point and the right choice for a
local machine or virtual machine, where publicly trusted certificates cannot be
issued for a private address.

---

## 3. Install

On a fresh server, install with a single public command — no account, no token,
nothing to download by hand:

```bash
curl -fsSL https://raw.githubusercontent.com/ldcobs/archie/main/install/bootstrap.sh | sudo bash
```

This downloads a version-pinned, checksum-verified package from the project's
public GitHub Releases, extracts it to `/opt/archie`, and starts a **guided web
setup wizard**. It does not change anything on the host until you confirm at the
wizard's Review step. The bootstrap asks how you want to reach the wizard:

- **SSH tunnel** (default, recommended) — the wizard binds to `127.0.0.1` only
  and is never exposed to the internet. The bootstrap prints the exact command:
  ```bash
  ssh -L 8899:localhost:8899 <user>@<your-server>   # then open http://localhost:8899
  ```
- **Temporary public URL** — the wizard binds `0.0.0.0`, gated by a one-time
  token in the URL. No SSH needed; stop it as soon as setup finishes.

Prefer to drive it from a checkout instead of the wizard? The same installer is
scriptable with flags, so it can run fully unattended for automated provisioning:

```bash
# Guided:
./install.sh

# Unattended example (direct mode):
./install.sh --mode=direct --yes
```

Either way, the installer:

1. Detects the environment (operating system, architecture, public address,
   container runtime, open ports).
2. Installs the host-side VPN engines and the container stack.
3. Generates fresh cryptographic material for your installation — never reuse
   keys from documentation or another install.
4. Builds your configuration from the values you provide or that were detected.
5. Provisions certificates for the chosen mode where required.
6. Applies firewall rules for exactly the protocols you enabled.
7. Runs a **post-install self-check** that each service is listening and
   reachable.
8. Prints the first-run URL.

> The installer creates configuration and cryptographic keys. It does **not**
> create any default administrator password — the first time you open the
> dashboard, you create the owner account through a guided setup step.

---

## 4. First run

1. Open the URL the installer prints (for example,
   `https://your-domain.example/`).
2. Create the owner account.
3. Create your first access key, or send an invite.
4. Optionally configure email delivery (see §6) so invites can be emailed.

---

## 5. Day-to-day operations

- **Access keys.** Create, group, rotate, disable, and delete keys. Set per-key
  traffic limits, expiry, and device policy; enforcement is automatic.
- **Invites.** Generate a branded invite link or QR code; the recipient
  self-provisions through the onboarding page. Resend access to an existing user
  at any time.
- **Security.** Watch live connections and the attack map; review and act on
  threats; approve, reject, or block devices; choose the protection mode that
  governs automated banning.
- **Server health.** Monitor engine and service status, traffic, and resource
  use from the dashboard.

---

## 6. Email delivery (optional)

To email invites, configure an SMTP relay. Set the values in
**Settings → Email delivery**, or provide them as environment defaults at install
time:

```
SMTP_HOST       your mail relay host
SMTP_PORT       587 (STARTTLS) or 465 (implicit TLS)
SMTP_SECURE     true for port 465, false otherwise
SMTP_USER       relay username (if required)
SMTP_PASS       relay password (if required)
SMTP_FROM       From address, e.g. "Your VPN <invites@your-domain.example>"
```

Use the **Send test** button to confirm delivery before relying on it. If SMTP is
not configured, operators can still share invites by copying the link or QR code.

---

## 7. Upgrades and backups

- **Upgrades** re-run the installer in upgrade mode: it backs up your current
  configuration first, updates the stack, validates the configuration before
  applying it, and can restore the previous state if anything fails.
- **Backups** of operator state can be exported and restored from the dashboard.
- Your own configuration and cryptographic keys are never overwritten by an
  upgrade without an explicit, reviewed change.

---

## 8. Host support

| Environment | Status |
|-------------|--------|
| Debian / Ubuntu families | Primary, fully supported |
| Enterprise RPM families | Best-effort |
| Local virtual machine | Supported (use Direct mode) |
| Local / bare-metal host | Supported (use Direct mode) |

For automated or cloud provisioning, the installer's unattended flags make it
suitable for first-boot scripts. Where a platform's network firewall is managed
separately, the installer prints the exact set of ports to open.
