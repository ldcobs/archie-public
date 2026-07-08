"""Pytest fixtures for Archie API contract tests.

Strategy: import vpn-api.py IN-PROCESS via importlib (which skips the
``__main__`` block), monkeypatch its hardcoded constants to point at a temp
dir, then start its HTTPServer on an ephemeral port in a background thread.

This gives full per-test isolation without subprocess management and without
touching real /app, /var/log, or /etc/xray paths.
"""

from __future__ import annotations

import importlib.util
import json
import os
import socket
import sys
import threading
import types
from http.server import HTTPServer
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
API_DIR = REPO_ROOT / "api"
SNAPSHOT = REPO_ROOT / "fixtures" / "vps-snapshot"


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _load_module(name: str, path: Path) -> types.ModuleType:
    """Import a .py file as a module (skipping __main__ guard)."""
    spec = importlib.util.spec_from_file_location(name, str(path))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def mock_xray(tmp_path):
    """Create a mock xray binary on PATH that records its invocations.

    Supports: ``run -test -c <path>`` (exit 0). The call log is readable
    at ``mock_xray.calls``.
    """
    binpath = tmp_path / "mock-xray"
    logfile = tmp_path / "xray-calls.log"
    script = f"""#!/usr/bin/env bash
echo "$@" >> "{logfile}"
exit 0
"""
    binpath.write_text(script)
    binpath.chmod(0o755)
    # Return an object the fixture caller can inspect
    class _MockXray:
        path = str(binpath)
        log = str(logfile)

        @property
        def calls(self) -> list[str]:
            try:
                return [l.strip() for l in Path(self.log).read_text().splitlines() if l.strip()]
            except FileNotFoundError:
                return []

        @property
        def test_count(self) -> int:
            return sum(1 for c in self.calls if "run" in c and "-test" in c)

    return _MockXray()


