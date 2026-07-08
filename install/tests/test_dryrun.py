"""End-to-end dry-run test: run the full assembler, assert the staging tree.

These exercise the whole pipeline (detection → crypto → assemble) without
touching the host. We call assemble() directly rather than shelling out to
install.sh so the test is hermetic and fast.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]


def _make_params(staging: Path, mode: str, **kw):
    from install.lib.common import Params
    p = Params()
    p.mode = mode
    p.server_ip = kw.get("server_ip", "198.51.100.10")
    p.server_domain = kw.get("domain", "")
    p.brand = "Test"
    p.reality_sni = "www.microsoft.com"
    p.staging_dir = str(staging)
    p.install_dir = "/opt/archie"
    p.wg_endpoint_ip = p.server_ip
    # pre-fill crypto so no binaries needed
    p.reality_pbk = "A" * 43
    p.reality_pvk = "B" * 43
    p.reality_sid = "0123456789abcdef"
    p.auth_secret = "s" * 44
    p.api_token = "t" * 64
    p.hysteria_password = "h" * 32
    p.wg_private = "c" * 44
    p.wg_public = "d" * 44
    return p


@pytest.fixture
def staging(tmp_path):
    s = tmp_path / "archie"
    return s


# ── Mode A ──


def test_mode_a_full_tree(staging):
    from install.lib.assemble_install_dir import assemble
    p = _make_params(staging, "A", server_ip="198.51.100.10")
    out = assemble(p)
    assert out == staging
    # required files
    for rel in [".env", "manifest.json", "docker-compose.vpn.yml",
                "host/xray/config.json", "host/hysteria/config.yaml",
                "host/hysteria/cert.pem", "host/hysteria/key.pem",
                "host/wireguard/wg0.conf", "host/wireguard/clients.json",
                "host/systemd/xray.service", "host/systemd/hysteria-server.service",
                "vpn-dashboard-v3/.env.production",
                "scripts/apply-vpn-changes.sh"]:
        assert (staging / rel).exists(), f"missing {rel}"
    # mode A has no nginx
    assert not (staging / "nginx").exists()


def test_mode_a_xray_config_valid_json(staging):
    from install.lib.assemble_install_dir import assemble
    assemble(_make_params(staging, "A"))
    cfg = json.loads((staging / "host/xray/config.json").read_text())
    assert [i["tag"] for i in cfg["inbounds"]] == ["vless-reality", "api", "shadowsocks"]


def test_mode_a_apply_script_paths_rewritten(staging):
    from install.lib.assemble_install_dir import assemble
    assemble(_make_params(staging, "A"))
    text = (staging / "scripts/apply-vpn-changes.sh").read_text()
    assert "__ARCHIE_DATA__" not in text  # placeholder must be rewritten to the data dir
    assert "/opt/archie" in text


def test_mode_a_manifest(staging):
    from install.lib.assemble_install_dir import assemble
    assemble(_make_params(staging, "A"))
    m = json.loads((staging / "manifest.json").read_text())
    assert m["mode"] == "A"
    assert m["needs_nginx"] is False
    assert m["hysteria_cert_mode"] == "self-signed"
    assert m["tls_cert_source"] == "none"


# ── Mode B ──


def test_mode_b_full_tree_includes_nginx(staging):
    from install.lib.assemble_install_dir import assemble
    p = _make_params(staging, "B", domain="vpn.example.com")
    p.cf_origin_cert = "FAKE"
    assemble(p)
    for rel in ["nginx/nginx.conf", "nginx/conf.d/archie.conf",
                "nginx/html/index.html", "nginx/cloudflare-ips.conf"]:
        assert (staging / rel).exists(), f"missing {rel}"
    assert "cloudflare-origin.pem" in (staging / "nginx/nginx.conf").read_text()


def test_mode_b_cert_is_operator_staged_not_self_signed(staging):
    from install.lib.assemble_install_dir import assemble
    p = _make_params(staging, "B", domain="vpn.example.com")
    p.cf_origin_cert = "FAKE"
    assemble(p)
    assert (staging / "host/hysteria/cert.pem.STAGED-BY-OPERATOR").exists()
    assert not (staging / "host/hysteria/cert.pem").exists()


def test_mode_b_cf_origin_cert_staged_for_apply(staging):
    """The apply plan's cf-origin-cert step copies host/cloudflare-origin.{pem,key}
    onto the box — assemble must actually write those, with the pasted PEM
    content and a 0600 key. This is the exact gap that blocked Mode B: the
    engine referenced these files but nothing ever created them."""
    from install.lib.assemble_install_dir import assemble
    p = _make_params(staging, "B", domain="vpn.example.com")
    p.cf_origin_cert = "-----BEGIN CERTIFICATE-----\nCERTBODY\n-----END CERTIFICATE-----"
    p.cf_origin_key = "-----BEGIN PRIVATE KEY-----\nKEYBODY\n-----END PRIVATE KEY-----"
    assemble(p)
    cert = staging / "host/cloudflare-origin.pem"
    key = staging / "host/cloudflare-origin.key"
    assert cert.exists() and key.exists(), "CF origin cert/key not staged"
    assert "CERTBODY" in cert.read_text()
    assert "KEYBODY" in key.read_text()
    # trailing newline normalized so `install` doesn't choke on a bare last line
    assert cert.read_text().endswith("\n") and key.read_text().endswith("\n")
    assert (key.stat().st_mode & 0o777) == 0o600


def test_mode_b_apply_plan_has_cert_steps(staging):
    """build_plan for Mode B must include cf-origin-cert (install the pasted
    cert) and hysteria-cert (reuse it for HY2)."""
    from install.lib.assemble_install_dir import assemble
    from install.lib import apply
    p = _make_params(staging, "B", domain="vpn.example.com")
    p.cf_origin_cert = "-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----"
    p.cf_origin_key = "-----BEGIN PRIVATE KEY-----\nX\n-----END PRIVATE KEY-----"
    out = assemble(p)
    steps = apply.build_plan(p, Path(str(out)))
    names = [s.name for s in steps]
    assert "cf-origin-cert" in names
    assert "hysteria-cert" in names


# ── Mode C ──


def test_mode_c_uses_lets_encrypt_paths(staging):
    from install.lib.assemble_install_dir import assemble
    p = _make_params(staging, "C", domain="vpn.example.com")
    assemble(p)
    nginx = (staging / "nginx/nginx.conf").read_text()
    assert "letsencrypt/live/vpn.example.com" in nginx
    assert "cloudflare-ips.conf" not in (staging / "nginx/conf.d/archie.conf").read_text()


# ── env + dashboard build env ──


def test_env_has_nonblank_secrets(staging):
    from install.lib.assemble_install_dir import assemble
    assemble(_make_params(staging, "A"))
    kv = {}
    for line in (staging / ".env").read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, _, v = line.partition("=")
            kv[k] = v
    assert kv["AUTH_SECRET"]
    assert kv["VPN_API_V3_TOKEN"]
    assert kv["VLESS_PBK"]


def test_dashboard_env_production_baked(staging):
    from install.lib.assemble_install_dir import assemble
    p = _make_params(staging, "B", domain="vpn.example.com")
    p.cf_origin_cert = "FAKE"
    assemble(p)
    text = (staging / "vpn-dashboard-v3/.env.production").read_text()
    assert "NEXT_PUBLIC_SERVER_IP=198.51.100.10" in text
    assert "NEXT_PUBLIC_SERVER_DOMAIN=vpn.example.com" in text


# ── idempotency ──


def test_rerun_overwrites_cleanly(staging):
    from install.lib.assemble_install_dir import assemble
    p = _make_params(staging, "A")
    assemble(p)
    # add a stray file
    (staging / "stray.txt").write_text("x")
    assemble(p)  # re-run should wipe + regenerate
    assert not (staging / "stray.txt").exists()
    assert (staging / "manifest.json").exists()
