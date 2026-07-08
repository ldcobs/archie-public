# Requirements

Everything you need before installing Archie, in one place: the server specs, the
domain rules per mode, and the full list of network ports.

## Server

| | Requirement |
|---|---|
| **Architecture** | **x86-64 (amd64) only.** ARM servers are not supported. |
| **Operating system** | Ubuntu 22.04 / 24.04 or Debian 11 / 12 (Debian/Ubuntu family). RHEL-family is best-effort. |
| **Access** | Root (the one-liner uses `sudo`). |
| **CPU / RAM** | 1 vCPU / 1 GB works to *run* Archie. **2 vCPU / 2 GB is recommended** — the default install **builds the app on your server**, and a 1 GB box can run out of memory during the build. On a 1 GB server, add swap or pick a 2 GB plan. |
| **Disk** | ~20 GB free. |
| **Container runtime** | Docker — the installer installs it if it's missing. |
| **Network** | Outbound internet access (to download packages and the install package). |

## Domain (depends on install mode)

| Mode | Domain | TLS certificate |
|------|--------|-----------------|
| **Direct** | Not needed | Not needed |
| **CDN-fronted** | Required, on a CDN (e.g. Cloudflare) | Your CDN's origin certificate |
| **Direct-TLS** | Required, DNS `A` record → your server IP | Issued automatically |

## Ports

The installer's firewall (UFW) opens **only** the ports your chosen mode needs and
blocks the rest — you don't configure these by hand. This table is for reference,
and so you can open the right ports in your **cloud provider's firewall** too (see
the note below).

| Port | Protocol | Purpose | Modes | Exposure |
|------|----------|---------|-------|----------|
| 22 | TCP | SSH administration | all | You only — lock down per [Secure your server](SECURE_YOUR_SERVER.md) |
| 443 | TCP | Reality / VLESS (main protocol) | all | Public |
| 2096 | UDP | Hysteria2 | all | Public |
| 51820 | UDP | WireGuard | all | Public |
| 8388 | TCP | Shadowsocks | Direct | Public |
| 8080 | TCP | Dashboard over HTTP (reached by server IP) | Direct | Public — keep it firewalled to yourself where possible |
| 80 | TCP | HTTP for certificate issuance / redirect | CDN-fronted, Direct-TLS | Public |
| 8443 | TCP | Dashboard + protocols over TLS (nginx) | CDN-fronted, Direct-TLS | Public |
| 2053 | TCP | Alternate TLS port | CDN-fronted, Direct-TLS | Public |
| 8899 | TCP | Setup wizard | **During install only**, and only if you choose the "temporary public link" option | Temporary |
| 10085 | TCP | Xray control API | all | Internal — Docker network only, never exposed |
| 10001–10006 | TCP | Protocol backends behind nginx | CDN-fronted, Direct-TLS | Internal — Docker network only |

> **Cloud provider firewalls.** Many hosts (AWS EC2 "Security Groups", and the
> firewalls on Hostinger, Oracle Cloud, etc.) put a **second** firewall in front of
> your server. Archie's own firewall can't open those — you must allow the same
> public ports there too, or clients (and the setup wizard's temporary link) won't
> be reachable. Providers with no external firewall (typical DigitalOcean /
> Hetzner / Vultr basic plans) need nothing extra.

Next: [Secure your server](SECURE_YOUR_SERVER.md), then the install steps in the
[main README](../../README.md#install).
