"""Tests for the crypto material generators."""

from __future__ import annotations

import base64

from install.lib import crypto
from install.lib.common import Params
from install.lib import x25519


# ── Pure-stdlib X25519 (RFC 7748) ──


def test_x25519_reality_keypair_shape():
    pvk, pbk = x25519.reality_keypair()
    # base64url of 32 bytes = 43 chars (no padding)
    assert len(pvk) == 43
    assert len(pbk) == 43
    # decode must yield 32 raw bytes
    def b64url_dec(s):
        pad = "=" * (-len(s) % 4)
        return base64.urlsafe_b64decode(s + pad)
    assert len(b64url_dec(pvk)) == 32
    assert len(b64url_dec(pbk)) == 32


def test_x25519_keypairs_are_distinct():
    pairs = {x25519.reality_keypair() for _ in range(5)}
    assert len(pairs) == 5  # all unique


def test_x25519_wg_keypair_uses_standard_base64():
    priv, pub = x25519.wireguard_keypair()
    # standard base64 of 32 bytes = 44 chars (with padding)
    assert len(priv) == 44
    assert priv.endswith("=")
    assert len(pub) == 44
    assert pub.endswith("=")


def test_x25519_known_answer_vector():
    # RFC 7748 §6.1 first X25519 test vector (scalar × u-coord → output).
    import binascii
    scalar = binascii.unhexlify(
        "a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4"
    )
    ucoord = binascii.unhexlify(
        "e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c"
    )
    expected = binascii.unhexlify(
        "c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552"
    )
    got = x25519._scalar_mult(scalar, ucoord)
    assert got == expected


def test_x25519_basepoint_public_key_matches_rfc():
    # RFC 7748 §6.1: scalar 1c ... (the second vector's scalar) but here we
    # just confirm that the standard base-point public key generation works:
    # a known scalar against basepoint u=9 should give a deterministic pub.
    import binascii
    scalar = binascii.unhexlify(
        "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a"
    )
    expected = binascii.unhexlify(
        "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a"
    )
    got = x25519._scalar_mult(scalar, x25519._BASE_U)
    assert got == expected


# ── ensure_* fill functions ──


def test_ensure_reality_keeps_provided_values():
    p = Params()
    p.reality_pbk = "P" * 43
    p.reality_pvk = "V" * 43
    crypto.ensure_reality(p)
    assert p.reality_pbk == "P" * 43
    assert p.reality_pvk == "V" * 43


def test_ensure_reality_generates_when_empty():
    p = Params()
    crypto.ensure_reality(p)
    assert len(p.reality_pbk) == 43
    assert len(p.reality_pvk) == 43
    assert p.reality_sid and len(p.reality_sid) == 16  # hex8


def test_ensure_wireguard_keeps_provided_values():
    p = Params()
    p.wg_private = "priv" + "=" * 40
    p.wg_public = "pub" + "=" * 41
    crypto.ensure_wireguard(p)
    assert p.wg_private.startswith("priv")


def test_ensure_wireguard_generates_when_empty():
    p = Params()
    crypto.ensure_wireguard(p)
    assert len(p.wg_private) == 44
    assert len(p.wg_public) == 44


def test_ensure_auth_secret_nonempty():
    p = Params()
    crypto.ensure_auth_secret(p)
    assert p.auth_secret
    assert len(p.auth_secret) >= 32


def test_ensure_api_token_is_hex():
    p = Params()
    crypto.ensure_api_token(p)
    assert p.api_token
    # 64 hex chars (openssl rand -hex 32) or token_hex(32)
    assert len(p.api_token) == 64
    int(p.api_token, 16)  # raises if not hex


def test_ensure_hysteria_password():
    p = Params()
    crypto.ensure_hysteria_password(p)
    assert p.hysteria_password
    assert len(p.hysteria_password) == 32


def test_ensure_all_fills_everything():
    p = Params()
    crypto.ensure_all(p)
    for attr in ("reality_pbk", "reality_pvk", "reality_sid",
                 "auth_secret", "api_token", "hysteria_password",
                 "wg_private", "wg_public"):
        assert getattr(p, attr), f"{attr} not filled"
