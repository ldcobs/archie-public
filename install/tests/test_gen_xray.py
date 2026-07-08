"""Tests for the Xray config generator."""

from __future__ import annotations

import json

from install.lib import gen_xray_config
from install.lib.common import Params


def _build(p: Params) -> dict:
    return gen_xray_config.build_config(p)


def _tags(cfg: dict) -> list[str]:
    return [i["tag"] for i in cfg["inbounds"]]


# ── Mode A ──


def test_mode_a_inbounds_are_minimal(params_a):
    cfg = _build(params_a)
    assert _tags(cfg) == ["vless-reality", "api", "shadowsocks"]


def test_mode_a_has_no_cdn_inbounds(params_a):
    cfg = _build(params_a)
    for ib in cfg["inbounds"]:
        ss = ib.get("streamSettings", {})
        assert ss.get("network") != "ws" or ib["tag"] == "shadowsocks"
        assert ss.get("network") != "grpc"


# ── Modes B and C (identical Xray config) ──


CDN_TAGS = {"vmess-ws", "vmess-grpc", "trojan-tls", "vless-ws", "vless-grpc", "trojan-ws"}


def test_mode_b_has_full_inbound_set(params_b):
    cfg = _build(params_b)
    tags = _tags(cfg)
    assert tags[:3] == ["vless-reality", "api", "vmess-ws"]
    assert tags[-1] == "shadowsocks"
    assert CDN_TAGS.issubset(set(tags))


def test_mode_c_matches_mode_b_inbounds(params_b, params_c):
    # B and C produce identical Xray configs (only nginx/cert differs).
    assert _tags(_build(params_b)) == _tags(_build(params_c))


def test_cdn_inbounds_use_security_none(params_b):
    # nginx terminates TLS, so Xray listens plain — security must be "none".
    cfg = _build(params_b)
    for ib in cfg["inbounds"]:
        if ib["tag"] in CDN_TAGS:
            assert ib["streamSettings"]["security"] == "none", ib["tag"]


def test_cdn_inbounds_use_internal_ports(params_b):
    cfg = _build(params_b)
    port_by_tag = {ib["tag"]: ib["port"] for ib in cfg["inbounds"]}
    assert port_by_tag["vmess-ws"] == 10001
    assert port_by_tag["vmess-grpc"] == 10002
    assert port_by_tag["trojan-tls"] == 10003
    assert port_by_tag["vless-ws"] == 10004
    assert port_by_tag["vless-grpc"] == 10005
    assert port_by_tag["trojan-ws"] == 10006


def test_cdn_inbounds_reference_operator_domain(params_b):
    cfg = _build(params_b)
    for ib in cfg["inbounds"]:
        ss = ib.get("streamSettings", {})
        if ss.get("network") == "ws":
            assert ss["wsSettings"]["headers"]["Host"] == "vpn.example.com"
        if ss.get("network") == "grpc":
            assert ss["grpcSettings"]["serviceName"].endswith("-grpc")


# ── Reality inbound ──


def test_reality_private_key_is_filled(params_a):
    cfg = _build(params_a)
    reality = cfg["inbounds"][0]
    assert reality["tag"] == "vless-reality"
    rs = reality["streamSettings"]["realitySettings"]
    assert rs["privateKey"] == params_a.reality_pvk
    assert rs["privateKey"] != "REPLACE_ME"
    assert rs["shortIds"] == [params_a.reality_sid]
    assert rs["shortIds"] != ["REPLACE_ME"]


def test_reality_uses_operator_sni(params_a):
    cfg = _build(params_a)
    rs = cfg["inbounds"][0]["streamSettings"]["realitySettings"]
    assert rs["dest"] == "www.microsoft.com:443"
    assert rs["serverNames"] == ["www.microsoft.com"]


def test_default_reality_sni_is_a_working_decoy():
    """Regression guard: the DEFAULT Reality decoy must not be www.microsoft.com.
    Microsoft's TLS edge stopped working as a Reality decoy —
    clients on that SNI complete the connection but pass zero traffic ("connects,
    no internet"), with no error anywhere. Every install that doesn't override
    the SNI inherits this default, so it must be a decoy that actually works."""
    from install.lib.common import Params
    assert Params().reality_sni != "www.microsoft.com"
    assert Params().reality_sni == "www.cloudflare.com"


