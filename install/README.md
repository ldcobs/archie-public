# Archie Installer

Generates a complete, mode-specific Archie VPN stack into a **staging directory**
on your local machine. By default, nothing on the host changes.

> **Status:** Mode A and Mode C have been validated end-to-end on throwaway EC2
> hosts through the real setup wizard. Mode B is wired through the wizard and
> engine with pasted Cloudflare Origin cert/key material, but still needs its
> first live clean-host validation with a real proxied Cloudflare DNS record.
> Default (no `--apply`) still only writes staging.

## Install on a server (the one-liner)

On a fresh root host, the published bootstrap downloads a **version-pinned,
checksum-verified** package from GitHub Releases, extracts it to `/opt/archie`,
and launches the web setup wizard (it does **not** install anything itself — the
wizard does that, after you confirm at its Review step):

```bash
curl -fsSL https://raw.githubusercontent.com/ldcobs/archie/main/install/bootstrap.sh | sudo bash
```

The bootstrap asks how you want to reach the wizard:

- SSH tunnel (default): binds `127.0.0.1` only.
- Temporary public URL: binds `0.0.0.0`, gated by a one-time token.

For SSH-tunnel mode, the bootstrap prints the exact command:

```bash
ssh -L 8899:localhost:8899 <user>@<server>     # then open http://localhost:8899
```

**Offline / air-gapped:** copy `archie-<version>.tgz` (and its `.sha256`) to the
host and point the bootstrap at it — no download, same checksum gate:

```bash
ARCHIE_TGZ=/path/to/archie-0.1.0.tgz sudo -E bash install/bootstrap.sh
```

Other env knobs: `ARCHIE_PORT` (default 8899), `ARCHIE_PUBLIC=1` (advanced —
temporary `0.0.0.0` exposure gated by a one-time token), `ARCHIE_NO_LAUNCH=1`
(extract only), `ARCHIE_INSTALL_DIR` (default `/opt/archie`).

## Resetting a test host

To validate the installer from scratch, reset a **throwaway** host with
`teardown.sh` — it removes Archie's footprint (containers, host services + units,
configs/binaries, `/opt/archie`, UFW rules) but keeps the Docker engine + base
packages by default. **Never run it on production** (it refuses on a prod-looking
hostname or an `/etc/archie-production` marker, and always requires `--yes`):

```bash
sudo bash install/teardown.sh --dry-run        # preview — changes nothing
sudo bash install/teardown.sh --yes            # reset; ready for a fresh install
sudo bash install/teardown.sh --yes --purge-docker --purge-packages   # bare host
```

## Quick start (local, no VPS)

```bash
cd install/

# one-time: create the test venv (gitignored)
python3 -m venv .venv && .venv/bin/pip install pytest

# run the generator — writes only to install/.staging/archie-A
./install.sh --mode=A --server-ip=198.51.100.10 --yes --insecure-ip

# inspect what was generated
ls -la .staging/archie-A/
cat .staging/archie-A/manifest.json
```

## The three install modes

| Mode | Protocols | Needs domain | TLS termination | Cert source |
|------|-----------|--------------|-----------------|-------------|
| **A** | Reality + Hysteria2 + WireGuard + Shadowsocks | no | (host-direct, self-signed HY2) | self-signed |
| **B** | A + vmess/vless/trojan WS+gRPC | yes | nginx | Cloudflare Origin cert |
| **C** | A + vmess/vless/trojan WS+gRPC | yes | nginx | Let's Encrypt |

Modes B and C produce **identical Xray configs** — the only difference is which
cert nginx mounts. The installer branches that in the nginx generator.

## Flags

See `./install.sh --help`. Key ones:

- `--mode=A|B|C` (required)
- `--server-ip=` (auto-detected if omitted; `--insecure-ip` accepts RFC1918)
- `--domain=` (required for B, C)
- `--cf-origin-cert=<path|PEM>` (required for B)
- `--reality-pbk/--reality-pvk/--reality-sid=` (auto-generated via `xray x25519` if omitted)
- `--auth-secret=`, `--api-token=` (auto-generated)
- `--staging=<dir>` (default `install/.staging/archie-<mode>`)
- `--install-dir=<dir>` (default `/opt/archie`; the target path used inside staging)
- `--apply` (mutates the host: packages, configs, systemd, Docker, UFW, self-check)
- `--dry-run` (with `--apply`, prints the host mutation plan without running it)

## Crypto material

Reality (X25519) and WireGuard (Curve25519) keys are generated in this order,
falling back if a tool is missing:

1. `xray x25519` / `wg genkey` (canonical, what the VPS uses)
2. PyNaCl (if installed)
3. **Pure-stdlib RFC 7748** (`lib/x25519.py`) — always available, verified against
   the RFC 7748 §6.1 test vectors in `tests/test_crypto.py`

So the generator runs anywhere with python3, no external deps.

## Layout produced in staging

```
<staging>/
├── .env                              # docker compose reads this
├── docker-compose.vpn.yml            # copied from repo (verbatim)
├── manifest.json                     # what was generated (for self-check + apply)
├── vpn-api-v3/                       # repo api/ (compose mounts ./vpn-api-v3)
├── vpn-dashboard-v3/                 # repo dashboard/ (clean build context)
│   └── .env.production               # NEXT_PUBLIC_* baked into the dashboard build
├── scripts/apply-vpn-changes.sh      # repo script, paths rewritten to install_dir
├── nginx/                            # omitted in Mode A
│   ├── nginx.conf                    # stream{} 2053→10003 for B/C
│   ├── conf.d/archie.conf            # server blocks per mode
│   ├── html/index.html
│   ├── cloudflare-ips.conf           # Mode B only
│   └── htpasswd                      # only with --dashboard-basic-auth
└── host/                             # files destined for /etc on the host
    ├── xray/config.json
    ├── hysteria/{config.yaml,cert.pem,key.pem}   # cert self-signed in A
    ├── wireguard/{wg0.conf,clients.json}
    └── systemd/{xray,hysteria-server,archie-*}.service
```

## Testing

```bash
cd install/
.venv/bin/pytest                      # full installer test suite
docker run --rm -v "$PWD:/work" koalaman/shellcheck:stable install.sh
```

- **`tests/test_gen_*.py`** — unit tests per generator (pure functions).
- **`tests/test_crypto.py`** — includes RFC 7748 KAT vectors for the stdlib fallback.
- **`tests/test_dryrun.py`** — runs the full assembler end-to-end, asserts the
  staging tree for all three modes. No host contact.

## Apply status

Mode A `--apply` installs packages, Xray, Hysteria2, WireGuard, Docker, the
dashboard/API compose stack, UFW rules, and then runs live self-checks. It
publishes the dashboard at:

```bash
http://<server-ip>:8080/v3
```

Mode C is also live-validated through the wizard and publishes the dashboard at:

```bash
https://<domain>:8443/v3
```

Mode B is now selectable in the wizard and stages the pasted Cloudflare Origin
cert/key for nginx and Hysteria2, but has not yet had a successful clean-host
EC2 validation. Treat Mode B as "ready to test", not "proven". `--upgrade`
backup/restore is still deferred.
