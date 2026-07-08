"""``--apply`` host mutation — turn a generated staging tree into a live install.

Planning (:func:`build_plan`) is a **pure function**: given a ``Params`` and the
staging path, it returns the ordered list of shell steps without touching the
host. That makes the exact command sequence unit-testable on any machine.

Execution (:func:`run_plan`) is the only mutating part. It honours:

- ``dry_run`` — print each step's command, run nothing.
- per-step ``check`` — a probe that, when it exits 0, means the step is already
  satisfied, so it's skipped (idempotent re-runs).
- ``allow_fail`` — a step whose failure is a warning, not an abort.

:func:`self_check` runs the §6 post-install probes and returns a list of
``(label, ok, detail)`` so the caller can print a clean report.

Mode A and Mode C have been validated end-to-end on throwaway hosts. Mode B has
the Cloudflare Origin certificate path wired, but still needs live host
validation with a real proxied Cloudflare DNS record and Origin certificate.
"""

from __future__ import annotations

import os
import shlex
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from .common import Params, err, info, ok, warn


# ─────────────────────────────────────────────────────────────────────────────
# Step model
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class Step:
    name: str                       # short id, unique within a plan
    desc: str                       # human-readable one-liner
    sh: str                         # command line, run via `bash -c`
    check: str | None = None        # exit 0 → already satisfied, skip
    allow_fail: bool = False        # failure is a warning, not an abort


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────


def _pkg_cmds(p: Params) -> tuple[str, str]:
    """Return (update_cmd, install_prefix) for the host's package manager."""
    rhel = p.os_id in ("amzn", "rocky", "almalinux", "fedora", "centos", "rhel")
    if rhel:
        mgr = "dnf" if _have("dnf") else "yum"
        return (f"{mgr} -y makecache", f"{mgr} -y install")
    return ("apt-get update -y", "DEBIAN_FRONTEND=noninteractive apt-get install -y")


def _have(binary: str) -> bool:
    return subprocess.run(
        ["bash", "-c", f"command -v {shlex.quote(binary)} >/dev/null 2>&1"]
    ).returncode == 0


def _base_packages(p: Params) -> list[str]:
    pkgs = ["curl", "ca-certificates", "jq", "openssl", "rsync", "iproute2",
            "wireguard-tools"]
    if not p.no_firewall:
        pkgs.append("ufw")
    if not p.no_fail2ban:
        pkgs.append("fail2ban")
    return pkgs


# ─────────────────────────────────────────────────────────────────────────────
# Plan
# ─────────────────────────────────────────────────────────────────────────────