def test_reality_has_fallback_and_sockopt(params_a):
    # Fallback to 8443 + TCP keepalive tuning.
    cfg = _build(params_a)
    reality = cfg["inbounds"][0]
    assert reality["settings"]["fallbacks"] == [{"dest": 8443, "xver": 1}]
    assert reality["streamSettings"]["sockopt"]["tcpKeepAliveIdle"] == 30


# ── Control blocks (always present) ──


def test_api_inbound_present_and_protected(params_a):
    cfg = _build(params_a)
    api = [i for i in cfg["inbounds"] if i["tag"] == "api"]
    assert len(api) == 1
    assert api[0]["listen"] == "127.0.0.1"
    assert api[0]["port"] == 10085
    assert api[0]["protocol"] == "dokodemo-door"


def test_stats_api_policy_blocks_present(params_a):
    cfg = _build(params_a)
    assert cfg["stats"] == {}
    # HandlerService (live user add/remove, no Xray restart) must be enabled
    # alongside StatsService — matches production; the dashboard relies on it.
    assert cfg["api"] == {"tag": "api", "services": ["StatsService", "HandlerService"]}
    assert cfg["policy"]["levels"]["0"]["statsUserUplink"] is True
    assert cfg["policy"]["levels"]["0"]["statsUserDownlink"] is True
    assert cfg["policy"]["system"]["statsInboundUplink"] is True
    assert cfg["policy"]["system"]["statsInboundDownlink"] is True


def test_routing_has_api_and_private_block_rules(params_a):
    cfg = _build(params_a)
    rules = cfg["routing"]["rules"]
    assert rules[0] == {"type": "field", "inboundTag": ["api"], "outboundTag": "api"}
    assert any(r.get("ip") == ["geoip:private"] and r.get("outboundTag") == "block" for r in rules)


def test_outbounds_direct_and_block(params_a):
    cfg = _build(params_a)
    tags = {o["tag"]: o["protocol"] for o in cfg["outbounds"]}
    assert tags["direct"] == "freedom"
    assert tags["block"] == "blackhole"


def test_shadowsocks_inbound(params_a):
    cfg = _build(params_a)
    ss = [i for i in cfg["inbounds"] if i["tag"] == "shadowsocks"][0]
    assert ss["port"] == 8388
    assert ss["protocol"] == "shadowsocks"
    assert ss["settings"]["method"] == "chacha20-ietf-poly1305"
    assert ss["settings"]["network"] == "tcp,udp"
    # Must carry a server-level password or xray rejects the inbound at load.
    assert ss["settings"]["password"] == params_a.ss_password
    assert ss["settings"]["password"], "shadowsocks server password must be non-empty"


def test_crypto_fills_shadowsocks_password():
    from install.lib.common import Params
    from install.lib import crypto
    p = Params()
    crypto.ensure_ss_password(p)
    assert p.ss_password and len(p.ss_password) >= 16


# ── Extra protocols ──


def test_extra_protocols_xhttp(params_b):
    params_b.extra_protocols = ["vless-xhttp", "vmess-xhttp"]
    cfg = _build(params_b)
    tags = _tags(cfg)
    assert "vless-xhttp" in tags and "vmess-xhttp" in tags


def test_extra_protocols_mkcp_in_mode_a(params_a):
    # mKCP is UDP and works without a CDN, so it's allowed in Mode A.
    params_a.extra_protocols = ["vless-mkcp"]
    cfg = _build(params_a)
    tags = _tags(cfg)
    assert "vless-mkcp" in tags
    # but xhttp (TLS-offloaded) is not added in mode A
    params_a.extra_protocols = ["vless-xhttp"]
    cfg = _build(params_a)
    assert "vless-xhttp" not in _tags(cfg)


# ── Output validity ──


def test_config_is_json_serializable_roundtrip(params_b):
    cfg = _build(params_b)
    text = json.dumps(cfg)
    assert json.loads(text) == cfg