@pytest.fixture
def seed_config():
    """A minimal valid Xray config.json with one Reality inbound + one user."""
    return {
        "log": {"loglevel": "warning"},
        "inbounds": [
            {
                "tag": "vless-reality",
                "port": 443,
                "protocol": "vless",
                "settings": {
                    "clients": [
                        {"id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                         "flow": "xtls-rprx-vision", "email": "testuser"}
                    ],
                    "decryption": "none",
                },
                "streamSettings": {
                    "network": "tcp",
                    "security": "reality",
                    "realitySettings": {
                        "dest": "www.microsoft.com:443",
                        "serverNames": ["www.microsoft.com"],
                        "privateKey": "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
                        "shortIds": ["0123456789abcdef"],
                    },
                },
            },
            {
                "listen": "127.0.0.1", "port": 10085,
                "protocol": "dokodemo-door",
                "settings": {"address": "127.0.0.1"}, "tag": "api",
            },
            {
                "tag": "shadowsocks", "port": 8388,
                "protocol": "shadowsocks",
                "settings": {"method": "chacha20-ietf-poly1305",
                             "password": "testpw", "network": "tcp,udp"},
            },
        ],
        "outbounds": [
            {"protocol": "freedom", "tag": "direct"},
            {"protocol": "blackhole", "tag": "block"},
        ],
        "routing": {"rules": [
            {"type": "field", "inboundTag": ["api"], "outboundTag": "api"},
        ]},
        "stats": {},
        "api": {"tag": "api", "services": ["StatsService"]},
        "policy": {
            "levels": {"0": {"statsUserUplink": True, "statsUserDownlink": True}},
            "system": {"statsInboundUplink": True, "statsInboundDownlink": True},
        },
    }


@pytest.fixture
def api(tmp_path, mock_xray, seed_config):
    """Spin up vpn-api in-process on an ephemeral port with isolated state.

    Returns a dict with ``base_url``, ``token``, the module handle, and the
    temp dir for direct file inspection.
    """
    # Ensure api/ is importable (vpn-api.py imports vpn_extensions_v3)
    if str(API_DIR) not in sys.path:
        sys.path.insert(0, str(API_DIR))

    # Remove any cached imports from a prior fixture run
    for mod_name in list(sys.modules):
        if mod_name in ("vpn_api", "vpn_extensions_v3"):
            del sys.modules[mod_name]

    # Create isolated state dirs
    state_dir = tmp_path / "app"
    log_dir = tmp_path / "logs"
    xray_dir = tmp_path / "xray"
    for d in (state_dir, log_dir, xray_dir):
        d.mkdir(parents=True, exist_ok=True)

    # Seed config + traffic
    config_path = xray_dir / "config.json"
    config_path.write_text(json.dumps(seed_config))
    (state_dir / "traffic_daily.json").write_text(json.dumps({}))
    (API_DIR / "traffic_daily.json").write_text(json.dumps({}))

    # Import the modules
    os.environ["XRAY_BIN"] = mock_xray.path
    os.environ["API_AUTH_TOKEN"] = "test-bearer-token"
    os.environ["ABUSEIPDB_API_KEY"] = ""
    os.environ["TELEGRAM_BOT_TOKEN"] = ""
    os.environ["TELEGRAM_CHAT_ID"] = ""

    vpn_api = _load_module("vpn_api", API_DIR / "vpn-api.py")
    # vpn_extensions_v3 is imported lazily inside functions, so patch its
    # module globals directly. Load it as a separate module.
    ext = _load_module("vpn_extensions_v3", API_DIR / "vpn_extensions_v3.py")

    # Patch hardcoded constants → temp paths.
    # Critical: function-local name resolution reads from the function's
    # __globals__ dict (== the module __dict__) at CALL time. Setting
    # vpn_api.XRAY_CFG works because that IS the module dict — but only if no
    # stale cached module survives. We force a fresh exec each fixture call
    # (done above via sys.modules.pop) so the globals we mutate are the live ones.
    port = _free_port()
    _patches = {
        "PORT": port,
        "XRAY_CFG": str(config_path),
        "PENDING_CFG": str(state_dir / "pending_config.json"),
        "XRAY_BIN": mock_xray.path,
        "XRAY_AUDIT": str(state_dir / "pending_config_audit.log"),
        "LOG_ACCESS": str(log_dir / "access.log"),
        "LOG_ERROR": str(log_dir / "error.log"),
        "LOG_AUTH": str(log_dir / "auth.log"),
        "LOG_F2B": str(log_dir / "fail2ban.log"),
    }
    for k, v in _patches.items():
        vpn_api.__dict__[k] = v   # mutate the live module globals directly

    ext_patches = {
        "BLOCKS_FILE": str(state_dir / "permanent_blocks.json"),
        "DEVICE_FILE": str(state_dir / "device_approvals.json"),
        "DEVICE_BLOCKS": str(state_dir / "device_blocks.json"),
        "KNOWN_IPS_FILE": str(state_dir / "known_ips.json"),
        "PENDING_FW": str(state_dir / "pending_firewall.json"),
        "PROTECTION_MODE_FILE": str(state_dir / "protection_mode.json"),
        "GATEWAYS_FILE": str(state_dir / "gateways.json"),
    }
    for k, v in ext_patches.items():
        ext.__dict__[k] = v

    # Touch the log files so tail() doesn't error
    for f in ("access.log", "error.log", "auth.log", "fail2ban.log"):
        (log_dir / f).touch()

    # Start HTTPServer on ephemeral port
    server = HTTPServer(("127.0.0.1", port), vpn_api.Handler)
    server.timeout = 0.5
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    import urllib.request

    class _API:
        def __init__(self):
            self.base_url = f"http://127.0.0.1:{port}"
            self.token = "test-bearer-token"
            self.module = vpn_api
            self.ext_module = ext
            self.tmp = tmp_path
            self.state_dir = state_dir
            self.xray_dir = xray_dir
            self.config_path = config_path
            self.mock_xray = mock_xray

        def get(self, path: str, *, auth: bool = True, raw: bool = False):
            url = self.base_url + path
            req = urllib.request.Request(url, method="GET")
            if auth:
                req.add_header("Authorization", f"Bearer {self.token}")
            try:
                resp = urllib.request.urlopen(req, timeout=10)
                body = resp.read()
                if raw:
                    return resp.status, body
                return resp.status, json.loads(body) if body else None
            except urllib.error.HTTPError as e:
                body = e.read()
                if raw:
                    return e.code, body
                try:
                    return e.code, json.loads(body)
                except json.JSONDecodeError:
                    return e.code, body.decode(errors="replace")

        def post(self, path: str, body=None, *, auth: bool = True):
            url = self.base_url + path
            data = json.dumps(body or {}).encode()
            req = urllib.request.Request(url, data=data, method="POST")
            req.add_header("Content-Type", "application/json")
            if auth:
                req.add_header("Authorization", f"Bearer {self.token}")
            try:
                resp = urllib.request.urlopen(req, timeout=10)
                raw = resp.read()
                return resp.status, (json.loads(raw) if raw else None)
            except urllib.error.HTTPError as e:
                raw = e.read()
                try:
                    return e.code, json.loads(raw)
                except json.JSONDecodeError:
                    return e.code, raw.decode(errors="replace")

        def delete(self, path: str, *, auth: bool = True):
            url = self.base_url + path
            req = urllib.request.Request(url, method="DELETE")
            if auth:
                req.add_header("Authorization", f"Bearer {self.token}")
            try:
                resp = urllib.request.urlopen(req, timeout=10)
                raw = resp.read()
                return resp.status, (json.loads(raw) if raw else None)
            except urllib.error.HTTPError as e:
                raw = e.read()
                try:
                    return e.code, json.loads(raw)
                except json.JSONDecodeError:
                    return e.code, raw.decode(errors="replace")

        def config(self) -> dict:
            return json.loads(self.config_path.read_text())

    yield _API()

    # Teardown
    server.shutdown()
    server.server_close()
    # Clean up the traffic_daily.json that vpn-api writes next to itself
    td = API_DIR / "traffic_daily.json"
    if td.exists():
        td.unlink()
