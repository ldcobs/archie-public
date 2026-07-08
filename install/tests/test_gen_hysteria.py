"""Tests for the Hysteria2 config generator."""

from __future__ import annotations

from install.lib import gen_hysteria


def test_config_has_listen_2096(params_a):
    cfg = gen_hysteria.build_config(params_a, "/c.pem", "/k.pem", insecure=True)
    assert "listen: :2096" in cfg


def test_config_has_tls_cert_and_key_paths(params_a):
    cfg = gen_hysteria.build_config(params_a, "/etc/hysteria/cert.pem", "/etc/hysteria/key.pem", insecure=True)
    assert "cert: /etc/hysteria/cert.pem" in cfg
    assert "key: /etc/hysteria/key.pem" in cfg


def test_config_has_userpass_auth(params_a):
    cfg = gen_hysteria.build_config(params_a, "/c.pem", "/k.pem", insecure=True)
    assert "auth:" in cfg
    assert "type: userpass" in cfg
    assert "userpass:" in cfg
    assert params_a.hysteria_password in cfg


def test_config_has_masquerade_proxy(params_a):
    cfg = gen_hysteria.build_config(params_a, "/c.pem", "/k.pem", insecure=True)
    assert "masquerade:" in cfg
    assert "type: proxy" in cfg
    # hysteria2 schema: proxy.url + rewriteHost (not target/listen/forceHTTPS)
    assert "proxy:" in cfg
    assert f"url: https://{params_a.reality_sni}" in cfg
    assert "rewriteHost: true" in cfg
    assert "forceHTTPS" not in cfg


def test_insecure_flag_emits_comment(params_a):
    cfg = gen_hysteria.build_config(params_a, "/c.pem", "/k.pem", insecure=True)
    assert "self-signed" in cfg and "insecure=1" in cfg


def test_secure_flag_omits_self_signed_comment(params_b):
    cfg = gen_hysteria.build_config(params_b, "/c.pem", "/k.pem", insecure=False)
    assert "self-signed" not in cfg


def test_bandwidth_and_quic_settings_present(params_a):
    cfg = gen_hysteria.build_config(params_a, "/c.pem", "/k.pem", insecure=True)
    assert "bandwidth:" in cfg
    assert "1 gbps" in cfg
    assert "quic:" in cfg


def test_cert_paths_helper():
    cert, key = gen_hysteria.cert_paths()
    assert cert == "/etc/hysteria/cert.pem"
    assert key == "/etc/hysteria/key.pem"


def test_config_parses_as_yamlish_lines(params_a):
    # We don't require PyYAML; just sanity-check structure line-by-line.
    cfg = gen_hysteria.build_config(params_a, "/c.pem", "/k.pem", insecure=True)
    lines = [l.strip() for l in cfg.splitlines() if l.strip()]
    # top-level keys we expect (some carry an inline value, e.g. "listen: :2096")
    for key in ("listen:", "tls:", "auth:", "masquerade:", "bandwidth:", "quic:"):
        assert any(l.startswith(key) for l in lines), f"missing top-level section {key}"
