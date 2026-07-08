"""Xray ``config.json`` generator.

Produces the Xray JSON, branched by install mode:

- **Mode A (no-CDN):** ``[vless-reality, api, shadowsocks]``. No TLS-offloaded
  inbounds, no nginx in front.
- **Mode B (Cloudflare-fronted) and Mode C (direct-TLS LE):** the Mode A set
  *plus* the six CDN/direct-TLS inbounds on internal host ports 10001–10006.
  Xray uses ``security: none`` because nginx terminates TLS upstream (in both
  B and C). The B-vs-C difference is purely which cert nginx mounts — handled
  by ``gen_nginx``, not here.

Extra protocols (xhttp / httpupgrade / mkcp) are opt-in via
``params.extra_protocols`` and default off.

Control blocks (api/stats/policy/routing) are always emitted — without them
the dashboard's traffic charts break.
"""

from __future__ import annotations

from typing import Any

from .common import Params

# Internal host ports for the TLS-offloaded inbounds (nginx → 172.20.0.1:<port>).
# Matches the live fixture and nginx routing table.
_INTERNAL_PORTS = {
    "vmess-ws": 10001,
    "vmess-grpc": 10002,
    "trojan-tls": 10003,
    "vless-ws": 10004,
    "vless-grpc": 10005,
    "trojan-ws": 10006,
}

# Extra (opt-in) inbounds. XHTTP/HTTPUpgrade reuse the 10001–10006 range concept
# but we map them to distinct ports so they can coexist.
_EXTRA_PORTS = {
    "vless-xhttp": 10011,
    "vmess-xhttp": 10012,
    "vless-httpupgrade": 10013,
    "vmess-httpupgrade": 10014,
    "vless-mkcp": 4500,
    "vmess-mkcp": 4501,
}

_LOG_BLOCK = {
    "loglevel": "warning",
    "access": "/var/log/xray/access.log",
    "error": "/var/log/xray/error.log",
}

_OUTBOUNDS = [
    {"protocol": "freedom", "tag": "direct"},
    {"protocol": "blackhole", "tag": "block"},
]


def _api_inbound() -> dict[str, Any]:
    """Protected dokodemo inbound for the StatsService gRPC API. Always present."""
    return {
        "listen": "127.0.0.1",
        "port": 10085,
        "protocol": "dokodemo-door",
        "settings": {"address": "127.0.0.1"},
        "tag": "api",
    }


def _routing_block() -> dict[str, Any]:
    return {
        "domainStrategy": "IPIfNonMatch",
        "rules": [
            {"type": "field", "inboundTag": ["api"], "outboundTag": "api"},
            {"type": "field", "ip": ["geoip:private"], "outboundTag": "block"},
        ],
    }


def _reality_inbound(p: Params) -> dict[str, Any]:
    sni = p.reality_sni
    return {
        "tag": "vless-reality",
        "port": 443,
        "protocol": "vless",
        "settings": {
            "clients": [],
            "decryption": "none",
            "fallbacks": [{"dest": 8443, "xver": 1}],
        },
        "streamSettings": {
            "network": "tcp",
            "security": "reality",
            "realitySettings": {
                "dest": f"{sni}:443",
                "serverNames": [sni],
                "privateKey": p.reality_pvk,
                "shortIds": [p.reality_sid],
            },
            "sockopt": {
                "tcpKeepAliveIdle": 30,
                "tcpKeepAliveInterval": 10,
            },
        },
        "sniffing": {"enabled": True, "destOverride": ["http", "tls", "quic"]},
    }


def _shadowsocks_inbound(password: str) -> dict[str, Any]:
    return {
        "tag": "shadowsocks",
        "port": 8388,
        "protocol": "shadowsocks",
        "settings": {
            "method": "chacha20-ietf-poly1305",
            # Server-level password — required for the inbound to load. The
            # dashboard adds per-client entries (each keyed by its own uuid).
            "password": password,
            "network": "tcp,udp",
        },
        "sniffing": {"enabled": True, "destOverride": ["http", "tls", "quic"]},
    }


def _ws_inbound(tag: str, port: int, path: str, host: str) -> dict[str, Any]:
    protocol = "vmess" if tag.startswith("vmess") else "vless"
    settings: dict[str, Any] = {"clients": []}
    if protocol == "vless":
        settings["decryption"] = "none"
    return {
        "tag": tag,
        "port": port,
        "protocol": protocol,
        "settings": settings,
        "streamSettings": {
            "network": "ws",
            "security": "none",  # nginx terminates TLS
            "wsSettings": {"path": path, "headers": {"Host": host}},
        },
    }


def _grpc_inbound(tag: str, port: int, service: str) -> dict[str, Any]:
    protocol = "vmess" if tag.startswith("vmess") else "vless"
    settings: dict[str, Any] = {"clients": []}
    if protocol == "vless":
        settings["decryption"] = "none"
    return {
        "tag": tag,
        "port": port,
        "protocol": protocol,
        "settings": settings,
        "streamSettings": {
            "network": "grpc",
            "security": "none",
            "grpcSettings": {"serviceName": service},
        },
    }


def _trojan_tls_inbound(port: int, domain: str) -> dict[str, Any]:
    # In the live deployment nginx fronts 2053→10003 with TLS; Xray itself
    # listens on the internal port with security none.
    return {
        "tag": "trojan-tls",
        "port": port,
        "protocol": "trojan",
        "settings": {"clients": [], "fallbacks": []},
        "streamSettings": {
            "network": "tcp",
            "security": "none",
            "tlsSettings": {"serverName": domain},
        },
    }


