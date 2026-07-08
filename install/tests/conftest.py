"""Pytest fixtures for the Archie installer generators.

Tests import the lib as a package (``install.lib.*``) so the generators'
relative imports resolve. We put the repo root on sys.path once.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]   # .../Archie
INSTALL_DIR = REPO_ROOT / "install"


def _ensure_importable() -> None:
    if str(REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(REPO_ROOT))


_ensure_importable()


@pytest.fixture
def params_a() -> "object":
    """A fully-filled Params for Mode A (no domain, no nginx)."""
    from install.lib.common import Params
    p = Params()
    p.mode = "A"
    p.server_ip = "198.51.100.10"
    p.server_domain = ""
    p.brand = "Test VPN"
    p.reality_pbk = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    p.reality_pvk = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
    p.reality_sid = "0123456789abcdef"
    p.reality_sni = "www.microsoft.com"
    p.auth_secret = "test-auth-secret"
    p.api_token = "a" * 64
    p.hysteria_password = "h" * 32
    p.ss_password = "s" * 32
    p.wg_private = "c" * 44
    p.wg_public = "d" * 44
    p.wg_endpoint_ip = p.server_ip
    p.staging_dir = ""
    return p


@pytest.fixture
def params_b(params_a) -> "object":
    """Mode B: copy of A with domain + CF Origin cert set."""
    import copy
    p = copy.copy(params_a)
    p.mode = "B"
    p.server_domain = "vpn.example.com"
    p.cf_origin_cert = "-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n"
    p.cf_origin_key = "-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n"
    return p


@pytest.fixture
def params_c(params_a) -> "object":
    """Mode C: copy of A with domain set, no CF cert."""
    import copy
    p = copy.copy(params_a)
    p.mode = "C"
    p.server_domain = "vpn.example.com"
    return p
