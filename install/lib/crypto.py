"""Cryptographic material generation.

Reality keypair and WG keys need the `xray` and `wg` binaries respectively.
`openssl` handles AUTH_SECRET / API_AUTH_TOKEN / Hysteria password / Reality
short ID / the Mode-A self-signed Hysteria cert.

Every generator accepts pre-filled values (so re-runs are deterministic) and
only fills what's missing. When the required binary is absent and the value
isn't provided, we fall back to a Python implementation where one exists
(openssl rand via `secrets`; WG keys via `pynacl` if installed, else a clear
error), or raise — never silently emit a placeholder.
"""

from __future__ import annotations

import base64
import hashlib
import secrets

from . import common
from .common import Params, die, err, info, looks_like_key, run_capture, run_capture_bytes, warn


# ─────────────────────────────────────────────────────────────────────────────
# Reality keypair (xray x25519)
# ─────────────────────────────────────────────────────────────────────────────

def _xray_x25519() -> tuple[str, str]:
    """Run `xray x25519`, return (private, public). Raises if unavailable."""
    out = run_capture(["xray", "x25519"])
    if not out:
        raise RuntimeError("xray binary not available for x25519 keygen")
    pvk = pbk = ""
    for line in out.splitlines():
        low = line.lower()
        if "private" in low and ":" in line:
            pvk = line.split(":", 1)[1].strip()
        elif "public" in low and ":" in line:
            pbk = line.split(":", 1)[1].strip()
    if not pvk or not pbk:
        raise RuntimeError(f"could not parse xray x25519 output: {out!r}")
    return pvk, pbk


def _nacl_x25519() -> tuple[str, str]:
    """Pure-python fallback using PyNaCl if installed."""
    try:
        from nacl.public import PrivateKey
    except ImportError as exc:
        raise RuntimeError("PyNaCl not available") from exc
    sk = PrivateKey.generate()
    pvk = base64.urlsafe_b64encode(bytes(sk)).decode().rstrip("=")
    pbk = base64.urlsafe_b64encode(bytes(sk.public_key)).decode().rstrip("=")
    return pvk, pbk


def _stdlib_x25519() -> tuple[str, str]:
    """Pure-stdlib Curve25519 keygen (RFC 7748). Always available."""
    from . import x25519
    return x25519.reality_keypair()


def ensure_reality(params: Params) -> None:
    if params.reality_pbk and params.reality_pvk:
        if not looks_like_key(params.reality_pbk) or not looks_like_key(params.reality_pvk):
            warn("provided reality keys look malformed; proceeding anyway")
        return
    # Prefer the real xray binary (canonical format); fall back through deps;
    # last resort is a stdlib-only implementation so local dev never blocks.
    pvk = pbk = None
    for label, fn in (
        ("xray", _xray_x25519),
        ("pynacl", _nacl_x25519),
        ("stdlib", _stdlib_x25519),
    ):
        try:
            pvk, pbk = fn()
            if label != "xray":
                info(f"generated reality keypair using {label} fallback")
            break
        except RuntimeError:
            continue
    if not pvk or not pbk:
        die("cannot generate Reality keypair (all keygen methods failed)")
    params.reality_pvk, params.reality_pbk = pvk, pbk
    if not params.reality_sid:
        params.reality_sid = common.hex8()


# ─────────────────────────────────────────────────────────────────────────────
# App secrets (openssl / secrets)
# ─────────────────────────────────────────────────────────────────────────────


def ensure_auth_secret(params: Params) -> None:
    if params.auth_secret:
        return
    params.auth_secret = common.rand_b64(32)


def ensure_api_token(params: Params) -> None:
    if params.api_token:
        return
    # openssl rand -hex 32 -> 64 hex chars
    out = run_capture(["openssl", "rand", "-hex", "32"])
    params.api_token = out or secrets.token_hex(32)


def ensure_hysteria_password(params: Params) -> None:
    if params.hysteria_password:
        return
    out = run_capture(["openssl", "rand", "-hex", "16"])
    params.hysteria_password = out or secrets.token_hex(16)


