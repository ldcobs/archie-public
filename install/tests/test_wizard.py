"""Tests for the bootstrap-owned setup wizard backend."""

from __future__ import annotations

from install.wizard import serve


def test_wizard_mode_a_dashboard_url_uses_public_server_ip(monkeypatch):
    def fake_detect(_p, insecure_ip=False):
        _p.server_ip = "198.51.100.10"

    def fake_crypto(_p):
        return None

    monkeypatch.setattr(serve.detect, "run_all_detection", fake_detect)
    import lib.crypto as crypto
    monkeypatch.setattr(crypto, "ensure_all", fake_crypto)

    p = serve._params_from_answers({"mode": "A", "server_ip": "198.51.100.10"})
    assert serve._dashboard_url(p) == "http://198.51.100.10:8080/v3"


def _stub_detect_crypto(monkeypatch):
    monkeypatch.setattr(serve.detect, "run_all_detection",
                        lambda _p, insecure_ip=False: setattr(_p, "server_ip", "198.51.100.10"))
    import lib.crypto as crypto
    monkeypatch.setattr(crypto, "ensure_all", lambda _p: None)


def test_wizard_honors_archie_prebuilt_env(monkeypatch):
    # bootstrap.sh exports ARCHIE_PREBUILT; the wizard must thread it into Params
    # so an Option-B install actually pulls images instead of building source.
    _stub_detect_crypto(monkeypatch)
    monkeypatch.setenv("ARCHIE_PREBUILT", "1")
    p = serve._params_from_answers({"mode": "A", "server_ip": "198.51.100.10"})
    assert p.prebuilt is True


def test_wizard_defaults_to_source_build(monkeypatch):
    _stub_detect_crypto(monkeypatch)
    monkeypatch.delenv("ARCHIE_PREBUILT", raising=False)
    p = serve._params_from_answers({"mode": "A", "server_ip": "198.51.100.10"})
    assert p.prebuilt is False


def test_wizard_mode_b_preserves_pasted_origin_cert(monkeypatch):
    def fake_detect(_p, insecure_ip=False):
        _p.server_ip = "198.51.100.10"

    def fake_crypto(_p):
        return None

    monkeypatch.setattr(serve.detect, "run_all_detection", fake_detect)
    import lib.crypto as crypto
    monkeypatch.setattr(crypto, "ensure_all", fake_crypto)

    answers = {
        "mode": "B",
        "domain": "vpn.example.com",
        "cf_origin_cert": "-----BEGIN CERTIFICATE-----\nCERT\n-----END CERTIFICATE-----",
        "cf_origin_key": "-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----",
    }
    p = serve._params_from_answers(answers)
    assert p.server_domain == "vpn.example.com"
    assert p.cf_origin_cert == answers["cf_origin_cert"]
    assert p.cf_origin_key == answers["cf_origin_key"]
    assert serve._dashboard_url(p) == "https://vpn.example.com:8443/v3"