def build_plan(p: Params, staging: Path) -> list[Step]:
    """Ordered, idempotent steps that install Archie from ``staging``.

    Pure: builds command strings only, runs nothing.
    """
    s = str(staging)
    host = f"{s}/host"
    inst = p.install_dir
    update_cmd, install = _pkg_cmds(p)
    steps: list[Step] = []

    # ── 1. host packages ──────────────────────────────────────────────────
    steps.append(Step("pkg-update", "refresh package index", update_cmd, allow_fail=True))
    steps.append(Step(
        "pkg-base", "install base packages",
        f"{install} {' '.join(_base_packages(p))}",
    ))
    steps.append(Step(
        "docker", "install Docker engine + compose plugin",
        "curl -fsSL https://get.docker.com | sh",
        check="command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1",
    ))
    steps.append(Step(
        "xray", "install Xray-core (binary + geodata)",
        'bash -c "$(curl -fsSL https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install',
        check="test -x /usr/local/bin/xray",
    ))
    steps.append(Step(
        "hysteria", "install Hysteria 2 binary",
        "curl -fsSL https://get.hy2.sh/ | bash",
        check="test -x /usr/local/bin/hysteria",
    ))

    # ── 2. host files (systemd-managed protocols live outside Docker) ──────
    # The official Xray installer pre-creates /var/log/xray + log files owned by
    # `nobody`. Our unit runs xray as root but with a restricted
    # CapabilityBoundingSet (no CAP_DAC_OVERRIDE), so root can't write files it
    # doesn't own — chown the log tree to root or xray fails to open its logger.
    steps.append(Step(
        "host-dirs", "create host config + log dirs",
        "mkdir -p /usr/local/etc/xray /usr/local/share/xray /etc/hysteria "
        "/etc/wireguard /etc/systemd/system /var/log/xray && "
        "touch /var/log/xray/access.log /var/log/xray/error.log && "
        "chown -R root:root /var/log/xray && chmod 755 /var/log/xray && "
        "chmod 644 /var/log/xray/access.log /var/log/xray/error.log",
    ))
    steps.append(Step(
        "xray-config", "install Xray config",
        f"install -m 644 {host}/xray/config.json /usr/local/etc/xray/config.json",
        check=f"cmp -s {host}/xray/config.json /usr/local/etc/xray/config.json",
    ))
    if p.mode == "A":
        # Mode A self-signs at staging time, so the cert/key already exist
        # in the staging tree and can be installed alongside the config.
        steps.append(Step(
            "hysteria-config", "install Hysteria config + cert",
            f"install -m 644 {host}/hysteria/config.yaml /etc/hysteria/config.yaml && "
            f"install -m 644 {host}/hysteria/cert.pem /etc/hysteria/cert.pem && "
            f"install -m 600 {host}/hysteria/key.pem /etc/hysteria/key.pem",
        ))
    else:
        # Modes B/C have no real cert at staging time — B needs the operator's
        # CF Origin cert, C needs a Let's Encrypt cert issued later in this
        # same plan. Install only the config here; the "hysteria-cert" step
        # below (after the cert exists) copies the real material in.
        steps.append(Step(
            "hysteria-config", "install Hysteria config",
            f"install -m 644 {host}/hysteria/config.yaml /etc/hysteria/config.yaml",
        ))
    steps.append(Step(
        "wg-config", "install WireGuard config",
        f"install -m 600 {host}/wireguard/wg0.conf /etc/wireguard/wg0.conf && "
        f"install -m 600 {host}/wireguard/clients.json /etc/wireguard/clients.json",
    ))
    steps.append(Step(
        "systemd-units", "install systemd units",
        f"install -m 644 {host}/systemd/*.service {host}/systemd/*.timer /etc/systemd/system/ && "
        "systemctl daemon-reload",
    ))

    # ── 3. install dir (the compose stack source) ─────────────────────────
    steps.append(Step("install-dir", "create install dir", f"mkdir -p {inst}"))
    # --delete keeps the install dir in sync with staging, but must NOT wipe the
    # installer's own state/log dir (/opt/archie/.install), the staging tree
    # itself, or install/ — the wizard's own code+UI, which is still the
    # running process serving this very install to the customer's browser.
    # Deleting it out from under itself 404s any subsequent page load even
    # though the API keeps working off already-loaded Python.
    steps.append(Step(
        "sync-stack", "copy compose stack into place",
        f"rsync -a --delete-after --exclude host/ --exclude manifest.json "
        f"--exclude .install --exclude install/ {s}/ {inst}/",
    ))

    # ── 4. mode-specific cert work ────────────────────────────────────────
    # ailab-net must exist before le-issue: certbot runs via `docker compose
    # run --rm`, and the compose file declares the ailab network as external
    # — compose refuses to run any service if a declared external network is
    # missing, even for a one-off `run`. (The network is created again, as a
    # no-op, in §7 below — creation is idempotent via the `check` probe.)
    steps.append(Step(
        "ailab-net", "create the ailab Docker network",
        "docker network create --subnet 172.20.0.0/16 ailab",
        check="docker network inspect ailab >/dev/null 2>&1",
    ))
    if p.mode == "B":
        # Validate the uploaded Origin cert + key BEFORE installing them: both
        # must be parseable PEM and their public keys must match, or nginx (and
        # Hysteria2) would only fail later with a cryptic handshake error. Fail
        # fast here with a clear message instead — this is the openssl pair-check
        # done by hand during Mode B bring-up, promoted into the install so a
        # mismatched/typo'd upload never reaches "verify".
        steps.append(Step(
            "cf-cert-validate", "validate Cloudflare Origin cert + key match",
            f"openssl x509 -in {host}/cloudflare-origin.pem -noout && "
            f"openssl pkey -in {host}/cloudflare-origin.key -noout && "
            f'[ "$(openssl x509 -in {host}/cloudflare-origin.pem -noout -pubkey | openssl md5)" = '
            f'"$(openssl pkey -in {host}/cloudflare-origin.key -pubout | openssl md5)" ]',
        ))
        steps.append(Step(
            "cf-origin-cert", "install Cloudflare Origin cert",
            f"install -m 644 {host}/cloudflare-origin.pem /etc/ssl/cloudflare-origin.pem && "
            f"install -m 600 {host}/cloudflare-origin.key /etc/ssl/cloudflare-origin.key",
            allow_fail=True,
        ))
        # Hysteria2 is UDP/QUIC — it isn't behind nginx, so it needs its own
        # copy of the same cert. allow_fail matches cf-origin-cert above: if
        # the operator didn't supply a cert, Hysteria2 just stays unusable
        # rather than aborting the whole install.
        steps.append(Step(
            "hysteria-cert", "copy Cloudflare Origin cert for Hysteria2",
            "install -m 644 /etc/ssl/cloudflare-origin.pem /etc/hysteria/cert.pem && "
            "install -m 600 /etc/ssl/cloudflare-origin.key /etc/hysteria/key.pem",
            allow_fail=True,
        ))
    elif p.mode == "C":
        # First issuance uses --standalone, not --webroot: nginx's generated
        # config for mode C has `ssl_certificate` lines pointing at this very
        # cert, so nginx CANNOT start until the cert exists — but nginx is
        # also what would normally serve the webroot HTTP-01 challenge. That's
        # a chicken-and-egg deadlock (nginx isn't started until the later
        # compose-up step anyway). --standalone sidesteps it: certbot binds
        # host port 80 itself for the duration of this one-off run (port 80 is
        # free here — nginx hasn't claimed it yet) and releases it on exit,
        # before compose-up starts nginx for real. Ongoing renewal (the
        # long-running certbot service started later, in compose-up) still
        # uses --webroot, which is correct by then since nginx is up.
        dom = shlex.quote(p.server_domain)
        steps.append(Step(
            "le-issue", "issue Let's Encrypt cert (certbot standalone)",
            # --entrypoint overrides the certbot service's compose entrypoint
            # (a long-running renewal loop for the persistent compose-up
            # service) for this one-off invocation only — without it, `run`'s
            # appended command is silently dropped and the container just
            # sits on `certbot renew` (no-op, no cert yet) + `sleep 12h`
            # forever instead of ever issuing anything.
            f"cd {inst} && docker compose -f {_compose_base(p)} run --rm "
            f"--publish 80:80 --entrypoint certbot certbot "
            f"certonly --standalone -d {dom} "
            f"--non-interactive --agree-tos --register-unsafely-without-email",
            # The certbot container's /etc/letsencrypt is bind-mounted from
            # {inst}/data/certbot/conf on the HOST (see docker-compose.vpn.yml
            # `./data/certbot/conf:/etc/letsencrypt`) — nginx resolves the
            # bare /etc/letsencrypt/... path correctly because it shares that
            # same mount from inside its own container, but this check (and
            # the hysteria-cert copy below) run directly on the host shell,
            # where bare /etc/letsencrypt is untouched and the real cert
            # lives at the host-side mount path instead.
            check=f"test -d {inst}/data/certbot/conf/live/{p.server_domain}",
        ))
        # Hysteria2 is UDP/QUIC — it isn't behind nginx, so it needs its own
        # copy of the cert Let's Encrypt just issued.
        steps.append(Step(
            "hysteria-cert", "copy Let's Encrypt cert for Hysteria2",
            f"install -m 644 {inst}/data/certbot/conf/live/{dom}/fullchain.pem /etc/hysteria/cert.pem && "
            f"install -m 600 {inst}/data/certbot/conf/live/{dom}/privkey.pem /etc/hysteria/key.pem",
        ))

    # ── 5. kernel + xray validation ───────────────────────────────────────
    steps.append(Step(
        "ip-forward", "enable IPv4 forwarding (WireGuard NAT)",
        "echo 'net.ipv4.ip_forward=1' > /etc/sysctl.d/99-archie.conf && "
        "sysctl -p /etc/sysctl.d/99-archie.conf",
    ))
    steps.append(Step(
        "xray-test", "validate Xray config",
        "/usr/local/bin/xray run -test -confdir /usr/local/etc/xray",
    ))

    # ── 6. host VPN services (independent of Docker) ──────────────────────
    host_units = "xray hysteria-server wg-quick@wg0 archie-apply-changes"
    if not p.no_fail2ban:
        host_units += " fail2ban"
    # `enable` for boot + `restart` (not `enable --now`) so our freshly-written
    # config/units take effect even if a package's own unit already started the
    # service (the Xray installer enables+starts its own unit at install time).
    # archie-apply-changes.service applies the dashboard's queued firewall
    # block/unblock commands (and the legacy config-restart fallback) — it was
    # shipped in staging/systemd/ but never enabled, so those commands were
    # silently dropped on every install until this step included it.
    steps.append(Step(
        "host-services", "enable + (re)start host VPN services",
        f"systemctl enable {host_units} && systemctl restart {host_units}",
    ))

    # ── 7. Docker network + compose stack ─────────────────────────────────
    # (ailab-net is created earlier, in §4, so le-issue's `docker compose run`
    # has it available — it's idempotent, no need to repeat it here.)
    files = _compose_files(p)
    services = " ".join(_compose_services(p))
    if p.prebuilt:
        # Option B — pull the sealed ghcr.io images, then start (no on-box build).
        steps.append(Step(
            "compose-up", "pull + start the dashboard/API containers",
            f"cd {inst} && docker compose {files} pull {services} && "
            f"docker compose {files} up -d {services}",
        ))
    else:
        steps.append(Step(
            "compose-up", "build + start the dashboard/API containers",
            f"cd {inst} && docker compose {files} up -d --build {services}",
        ))

    # ── 8. firewall ───────────────────────────────────────────────────────
    if not p.no_firewall:
        steps.extend(_ufw_steps(p))

    # ── 9. optional traffic poller timer ──────────────────────────────────
    # Some installs do not ship the traffic poller yet. Traffic accounting is
    # runtime telemetry, not an install-readiness dependency, so never leave a
    # failing timer behind when the script is absent.
    steps.append(Step(
        "poller-timer", "enable traffic poller if shipped",
        "if test -f /opt/archie/vpn-api-v3/traffic_poller.py; then "
        "systemctl enable --now archie-traffic-poller.timer; "
        "else "
        # Absent: stop+disable the timer AND the service, then clear any failed
        # state so a fresh install never finishes with a failed poller unit (the
        # unit may have fired once before this step on a host with prior history).
        "systemctl disable --now archie-traffic-poller.timer archie-traffic-poller.service >/dev/null 2>&1 || true; "
        "systemctl reset-failed archie-traffic-poller.timer archie-traffic-poller.service >/dev/null 2>&1 || true; "
        "fi",
    ))

    return steps


