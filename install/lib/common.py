"""Shared helpers for the Archie installer generators.

Everything here is pure: no system mutation, no network. The bash entry point
handles mutation; these modules only compute and write files into a staging dir.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional


# ─────────────────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────────────────

_VERBOSE = False


def set_verbose(value: bool) -> None:
    global _VERBOSE
    _VERBOSE = bool(value)


def _log(prefix: str, msg: str) -> None:
    print(f"{prefix} {msg}", file=sys.stderr, flush=True)


def info(msg: str) -> None:
    _log("[*]", msg)


def ok(msg: str) -> None:
    _log("[+]", msg)


def warn(msg: str) -> None:
    _log("[!]", msg)


def err(msg: str) -> None:
    _log("[x]", msg)


def debug(msg: str) -> None:
    if _VERBOSE:
        _log("[.]", msg)


def die(msg: str, code: int = 1) -> "None":
    err(msg)
    raise SystemExit(code)


# ─────────────────────────────────────────────────────────────────────────────
# Run wrapper — bash side controls whether commands actually execute.
# In Python we only ever need to run *read-only probes* (uname, ss, docker info,
# openssl rand, xray x25519). Anything mutating is the bash script's job.
# ─────────────────────────────────────────────────────────────────────────────


def run_capture(cmd: list[str], timeout: int = 10) -> Optional[str]:
    """Run a read-only command, return stdout (stripped) or None on failure.

    Never raises — detection is best-effort. Failures mean "unknown", callers
    decide how to treat that.
    """
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError) as exc:
        debug(f"probe failed: {' '.join(cmd)} -> {exc}")
        return None
    if proc.returncode != 0:
        debug(f"probe nonzero: {' '.join(cmd)} -> rc={proc.returncode}")
        return None
    return proc.stdout.strip() or None


def run_capture_bytes(cmd: list[str], timeout: int = 10) -> Optional[bytes]:
    """Same as run_capture but returns raw bytes (for keygen output)."""
    try:
        proc = subprocess.run(
            cmd, capture_output=True, timeout=timeout, check=False
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError) as exc:
        debug(f"probe failed: {' '.join(cmd)} -> {exc}")
        return None
    if proc.returncode != 0:
        return None
    return proc.stdout or None


# ─────────────────────────────────────────────────────────────────────────────
# File helpers (atomic write into staging)
# ─────────────────────────────────────────────────────────────────────────────


def atomic_write(path: Path, data: str, mode: int = 0o644) -> None:
    """Write text to path atomically (tmp + rename). Creates parent dirs."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(data, encoding="utf-8")
    os.chmod(tmp, mode)
    os.replace(tmp, path)


