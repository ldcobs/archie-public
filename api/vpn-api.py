#!/usr/bin/env python3
"""
VPN Stats API v3 — reads Xray & SSH logs, geolocates IPs, detects threats.
Security hardened: API auth, tightened CORS, env-based secrets, proper error handling.
"""
import re, json, datetime, threading, socket, urllib.request, sys, os, logging, time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from http.server import HTTPServer, BaseHTTPRequestHandler

sys.path.insert(0, "/app")

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("vpn-api-v3")

# ── Config / Secrets from environment ─────────────────────────────────────────
LOG_ACCESS = "/var/log/xray/access.log"
LOG_ERROR  = "/var/log/xray/error.log"
LOG_AUTH   = "/var/log/auth.log"
XRAY_CFG   = "/etc/xray/config.json"
PORT       = 5900
TAIL_BYTES = 2_000_000

# Auth — Bearer token for all management endpoints
API_AUTH_TOKEN = os.environ.get("API_AUTH_TOKEN", "").strip()

# CORS — comma-separated list of allowed origins (no wildcards)
_allowed_origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
_cors_all = "*" in _allowed_origins

# VLESS/server config from env. The installer sets these per deployment; the
# fallbacks are empty on purpose (fail closed) so no single deployment's host,
# keys, or brand is baked into the source. SNI keeps a working default decoy.
SERVER_IP   = os.environ.get("SERVER_IP",   "")
SERVER_PORT = int(os.environ.get("SERVER_PORT", "443"))
SERVER_DOMAIN = os.environ.get("SERVER_DOMAIN", "")
BRAND_NAME  = os.environ.get("BRAND_NAME",  "VPN")
VLESS_PBK   = os.environ.get("VLESS_PBK",   "")
VLESS_SID   = os.environ.get("VLESS_SID",  "")
VLESS_SNI   = os.environ.get("VLESS_SNI",  "www.cloudflare.com")
# STATE_DIR: where runtime state lives. Default /app matches the historical
# on-box/prod layout (state written beside the source); the pre-built image
# (Option B) points it at a dedicated shared volume so state persists across
# restarts and is shared with the dashboard.
STATE_DIR    = os.environ.get("STATE_DIR", "/app")
PENDING_CFG  = os.path.join(STATE_DIR, "pending_config.json")
_cfg_lock    = threading.Lock()

# ── Rate limiting ─────────────────────────────────────────────────────────────
# Simple in-memory: track requests per IP
_rate_ip_times: dict[str, list[float]] = defaultdict(list)
_rate_lock = threading.Lock()
RATE_LIMIT = 120   # requests per window
RATE_WINDOW = 60    # seconds

def _check_rate_limit(ip: str) -> bool:
    """Return True if IP is within rate limit, False if throttled."""
    now = time.time()
    with _rate_lock:
        times = _rate_ip_times[ip]
        # Keep only recent entries
        cutoff = now - RATE_WINDOW
        times[:] = [t for t in times if t > cutoff]
        if len(times) >= RATE_LIMIT:
            return False
        times.append(now)
        return True

# ── Helpers ──────────────────────────────────────────────────────────────────

def tail(path, size=TAIL_BYTES):
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - size))
            return f.read().decode("utf-8", errors="ignore").splitlines()
    except FileNotFoundError:
        return []

_geo_cache: dict = {}
_geo_lock  = threading.Lock()
_rdns_cache: dict = {}
_rdns_lock  = threading.Lock()

def geolocate(ips):
    need = [ip for ip in set(ips) if ip not in _geo_cache]
    if not need:
        return
    try:
        for i in range(0, len(need), 100):
            batch = [{"query": ip, "fields": "query,country,countryCode,city,isp"} for ip in need[i:i+100]]
            req = urllib.request.Request(
                "http://ip-api.com/batch",
                data=json.dumps(batch).encode(),
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=5) as r:
                for item in json.loads(r.read()):
                    with _geo_lock:
                        _geo_cache[item["query"]] = {
                            "country": item.get("country", ""),
                            "cc":      item.get("countryCode", ""),
                            "city":    item.get("city", ""),
                            "isp":     item.get("isp", ""),
                        }
    except Exception:
        logger.warning("Geolocation batch failed — some IPs may lack geo data")

def geo(ip):
    with _geo_lock:
        return dict(_geo_cache.get(ip, {}))

def flag(cc):
    if not cc or len(cc) != 2:
        return ""
    return chr(0x1F1E6 + ord(cc[0]) - 65) + chr(0x1F1E6 + ord(cc[1]) - 65)

def ip_info(ip):
    g = geo(ip)
    g["ip"]   = ip
    g["flag"] = flag(g.get("cc", ""))
    g["label"] = " ".join(filter(None, [g.get("city"), g.get("cc")]))
    return g

# ── Reverse DNS ───────────────────────────────────────────────────────────────

_IP_RE = re.compile(r"^\d+\.\d+\.\d+\.\d+$")

def _rdns_one(ip):
    try:
        socket.setdefaulttimeout(2)
        name = socket.gethostbyaddr(ip)[0]
        with _rdns_lock:
            _rdns_cache[ip] = name
    except Exception:
        with _rdns_lock:
            _rdns_cache[ip] = ip

def rdns_batch(ips):
    with _rdns_lock:
        need = [ip for ip in set(ips) if ip not in _rdns_cache]
    if not need:
        return
    with ThreadPoolExecutor(max_workers=20) as ex:
        list(ex.map(_rdns_one, need))

def resolve(host):
    if not _IP_RE.match(host):
        return host
    with _rdns_lock:
        return _rdns_cache.get(host, host)

# ── Xray config ───────────────────────────────────────────────────────────────

def xray_users():
    try:
        with open(XRAY_CFG) as f:
            cfg = json.load(f)
        return [c["email"] for c in cfg["inbounds"][0]["settings"]["clients"] if "email" in c]
    except Exception:
        logger.error("Could not read Xray config")
        return []

# ── Access log ───────────────────────────────────────────────────────────────

