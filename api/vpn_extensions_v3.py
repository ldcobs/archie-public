#!/usr/bin/env python3
"""
VPN API Extensions v3 — AbuseIPDB, server health, sessions, permanent blocks, device policy.
Security hardened: proper error logging, atomic file writes.
"""
import os, json, re, time, urllib.request, datetime, threading, logging, tempfile, subprocess

# ── Logging ───────────────────────────────────────────────────────────────────
logger = logging.getLogger("vpn-ext-v3")

# ── Config ─────────────────────────────────────────────────────────────────────
# STATE_DIR: default /app = historical on-box/prod layout; pre-built image
# (Option B) sets it to a dedicated shared volume. See vpn-api.py.
STATE_DIR      = os.environ.get("STATE_DIR", "/app")
ABUSEIPDB_KEY  = os.environ.get("ABUSEIPDB_API_KEY", "").strip()
BLOCKS_FILE    = os.path.join(STATE_DIR, "permanent_blocks.json")
DEVICE_FILE    = os.path.join(STATE_DIR, "device_approvals.json")
DEVICE_BLOCKS  = os.path.join(STATE_DIR, "device_blocks.json")
KNOWN_IPS_FILE = os.path.join(STATE_DIR, "known_ips.json")
PENDING_FW     = os.path.join(STATE_DIR, "pending_firewall.json")
SESSION_GAP    = 300
DEVICE_LIMIT   = 2

ABUSE_CATEGORIES = {
    1:"DNS Compromise", 2:"DNS Poisoning", 3:"Fraud Orders", 4:"DDoS",
    5:"FTP Brute-Force", 6:"Ping of Death", 7:"Phishing", 8:"Fraud VoIP",
    9:"Open Proxy", 10:"Web Spam", 11:"Email Spam", 12:"Blog Spam",
    13:"VPN IP", 14:"Port Scan", 15:"Hacking", 16:"SQL Injection",
    17:"Spoofing", 18:"Brute Force", 19:"Bad Web Bot", 20:"Exploited Host",
    21:"Web App Attack", 22:"SSH Attack", 23:"IoT Attack",
}

_abuse_cache  = {}
_abuse_lock   = threading.Lock()
_known_lock   = threading.Lock()
_device_lock  = threading.Lock()

# ── Helpers ──────────────────────────────────────────────────────────────────

def _now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def _atomic_write(path, data):
    """Write JSON atomically using rename over temp file."""
    tmp = tempfile.NamedTemporaryFile(
        mode="w", dir=os.path.dirname(path) or "/tmp",
        delete=False, suffix=".tmp"
    )
    try:
        json.dump(data, tmp, indent=2)
        tmp.close()
        os.rename(tmp.name, path)
    except Exception:
        logger.error(f"Failed atomic write to {path}")
        if os.path.exists(tmp.name):
            os.unlink(tmp.name)
        raise

# ── AbuseIPDB reputation ─────────────────────────────────────────────────────