def atomic_write_bytes(path: Path, data: bytes, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    os.chmod(tmp, mode)
    os.replace(tmp, path)


def write_json(path: Path, obj: Any, indent: int = 2) -> None:
    atomic_write(path, json.dumps(obj, indent=indent) + "\n")


# ─────────────────────────────────────────────────────────────────────────────
# Params dataclass — the single shape every generator consumes.
# install.sh parses flags + detection into a Params and hands it down.
# ─────────────────────────────────────────────────────────────────────────────


VALID_MODES = {"A", "B", "C"}


@dataclass
class Params:
    # ── mode / identity ──
    mode: str = "A"                       # A | B | C
    server_ip: str = ""
    server_domain: str = ""               # required for B, C
    brand: str = "Archie VPN"
    base_path: str = "/v3"                # next.config.ts hardcodes /v3

    # ── reality ──
    reality_pbk: str = ""                 # public (X25519 base64url)
    reality_pvk: str = ""                 # private (paired)
    reality_sid: str = ""                 # 16-hex (8 bytes)
    reality_sni: str = "www.cloudflare.com"  # microsoft's TLS edge stopped working as a Reality decoy — clients on the old SNI connect but pass no traffic

    # ── app secrets ──
    auth_secret: str = ""                 # openssl rand -base64 32
    api_token: str = ""                   # openssl rand -hex 32  -> VPN_API_V3_TOKEN

    # ── hysteria2 ──
    hysteria_password: str = ""           # openssl rand -hex 16

    # ── shadowsocks ──
    ss_password: str = ""                 # server-level SS password (inbound must be valid)

    # ── wireguard ──
    wg_private: str = ""                  # wg genkey
    wg_public: str = ""                   # wg pubkey < private
    wg_endpoint_ip: str = ""              # default: server_ip

    # ── mode B (Cloudflare Origin cert) ──
    cf_origin_cert: str = ""              # PEM content (or path to read)
    cf_origin_key: str = ""               # PEM content

    # ── telegram (optional) ──
    tg_token: str = ""
    tg_chat_id: str = ""

    # ── enrichment (optional) ──
    abuseipdb_key: str = ""

    # ── SMTP invite email (optional; stored-override in the UI wins per-field) ──
    smtp_host: str = ""
    smtp_port: str = ""                   # blank → app default 587
    smtp_user: str = ""
    smtp_pass: str = ""
    smtp_from: str = ""                   # "Brand <invites@example.com>"
    smtp_secure: str = ""                 # "true"/"false"; blank → app default false
    no_smtp: bool = False

    # ── behavior ──
    install_dir: str = "/opt/archie"      # staging layout mirrors this
    staging_dir: str = ""                 # where generators write
    extra_protocols: list[str] = field(default_factory=list)  # xhttp, httpupgrade, mkcp
    dashboard_basic_auth: bool = False    # nginx auth_basic on dashboard
    no_fail2ban: bool = False
    no_firewall: bool = False
    # Option B (pre-built images): stage docker-compose.release.yml and pull the
    # sealed ghcr.io images instead of copying api/+dashboard/ source and building
    # on the box. Default False keeps the validated source-build path for dev/prod.
    prebuilt: bool = False

    # ── detection (filled by detect.py) ──
    os_id: str = ""                       # ubuntu, debian, amzn, rocky, ...
    os_version: str = ""
    arch: str = "x86_64"
    docker_present: bool = False
    ufw_present: bool = False
    wan_iface: str = "eth0"               # for WG NAT rules

    # ── crypto material carried for re-runs ──
    # (filled by crypto.fill_missing; empty means "generate")

    # ── internal: where this script lives (for reading bundled templates) ──
    installer_root: str = ""

    def validate(self) -> None:
        if self.mode not in VALID_MODES:
            die(f"invalid mode '{self.mode}' (expected one of {sorted(VALID_MODES)})")
        if not self.server_ip:
            die("server_ip is required (use --server-ip= or let detection fill it)")
        if self.mode in ("B", "C") and not self.server_domain:
            die(f"mode {self.mode} requires --domain=")
        if self.mode == "B" and not self.cf_origin_cert:
            die("mode B requires a Cloudflare Origin cert (--cf-origin-cert=)")
        if not self.staging_dir:
            die("staging_dir is required")
        # reality must be a paired keyset or fully empty (so we generate)
        partial = bool(self.reality_pbk) ^ bool(self.reality_pvk)
        if partial:
            die("reality_pbk and reality_pvk must be both set or both empty")

    @property
    def public_base_url(self) -> str:
        if self.mode == "A":
            # Mode A has no domain and no TLS anywhere — the dashboard is
            # plain HTTP on a non-default port (see gen_compose.py's
            # MODE_A_DASHBOARD_PORT). This value is baked into every
            # install's NEXT_PUBLIC_PUBLIC_BASE_URL and used to build
            # customer-facing invite/subscription links — getting either the
            # scheme or the port wrong here sends a real invite link to
            # Xray's Reality listener on :443 instead of the dashboard.
            return f"http://{self.server_ip}:8080{self.base_path}"
        # Domain modes run the dashboard/API behind nginx on :8443 because
        # host port 443 is reserved for direct VLESS Reality. This is baked
        # into invite links, subscription URLs, ALLOWED_ORIGINS, and CLI
        # preview output; omitting the port sends browsers to Reality instead
        # of nginx.
        return f"https://{self.server_domain}:8443{self.base_path}"

    @property
    def needs_nginx(self) -> bool:
        # Modes B and C always need nginx (TLS termination + WS/gRPC routing).
        # Mode A can run without nginx; the bash layer may still bring it up for
        # the dashboard UI, but config generation treats it as optional.
        return self.mode in ("B", "C")


# ─────────────────────────────────────────────────────────────────────────────
# Small parsing / format helpers
# ─────────────────────────────────────────────────────────────────────────────


_KEY_RE = re.compile(r"^[A-Za-z0-9_\-]{20,}$")


def looks_like_key(s: str) -> bool:
    """Loose check that a string is plausible key material (non-empty, base64-ish)."""
    return bool(s) and bool(_KEY_RE.match(s))


def hex8() -> str:
    """8 random bytes as 16 hex chars. Prefers openssl; falls back to secrets."""
    out = run_capture(["openssl", "rand", "-hex", "8"])
    if out and len(out) == 16:
        return out
    import secrets
    return secrets.token_hex(8)


def rand_b64(n: int = 32) -> str:
    """n random bytes base64-encoded (default 32 -> 44-char string)."""
    out = run_capture(["openssl", "rand", "-base64", str(n)])
    if out:
        return out
    import secrets, base64
    return base64.b64encode(secrets.token_bytes(n)).decode()