def parse_access(mock_devices=False):
    from vpn_extensions_v3 import (
        check_reputation, get_server_health,
        parse_sessions_for_user, update_and_check_known_ips,
        get_permanent_blocks, write_firewall_command,
        evaluate_device_policy, approve_device, reject_device,
        reset_user_devices, mock_device_policy
    )

    now    = datetime.datetime.now(datetime.timezone.utc)
    W_ACTIVE = 60
    W5       = 300
    W24      = 86400
    users    = xray_users()

    udata = {u: dict(email=u, ips_5m=set(), ips_24h=set(),
                     c5=0, c_active=0, c24=0, last=None, first=None,
                     domains=defaultdict(int), log_entries=[]) for u in users}

    top_dests = defaultdict(lambda: defaultdict(int))
    recent    = []
    all_ips   = set()

    for line in tail(LOG_ACCESS):
        m = re.match(r"(\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2})", line)
        if not m:
            continue
        ts  = datetime.datetime.strptime(m.group(1), "%Y/%m/%d %H:%M:%S").replace(tzinfo=datetime.timezone.utc)
        age = (now - ts).total_seconds()
        if age > W24:
            continue

        ip_m    = re.search(r"from (?:tcp:|udp:)?(\d+\.\d+\.\d+\.\d+):", line)
        dest_m  = re.search(r"accepted \w+:(\S+)", line)
        email_m = re.search(r"email: (\S+)", line)
        if not (ip_m and email_m):
            continue

        ip    = ip_m.group(1)
        email = email_m.group(1)

        # Skip private/internal IPs (WireGuard tunnel, Docker network, loopback)
        if (ip.startswith("10.") or ip.startswith("172.") or
                ip.startswith("192.168.") or ip.startswith("127.")):
            continue

        dest  = dest_m.group(1) if dest_m else "?"
        host  = dest.rsplit(":", 1)[0].strip("[]") if ":" in dest else dest

        all_ips.add(ip)

        if email in udata:
            u = udata[email]
            u["c24"] += 1
            u["ips_24h"].add(ip)
            u["domains"][host] += 1
            if not u["last"]  or ts > u["last"]:  u["last"]  = ts
            if not u["first"] or ts < u["first"]: u["first"] = ts
            if age <= W5:
                u["c5"] += 1
                u["ips_5m"].add(ip)
            if age <= W_ACTIVE:
                u["c_active"] += 1

        top_dests[host][email] += 1
        if len(recent) < 60:
            recent.append(dict(time=ts.isoformat(), email=email, ip=ip, dest=dest))
        if email in udata:
            udata[email]["log_entries"].append((ts, ip, dest))

    ip_dests = [h for h in top_dests.keys() if _IP_RE.match(h)]
    rdns_batch(ip_dests)
    geolocate(list(all_ips))

    active = []
    for name in users:
        u = udata[name]
        top_domains = sorted(u["domains"].items(), key=lambda x: -x[1])[:20]
        sessions    = parse_sessions_for_user(u["log_entries"])
        all_ips_24h = [ip_info(ip)["ip"] for ip in u["ips_24h"]]
        _, new_ips  = update_and_check_known_ips(name, all_ips_24h)
        device_policy = (mock_device_policy(name, all_ips_24h) if mock_devices
                         else evaluate_device_policy(name, all_ips_24h))
        if u["c_active"] > 0:
            status = "online"
        elif u["c5"] > 0:
            status = "recent"
        else:
            status = "offline"
        active.append(dict(
            email       = name,
            online      = (status == "online"),
            status      = status,
            ips         = [ip_info(ip) for ip in u["ips_5m"]],
            ips_24h     = [ip_info(ip) for ip in u["ips_24h"]],
            conns_5m    = u["c5"],
            conns_24h   = u["c24"],
            last_seen   = u["last"].isoformat()  if u["last"]  else None,
            first_seen  = u["first"].isoformat() if u["first"] else None,
            top_domains = [{"host": resolve(h), "count": c} for h, c in top_domains],
            sessions    = sessions,
            new_ips     = list(new_ips),
            devices     = {**device_policy, **dict(
                approved_info = [ip_info(ip) for ip in device_policy.get("approved", [])],
                pending_info  = [ip_info(ip) for ip in device_policy.get("pending", [])],
                rejected_info = [ip_info(ip) for ip in device_policy.get("rejected", [])],
            )},
        ))

    dests = sorted(
        [{"host": resolve(h), "raw": h, "user": u, "count": c}
         for h, uc in top_dests.items() for u, c in uc.items()],
        key=lambda x: -x["count"]
    )

    return dict(
        users            = users,
        active           = active,
        top_destinations = dests[:30],
        recent           = list(reversed(recent[:30])),
        stats            = dict(
            conns_24h      = sum(u["c24"] for u in udata.values()),
            unique_ips_24h = len(all_ips),
        ),
    )

# ── SSH threats ──────────────────────────────────────────────────────────────

def parse_ssh_threats():
    from vpn_extensions_v3 import check_reputation, get_permanent_blocks
    now    = datetime.datetime.now(datetime.timezone.utc)
    year   = now.year
    counts = defaultdict(int)

    for line in tail(LOG_AUTH, 500_000):
        ts = None
        m_iso = re.match(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})", line)
        m_sys = re.match(r"(\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2})", line)
        try:
            if m_iso:
                ts = datetime.datetime.strptime(m_iso.group(1), "%Y-%m-%dT%H:%M:%S").replace(tzinfo=datetime.timezone.utc)
            elif m_sys:
                ts = datetime.datetime.strptime(f"{m_sys.group(1)} {year}", "%b %d %H:%M:%S %Y").replace(tzinfo=datetime.timezone.utc)
                if ts > now:
                    ts = ts.replace(year=year - 1)
        except ValueError:
            continue
        if ts is None or (now - ts).total_seconds() > 86400:
            continue

        ip_m = re.search(
            r"(?:Failed \S+ for (?:invalid user )?\S+ from|Invalid user \S+ from) (\d+\.\d+\.\d+\.\d+)",
            line
        )
        if ip_m:
            repeat_m = re.search(r"message repeated (\d+) times", line)
            counts[ip_m.group(1)] += int(repeat_m.group(1)) if repeat_m else 1

    threats = sorted(counts.items(), key=lambda x: -x[1])[:20]
    geolocate([ip for ip, _ in threats])
    perm_blocks = get_permanent_blocks()
    reputations = check_reputation([ip for ip, _ in threats])
    return [
        dict(ip=ip, count=c, flag=flag(geo(ip).get("cc", "")),
             banned=False, perm_blocked=(ip in perm_blocks),
             reputation=reputations.get(ip), **geo(ip))
        for ip, c in threats
    ]