def _compose_base(p: Params) -> str:
    """The base compose file apply drives — image-based release compose for
    Option B, source-build compose otherwise."""
    return "docker-compose.release.yml" if p.prebuilt else "docker-compose.vpn.yml"


def _compose_files(p: Params) -> str:
    base = _compose_base(p)
    if p.mode == "A":
        return f"-f {base} -f docker-compose.modeA.yml"
    return f"-f {base}"


def _compose_services(p: Params) -> list[str]:
    if p.mode == "A":
        return ["vpn-api-v3", "vpn-dashboard-v3"]
    return ["nginx", "certbot", "vpn-api-v3", "vpn-dashboard-v3"]


def _ufw_steps(p: Params) -> list[Step]:
    out = [
        Step("ufw-ssh", "UFW allow SSH (avoid lockout)", "ufw allow 22/tcp", allow_fail=True),
    ]
    # If the customer chose "temporary public URL" for the wizard itself
    # (bootstrap.sh's ARCHIE_PUBLIC=1 path), it's bound to 0.0.0.0 and the
    # customer is actively watching this very install run through it. UFW's
    # default-deny would otherwise cut them off mid-install, right before
    # they see "Installed" — so keep its port open for as long as UFW is
    # managed by us. wizard.py can be stopped manually afterwards, which is
    # already the documented cleanup step.
    wizard_port = os.environ.get("ARCHIE_WIZARD_PORT", "").strip()
    if wizard_port.isdigit():
        out.append(Step("ufw-wizard", f"UFW allow install wizard {wizard_port}/tcp (temporary public access)",
                         f"ufw allow {wizard_port}/tcp", allow_fail=True))
    out += [
        Step("ufw-reality", "UFW allow Reality 443", "ufw allow 443/tcp"),
        Step("ufw-hy2", "UFW allow Hysteria2 2096/udp", "ufw allow 2096/udp"),
        Step("ufw-wg", "UFW allow WireGuard 51820/udp", "ufw allow 51820/udp"),
        # The Xray gRPC control API is sensitive — only the Docker bridge may reach it.
        Step("ufw-api", "UFW allow Docker→Xray api 10085",
             "ufw allow from 172.20.0.0/16 to any port 10085 proto tcp"),
    ]
    if p.mode == "A":
        # Mode A: Shadowsocks is a direct public protocol (clients dial it on the
        # public IP). The dashboard is published on the host IP (no domain), so
        # the web port is open too — the cloud firewall should still gate it.
        out.append(Step("ufw-ss", "UFW allow Shadowsocks 8388 (public)",
                        "ufw allow 8388/tcp"))
        out.append(Step("ufw-dash", "UFW allow dashboard 8080 (browser by IP)",
                        "ufw allow 8080/tcp"))
    else:
        # B/C: clients use the CDN-fronted protocols via nginx; SS stays internal.
        out += [
            Step("ufw-ss", "UFW allow Docker→Shadowsocks 8388",
                 "ufw allow from 172.20.0.0/16 to any port 8388 proto tcp"),
            Step("ufw-cdn", "UFW allow Docker→Xray CDN inbounds 10001-10006",
                 "ufw allow from 172.20.0.0/16 to any port 10001:10006 proto tcp"),
            Step("ufw-http",
                 "UFW allow 80 (Let's Encrypt/http)" if p.mode == "C" else "UFW allow 80 (nginx http)",
                 "ufw allow 80/tcp"),
            Step("ufw-tls", "UFW allow nginx TLS 8443", "ufw allow 8443/tcp"),
            Step("ufw-alt", "UFW allow alt TLS 2053", "ufw allow 2053/tcp"),
        ]
    out.append(Step("ufw-enable", "enable UFW", "ufw --force enable", allow_fail=True))
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Execution
# ─────────────────────────────────────────────────────────────────────────────