def check_reputation(ips):
    """Look up AbuseIPDB for a list of IPs. Returns {ip: score_data} dict."""
    results = {}
    if not ABUSEIPDB_KEY:
        logger.debug("ABUSEIPDB_KEY not set — skipping reputation check")
        return results
    if not ips:
        return results

    with _abuse_lock:
        need = [ip for ip in ips if ip not in _abuse_cache]

    for ip in need:
        try:
            req = urllib.request.Request(
                f"https://api.abuseipdb.com/api/v2/check?ipAddress={ip}&maxAgeInDays=90&verbose",
                headers={"Key": ABUSEIPDB_KEY, "Accept": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=5) as r:
                d = json.loads(r.read())["data"]
                cat_ids = set()
                for rep in d.get("reports", []):
                    cat_ids.update(rep.get("categories", []))
                categories = [ABUSE_CATEGORIES.get(c, f"#{c}") for c in sorted(cat_ids)]
                entry = {
                    "score":          d.get("abuseConfidenceScore", 0),
                    "total_reports":  d.get("totalReports", 0),
                    "distinct_users": d.get("numDistinctUsers", 0),
                    "is_tor":         d.get("isTor", False),
                    "usage_type":     d.get("usageType", ""),
                    "isp":            d.get("isp", ""),
                    "domain":         d.get("domain", ""),
                    "last_reported":  d.get("lastReportedAt", ""),
                    "categories":     categories,
                }
                with _abuse_lock:
                    _abuse_cache[ip] = entry
        except urllib.error.HTTPError as e:
            logger.warning(f"AbuseIPDB HTTP error for {ip}: {e.code}")
            with _abuse_lock:
                _abuse_cache[ip] = None
        except Exception as e:
            logger.warning(f"AbuseIPDB lookup failed for {ip}: {e}")
            with _abuse_lock:
                _abuse_cache[ip] = None

    with _abuse_lock:
        for ip in ips:
            if ip in _abuse_cache:
                results[ip] = _abuse_cache[ip]
    return results

# ── Server health ─────────────────────────────────────────────────────────────

import time as _time
_net_prev = {}   # {iface: (ts, rx_bytes, tx_bytes)}

def _read_net_dev():
    """Return {iface: (rx_bytes, tx_bytes)} from /proc/net/dev."""
    result = {}
    try:
        for line in open('/proc/net/dev'):
            line = line.strip()
            if ':' not in line:
                continue
            iface, rest = line.split(':', 1)
            iface = iface.strip()
            if iface == 'lo':
                continue
            cols = rest.split()
            if len(cols) >= 9:
                result[iface] = (int(cols[0]), int(cols[8]))
    except Exception:
        pass
    return result

def get_server_health():
    health = {}
    try:
        uptime_s = float(open("/proc/uptime").read().split()[0])
        d, rem = divmod(int(uptime_s), 86400)
        h, rem = divmod(rem, 3600)
        m = rem // 60
        health["uptime"] = f"{d}d {h}h {m}m" if d else f"{h}h {m}m"
        health["uptime_seconds"] = int(uptime_s)
    except Exception as e:
        logger.warning(f"Could not read uptime: {e}")
        health["uptime"] = "unknown"

    try:
        parts = open("/proc/loadavg").read().split()
        health["load_1"]  = float(parts[0])
        health["load_5"]  = float(parts[1])
        health["load_15"] = float(parts[2])
    except Exception as e:
        logger.warning(f"Could not read loadavg: {e}")

    try:
        mem = {}
        for line in open("/proc/meminfo"):
            k, v = line.split(":")
            mem[k.strip()] = int(v.split()[0])
        total = mem.get("MemTotal", 1)
        avail = mem.get("MemAvailable", 0)
        used  = total - avail
        health["mem_total_mb"] = round(total / 1024)
        health["mem_used_mb"]  = round(used  / 1024)
        health["mem_pct"]      = round(used / total * 100)
    except Exception as e:
        logger.warning(f"Could not read memory info: {e}")

    try:
        s = os.statvfs("/")
        total = s.f_blocks * s.f_frsize
        free  = s.f_bfree  * s.f_frsize
        health["disk_total_gb"] = round(total / 1e9, 1)
        health["disk_used_gb"]  = round((total - free) / 1e9, 1)
        health["disk_pct"]      = round((total - free) / total * 100) if total else 0
    except Exception as e:
        logger.warning(f"Could not read disk info: {e}")

    # Service checks — scan /proc directly (pid:host, no external tools needed)
    def _proc_has(fragment):
        try:
            for pid in os.listdir('/proc'):
                if not pid.isdigit():
                    continue
                try:
                    cmd = open(f'/proc/{pid}/cmdline', 'rb').read().replace(b'\x00', b' ').decode(errors='ignore')
                    if fragment in cmd:
                        return True
                except Exception:
                    pass
        except Exception:
            pass
        return False

    try:
        health['xray_running'] = _proc_has('xray')
    except Exception as e:
        logger.warning('xray check failed: ' + str(e))
        health['xray_running'] = None

    try:
        health['hysteria2_running'] = _proc_has('hysteria')
    except Exception as e:
        logger.warning('hysteria2 check failed: ' + str(e))
        health['hysteria2_running'] = None

    try:
        health['wg_running'] = 'wg0' in open('/proc/1/net/dev').read()
    except Exception as e:
        logger.warning('wg0 check failed: ' + str(e))
        health['wg_running'] = None

    try:
        health['nginx_running'] = _proc_has('nginx')
    except Exception as e:
        logger.warning('nginx check failed: ' + str(e))
        health['nginx_running'] = None

    # CPU model + core count
    try:
        model, cores = '', 0
        for line in open('/proc/cpuinfo'):
            if line.startswith('model name') and not model:
                model = line.split(':', 1)[1].strip()
            if line.startswith('processor'):
                cores += 1
        health['cpu_model'] = model or 'Unknown'
        health['cpu_cores'] = cores or 1
    except Exception as e:
        logger.warning('cpu info failed: ' + str(e))

    # Live network throughput — delta since last poll
    try:
        global _net_prev
        now = _time.time()
        current = _read_net_dev()
        rx_mbps = tx_mbps = 0.0
        iface_name = ''
        for iface, (rx, tx) in current.items():
            if iface in _net_prev:
                prev_ts, prev_rx, prev_tx = _net_prev[iface]
                dt = now - prev_ts
                if dt > 0:
                    rx_mbps += (rx - prev_rx) * 8 / dt / 1e6
                    tx_mbps += (tx - prev_tx) * 8 / dt / 1e6
                    iface_name = iface
            _net_prev[iface] = (now, rx, tx)
        health['net_rx_mbps'] = round(max(0, rx_mbps), 2)
        health['net_tx_mbps'] = round(max(0, tx_mbps), 2)
        health['net_iface']   = iface_name
    except Exception as e:
        logger.warning('net throughput failed: ' + str(e))
        health['net_rx_mbps'] = None
        health['net_tx_mbps'] = None

    return health

def _read_boot_time_epoch():
    try:
        with open('/proc/stat') as handle:
            for line in handle:
                if line.startswith('btime '):
                    return int(line.split()[1])
    except Exception:
        pass
    return int(time.time())

def _format_duration(total_seconds):
    if total_seconds is None:
        return None
    total_seconds = max(0, int(total_seconds))
    days, rem = divmod(total_seconds, 86400)
    hours, rem = divmod(rem, 3600)
    minutes = rem // 60
    return f"{days}d {hours}h {minutes}m" if days else f"{hours}h {minutes}m"

def _service_payload(running, uptime_seconds=None, last_restart=None, source='unknown'):
    return {
        'running': running,
        'uptime': _format_duration(uptime_seconds) if uptime_seconds is not None else None,
        'uptime_seconds': int(uptime_seconds) if uptime_seconds is not None else None,
        'last_restart': last_restart,
        'source': source,
    }

def _systemd_service_status(unit):
    boot_epoch = _read_boot_time_epoch()
    try:
        proc = subprocess.run(
            ['systemctl', 'show', unit, '-p', 'ActiveState', '-p', 'ActiveEnterTimestampMonotonic', '--value'],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if proc.returncode != 0:
            return _service_payload(None, source='systemd-error')

        lines = [line.strip() for line in proc.stdout.splitlines()]
        active_state = lines[0] if lines else ''
        active_enter_mono = lines[1] if len(lines) > 1 else ''
        running = active_state == 'active'
        if running and active_enter_mono.isdigit():
            start_epoch = boot_epoch + (int(active_enter_mono) / 1_000_000)
            now_epoch = time.time()
            uptime_seconds = max(0, int(now_epoch - start_epoch))
            last_restart = datetime.datetime.fromtimestamp(
                start_epoch, tz=datetime.timezone.utc
            ).isoformat()
            return _service_payload(True, uptime_seconds, last_restart, source='systemd')
        return _service_payload(running, source='systemd')
    except Exception as e:
        logger.warning(f"systemd status failed for {unit}: {e}")
        return _service_payload(None, source='systemd-error')

def _process_status(fragments, running_hint=None):
    boot_epoch = _read_boot_time_epoch()
    ticks_per_sec = os.sysconf(os.sysconf_names['SC_CLK_TCK'])
    candidates = []
    try:
        for pid in os.listdir('/proc'):
            if not pid.isdigit():
                continue
            try:
                cmdline = open(f'/proc/{pid}/cmdline', 'rb').read().replace(b'\x00', b' ').decode(errors='ignore')
                if not cmdline:
                    continue
                if not any(fragment in cmdline for fragment in fragments):
                    continue
                stat_parts = open(f'/proc/{pid}/stat', 'r').read().split()
                if len(stat_parts) > 21:
                    start_ticks = int(stat_parts[21])
                    candidates.append((start_ticks, pid))
            except Exception:
                continue
    except Exception as e:
        logger.warning(f"process scan failed for {fragments}: {e}")

    if not candidates:
        return _service_payload(running_hint, source='proc')

    start_ticks, _pid = min(candidates, key=lambda item: item[0])
    start_epoch = boot_epoch + (start_ticks / ticks_per_sec)
    now_epoch = time.time()
    uptime_seconds = max(0, int(now_epoch - start_epoch))
    last_restart = datetime.datetime.fromtimestamp(start_epoch, tz=datetime.timezone.utc).isoformat()
    return _service_payload(True, uptime_seconds, last_restart, source='proc')

def _wg_interface_status(iface='wg0'):
    """Detect WireGuard via /proc/1/net/dev (host netns, accessible with pid:host)."""
    boot_epoch = _read_boot_time_epoch()
    for path in ('/proc/1/net/dev', '/proc/net/dev'):
        try:
            with open(path, 'r') as f:
                for line in f:
                    if iface in line:
                        uptime_seconds = max(0, int(time.time() - boot_epoch))
                        return _service_payload(True, uptime_seconds, source='proc-net')
        except Exception:
            continue
    return _service_payload(False, source='proc-net')


def get_runtime_service_health():
    health = {
        # Use /proc scanning (pid: "host" gives us host process visibility).
        # systemctl is not available inside Docker without D-Bus.
        'xray_service':      _process_status(['/usr/local/bin/xray', 'xray run', 'xray -config']),
        'hysteria2_service': _process_status(['hysteria-server', 'hysteria server', '/usr/local/bin/hysteria']),
        'nginx_service':     _process_status(['nginx: master', 'nginx -g']),
        'wg_service':        _wg_interface_status('wg0'),
        'dashboard_service': _process_status(['node server.js', '/app/server.js']),
        'vpn_api_service':   _process_status(['/app/vpn-api.py', 'python3 /app/vpn-api.py']),
    }

    health['xray_running']      = health['xray_service']['running']
    health['hysteria2_running'] = health['hysteria2_service']['running']
    health['nginx_running']     = health['nginx_service']['running']
    health['wg_running']        = health['wg_service']['running']
    health['dashboard_running'] = health['dashboard_service']['running']
    health['vpn_api_running']   = health['vpn_api_service']['running']
    return health

# ── Session grouping ─────────────────────────────────────────────────────────

def parse_sessions_for_user(log_entries):
    if not log_entries:
        return []
    sorted_entries = sorted(log_entries, key=lambda x: x[0])
    sessions = []
    cur = None
    for ts, ip, dest in sorted_entries:
        if cur is None or (ts - cur["end"]).total_seconds() > SESSION_GAP:
            if cur:
                sessions.append(cur)
            cur = {"start": ts, "end": ts, "ips": {ip}, "conns": 1}
        else:
            cur["end"] = ts
            cur["ips"].add(ip)
            cur["conns"] += 1
    if cur:
        sessions.append(cur)
    result = []
    for s in reversed(sessions[-10:]):
        dur_min = max(1, int((s["end"] - s["start"]).total_seconds() / 60))
        result.append({
            "start":   s["start"].isoformat(),
            "end":     s["end"].isoformat(),
            "ips":     list(s["ips"]),
            "conns":   s["conns"],
            "dur_min": dur_min,
        })
    return result

# ── Known IPs ───────────────────────────────────────────────────────────────

def load_known_ips():
    try:
        with _known_lock:
            if os.path.exists(KNOWN_IPS_FILE):
                return json.load(open(KNOWN_IPS_FILE))
    except Exception as e:
        logger.warning(f"Could not load known IPs: {e}")
    return {}

def save_known_ips(data):
    try:
        with _known_lock:
            _atomic_write(KNOWN_IPS_FILE, data)
    except Exception as e:
        logger.error(f"Could not save known IPs: {e}")

def update_and_check_known_ips(user, current_ips):
    db     = load_known_ips()
    known  = set(db.get(user, []))
    current = set(current_ips or [])
    new_ips = current - known
    if new_ips:
        db[user] = list(known | current)
        save_known_ips(db)
    return known, new_ips

# ── Device approval / policy ─────────────────────────────────────────────────

def load_device_db():
    try:
        with _device_lock:
            if os.path.exists(DEVICE_FILE):
                data = json.load(open(DEVICE_FILE))
                if isinstance(data, dict):
                    data.setdefault("users", {})
                    return data
    except Exception as e:
        logger.warning(f"Could not load device DB: {e}")
    return {"users": {}}

def save_device_db(data):
    try:
        with _device_lock:
            _atomic_write(DEVICE_FILE, data)
        return True
    except Exception as e:
        logger.error(f"Could not save device DB: {e}")
        return False

def _user_policy(db, user):
    policy = db.setdefault("users", {}).setdefault(user, {})
    policy.setdefault("enabled", True)
    policy.setdefault("limit", DEVICE_LIMIT)
    policy.setdefault("approved", {})
    policy.setdefault("pending", {})
    policy.setdefault("rejected", {})
    return policy

def _touch_ip(bucket, ip, now):
    item = bucket.setdefault(ip, {"first_seen": now})
    item["last_seen"] = now
    return item

def _seed_approved_from_known(user, policy, now):
    if policy.get("approved"):
        return
    known = load_known_ips().get(user, [])
    for ip in known[:int(policy.get("limit") or DEVICE_LIMIT)]:
        policy["approved"][ip] = {"first_seen": now, "last_seen": now, "source": "known_ip_seed"}

def evaluate_device_policy(user, current_ips, dry_run=False):
    now = _now_iso()
    current = sorted(set(current_ips or []))
    db = load_device_db()
    policy = _user_policy(db, user)
    limit = int(policy.get("limit") or DEVICE_LIMIT)
    _seed_approved_from_known(user, policy, now)
    changed = False

    for ip in current:
        if ip in policy["approved"]:
            _touch_ip(policy["approved"], ip, now)
            changed = True
            continue
        if ip in policy["rejected"]:
            _touch_ip(policy["rejected"], ip, now)
            changed = True
            continue
        if len(policy["approved"]) < limit:
            policy["approved"][ip] = {"first_seen": now, "last_seen": now, "source": "auto_registered"}
            changed = True
            continue
        is_new_pending = ip not in policy["pending"]
        _touch_ip(policy["pending"], ip, now)
        changed = True
        if is_new_pending and not dry_run:
            threading.Thread(target=_notify_device_pending, args=(user, ip), daemon=True).start()

    if changed and not dry_run:
        save_device_db(db)

    pending_now  = [ip for ip in policy["pending"]  if ip in current]
    rejected_now = [ip for ip in policy["rejected"] if ip in current]
    return {
        "enabled":        bool(policy.get("enabled", True)),
        "limit":          limit,
        "approved":       sorted(policy["approved"].keys()),
        "pending":        sorted(policy["pending"].keys()),
        "rejected":       sorted(policy["rejected"].keys()),
        "pending_now":    sorted(pending_now),
        "rejected_now":   sorted(rejected_now),
        "approved_count": len(policy["approved"]),
        "pending_count":  len(policy["pending"]),
        "rejected_count": len(policy["rejected"]),
        "warning":        bool(pending_now or rejected_now),
    }

def approve_device(user, ip, replace_oldest=False):
    now = _now_iso()
    db = load_device_db()
    policy = _user_policy(db, user)
    limit = int(policy.get("limit") or DEVICE_LIMIT)
    approved = policy["approved"]
    replaced = None

    if ip not in approved and len(approved) >= limit:
        if not replace_oldest:
            return None, "Device limit is full — approve with replacement or reset devices first"
        replaced = sorted(approved.items(), key=lambda kv: kv[1].get("first_seen", ""))[0][0]
        approved.pop(replaced, None)

    policy["pending"].pop(ip, None)
    policy["rejected"].pop(ip, None)
    approved[ip] = {
        "first_seen": approved.get(ip, {}).get("first_seen", now),
        "last_seen":  now,
        "source":     "manual_approval"
    }
    if not save_device_db(db):
        return None, "Could not save device approval"
    write_firewall_command("unblock", ip, scope="device", user=user)
    return {"approved": ip, "replaced": replaced}, None

def reject_device(user, ip):
    now = _now_iso()
    db = load_device_db()
    policy = _user_policy(db, user)
    item = policy["pending"].pop(ip, {})
    item.setdefault("first_seen", now)
    item["last_seen"]   = now
    item["blocked"]     = True
    item["rejected_at"] = now
    policy["rejected"][ip] = item
    if not save_device_db(db):
        return None, "Could not save rejected device"
    write_firewall_command("block", ip, scope="device", user=user)
    return {"rejected": ip}, None

def reset_user_devices(user):
    db = load_device_db()
    policy = _user_policy(db, user)
    blocked = set(policy.get("pending", {}).keys()) | set(policy.get("rejected", {}).keys())
    policy["approved"] = {}
    policy["pending"]  = {}
    policy["rejected"] = {}
    if not save_device_db(db):
        return None, "Could not reset devices"
    for ip in sorted(blocked):
        write_firewall_command("unblock", ip, scope="device", user=user)
    return {"reset": user, "unblock_queued": sorted(blocked)}, None

def mock_device_policy(user, ips_24h):
    pending  = ["203.0.113.44"] if user == "demo" else []
    approved = list(ips_24h[:2]) or (["198.51.100.10"] if pending else [])
    return {
        "enabled": True, "limit": DEVICE_LIMIT,
        "approved": approved, "pending": pending, "rejected": [],
        "pending_now": pending, "rejected_now": [],
        "approved_count": len(approved), "pending_count": len(pending),
        "rejected_count": 0, "warning": bool(pending), "mock": True,
    }

# ── Permanent blocks ────────────────────────────────────────────────────────

def get_permanent_blocks():
    try:
        d = json.load(open(BLOCKS_FILE))
        return set(d.get("ips", []))
    except Exception:
        return set()

def write_firewall_command(action, ip, scope="permanent", user=""):
    try:
        cmd = {"action": action, "ip": ip, "scope": scope, "user": user, "ts": _now_iso()}
        queued = []
        if os.path.exists(PENDING_FW):
            try:
                existing = json.load(open(PENDING_FW))
                if isinstance(existing, dict) and isinstance(existing.get("commands"), list):
                    queued = existing["commands"]
                elif isinstance(existing, dict) and existing.get("ip"):
                    queued = [existing]
            except Exception as e:
                logger.warning(f"Could not read pending firewall queue: {e}")
                queued = []
        queued.append(cmd)
        _atomic_write(PENDING_FW, {"commands": queued})
        return True
    except Exception as e:
        logger.error(f"Could not queue firewall command: {e}")
        return False


# ── Telegram ──────────────────────────────────────────────────────────────────

TELEGRAM_TOKEN   = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
_TG_API          = "https://api.telegram.org"

# Track pending IPs we already notified to avoid repeat alerts
_tg_notified_pending: set = set()
_tg_notified_lock = threading.Lock()

# State for push alert deduplication
_push_seen_threats:      dict = {}   # ip -> last alerted count
_push_seen_bans:         set  = set() # IPs we already alerted as banned
_push_seen_pmode_ts:     str  = ""   # updated_at of last alerted protection mode change
_push_alert_threshold         = 10   # SSH hits before alerting
_push_interval_s              = 60   # how often the monitor loop runs

# Daily digest schedule
_digest_hour_utc              = 8    # send digest at 08:00 UTC
_digest_last_day:             str = ""  # YYYY-MM-DD of last digest sent

PROTECTION_MODE_FILE = os.path.join(STATE_DIR, "protection_mode.json")


def _tg_post(method: str, payload: dict):
    """Low-level POST to Telegram Bot API. Silently ignores errors."""
    if not TELEGRAM_TOKEN:
        return None
    try:
        data = json.dumps(payload).encode()
        req  = urllib.request.Request(
            f"{_TG_API}/bot{TELEGRAM_TOKEN}/{method}",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=8) as r:
            return json.loads(r.read())
    except Exception as e:
        logger.warning("Telegram API error [%s]: %s", method, e)
        return None


def telegram_notify(text: str, reply_markup: dict | None = None) -> dict | None:
    """Send a message to the owner chat. Supports HTML parse mode."""
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        return None
    payload: dict = {"chat_id": TELEGRAM_CHAT_ID, "text": text, "parse_mode": "HTML"}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    return _tg_post("sendMessage", payload)


def telegram_answer_callback(callback_query_id: str, text: str = "", show_alert: bool = False):
    """Acknowledge an inline button press."""
    _tg_post("answerCallbackQuery", {
        "callback_query_id": callback_query_id,
        "text": text,
        "show_alert": show_alert,
    })


def telegram_edit_message(chat_id, message_id: int, text: str):
    """Replace the text of an existing message (used after button action)."""
    _tg_post("editMessageText", {
        "chat_id": chat_id,
        "message_id": message_id,
        "text": text,
        "parse_mode": "HTML",
    })


# ── Push monitor loop ────────────────────────────────────────────────────────

def _push_monitor_loop(parse_ssh_threats_fn, parse_fail2ban_fn):
    """Background thread: polls threats/bans and digest (slow, 60s cycle)."""
    while True:
        try:
            _push_check_threats(parse_ssh_threats_fn())
            _push_check_bans(parse_fail2ban_fn())
            _push_check_digest(parse_ssh_threats_fn, parse_fail2ban_fn)
        except Exception as e:
            logger.warning("push monitor (threats) error: %s", e)
        time.sleep(_push_interval_s)


def _push_pmode_loop():
    """Separate fast-poll thread for protection mode changes (10s cycle)."""
    while True:
        try:
            _push_check_protection_mode()
        except Exception as e:
            logger.warning("push monitor (pmode) error: %s", e)
        time.sleep(10)


def _push_check_threats(threats: list):
    global _push_seen_threats
    for t in threats:
        ip    = t.get("ip", "")
        count = t.get("count", 0)
        if not ip or count < _push_alert_threshold:
            continue
        prev = _push_seen_threats.get(ip, 0)
        # Alert on first breach of threshold, then again each time count doubles
        if prev == 0 or count >= prev * 2:
            _push_seen_threats[ip] = count
            flag    = t.get("flag", "🌐")
            country = t.get("country", "Unknown")
            banned  = t.get("banned", False)
            perm    = t.get("perm_blocked", False)
            status  = "🚫 permanently blocked" if perm else ("🔒 temp-banned" if banned else "⚠️ active")
            text = (
                f"🛡 <b>SSH Threat Alert</b>\n\n"
                f"{flag} <code>{ip}</code>  {country}\n"
                f"Attempts: <b>{count}</b>  ·  {status}"
            )
            markup = None
            if not perm and not banned:
                markup = {"inline_keyboard": [[
                    {"text": "⏱ Temp-ban",    "callback_data": f"tempban_ip:{ip}"},
                    {"text": "🚫 Perm-block", "callback_data": f"block_ip:{ip}"},
                    {"text": "👁 Ignore",     "callback_data": f"ignore_threat:{ip}"},
                ]]}
            threading.Thread(target=telegram_notify, args=(text, markup), daemon=True).start()


def _push_check_bans(bans: list):
    global _push_seen_bans
    for b in bans:
        ip = b.get("ip", "")
        if not ip or ip in _push_seen_bans:
            continue
        if b.get("active") and not b.get("perm_blocked"):
            _push_seen_bans.add(ip)
            flag    = b.get("flag", "🌐")
            country = b.get("country", "")
            jail    = b.get("jail", "")
            text = (
                f"🔒 <b>Auto-banned</b>  {flag} <code>{ip}</code>  {country}\n"
                f"Jail: {jail}" if jail else f"🔒 <b>Auto-banned</b>  {flag} <code>{ip}</code>  {country}"
            )
            markup = {"inline_keyboard": [[
                {"text": "🚫 Upgrade to perm-block", "callback_data": f"block_ip:{ip}"},
                {"text": "✅ Release",               "callback_data": f"ignore_threat:{ip}"},
            ]]}
            threading.Thread(target=telegram_notify, args=(text, markup), daemon=True).start()


def _push_check_protection_mode():
    """Alert when protection_mode.json changes (mode switched in dashboard)."""
    global _push_seen_pmode_ts
    try:
        with open(PROTECTION_MODE_FILE, 'r') as f:
            state = json.load(f)
        ts   = state.get("updated_at", "")
        mode = state.get("mode", "temp-ban")
        if not ts or ts == _push_seen_pmode_ts:
            return
        _push_seen_pmode_ts = ts
        label = "🚨 Permanent Deny" if mode == "permanent-deny" else "🛡 Temp-Ban only"
        text  = (
            f"⚙️ <b>Protection mode changed</b>\n\n"
            f"New mode: <b>{label}</b>\n"
            f"Changed at: {ts[:19].replace('T', ' ')} UTC"
        )
        markup = {"inline_keyboard": [[
            {"text": "↩ Revert to temp-ban", "callback_data": "pmode_revert:temp-ban"},
        ]]} if mode == "permanent-deny" else {"inline_keyboard": [[
            {"text": "⬆ Escalate to permanent-deny", "callback_data": "pmode_revert:permanent-deny"},
        ]]}
        threading.Thread(target=telegram_notify, args=(text, markup), daemon=True).start()
    except FileNotFoundError:
        pass
    except Exception as e:
        logger.warning("protection mode check error: %s", e)


def _push_check_digest(parse_ssh_threats_fn, parse_fail2ban_fn):
    """Send the daily security digest at _digest_hour_utc if not yet sent today."""
    global _digest_last_day
    now = datetime.datetime.utcnow()
    if now.hour != _digest_hour_utc:
        return
    today = now.strftime("%Y-%m-%d")
    if _digest_last_day == today:
        return
    _digest_last_day = today
    try:
        threats = parse_ssh_threats_fn()
        bans    = parse_fail2ban_fn()
        _send_daily_digest(threats, bans)
    except Exception as e:
        logger.warning("daily digest error: %s", e)


def _send_daily_digest(threats: list, bans: list):
    active_bans  = sum(1 for b in bans if b.get("active") and not b.get("perm_blocked"))
    perm_blocks  = len(get_permanent_blocks())
    total_hits   = sum(t.get("count", 0) for t in threats)
    top_threats  = sorted(threats, key=lambda t: t.get("count", 0), reverse=True)[:5]

    # Country breakdown
    country_hits: dict = {}
    for t in threats:
        cc = t.get("country", "Unknown")
        country_hits[cc] = country_hits.get(cc, 0) + t.get("count", 0)
    top_countries = sorted(country_hits.items(), key=lambda x: x[1], reverse=True)[:4]

    now_str = datetime.datetime.utcnow().strftime("%Y-%m-%d")

    lines = [
        f"📋 <b>Daily Security Digest</b>  —  {now_str}",
        "",
        f"🛡 Active bans: <b>{active_bans}</b>  ·  🚫 Perm blocks: <b>{perm_blocks}</b>",
        f"🔍 SSH attempts (7d): <b>{total_hits}</b>  from <b>{len(threats)}</b> unique IPs",
    ]

    if top_countries:
        lines += ["", "<b>Top attack countries</b>"]
        for country, hits in top_countries:
            lines.append(f"  {country}: {hits}")

    if top_threats:
        lines += ["", "<b>Top threats</b>"]
        for t in top_threats:
            flag = t.get("flag", "🌐")
            ip   = t.get("ip", "?")
            cnt  = t.get("count", 0)
            ban  = " 🔒" if t.get("banned") else ""
            perm = " 🚫" if t.get("perm_blocked") else ""
            lines.append(f"  {flag} <code>{ip}</code> · {cnt} hits{ban}{perm}")

    threading.Thread(target=telegram_notify, args=("\n".join(lines),), daemon=True).start()


def start_push_monitor(parse_ssh_threats_fn, parse_fail2ban_fn):
    """Start the background push monitor. Call once at server startup."""
    global _push_seen_pmode_ts, _digest_last_day
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        return
    # Seed protection mode timestamp so we don't alert on pre-existing state.
    try:
        with open(PROTECTION_MODE_FILE, 'r') as f:
            _push_seen_pmode_ts = json.load(f).get("updated_at", "")
    except Exception:
        pass
    # Seed digest day so we don't send immediately on restart within the digest hour.
    _digest_last_day = datetime.datetime.utcnow().strftime("%Y-%m-%d")
    threading.Thread(target=_push_monitor_loop, args=(parse_ssh_threats_fn, parse_fail2ban_fn), daemon=True).start()
    threading.Thread(target=_push_pmode_loop, daemon=True).start()
    logger.info("Telegram push monitor started (threats=%ds, pmode=10s, threshold=%d hits)", _push_interval_s, _push_alert_threshold)


# ── Notification hooks ────────────────────────────────────────────────────────

def _notify_device_pending(user: str, ip: str):
    key = f"{user}:{ip}"
    with _tg_notified_lock:
        if key in _tg_notified_pending:
            return
        _tg_notified_pending.add(key)
    telegram_notify(
        f"🔔 <b>Device Pending Approval</b>\n\n"
        f"User: <code>{user}</code>\n"
        f"IP: <code>{ip}</code>\n\n"
        f"Device limit reached — manual approval required.",
        reply_markup={"inline_keyboard": [[
            {"text": "✅ Approve", "callback_data": f"approve:{user}:{ip}"},
            {"text": "❌ Reject",  "callback_data": f"reject:{user}:{ip}"},
        ]]},
    )


def _notify_device_approved(user: str, ip: str, by: str = "owner"):
    key = f"{user}:{ip}"
    with _tg_notified_lock:
        _tg_notified_pending.discard(key)
    telegram_notify(f"✅ <b>Device Approved</b>\n\nUser: <code>{user}</code>\nIP: <code>{ip}</code>")


def _notify_device_rejected(user: str, ip: str, by: str = "owner"):
    key = f"{user}:{ip}"
    with _tg_notified_lock:
        _tg_notified_pending.discard(key)
    telegram_notify(f"🚫 <b>Device Rejected</b>\n\nUser: <code>{user}</code>\nIP: <code>{ip}</code>")


# ── Callback query dispatcher ─────────────────────────────────────────────────

def handle_telegram_callback(cq: dict):
    """Handle inline button presses. Called from the webhook route in vpn-api.py."""
    cq_id   = cq.get("id", "")
    data    = cq.get("data", "")
    chat_id = cq.get("message", {}).get("chat", {}).get("id")
    msg_id  = cq.get("message", {}).get("message_id")

    # Security: only accept from owner chat
    if str(chat_id) != str(TELEGRAM_CHAT_ID):
        telegram_answer_callback(cq_id, "Unauthorized", show_alert=True)
        return

    parts = data.split(":", 2)
    action = parts[0] if parts else ""

    if action in ("approve", "reject") and len(parts) == 3:
        _, user, ip = parts
        if action == "approve":
            result, err = approve_device(user, ip)
            if err:
                telegram_answer_callback(cq_id, f"Error: {err}", show_alert=True)
            else:
                telegram_answer_callback(cq_id, "Approved ✅")
                telegram_edit_message(chat_id, msg_id,
                    f"✅ <b>Approved</b> — <code>{ip}</code> for <code>{user}</code>")
        else:
            result, err = reject_device(user, ip)
            if err:
                telegram_answer_callback(cq_id, f"Error: {err}", show_alert=True)
            else:
                telegram_answer_callback(cq_id, "Rejected 🚫")
                telegram_edit_message(chat_id, msg_id,
                    f"🚫 <b>Rejected</b> — <code>{ip}</code> for <code>{user}</code>")

    elif action == "block_ip" and len(parts) == 2:
        ip = parts[1]
        write_firewall_command("block", ip, scope="permanent")
        telegram_answer_callback(cq_id, "Blocked ✅")
        telegram_edit_message(chat_id, msg_id,
            f"🔒 <b>Permanent block queued</b> — <code>{ip}</code>")

    elif action == "tempban_ip" and len(parts) == 2:
        ip = parts[1]
        write_firewall_command("block", ip, scope="temporary")
        telegram_answer_callback(cq_id, "Temp-banned ✅")
        telegram_edit_message(chat_id, msg_id,
            f"⏱ <b>Temp-ban queued</b> — <code>{ip}</code>")

    elif action == "ignore_threat" and len(parts) == 2:
        telegram_answer_callback(cq_id, "Ignored")
        telegram_edit_message(chat_id, msg_id,
            f"👁 <b>Threat acknowledged</b> — <code>{parts[1]}</code> — no action taken")

    elif action == "pmode_revert" and len(parts) == 2:
        target_mode = parts[1]  # "temp-ban" or "permanent-deny"
        try:
            import json as _json
            state = {
                "mode": target_mode,
                "updated_at": _now_iso(),
                "effective_from": _now_iso() if target_mode == "permanent-deny" else "",
            }
            _atomic_write(PROTECTION_MODE_FILE, state)
            global _push_seen_pmode_ts
            _push_seen_pmode_ts = state["updated_at"]  # suppress re-alert for this change
            label = "🚨 Permanent Deny" if target_mode == "permanent-deny" else "🛡 Temp-Ban only"
            telegram_answer_callback(cq_id, f"Mode set to {target_mode}")
            telegram_edit_message(chat_id, msg_id,
                f"⚙️ <b>Protection mode set</b>: {label}")
        except Exception as e:
            telegram_answer_callback(cq_id, f"Error: {e}", show_alert=True)

    else:
        telegram_answer_callback(cq_id, "Unknown action")


# ── Command formatters (called from vpn-api.py with pre-fetched data) ─────────

def tg_fmt_status(health: dict, svc: dict, fail2ban_bans: list, perm_bans: int) -> str:
    cpu  = health.get("cpu_pct", 0)
    mem  = health.get("mem_pct", 0)
    disk = health.get("disk_pct", 0)
    uptime = health.get("uptime", "")

    svc_lines = []
    for label, key in [("Xray", "xray_service"), ("Hysteria2", "hysteria2_service"), ("WireGuard", "wg_service"), ("nginx", "nginx_service")]:
        s   = svc.get(key, {})
        ico = "✅" if s.get("running") else "❌"
        svc_lines.append(f"  {ico} {label}")

    active_bans = sum(1 for b in fail2ban_bans if b.get("active") and not b.get("perm_blocked"))

    lines = [
        "📊 <b>Archie Status</b>",
        "",
        f"CPU {cpu:.0f}%  ·  RAM {mem:.0f}%  ·  Disk {disk:.0f}%",
        f"Uptime: {uptime}" if uptime else "",
        "",
        "<b>Services</b>",
        *svc_lines,
        "",
        f"🔒 Temp bans: <b>{active_bans}</b>",
        f"🚫 Perm blocks: <b>{perm_bans}</b>",
    ]
    return "\n".join(l for l in lines if l != "" or lines.index(l) not in (3,))


def tg_fmt_threats(threats: list) -> str:
    if not threats:
        return "✅ <b>No active SSH threats</b>"
    lines = ["🛡 <b>SSH Threats</b>", ""]
    for t in threats[:10]:
        flag    = t.get("flag", "🌐")
        ip      = t.get("ip", "?")
        country = t.get("country", "")
        count   = t.get("count", 0)
        banned  = " 🔒" if t.get("banned") else ""
        perm    = " 🚫" if t.get("perm_blocked") else ""
        lines.append(f"{flag} <code>{ip}</code>  {country}  · {count} hits{banned}{perm}")
    if len(threats) > 10:
        lines.append(f"\n…and {len(threats) - 10} more")
    return "\n".join(lines)


def tg_fmt_keys(access: dict) -> str:
    """Format /keys reply. Expects the full parse_access() result dict."""
    all_names = access.get("users", [])
    active    = access.get("active", [])   # list of dicts with email/status/ips
    stats     = access.get("stats", {})

    total  = len(all_names)
    if total == 0:
        return "ℹ️ No VPN keys found."

    online = sum(1 for u in active if u.get("status") == "online")
    recent = sum(1 for u in active if u.get("status") == "recent")
    conns  = stats.get("conns_24h", 0)

    # Build status map for quick lookup
    status_map = {u.get("email", ""): u.get("status", "") for u in active}

    lines = [
        "🔑 <b>VPN Keys</b>",
        "",
        f"Total: <b>{total}</b>  ·  Online: <b>{online}</b>  ·  Recent: <b>{recent}</b>",
        f"Connections (24h): <b>{conns}</b>",
        "",
        "<b>Active users</b>",
    ]
    shown = 0
    for u in active[:8]:
        name = u.get("email", "?")
        st   = {"online": "🟢", "recent": "🟡"}.get(u.get("status", ""), "⚫")
        ips  = len(u.get("ips", []))
        ip_s = f"  {ips} IP{'s' if ips != 1 else ''}" if ips else ""
        lines.append(f"  {st} <code>{name}</code>{ip_s}")
        shown += 1
    if total > shown:
        offline = total - shown
        lines.append(f"  ⚫ …{offline} offline")
    return "\n".join(lines)


# ── Gateway data model ────────────────────────────────────────────────────────

GATEWAYS_FILE = os.path.join(STATE_DIR, "gateways.json")

def load_gateways() -> dict:
    """Return {'gateways': [...], 'user_assignments': {...}}."""
    try:
        with open(GATEWAYS_FILE) as f:
            return json.load(f)
    except FileNotFoundError:
        return {"gateways": [], "user_assignments": {}}
    except Exception as e:
        logger.warning("load_gateways error: %s", e)
        return {"gateways": [], "user_assignments": {}}

def save_gateways(data: dict) -> None:
    _atomic_write(GATEWAYS_FILE, data)

def build_xray_outbound(gw: dict) -> dict:
    """Build Xray outbound config dict from a gateway record."""
    proto = gw.get("protocol", "socks5")
    tag   = gw["tag"]
    addr  = gw["address"]
    port  = int(gw["port"])

    if proto == "socks5":
        server: dict = {"address": addr, "port": port}
        if gw.get("auth_user"):
            server["users"] = [{"user": gw["auth_user"], "pass": gw.get("auth_pass", "")}]
        return {"tag": tag, "protocol": "socks", "settings": {"servers": [server]}}

    if proto == "shadowsocks":
        return {
            "tag": tag,
            "protocol": "shadowsocks",
            "settings": {"servers": [{"address": addr, "port": port,
                "method": gw.get("ss_method", "chacha20-ietf-poly1305"),
                "password": gw.get("auth_pass", "")}]},
        }

    raise ValueError(f"Unsupported gateway protocol: {proto}")

# ─────────────────────────────────────────────────────────────────────────────

def tg_fmt_restart(result: dict) -> str:
    if result.get("ok") and result.get("healthy"):
        backup = result.get("backup", "")
        return f"✅ <b>Xray restarted</b> — healthy\n<code>{backup}</code>"
    elif result.get("rolled_back"):
        return "⚠️ <b>Restart failed</b> — health check did not pass. Rolled back to previous config."
    else:
        reason = result.get("reason", "Unknown error")
        return f"❌ <b>Restart aborted</b>\n{reason}"