# ── fail2ban ban history ─────────────────────────────────────────────────────

LOG_F2B = "/var/log/fail2ban.log"

def parse_fail2ban():
    from vpn_extensions_v3 import check_reputation, get_permanent_blocks
    history = defaultdict(list)
    pending = {}

    for line in tail(LOG_F2B, 1_000_000):
        m = re.match(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})", line)
        if not m:
            continue
        try:
            ts = datetime.datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S").replace(tzinfo=datetime.timezone.utc)
        except ValueError:
            continue

        ban_m   = re.search(r"NOTICE\s+\[(\w+)\] Ban (\d+\.\d+\.\d+\.\d+)", line)
        unban_m = re.search(r"NOTICE\s+\[(\w+)\] Unban (\d+\.\d+\.\d+\.\d+)", line)

        if ban_m:
            jail, ip = ban_m.group(1), ban_m.group(2)
            pending[ip] = {"banned_at": ts, "unbanned_at": None, "jail": jail}
        elif unban_m:
            ip = unban_m.group(2)
            if ip in pending:
                pending[ip]["unbanned_at"] = ts
                history[ip].append(pending.pop(ip))

    for ip, b in pending.items():
        history[ip].append(b)

    perm_blocks = get_permanent_blocks()
    ips = list(history.keys())
    reputations = check_reputation(ips)
    result = []
    for ip, events in sorted(history.items(), key=lambda x: -x[1][-1]["banned_at"].timestamp()):
        g          = geo(ip)
        latest     = events[-1]
        ban_count  = len(events)
        active     = latest["unbanned_at"] is None
        next_weeks = min(2 ** ban_count, 52)
        result.append(dict(
            ip=ip, jail=latest["jail"], ban_count=ban_count, next_weeks=next_weeks,
            banned_at=latest["banned_at"].isoformat(),
            unbanned_at=latest["unbanned_at"].isoformat() if latest["unbanned_at"] else None,
            active=active, flag=flag(g.get("cc", "")),
            perm_blocked=(ip in perm_blocks),
            reputation=reputations.get(ip), **g
        ))
    return result

def get_banned_ips():
    return {b["ip"] for b in parse_fail2ban() if b["active"]}

# ── VPN user management ──────────────────────────────────────────────────────

def vless_uri(uuid, email):
    return (f"vless://{uuid}@{SERVER_IP}:{SERVER_PORT}"
            f"?encryption=none&flow=xtls-rprx-vision&security=reality"
            f"&sni={VLESS_SNI}&fp=chrome&pbk={VLESS_PBK}&sid={VLESS_SID}"
            f"&type=tcp#{email}")

def read_cfg():
    with open(XRAY_CFG) as f:
        return json.load(f)

# ── Inbound introspection (read-only) ─────────────────────────────────────────
# Parses the live Xray config into a normalized list for the Inbounds page.
# This is READ-ONLY: it never mutates config.json.

def _classify_transport(stream):
    """Return a short human label for an inbound's transport + security."""
    if not stream:
        return "raw"
    net = stream.get("network", "tcp")
    sec = stream.get("security", "none")
    if sec == "reality":
        return "reality"
    if net == "ws":
        return "ws+tls"
    if net == "grpc":
        return "grpc+tls"
    if net == "tcp" and sec == "tls":
        return "tcp+tls"
    if net == "tcp":
        return "raw"
    return f"{net}+{sec}"

def _transport_detail(stream):
    """Return the path / serviceName / SNI details that distinguish siblings."""
    if not stream:
        return {}
    detail = {}
    sec = stream.get("security", "none")
    if sec == "reality":
        rs = stream.get("realitySettings", {})
        detail["sni"] = rs.get("serverNames", [])
        detail["dest"] = rs.get("dest")
    if sec == "tls":
        ts = stream.get("tlsSettings", {})
        sni = ts.get("serverName") or ts.get("certificates", [{}])[0].get("certificateFile")
        if sni:
            detail["sni"] = sni
    ws = stream.get("wsSettings")
    if ws:
        detail["path"] = ws.get("path")
        detail["host"] = (ws.get("headers") or {}).get("Host")
    grpc = stream.get("grpcSettings")
    if grpc:
        detail["serviceName"] = grpc.get("serviceName")
    return detail

def list_inbounds():
    """Parse config.json inbounds into normalized rows. Read-only."""
    cfg = read_cfg()
    rows = []
    for ib in cfg.get("inbounds", []):
        stream = ib.get("streamSettings")
        clients = ib.get("settings", {}).get("clients", [])
        rows.append({
            "tag":      ib.get("tag", ""),
            "protocol": ib.get("protocol", "unknown"),
            "port":     ib.get("port"),
            "listen":   ib.get("listen", "0.0.0.0"),
            "network":  (stream or {}).get("network", "tcp"),
            "security": (stream or {}).get("security", "none"),
            "transport": _classify_transport(stream),
            "detail":   _transport_detail(stream),
            "clients":  [{"id": c.get("id", ""), "email": c.get("email", ""), "flow": c.get("flow", "")} for c in clients],
            "client_count": len(clients),
            "enabled":  ib.get("listen") != "127.0.0.1" and not ib.get("disabled", False),
        })
    return rows

# ── Tier 2: test + restart (acts on the live server) ──────────────────────────
# Safety model:
#   1. Never apply a config that fails `xray run -test`.
#   2. Before restart, back up the current config.
#   3. After restart, poll health; if Xray does not come back, roll back to the
#      backup and restart again. Return the outcome.
# Every action is recorded to the audit log so an operator can trace a change.

import subprocess, shutil as _shutil, tempfile as _tempfile

XRAY_BIN      = os.environ.get("XRAY_BIN", "xray")
XRAY_AUDIT    = os.environ.get("XRAY_AUDIT", "/app/vpn-api/pending_config_audit.log")
# ---------------------------------------------------------------------------
# WireGuard peer management
# ---------------------------------------------------------------------------
WG_CONF    = '/etc/wireguard/wg0.conf'
WG_CLIENTS = '/etc/wireguard/clients.json'
WG_IF      = 'wg0'

def _wg_clients():
    try:
        import json as _json
        return _json.loads(open(WG_CLIENTS).read())
    except Exception:
        return []