def _run(cmd: str, log_path: str | None = None) -> int:
    """Run a shell command. If ``log_path`` is given, append the command and its
    combined output there (so a UI can show the live install log)."""
    if log_path:
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"\n$ {cmd}\n")
            f.flush()
            return subprocess.run(["bash", "-c", cmd], stdout=f,
                                  stderr=subprocess.STDOUT).returncode
    return subprocess.run(["bash", "-c", cmd]).returncode


def run_plan(steps: list[Step], *, dry_run: bool, verbose: bool = False,
             on_step=None, log_path: str | None = None) -> int:
    """Execute the plan. Returns 0 on success, non-zero on the first hard fail.

    ``on_step(index, status)`` — optional callback fired as each step changes
    (``running`` / ``done`` / ``failed``), so a UI can stream live progress.
    """
    def emit(idx, status):
        if on_step:
            try:
                on_step(idx, status)
            except Exception:
                pass

    n = len(steps)
    for i, st in enumerate(steps, 1):
        head = f"[{i}/{n}] {st.name}: {st.desc}"
        if dry_run:
            info(head)
            print(f"      $ {st.sh}", file=sys.stderr)
            if st.check:
                print(f"      (skip if: {st.check})", file=sys.stderr)
            continue

        if st.check and _run(st.check, log_path) == 0:
            emit(i - 1, "done")
            ok(f"{head} — already satisfied, skipping")
            continue

        emit(i - 1, "running")
        info(head)
        if verbose:
            print(f"      $ {st.sh}")
        rc = _run(st.sh, log_path)
        if rc != 0:
            if st.allow_fail:
                emit(i - 1, "done")
                warn(f"{st.name} failed (rc={rc}) — continuing (non-fatal)")
                continue
            emit(i - 1, "failed")
            err(f"{st.name} failed (rc={rc}) — aborting")
            return rc
        emit(i - 1, "done")
        ok(f"{st.name} done")
    return 0