def _trojan_ws_inbound(port: int, domain: str) -> dict[str, Any]:
    return {
        "tag": "trojan-ws",
        "port": port,
        "protocol": "trojan",
        "settings": {"clients": []},
        "streamSettings": {
            "network": "ws",
            "security": "none",
            "tlsSettings": {"serverName": domain},
            "wsSettings": {"path": "/trojan-ws", "headers": {"Host": domain}},
        },
    }


def _xhttp_inbound(tag: str, port: int, path: str, host: str) -> dict[str, Any]:
    protocol = "vmess" if tag.startswith("vmess") else "vless"
    settings: dict[str, Any] = {"clients": []}
    if protocol == "vless":
        settings["decryption"] = "none"
    return {
        "tag": tag,
        "port": port,
        "protocol": protocol,
        "settings": settings,
        "streamSettings": {
            "network": "xhttp",
            "security": "none",
            "tlsSettings": {"serverName": host},
            "xhttpSettings": {"path": path, "host": host},
        },
    }


def _httpupgrade_inbound(tag: str, port: int, path: str, host: str) -> dict[str, Any]:
    protocol = "vmess" if tag.startswith("vmess") else "vless"
    settings: dict[str, Any] = {"clients": []}
    if protocol == "vless":
        settings["decryption"] = "none"
    return {
        "tag": tag,
        "port": port,
        "protocol": protocol,
        "settings": settings,
        "streamSettings": {
            "network": "httpupgrade",
            "security": "none",
            "tlsSettings": {"serverName": host},
            "httpupgradeSettings": {"path": path, "host": host},
        },
    }


def _mkcp_inbound(tag: str, port: int) -> dict[str, Any]:
    protocol = "vmess" if tag.startswith("vmess") else "vless"
    settings: dict[str, Any] = {"clients": []}
    if protocol == "vless":
        settings["decryption"] = "none"
    return {
        "tag": tag,
        "port": port,
        "protocol": protocol,
        "settings": settings,
        "streamSettings": {
            "network": "kcp",
            "security": "none",
            "kcpSettings": {"header": {"type": "none"}},
        },
    }


def _cdn_inbounds(p: Params) -> list[dict[str, Any]]:
    """The six TLS-offloaded inbounds (nginx terminates TLS). Modes B/C only."""
    d = p.server_domain
    return [
        _ws_inbound("vmess-ws", 10001, "/vmess-ws", d),
        _grpc_inbound("vmess-grpc", 10002, "vmess-grpc"),
        _trojan_tls_inbound(10003, d),
        _ws_inbound("vless-ws", 10004, "/vless-ws", d),
        _grpc_inbound("vless-grpc", 10005, "vless-grpc"),
        _trojan_ws_inbound(10006, d),
    ]


def _extra_inbounds(p: Params) -> list[dict[str, Any]]:
    d = p.server_domain
    out: list[dict[str, Any]] = []
    for key in p.extra_protocols:
        if key == "vless-xhttp":
            out.append(_xhttp_inbound("vless-xhttp", _EXTRA_PORTS[key], "/vless-xhttp", d))
        elif key == "vmess-xhttp":
            out.append(_xhttp_inbound("vmess-xhttp", _EXTRA_PORTS[key], "/vmess-xhttp", d))
        elif key == "vless-httpupgrade":
            out.append(_httpupgrade_inbound("vless-httpupgrade", _EXTRA_PORTS[key], "/vless-hu", d))
        elif key == "vmess-httpupgrade":
            out.append(_httpupgrade_inbound("vmess-httpupgrade", _EXTRA_PORTS[key], "/vmess-hu", d))
        elif key == "vless-mkcp":
            out.append(_mkcp_inbound("vless-mkcp", _EXTRA_PORTS[key]))
        elif key == "vmess-mkcp":
            out.append(_mkcp_inbound("vmess-mkcp", _EXTRA_PORTS[key]))
    return out


def build_config(p: Params) -> dict[str, Any]:
    """Return the complete Xray config.json dict for the given mode."""
    inbounds: list[dict[str, Any]] = [_reality_inbound(p), _api_inbound()]

    if p.mode in ("B", "C"):
        inbounds.extend(_cdn_inbounds(p))
        inbounds.extend(_extra_inbounds(p))
    else:
        # Mode A: only the extra UDP transports make sense without a CDN.
        for ib in _extra_inbounds(p):
            if ib["streamSettings"]["network"] == "kcp":
                inbounds.append(ib)

    inbounds.append(_shadowsocks_inbound(p.ss_password))

    return {
        "log": dict(_LOG_BLOCK),
        "inbounds": inbounds,
        "outbounds": [dict(o) for o in _OUTBOUNDS],
        "routing": _routing_block(),
        "stats": {},
        # HandlerService enables live add/remove of users over the gRPC API
        # without restarting Xray — the dashboard/vpn-api rely on it for
        # no-restart enforcement (matches production). StatsService powers
        # traffic accounting. Both bind the 127.0.0.1:10085 `api` inbound.
        "api": {"tag": "api", "services": ["StatsService", "HandlerService"]},
        "policy": {
            "levels": {"0": {"statsUserUplink": True, "statsUserDownlink": True}},
            "system": {"statsInboundUplink": True, "statsInboundDownlink": True},
        },
    }


# List of inbound tags the generator emits per mode (for tests / docs).
def inbound_tags_for_mode(mode: str, extra: list[str] | None = None) -> list[str]:
    base = ["vless-reality", "api"]
    if mode in ("B", "C"):
        base += ["vmess-ws", "vmess-grpc", "trojan-tls", "vless-ws", "vless-grpc", "trojan-ws"]
    if extra:
        for k in extra:
            base.append(k)
    base.append("shadowsocks")
    return base