def _wg_peer_by_name(name):
    for c in _wg_clients():
        if c.get('name', '').lower() == name.lower():
            return c
    return None

def _wg_run(*args):
    """Run a wg command inside the host network namespace via nsenter."""
    return subprocess.run(
        ['nsenter', '--net=/proc/1/ns/net', '--'] + list(args),
        capture_output=True, text=True
    )


# ---------------------------------------------------------------------------
# Xray live user management via HandlerService API (adu/rmu) — NO restart.
# Mirrors the WireGuard nsenter approach: run `xray api` in the host net ns
# so it can reach the API inbound on 127.0.0.1:10085. config.json stays the
# canonical source of truth (written by the dashboard); these calls sync the
# live runtime to match it for a single user, affecting nobody else.
# ---------------------------------------------------------------------------
XRAY_API_ADDR = os.environ.get("XRAY_API_ADDR", "127.0.0.1:10085")

def _xray_api(*args):
    return subprocess.run(
        ["nsenter", "--net=/proc/1/ns/net", "--", XRAY_BIN, "api"] + list(args),
        capture_output=True, text=True, timeout=10,
    )

def _xray_config_inbounds():
    try:
        return json.loads(open(XRAY_CFG).read()).get("inbounds", [])
    except Exception:
        return []

def xray_user_disable(email):
    """Remove a user from every inbound in the live runtime (no restart)."""
    if not email:
        return {"ok": False, "error": "email required"}
    removed, errors = [], []
    for inb in _xray_config_inbounds():
        tag = inb.get("tag")
        if not tag or tag == "api":
            continue
        try:
            r = _xray_api("rmu", "-s", XRAY_API_ADDR, "-tag=" + tag, email)
            if "Removed 1" in (r.stdout + r.stderr):
                removed.append(tag)
        except Exception as e:
            errors.append(tag + ": " + str(e))
    return {"ok": True, "action": "disable", "email": email, "removed_from": removed, "errors": errors}

def xray_user_enable(email):
    """Add a user back to every inbound that lists them in config.json (no restart)."""
    if not email:
        return {"ok": False, "error": "email required"}
    import tempfile
    added, errors = [], []
    for inb in _xray_config_inbounds():
        tag = inb.get("tag")
        if not tag or tag == "api":
            continue
        clients = (inb.get("settings") or {}).get("clients") or []
        match = next((c for c in clients if c.get("email") == email), None)
        if not match:
            continue
        settings = {"clients": [match]}
        src = inb.get("settings") or {}
        for k in ("decryption", "method", "network"):
            if k in src:
                settings[k] = src[k]
        fragment = {"inbounds": [{
            "tag": tag,
            "port": inb.get("port", 443),
            "protocol": inb.get("protocol"),
            "settings": settings,
        }]}
        path = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
                json.dump(fragment, f)
                path = f.name
            r = _xray_api("adu", "-s", XRAY_API_ADDR, path)
            out = r.stdout + r.stderr
            if "result: ok" in out or "add user" in out:
                added.append(tag)
            else:
                errors.append(tag + ": " + out.strip()[:200])
        except Exception as e:
            errors.append(tag + ": " + str(e))
        finally:
            if path:
                try: os.unlink(path)
                except Exception: pass
    return {"ok": len(errors) == 0, "action": "enable", "email": email, "added_to": added, "errors": errors}


def wg_peer_disable(name):
    peer = _wg_peer_by_name(name)
    if not peer:
        return {'ok': False, 'error': f'WireGuard peer not found: {name}'}
    pubkey = peer.get('public', peer.get('pubkey', ''))
    if not pubkey:
        return {'ok': False, 'error': 'Peer has no public key'}
    try:
        r = _wg_run('wg', 'set', WG_IF, 'peer', pubkey, 'remove')
        if r.returncode != 0:
            return {'ok': False, 'error': r.stderr.strip() or 'wg set failed'}
        return {'ok': True}
    except Exception as e:
        return {'ok': False, 'error': str(e)}

def wg_peer_enable(name):
    peer = _wg_peer_by_name(name)
    if not peer:
        return {'ok': False, 'error': f'WireGuard peer not found: {name}'}
    pubkey = peer.get('public', peer.get('pubkey', ''))
    ip     = peer.get('ip', '')
    psk    = peer.get('psk', '')
    if not pubkey or not ip:
        return {'ok': False, 'error': 'Peer missing public key or IP'}
    try:
        import tempfile, os as _os
        args = ['wg', 'set', WG_IF, 'peer', pubkey, 'allowed-ips', f'{ip}/32']
        if psk:
            with tempfile.NamedTemporaryFile(mode='w', suffix='.psk', delete=False) as f:
                f.write(psk)
                psk_file = f.name
            try:
                args += ['preshared-key', psk_file]
                r = _wg_run(*args)
            finally:
                _os.unlink(psk_file)
        else:
            r = _wg_run(*args)
        if r.returncode != 0:
            return {'ok': False, 'error': r.stderr.strip() or 'wg set failed'}
        return {'ok': True}
    except Exception as e:
        return {'ok': False, 'error': str(e)}


HEALTH_POLL_S = 0.5
HEALTH_TIMEOUT_S = 10  # how long to wait for xray to come back

def _xray_test(path):
    """Run `xray run -test` on a config path. Returns (ok, stdout+stderr)."""
    try:
        proc = subprocess.run(
            [XRAY_BIN, "run", "-test", "-c", path],
            capture_output=True, text=True, timeout=15,
        )
        out = (proc.stdout or "") + (proc.stderr or "")
        return proc.returncode == 0, out
    except FileNotFoundError:
        return False, f"{XRAY_BIN} binary not found in PATH"
    except subprocess.TimeoutExpired:
        return False, "xray run -test timed out (15s)"