# ─────────────────────────────────────────────────────────────────────────────
# Self-check (§6)
# ─────────────────────────────────────────────────────────────────────────────


def _probe(cmd: str) -> bool:
    return _run(cmd) == 0


def self_check(p: Params, *, dashboard_url: str) -> list[tuple[str, bool, str]]:
    """Run the post-install probes. Returns [(label, ok, detail), ...]."""
    results: list[tuple[str, bool, str]] = []

    def add(label: str, cmd: str, detail: str = "") -> None:
        results.append((label, _probe(cmd), detail))

    add("Xray config valid", "/usr/local/bin/xray run -test -confdir /usr/local/etc/xray")
    add("Reality bound :443", "ss -tlnH 'sport = :443' | grep -q .")
    add("Hysteria2 bound :2096/udp", "ss -ulnH 'sport = :2096' | grep -q .")
    add("WireGuard bound :51820/udp", "ss -ulnH 'sport = :51820' | grep -q .")
    if p.mode == "A":
        add("Shadowsocks bound :8388", "ss -tlnH 'sport = :8388' | grep -q .", "")
    add("ailab network present", "docker network inspect ailab >/dev/null 2>&1")
    add("vpn-api-v3 running", "docker ps --format '{{.Names}}' | grep -q '^vpn-api-v3$'")
    add("vpn-dashboard-v3 running", "docker ps --format '{{.Names}}' | grep -q '^vpn-dashboard-v3$'")
    # Dashboard HTTP (Mode A is plain HTTP on :8080; B/C are TLS on :8443).
    # Mode C: resolve the domain to 127.0.0.1 instead of hitting real DNS —
    # verified live: a cloud instance often can't reach its own public IP over
    # the internet-facing route (AWS hairpin NAT), so probing the real domain
    # from inside the box itself gave a false "down" on a dashboard that
    # external clients could load fine. --resolve keeps the Host header/SNI
    # as the real domain (so nginx's server_name + TLS cert selection are
    # still exercised correctly) while avoiding the outbound self-connect.
    # Mode B is the opposite: the domain resolves to Cloudflare (not the box),
    # and the origin nginx allowlists Cloudflare IPs and denies everything else
    # (cloudflare-ips.conf ends in `deny all`). A --resolve to 127.0.0.1 hits
    # the origin directly from localhost, which the allowlist rejects with 403
    # — a false "down" on a perfectly healthy install. So for B, probe the real
    # domain through Cloudflare: an ordinary outbound connection to CF's edge,
    # no hairpin. Verified live on a Mode B EC2: localhost:8443/v3 -> 403,
    # via Cloudflare -> 200.
    resolve = ""
    probe_url = dashboard_url
    if p.mode == "A":
        # Mode A serves the dashboard as plain HTTP on the host's :8080 with no
        # vhost/Host-header matching, so self-probe over loopback. A cloud host
        # (AWS/GCP/etc.) usually can't reach its OWN public IP over the
        # internet-facing route (hairpin NAT) — probing the public IP false-failed
        # this check on a perfectly healthy install that external browsers loaded
        # fine. localhost:8080 is the same published port, so it reflects the
        # install itself, not the cloud firewall (mirrors the Reality check below).
        probe_url = dashboard_url.replace(p.server_ip, "127.0.0.1", 1)
    elif p.mode == "C" and p.server_domain:
        resolve = f"--resolve {shlex.quote(p.server_domain)}:8443:127.0.0.1 "
    # Hard timeouts so the check can NEVER hang the installer. Without these a
    # curl to an unreachable target (e.g. a cloud host that can't hairpin to its
    # own public IP) blocks for the full TCP timeout — a minute or more — leaving
    # a real user staring at a frozen verification screen. Bounded to a few
    # seconds it fails fast instead of hanging, for every mode.
    code = f"curl -ksS --connect-timeout 4 --max-time 8 {resolve}-o /dev/null -w '%{{http_code}}' " + shlex.quote(probe_url)
    # 301 is included alongside the other redirect codes: nginx's own
    # trailing-slash normalization (/v3 -> /v3/) returns 301, which is a
    # healthy response, not a failure — verified live (nginx access log
    # showed "GET /v3 ... 301", dashboard was actually fine).
    # A freshly-built dashboard container needs a few seconds for Next.js to
    # start serving after `docker compose up` returns, so a single probe here
    # races the warm-up and false-fails on a perfectly healthy install (seen
    # live: check ran ~5s after container start, dashboard was 200 moments
    # later). Retry for ~40s and pass the instant it responds. Each curl keeps
    # its own hard timeout, so the loop is bounded — it exits early on success
    # and can't hang.
    check = (
        f"for _ in $(seq 1 20); do "
        f"c=$({code}); "
        f"echo \"$c\" | grep -qE '^(200|301|302|307|308)$' && exit 0; "
        f"sleep 2; done; exit 1"
    )
    add("Dashboard responds", check, dashboard_url)
    # vpn-api runs in python:3.12-slim (no curl) and listens only on the ailab
    # network (:5900). Probe its public /vpn-api/stats from inside the container
    # with python's stdlib.
    add("vpn-api serving (:5900)",
        "docker exec vpn-api-v3 python3 -c "
        "'import urllib.request,sys; "
        "sys.exit(0 if urllib.request.urlopen(\"http://127.0.0.1:5900/vpn-api/stats\",timeout=5).status==200 else 1)'")
    # Reality handshake to the decoy SNI. Probe 127.0.0.1 (not the public IP) so
    # the check reflects the install, not the cloud firewall: on EC2/VPS the host
    # usually can't reach its own public IP:443 unless the security group allows
    # it. A pass returns the decoy site's real cert (Reality borrowed it).
    sni = shlex.quote(p.reality_sni)
    results.append((
        "Reality TLS handshake (local)",
        _probe(f"echo | timeout 8 openssl s_client -connect 127.0.0.1:443 -servername {sni} "
               f"</dev/null 2>/dev/null | grep -q 'CONNECTED'"),
        f"sni={p.reality_sni}",
    ))
    return results


def print_self_check(results: list[tuple[str, bool, str]]) -> bool:
    """Print a report. Returns True if all hard checks passed."""
    all_ok = True
    for label, passed, detail in results:
        mark = "[+]" if passed else "[x]"
        tail = f"  ({detail})" if detail else ""
        print(f"  {mark} {label}{tail}")
        if not passed:
            all_ok = False
    return all_ok
