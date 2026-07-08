"""Pure-Python X25519 (RFC 7748) — stdlib only.

Last-resort fallback so the installer can generate Reality and WireGuard
keypairs without requiring the `xray`, `wg`, or PyNaCl binaries. This is the
canonical Curve25519 scalar multiplication; it's slow (~ms) but only runs once
at install time and is purely for environments where the native tools aren't
present (e.g. local dev / CI).

References: RFC 7748 §5. The field arithmetic uses Python big ints (no C
extension), which is fine for a one-shot keygen.
"""

from __future__ import annotations

import base64
import os

# Curve25519 parameters (p = 2^255 - 19, a24 = 121665)
P = 2 ** 255 - 19
A24 = 121665


def _clamp(k: bytes) -> int:
    n = bytearray(k)
    n[0] &= 248
    n[31] &= 127
    n[31] |= 64
    return int.from_bytes(bytes(n), "little")


def _inv(x: int) -> int:
    return pow(x, P - 2, P)


def _scalar_mult(k: bytes, u: bytes) -> bytes:
    """X25519 scalar multiplication (RFC 7748 §5)."""
    k_int = _clamp(k)
    u_int = int.from_bytes(u, "little") & ((1 << 255) - 1)

    x1, x2 = u_int, 1
    z2, x3 = 0, u_int
    z3, swap = 1, 0

    for t in range(254, -1, -1):
        k_t = (k_int >> t) & 1
        swap ^= k_t
        if swap:
            x2, x3 = x3, x2
            z2, z3 = z3, z2
        swap = k_t

        A = (x2 + z2) % P
        AA = (A * A) % P
        B = (x2 - z2) % P
        BB = (B * B) % P
        E = (AA - BB) % P
        C = (x3 + z3) % P
        D = (x3 - z3) % P
        DA = (D * A) % P
        CB = (C * B) % P
        x3 = pow(DA + CB, 2, P)
        z3 = (x1 * pow(DA - CB, 2, P)) % P
        x2 = (AA * BB) % P
        z2 = (E * (AA + A24 * E)) % P

    if swap:
        x2, x3 = x3, x2

    z2_inv = _inv(z2)
    result = (x2 * z2_inv) % P
    return result.to_bytes(32, "little")


# Base point u = 9 (RFC 7748 §6.1).
_BASE_U = b"\x09" + b"\x00" * 31


def _b64url(b: bytes) -> str:
    """base64url without padding (Xray/x25519 key format)."""
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _b64std(b: bytes) -> str:
    """standard base64 with padding (WireGuard key format)."""
    return base64.b64encode(b).decode()


def reality_keypair() -> tuple[str, str]:
    """Return (private, public) X25519 keys in Xray's base64url format."""
    priv = os.urandom(32)
    pub = _scalar_mult(priv, _BASE_U)
    return _b64url(priv), _b64url(pub)


def wireguard_keypair() -> tuple[str, str]:
    """Return (private, public) WG keys in standard base64 format."""
    priv = os.urandom(32)
    pub = _scalar_mult(priv, _BASE_U)
    return _b64std(priv), _b64std(pub)