def _audit(action, detail=None):
    entry = {"ts": datetime.datetime.utcnow().isoformat() + "Z", "action": action}
    if detail:
        entry["detail"] = detail
    try:
        with open(XRAY_AUDIT, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass  # never block an action on audit write failure

def _find_xray_pid() -> int | None:
    """Find the main Xray process PID via /proc scan. Works with pid:host."""
    try:
        for pid in os.listdir('/proc'):
            if not pid.isdigit():
                continue
            try:
                cmdline = open(f'/proc/{pid}/cmdline', 'rb').read().replace(b'\x00', b' ').decode(errors='ignore')
                if 'xray' in cmdline and ('run' in cmdline or '-config' in cmdline or 'config' in cmdline):
                    return int(pid)
            except Exception:
                continue
    except Exception:
        pass
    return None


def _xray_active() -> bool:
    """Return True if the Xray process is running. Uses /proc — no systemctl needed."""
    return _find_xray_pid() is not None

def test_config():
    """Test the CURRENT live config. No mutation. Returns dict."""
    _audit("test_config")
    ok, out = _xray_test(XRAY_CFG)
    return {"ok": ok, "output": out[-2000:] if len(out) > 2000 else out}

def safe_restart():
    """Test → atomic swap (no-op if unchanged) → restart → health poll → rollback.

    The current implementation does NOT modify config.json itself; it validates
    the live config and restarts it. It exists so the UI can run the exact
    test-and-restart sequence the README prescribes, without SSH. A future
    variant will accept a candidate config body to validate-then-apply.
    """
    _audit("restart_requested")
    # 1. test the live config first
    ok, out = _xray_test(XRAY_CFG)
    if not ok:
        _audit("restart_aborted", {"reason": "config_test_failed"})
        return {"ok": False, "restarted": False, "reason": "Config test failed", "test_output": out[-1500:]}

    # 2. back up the current config before touching anything
    backup = XRAY_CFG + ".pre-restart-" + datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    try:
        _shutil.copy2(XRAY_CFG, backup)
    except Exception as e:
        _audit("restart_aborted", {"reason": "backup_failed", "error": str(e)})
        return {"ok": False, "restarted": False, "reason": f"Could not back up config: {e}"}

    # 3. restart: find Xray PID via /proc and SIGTERM it — systemd restarts it.
    #    systemctl is not available inside Docker (no D-Bus); os.kill works with pid:host.
    import signal as _signal
    restart_ok = False
    restart_err = ""
    old_pid = _find_xray_pid()
    if old_pid:
        try:
            os.kill(old_pid, _signal.SIGTERM)
            restart_ok = True
        except ProcessLookupError:
            restart_ok = True  # already gone
        except PermissionError as e:
            restart_err = f"SIGTERM denied for PID {old_pid}: {e}"
    else:
        restart_err = "Xray process not found — cannot restart"

    # 4. health poll
    healthy = False
    deadline = time.time() + HEALTH_TIMEOUT_S
    while time.time() < deadline:
        if _xray_active():
            healthy = True
            break
        time.sleep(HEALTH_POLL_S)

    if healthy:
        _audit("restart_ok", {"backup": backup})
        return {"ok": True, "restarted": True, "healthy": True, "backup": backup}
    else:
        # 5. rollback: restore the backup and restart again
        rolled_back = False
        try:
            _shutil.copy2(backup, XRAY_CFG)
            # Xray should already be restarting via systemd after SIGTERM;
            # just wait for the new process to appear.
            time.sleep(3)
            rolled_back = _xray_active()
        except Exception as e:
            restart_err += f" | rollback error: {e}"
        _audit("restart_rolled_back", {"backup": backup, "rolled_back_ok": rolled_back, "restart_err": restart_err})
        return {
            "ok": False, "restarted": restart_ok, "healthy": False,
            "reason": "Xray did not come back healthy; rolled back to previous config",
            "rolled_back": rolled_back, "backup": backup, "test_output": restart_err[-1500:],
        }

def write_cfg(cfg):
    import shutil, tempfile, os
    # Validate before writing
    new_json = json.dumps(cfg, indent=2)
    json.loads(new_json)  # raises on bad JSON
    # Atomic write: write to temp file, then rename
    tmp = tempfile.NamedTemporaryFile(
        mode="w", dir=os.path.dirname(XRAY_CFG) or "/tmp",
        delete=False, suffix=".tmp"
    )
    try:
        tmp.write(new_json)
        tmp.close()
        shutil.copy2(XRAY_CFG, XRAY_CFG + ".bak")
        os.rename(tmp.name, XRAY_CFG)
    except Exception:
        logger.error("Failed to write Xray config")
        raise

# ── Gateway management ────────────────────────────────────────────────────────

_gw_lock = threading.Lock()

def _test_and_apply_cfg(new_cfg: dict, audit_action: str) -> dict:
    """Test new_cfg in a temp file, write it atomically, restart Xray with rollback."""
    import shutil as _sh, tempfile as _tf, signal as _sig

    tmp = _tf.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
    try:
        json.dump(new_cfg, tmp, indent=2)
        tmp.close()
        ok, out = _xray_test(tmp.name)
    finally:
        try: os.unlink(tmp.name)
        except: pass

    if not ok:
        _audit(f"{audit_action}_aborted", {"reason": "test_failed"})
        return {"ok": False, "restarted": False, "error": "Config test failed", "detail": out[-1000:]}

    backup = XRAY_CFG + f".pre-{audit_action}-" + datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    _sh.copy2(XRAY_CFG, backup)
    write_cfg(new_cfg)

    old_pid = _find_xray_pid()
    if old_pid:
        try: os.kill(old_pid, _sig.SIGTERM)
        except (ProcessLookupError, PermissionError): pass

    healthy = False
    deadline = time.time() + HEALTH_TIMEOUT_S
    while time.time() < deadline:
        if _xray_active():
            healthy = True
            break
        time.sleep(HEALTH_POLL_S)

    if healthy:
        _audit(f"{audit_action}_ok", {"backup": backup})
        return {"ok": True, "restarted": True, "healthy": True, "backup": backup}

    try: _sh.copy2(backup, XRAY_CFG)
    except Exception: pass
    _audit(f"{audit_action}_rolled_back", {"backup": backup})
    return {"ok": False, "restarted": True, "healthy": False, "rolled_back": True,
            "error": "Xray did not come back; rolled back", "backup": backup}


def gateway_list() -> dict:
    from vpn_extensions_v3 import load_gateways
    data = load_gateways()
    cfg  = read_cfg()
    live = {o.get("tag") for o in cfg.get("outbounds", [])}
    for gw in data.get("gateways", []):
        gw["xray_active"] = gw["tag"] in live
    return data


def gateway_add(gw_data: dict) -> dict:
    from vpn_extensions_v3 import load_gateways, save_gateways, build_xray_outbound
    tag = gw_data.get("tag", "").strip()
    if not tag or not re.match(r'^[a-zA-Z0-9_-]+$', tag):
        return {"ok": False, "error": "tag must be non-empty alphanumeric + - _"}

    with _gw_lock:
        data = load_gateways()
        if any(g["tag"] == tag for g in data.get("gateways", [])):
            return {"ok": False, "error": f"Gateway '{tag}' already exists"}
        try:
            outbound = build_xray_outbound(gw_data)
        except Exception as e:
            return {"ok": False, "error": str(e)}

        with _cfg_lock:
            cfg = read_cfg()
            cfg.setdefault("outbounds", []).append(outbound)
            result = _test_and_apply_cfg(cfg, "gw_add")

        if not result.get("ok"):
            return result

        data.setdefault("gateways", []).append({
            **{k: v for k, v in gw_data.items() if k != "auth_pass"},
            "tag": tag,
            "auth_pass": gw_data.get("auth_pass", ""),  # kept in gateways.json, never sent to dashboard
            "created_at": datetime.datetime.utcnow().isoformat() + "Z",
        })
        save_gateways(data)
        _audit("gateway_add", {"tag": tag})
        result["gateway"] = tag
        return result


def gateway_remove(tag: str) -> dict:
    from vpn_extensions_v3 import load_gateways, save_gateways

    with _gw_lock:
        data = load_gateways()
        if not any(g["tag"] == tag for g in data.get("gateways", [])):
            return {"ok": False, "error": f"Gateway '{tag}' not found"}

        with _cfg_lock:
            cfg = read_cfg()
            cfg["outbounds"] = [o for o in cfg.get("outbounds", []) if o.get("tag") != tag]
            rules = cfg.setdefault("routing", {}).setdefault("rules", [])
            cfg["routing"]["rules"] = [r for r in rules if r.get("outboundTag") != tag]
            result = _test_and_apply_cfg(cfg, "gw_remove")

        if not result.get("ok"):
            return result

        data["gateways"] = [g for g in data.get("gateways", []) if g["tag"] != tag]
        data["user_assignments"] = {u: t for u, t in data.get("user_assignments", {}).items() if t != tag}
        save_gateways(data)
        _audit("gateway_remove", {"tag": tag})
        return result


def gateway_assign(tag: str, email: str) -> dict:
    from vpn_extensions_v3 import load_gateways, save_gateways

    with _gw_lock:
        data = load_gateways()
        if not any(g["tag"] == tag for g in data.get("gateways", [])):
            return {"ok": False, "error": f"Gateway '{tag}' not found"}

        with _cfg_lock:
            cfg = read_cfg()
            rules = cfg.setdefault("routing", {}).setdefault("rules", [])
            # Remove any existing gateway routing rule for this user (not api/block/direct)
            rules[:] = [r for r in rules
                        if not (r.get("type") == "field"
                                and email in r.get("user", [])
                                and r.get("outboundTag") not in ("api", "block", "direct"))]
            rules.insert(0, {"type": "field", "user": [email], "outboundTag": tag})
            result = _test_and_apply_cfg(cfg, "gw_assign")

        if not result.get("ok"):
            return result

        data.setdefault("user_assignments", {})[email] = tag
        save_gateways(data)
        _audit("gateway_assign", {"user": email, "gateway": tag})
        return result


def gateway_unassign(email: str) -> dict:
    from vpn_extensions_v3 import load_gateways, save_gateways

    with _gw_lock:
        with _cfg_lock:
            cfg = read_cfg()
            rules = cfg.setdefault("routing", {}).setdefault("rules", [])
            rules[:] = [r for r in rules
                        if not (r.get("type") == "field"
                                and email in r.get("user", [])
                                and r.get("outboundTag") not in ("api", "block", "direct"))]
            result = _test_and_apply_cfg(cfg, "gw_unassign")

        if not result.get("ok"):
            return result

        data = load_gateways()
        data.get("user_assignments", {}).pop(email, None)
        save_gateways(data)
        _audit("gateway_unassign", {"user": email})
        return result


def add_user(email):
    with _cfg_lock:
        cfg = read_cfg()
        clients = cfg["inbounds"][0]["settings"]["clients"]
        if any(c["email"] == email for c in clients):
            return None, "User already exists"
        import uuid as _uuid
        new_id = str(_uuid.uuid4())
        clients.append({"id": new_id, "flow": "xtls-rprx-vision", "email": email})
        write_cfg(cfg)
        return vless_uri(new_id, email), None

def remove_user(email):
    with _cfg_lock:
        cfg = read_cfg()
        clients = cfg["inbounds"][0]["settings"]["clients"]
        original = len(clients)
        cfg["inbounds"][0]["settings"]["clients"] = [
            c for c in clients if c["email"] != email
        ]
        if len(cfg["inbounds"][0]["settings"]["clients"]) == original:
            return False, "User not found"
        write_cfg(cfg)
        return True, None

# ── Live connection detection ─────────────────────────────────────────────────

# Read directly via the shared host PID namespace (`pid: host` in compose) —
# no bind mount needed. A prior version bind-mounted this to /host_net/tcp6,
# but bind-mounting a live /proc/net file is racy (intermittent runc error:
# "mountpoint was moved while re-opening") and caused compose-up to fail on a
# fresh install roughly 1 in 3 times. /proc/1/net/tcp6 is already visible here
# because PID 1 is the host's init and pid namespaces are shared.
HOST_TCP6 = "/proc/1/net/tcp6"

def get_active_ips():
    ESTABLISHED = "01"
    PORT_HEX    = "01BB"
    ips = set()
    try:
        with open(HOST_TCP6) as f:
            for line in f.readlines()[1:]:
                p = line.split()
                if len(p) < 4:
                    continue
                if p[3] != ESTABLISHED:
                    continue
                local_hex = p[1]
                local_port_hex = local_hex.split(":")[-1]
                if local_port_hex.upper() != PORT_HEX:
                    continue
                remote_hex = p[2]
                if remote_hex[16:24].upper() == "FFFF0000":
                    h = remote_hex[24:]
                    ip = ".".join(str(int(h[i:i+2], 16)) for i in (6, 4, 2, 0))
                    if _IP_RE.match(ip) and ip != "0.0.0.0":
                        ips.add(ip)
    except Exception:
        logger.warning("Could not read active connections from /proc")
    return ips

# ── HTTP handler ─────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def _cors_headers(self, origin):
        if _cors_all:
            self.send_header("Access-Control-Allow-Origin", "*")
        elif origin and origin in _allowed_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def _json(self, code, data):
        body = json.dumps(data).encode()
        origin = self.headers.get("Origin", "")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self._cors_headers(origin)
        self.end_headers()
        self.wfile.write(body)

    def _auth(self):
        """Check Bearer token. Returns True if authed, False if not."""
        if not API_AUTH_TOKEN:
            # Auth disabled — warn but allow
            logger.warning("API_AUTH_TOKEN not set — auth bypassed!")
            return True
        auth = self.headers.get("Authorization", "")
        return auth == f"Bearer {API_AUTH_TOKEN}"

    def _require_auth(self):
        if not self._auth():
            self._json(401, {"error": "Unauthorized"})
            return False
        return True

    def do_OPTIONS(self):
        origin = self.headers.get("Origin", "")
        self.send_response(204)
        self._cors_headers(origin)
        self.end_headers()

    def do_GET(self):
        import urllib.parse
        # Rate limit on stats endpoint
        client_ip = self.headers.get("X-Forwarded-For", self.client_address[0]).split(",")[0].strip()
        if not _check_rate_limit(client_ip):
            self._json(429, {"error": "Too many requests"})
            return

        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path == "/vpn-api/stats":
            # Stats endpoint is public (read-only, no user management)
            from vpn_extensions_v3 import (
                check_reputation, get_server_health,
                get_permanent_blocks, evaluate_device_policy,
                parse_sessions_for_user, update_and_check_known_ips,
                mock_device_policy, approve_device, reject_device,
                reset_user_devices
            )
            mock_devices = query.get("mock", [""])[0] == "devices"
            data          = parse_access(mock_devices=mock_devices)
            ssh_threats   = parse_ssh_threats()
            banned        = get_banned_ips()
            for t in ssh_threats:
                t["banned"]        = t["ip"] in banned
            f2b_bans      = parse_fail2ban()
            data["ssh_threats"]   = ssh_threats
            data["fail2ban_bans"] = f2b_bans
            data["server_health"] = get_server_health()
            data["perm_blocks"]   = list(get_permanent_blocks())
            data["mock_devices"]  = mock_devices
            self._json(200, data)

        elif path == "/vpn-api/gateways":
            if not self._require_auth():
                return
            try:
                self._json(200, {**gateway_list(), "ok": True})
            except Exception as e:
                self._json(500, {"ok": False, "error": str(e)})

        elif path == "/vpn-api/inbounds":
            # Read-only inbound listing for the Inbounds page.
            # Never mutates config. Falls back to an empty list if config is unreadable.
            try:
                self._json(200, {"inbounds": list_inbounds(), "ok": True})
            except Exception as e:
                logger.warning("list_inbounds failed: %s", e)
                self._json(200, {"inbounds": [], "ok": False, "error": str(e)})
        elif path == "/vpn-api/server-health":
            if not self._require_auth():
                return
            from vpn_extensions_v3 import get_runtime_service_health
            self._json(200, get_runtime_service_health())
        elif path == "/vpn-api/traffic":
            if not self._require_auth():
                return
            daily_path = os.path.join(STATE_DIR, "traffic_daily.json")
            try:
                with open(daily_path) as f:
                    daily = json.load(f)
            except Exception:
                daily = {}
            self._json(200, {"daily": daily, "ok": True})
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        import urllib.parse
        path = urllib.parse.unquote(self.path)
        if path != "/vpn-api/telegram-webhook" and not self._require_auth():
            return
        length = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._json(400, {"error": "Invalid JSON"})
            return

        from vpn_extensions_v3 import (
            approve_device, reject_device, reset_user_devices, write_firewall_command
        )

        if path == "/vpn-api/users":
            email = (body.get("email") or "").strip().lower()
            if not re.match(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}[a-zA-Z0-9]$", email):
                self._json(400, {"error": "Invalid email format — use letters, numbers, dots, hyphens, underscores"})
                return
            uri, err = add_user(email)
            if err:
                self._json(409, {"error": err})
            else:
                self._json(201, {"email": email, "vless_uri": uri, "note": "Key active within 60 seconds"})

        elif path.startswith("/vpn-api/block/"):
            ip = path[len("/vpn-api/block/"):].strip()
            if not _IP_RE.match(ip):
                self._json(400, {"error": "Invalid IP"})
                return
            if write_firewall_command("block", ip):
                self._json(200, {"blocked": ip, "note": "UFW rule applied within 60 seconds"})
            else:
                self._json(500, {"error": "Could not queue firewall command"})

        elif path.startswith("/vpn-api/devices/"):
            parts = path[len("/vpn-api/devices/"):].strip("/").split("/")
            if len(parts) == 3 and parts[2] in ("approve", "reject"):
                email, ip, action = parts
                if not _IP_RE.match(ip):
                    self._json(400, {"error": "Invalid IP"})
                    return
                if action == "approve":
                    result, err = approve_device(email, ip, bool(body.get("replace_oldest")))
                else:
                    result, err = reject_device(email, ip)
                if err:
                    self._json(409, {"error": err})
                else:
                    self._json(200, result)
            elif len(parts) == 2 and parts[1] == "reset":
                result, err = reset_user_devices(parts[0])
                if err:
                    self._json(500, {"error": err})
                else:
                    self._json(200, result)
            else:
                self._json(404, {"error": "Unknown device action"})

        elif path == "/vpn-api/gateways":
            try:
                body = json.loads(self.rfile.read(content_length))
            except Exception:
                self._json(400, {"error": "Invalid JSON"}); return
            self._json(200, gateway_add(body))

        elif path.startswith("/vpn-api/gateways/") and path.endswith("/assign"):
            tag = path[len("/vpn-api/gateways/"):-len("/assign")]
            try:
                body = json.loads(self.rfile.read(content_length))
            except Exception:
                self._json(400, {"error": "Invalid JSON"}); return
            email = body.get("email", "").strip()
            if not email:
                self._json(400, {"error": "email required"}); return
            self._json(200, gateway_assign(tag, email))

        elif path.startswith("/vpn-api/gateways/") and path.endswith("/unassign"):
            tag = path[len("/vpn-api/gateways/"):-len("/unassign")]
            try:
                body = json.loads(self.rfile.read(content_length))
            except Exception:
                self._json(400, {"error": "Invalid JSON"}); return
            email = body.get("email", "").strip()
            if not email:
                self._json(400, {"error": "email required"}); return
            self._json(200, gateway_unassign(email))

        elif path == "/vpn-api/inbounds/test":
            # Tier 2 — validate the live config without touching it.
            self._json(200, test_config())

        elif path == "/vpn-api/inbounds/restart":
            # Tier 2 — test, then restart with health check + auto-rollback.
            result = safe_restart()
            from vpn_extensions_v3 import telegram_notify, tg_fmt_restart
            threading.Thread(target=telegram_notify, args=(tg_fmt_restart(result),), daemon=True).start()
            self._json(200, result)


        elif path in ("/vpn-api/wireguard/peer/disable", "/vpn-api/wireguard/peer/enable"):
            # body already parsed at the top of do_POST
            name = body.get("name", "")
            if path.endswith("/disable"):
                self._json(200, wg_peer_disable(name))
            else:
                self._json(200, wg_peer_enable(name))

        elif path in ("/vpn-api/xray/user/disable", "/vpn-api/xray/user/enable"):
            email = body.get("email", "")
            if path.endswith("/disable"):
                self._json(200, xray_user_disable(email))
            else:
                self._json(200, xray_user_enable(email))

        elif path == "/vpn-api/telegram-webhook":
            # Telegram Bot webhook — no API auth, verified by chat_id inside handler.
            from vpn_extensions_v3 import (
                handle_telegram_callback, tg_fmt_status, tg_fmt_threats,
                tg_fmt_keys, tg_fmt_restart, telegram_notify, TELEGRAM_CHAT_ID,
                get_server_health, get_runtime_service_health,
            )

            sender_id = str(
                body.get("message", body.get("callback_query", {}).get("message", {}))
                    .get("chat", {}).get("id", "")
            )
            # For callback queries the sender is in from.id
            if "callback_query" in body:
                sender_id = str(body["callback_query"].get("from", {}).get("id", ""))

            if sender_id != str(TELEGRAM_CHAT_ID):
                self._json(200, {"ok": True})
                return

            if "callback_query" in body:
                threading.Thread(target=handle_telegram_callback, args=(body["callback_query"],), daemon=True).start()
                self._json(200, {"ok": True})
                return

            msg  = body.get("message", {})
            text = (msg.get("text") or "").strip()
            cmd  = text.split()[0].lower().split("@")[0] if text else ""

            def _run(fn):
                threading.Thread(target=fn, daemon=True).start()

            if cmd in ("/start", "/help"):
                _run(lambda: telegram_notify(
                    "🤖 <b>Archie VPN Bot</b>\n\n"
                    "/status — server health + active bans\n"
                    "/threats — current SSH threat list\n"
                    "/keys — active key count + traffic\n"
                    "/restart — test config + restart Xray\n"
                ))
            elif cmd == "/status":
                def _status():
                    health = get_server_health()
                    svc    = get_runtime_service_health()
                    bans   = parse_fail2ban()
                    perms  = len(get_banned_ips())
                    telegram_notify(tg_fmt_status(health, svc, bans, perms))
                _run(_status)
            elif cmd == "/threats":
                _run(lambda: telegram_notify(tg_fmt_threats(parse_ssh_threats())))
            elif cmd == "/keys":
                _run(lambda: telegram_notify(tg_fmt_keys(parse_access())))
            elif cmd == "/restart":
                def _restart():
                    telegram_notify("⏳ Running config test + restart…")
                    result = safe_restart()
                    telegram_notify(tg_fmt_restart(result))
                _run(_restart)
            else:
                _run(lambda: telegram_notify(f"Unknown command: <code>{cmd}</code>\n\nSend /help"))

            self._json(200, {"ok": True})

        else:
            self.send_response(404)
            self.end_headers()

    def do_DELETE(self):
        if not self._require_auth():
            return
        import urllib.parse
        path = urllib.parse.unquote(self.path)
        from vpn_extensions_v3 import write_firewall_command

        if path.startswith("/vpn-api/gateways/"):
            tag = path[len("/vpn-api/gateways/"):]
            self._json(200, gateway_remove(tag))

        elif path.startswith("/vpn-api/users/"):
            email = path[len("/vpn-api/users/"):]
            ok, err = remove_user(email)
            if err:
                self._json(404, {"error": err})
            else:
                self._json(200, {"deleted": email, "note": "Removed within 60 seconds"})

        elif path.startswith("/vpn-api/block/"):
            ip = path[len("/vpn-api/block/"):].strip()
            if not _IP_RE.match(ip):
                self._json(400, {"error": "Invalid IP"})
                return
            if write_firewall_command("unblock", ip):
                self._json(200, {"unblocked": ip, "note": "UFW rule removed within 60 seconds"})
            else:
                self._json(500, {"error": "Could not queue firewall command"})

        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass

def _register_telegram_webhook():
    """Register the Telegram webhook on startup. Silently skips if token not set."""
    try:
        from vpn_extensions_v3 import TELEGRAM_TOKEN, _tg_post
        if not TELEGRAM_TOKEN:
            return
        webhook_url = os.environ.get("TELEGRAM_WEBHOOK_URL", "").strip()
        if not webhook_url:
            print("TELEGRAM_WEBHOOK_URL not set — skipping webhook registration")
            return
        result = _tg_post("setWebhook", {
            "url": webhook_url,
            "allowed_updates": ["message", "callback_query"],
            "drop_pending_updates": True,
        })
        if result and result.get("ok"):
            print(f"Telegram webhook registered: {webhook_url}")
        else:
            print(f"Telegram webhook registration failed: {result}")
    except Exception as e:
        print(f"Telegram webhook setup error: {e}")


if __name__ == "__main__":
    auth_status = "ON" if API_AUTH_TOKEN else "OFF - SET API_AUTH_TOKEN"
    print(f"VPN Stats API v3 on :{PORT}  (auth={auth_status})")
    threading.Thread(target=_register_telegram_webhook, daemon=True).start()
    from vpn_extensions_v3 import start_push_monitor
    start_push_monitor(parse_ssh_threats, parse_fail2ban)
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
