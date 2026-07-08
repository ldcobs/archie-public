"""Environment detection — all read-only probes.

Every function here is safe to run on any machine (local dev, CI, VPS). It never
mutates state. Missing tools return empty/None, never raise.
"""

from __future__ import annotations

import re
import socket
from typing import Any

from . import common
from .common import Params, debug, info, run_capture, warn


# ─────────────────────────────────────────────────────────────────────────────
# OS / distro / arch
# ─────────────────────────────────────────────────────────────────────────────


def _parse_os_release() -> dict[str, str]:
    fields: dict[str, str] = {}
    try:
        text = open("/etc/os-release", encoding="utf-8").read()
    except OSError:
        return fields
    for line in text.splitlines():
        if "=" not in line or line.startswith("#"):
            continue
        k, _, v = line.partition("=")
        fields[k.strip()] = v.strip().strip('"')
    return fields


def detect_os(params: Params) -> None:
    rel = _parse_os_release()
    params.os_id = rel.get("ID", "").lower()
    params.os_version = (rel.get("VERSION_ID") or "").strip()
    out = run_capture(["uname", "-m"])
    params.arch = out or "x86_64"
    debug(f"os_id={params.os_id!r} os_version={params.os_version!r} arch={params.arch!r}")


def is_debian_family(p: Params) -> bool:
    return p.os_id in ("ubuntu", "debian") or "debian" in _parse_os_release().get("ID_LIKE", "")


def is_rhel_family(p: Params) -> bool:
    rel = _parse_os_release()
    return p.os_id in ("amzn", "rocky", "almalinux", "fedora", "centos", "rhel") or "rhel" in rel.get("ID_LIKE", "") or "fedora" in rel.get("ID_LIKE", "")


# ─────────────────────────────────────────────────────────────────────────────
# Public IP / NAT detection
# ─────────────────────────────────────────────────────────────────────────────


def detect_public_ip() -> str:
    """Best-effort public IP via ipify. Empty on failure."""
    for url in ("https://api.ipify.org", "https://ifconfig.me"):
        for tool in ("curl", "wget"):
            if tool == "curl":
                ip = run_capture(["curl", "-fsS", "--max-time", "5", url])
            else:
                ip = run_capture(["wget", "-qO-", "--timeout=5", url])
            if ip and re.fullmatch(r"\d{1,3}(?:\.\d{1,3}){3}", ip):
                return ip
    return ""


def is_rfc1918(ip: str) -> bool:
    if not ip or ip.count(".") != 3:
        return False
    o = [int(x) for x in ip.split(".")]
    return (
        o[0] == 10
        or (o[0] == 172 and 16 <= o[1] <= 31)
        or (o[0] == 192 and o[1] == 168)
    )


def detect_wan_iface() -> str:
    """Default route's interface (for WG NAT rules). 'eth0' fallback."""
    out = run_capture(["ip", "-o", "-4", "route", "show", "to", "default"])
    if out:
        # "default via 1.2.3.4 dev eth0 proto dhcp ..."
        m = re.search(r"\bdev\s+(\S+)", out)
        if m:
            return m.group(1)
    return "eth0"


# ─────────────────────────────────────────────────────────────────────────────
# Tools
# ─────────────────────────────────────────────────────────────────────────────


def detect_docker(params: Params) -> None:
    v = run_capture(["docker", "version", "--format", "{{.Server.Version}}"])
    params.docker_present = bool(v)
    if v:
        debug(f"docker server version: {v}")
    else:
        info("docker not detected — install step will provision it")


def detect_ufw(params: Params) -> None:
    params.ufw_present = bool(run_capture(["command", "-v", "ufw"]))


# ─────────────────────────────────────────────────────────────────────────────
# Existing artifacts (upgrade vs fresh)
# ─────────────────────────────────────────────────────────────────────────────


def existing_xray_config() -> str:
    try:
        return open("/usr/local/etc/xray/config.json", encoding="utf-8").read()
    except OSError:
        return ""


def ports_listening() -> set[int]:
    """Return the set of TCP ports currently in LISTEN state. Best-effort."""
    out = run_capture(["ss", "-tlnH"]) or ""
    ports: set[int] = set()
    for line in out.splitlines():
        # "LISTEN 0 4096 0.0.0.0:443 0.0.0.0:* ..."
        m = re.search(r":(\d+)\s", line)
        if m:
            ports.add(int(m.group(1)))
    return ports


# ─────────────────────────────────────────────────────────────────────────────
# Orchestration
# ─────────────────────────────────────────────────────────────────────────────


def run_all_detection(params: Params, *, insecure_ip: bool = False) -> None:
    """Fill params.* from the environment. Safe to run anywhere."""
    detect_os(params)
    detect_docker(params)
    detect_ufw(params)
    params.wan_iface = detect_wan_iface()

    if not params.server_ip:
        ip = detect_public_ip()
        if ip:
            if is_rfc1918(ip) and not insecure_ip:
                warn(
                    f"detected public IP {ip} looks NAT'd (RFC1918). "
                    "Pass --server-ip= explicitly or --insecure-ip to accept."
                )
            params.server_ip = ip
        else:
            info("could not auto-detect public IP; --server-ip= will be required")
    if not params.wg_endpoint_ip:
        params.wg_endpoint_ip = params.server_ip