def ensure_ss_password(params: Params) -> None:
    """Server-level Shadowsocks password. Required for the inbound to load
    (xray rejects a chacha20-ietf-poly1305 inbound with an empty password);
    per-client passwords are added by the dashboard at runtime."""
    if params.ss_password:
        return
    out = run_capture(["openssl", "rand", "-hex", "16"])
    params.ss_password = out or secrets.token_hex(16)


# ─────────────────────────────────────────────────────────────────────────────
# WireGuard keys (wg genkey | wg pubkey; wg genpsk)
# ─────────────────────────────────────────────────────────────────────────────


def _wg_keypair() -> tuple[str, str]:
    """Return (private, public) using `wg`. Raises if unavailable."""
    raw = run_capture_bytes(["sh", "-c", "wg genkey | wg pubkey"])
    if not raw:
        raise RuntimeError("wg binary not available for keygen")
    lines = raw.decode().split()
    if len(lines) < 2:
        raise RuntimeError(f"unexpected wg keygen output: {raw!r}")
    return lines[0], lines[1]


def _wg_keypair_pynacl() -> tuple[str, str]:
    try:
        from nacl.public import PrivateKey
    except ImportError as exc:
        raise RuntimeError("PyNaCl not available") from exc
    sk = PrivateKey.generate()
    private = base64.b64encode(bytes(sk)).decode().rstrip("=")
    public = base64.b64encode(bytes(sk.public_key)).decode().rstrip("=")
    return private, public


def _wg_keypair_stdlib() -> tuple[str, str]:
    """Pure-stdlib Curve25519 keygen in WireGuard (standard base64) format."""
    from . import x25519
    return x25519.wireguard_keypair()


def ensure_wireguard(params: Params) -> None:
    if params.wg_private and params.wg_public:
        return
    priv = pub = None
    for label, fn in (
        ("wg", _wg_keypair),
        ("pynacl", _wg_keypair_pynacl),
        ("stdlib", _wg_keypair_stdlib),
    ):
        try:
            priv, pub = fn()
            if label != "wg":
                info(f"generated wireguard keypair using {label} fallback")
            break
        except RuntimeError:
            continue
    if not priv or not pub:
        die("cannot generate WireGuard keypair (all keygen methods failed)")
    params.wg_private, params.wg_public = priv, pub


# ─────────────────────────────────────────────────────────────────────────────
# Hysteria Mode-A self-signed cert (openssl)
# ─────────────────────────────────────────────────────────────────────────────


def self_signed_cert(cn: str, days: int = 3650) -> tuple[str, str]:
    """Return (cert_pem, key_pem) for a self-signed RSA cert.

    Used in Mode A where there is no domain / no CF Origin cert, so Hysteria2
    terminates its own TLS with a self-signed cert (clients set insecure=1).
    """
    # Generate key and cert to two temp files — reading both from /dev/stdout
    # would interleave them. openssl writes them atomically; we just read back.
    return _self_signed_cert_two_step(cn, days)


def _self_signed_cert_two_step(cn: str, days: int) -> tuple[str, str]:
    import tempfile, os
    with tempfile.TemporaryDirectory() as td:
        key = os.path.join(td, "k.pem")
        crt = os.path.join(td, "c.pem")
        rc = _run_quiet([
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", key, "-out", crt, "-days", str(days),
            "-subj", f"/CN={cn}",
        ])
        if not rc:
            raise RuntimeError("openssl failed to produce self-signed cert")
        try:
            with open(crt) as f:
                cert = f.read()
            with open(key) as f:
                pk = f.read()
        except OSError as exc:
            raise RuntimeError(f"could not read generated cert: {exc}")
        return cert, pk


def _run_quiet(cmd: list[str], timeout: int = 15) -> bool:
    import subprocess
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=timeout)
        return p.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return False


def ensure_all(params: Params) -> None:
    """Top-level: fill every missing crypto field on params."""
    ensure_reality(params)
    ensure_auth_secret(params)
    ensure_api_token(params)
    ensure_hysteria_password(params)
    ensure_ss_password(params)
    ensure_wireguard(params)
