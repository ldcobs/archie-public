<p align="center">
  <img src="dashboard/public/assets/archie-header-transparent-dark.png" alt="Archie" width="600"/>
</p>

<p align="center">
  <strong>VPN &amp; Security Management Platform</strong>
</p>

---

Self-hosted VPN management and security operations for a server you control.
Archie runs the VPN engines on your host and gives you a web dashboard to create
access keys, invite users, watch live connections, and block abuse — all from one
place.

It wraps proven open-source protocols (Xray/Reality, Hysteria2, WireGuard,
Shadowsocks) behind a guided installer and a management UI, so you don't have to
hand-edit configs.

## Install

You install from your own computer onto a fresh Linux server — any mainstream
x86-64 VPS (Hostinger, DigitalOcean, Hetzner, Vultr, AWS EC2, etc.). It takes a few minutes.
See [Requirements](docs/public/REQUIREMENTS.md) for exact specs and ports.

> ⚠️ **Secure your server first — this is a hard requirement.** Archie runs *on*
> your VPS, so your VPN is only as secure as that server. Before installing, read
> **[Secure your server](docs/public/SECURE_YOUR_SERVER.md)** (SSH keys, disable
> password login, auto-updates). A gateway with a weak password puts every user
> at risk — an unsecured server makes Archie a liability instead of a safeguard.

**1. Connect to your server.** From your laptop's terminal, log in with the IP
address and credentials your VPS provider gave you:

```bash
ssh root@your-server-ip
```

**2. Run the installer.** Paste this one line and press Enter:

```bash
curl -fsSL https://raw.githubusercontent.com/ldcobs/archie/main/install/bootstrap.sh | sudo bash
```

It downloads a checksum-verified package and starts a **setup wizard** — a small
web page. Nothing on your server is changed yet; it builds and configures
everything only after you confirm, and it builds **on your server**, so it always
matches your server's architecture.

**3. Open the setup wizard in your browser.** The installer asks how you'd like to
reach it:

- **Temporary link (simplest)** — it prints a link like
  `http://your-server-ip:8899/?token=…`. Open it in your browser. No extra steps.
- **Private (SSH tunnel)** — keeps the wizard off the public internet. From your
  laptop, run the command it prints
  (`ssh -L 8899:localhost:8899 root@your-server-ip`), then open
  `http://localhost:8899`.

Either way you're just opening the setup page once — you don't stay connected to
anything afterward.

**4. Follow the wizard.** Pick an install mode (see below), review, and confirm.
It installs and configures everything for you.

**5. Use your dashboard.** When it finishes, the installer prints your dashboard
URL — that's your day-to-day address; the setup wizard is done and gone:

- With a domain → `https://your-domain.com/v3`
- Without a domain → `http://your-server-ip:8080/v3`

Open it, create your owner account, then create access keys or send invite links
and QR codes.

## Install modes

Step 4 asks you to pick one:

| Mode | Domain needed | Best for |
|------|---------------|----------|
| **Direct** | No | Fastest setup, personal use, restricted networks |
| **CDN-fronted** | Yes | CDN-fronted setup; routes supported transports through your CDN |
| **Direct-TLS** | Yes | Full protocol set with automatically issued certificates |

**Direct** is the recommended starting point.

See [docs/public/INSTALL_AND_OPERATIONS.md](docs/public/INSTALL_AND_OPERATIONS.md)
for day-to-day operations, email setup, and troubleshooting.

## Documentation

| Document | What it covers |
|----------|----------------|
| [Requirements](docs/public/REQUIREMENTS.md) | Server specs, domain rules, and all network ports in one place |
| [Secure your server](docs/public/SECURE_YOUR_SERVER.md) | **Read first** — hardening your VPS before install (required) |
| [Overview](docs/public/ARCHIE_OVERVIEW.md) | What Archie is and who it's for |
| [Install & Operations](docs/public/INSTALL_AND_OPERATIONS.md) | Installing and running Archie |
| [Security Model](docs/public/SECURITY_MODEL.md) | Authentication and security operations |
| [Security & Anti-Sharing Guide](docs/CUSTOMER_SECURITY_GUIDE.md) | Detecting and acting on key-sharing |
| [Self-Hosting Notes](docs/CUSTOMER_NOTES.md) | Running Archie on your own server |

## Contributing

Bug reports and feature requests are welcome via the issue templates.
Documentation improvements can be sent as pull requests. See
[CONTRIBUTING.md](CONTRIBUTING.md) for how the project is coordinated, and
[CHANGELOG.md](CHANGELOG.md) for what's changed between releases. For security
vulnerabilities, follow [SECURITY.md](SECURITY.md) — do not open a public issue.

## License

See [LICENSE](LICENSE).
