#!/usr/bin/env python3
"""
VPN API Extensions - AbuseIPDB, server health, sessions, permanent blocks, new IP detection
Imported by vpn-api.py
"""
import os, json, re, time, urllib.request, datetime, threading
from collections import defaultdict

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
SESSION_GAP    = 300   # seconds gap = new session
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

# ── AbuseIPDB reputation ───────────────────────────────────────────────────────

def check_reputation(ips):
    """Look up AbuseIPDB for a list of IPs. Returns {ip: score_data} dict."""
    if not ABUSEIPDB_KEY or not ips:
        return {}
    results = {}
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
                # Extract unique attack categories from reports
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
        except Exception:
            with _abuse_lock:
                _abuse_cache[ip] = None  # mark as attempted
    with _abuse_lock:
        for ip in ips:
            if ip in _abuse_cache:
                results[ip] = _abuse_cache[ip]
    return results

def reputation(ip):
    with _abuse_lock:
        return _abuse_cache.get(ip)

# ── Server health ──────────────────────────────────────────────────────────────

def get_server_health():
    health = {}

    # Uptime
    try:
        uptime_s = float(open("/proc/uptime").read().split()[0])
        d, rem = divmod(int(uptime_s), 86400)
        h, rem = divmod(rem, 3600)
        m = rem // 60
        health["uptime"] = f"{d}d {h}h {m}m" if d else f"{h}h {m}m"
        health["uptime_seconds"] = int(uptime_s)
    except Exception:
        health["uptime"] = "unknown"

    # Load average
    try:
        parts = open("/proc/loadavg").read().split()
        health["load_1"]  = float(parts[0])
        health["load_5"]  = float(parts[1])
        health["load_15"] = float(parts[2])
    except Exception:
        health["load_1"] = health["load_5"] = health["load_15"] = 0.0

    # Memory
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
    except Exception:
        health["mem_total_mb"] = health["mem_used_mb"] = health["mem_pct"] = 0

    # Disk (root filesystem)
    try:
        import os as _os
        s = _os.statvfs("/")
        total = s.f_blocks * s.f_frsize
        free  = s.f_bfree  * s.f_frsize
        used  = total - free
        health["disk_total_gb"] = round(total / 1e9, 1)
        health["disk_used_gb"]  = round(used  / 1e9, 1)
        health["disk_pct"]      = round(used / total * 100) if total else 0
    except Exception:
        health["disk_total_gb"] = health["disk_used_gb"] = health["disk_pct"] = 0

    # Xray process
    try:
        import subprocess
        r = subprocess.run(["pgrep", "-x", "xray"], capture_output=True, text=True)
        health["xray_running"] = r.returncode == 0
    except Exception:
        health["xray_running"] = None  # can't check from container

    return health

# ── Session grouping ───────────────────────────────────────────────────────────

def parse_sessions_for_user(log_entries):
    """
    log_entries: list of (ts: datetime, ip: str, dest: str)
    Returns list of session dicts sorted newest first.
    """
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
    for s in reversed(sessions[-10:]):  # last 10 sessions, newest first
        dur_min = max(1, int((s["end"] - s["start"]).total_seconds() / 60))
        result.append({
            "start":    s["start"].isoformat(),
            "end":      s["end"].isoformat(),
            "ips":      list(s["ips"]),
            "conns":    s["conns"],
            "dur_min":  dur_min,
        })
    return result

# ── Known IPs / new device detection ──────────────────────────────────────────

def load_known_ips():
    try:
        with _known_lock:
            if os.path.exists(KNOWN_IPS_FILE):
                return json.load(open(KNOWN_IPS_FILE))
    except Exception:
        pass
    return {}

def save_known_ips(data):
    try:
        with _known_lock:
            json.dump(data, open(KNOWN_IPS_FILE, "w"))
    except Exception:
        pass

def update_and_check_known_ips(user, current_ips):
    """
    Returns (known_ips: set, new_ips: set)
    Updates the known IPs file with any new IPs seen.
    """
    db = load_known_ips()
    known = set(db.get(user, []))
    current = set(current_ips)
    new_ips = current - known
    if new_ips:
        db[user] = list(known | current)
        save_known_ips(db)
    return known, new_ips


# ── Registered-device approval / enforcement ──────────────────────────────────

def _now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def load_device_db():
    try:
        with _device_lock:
            if os.path.exists(DEVICE_FILE):
                data = json.load(open(DEVICE_FILE))
                if isinstance(data, dict):
                    data.setdefault("users", {})
                    return data
    except Exception:
        pass
    return {"users": {}}

def save_device_db(data):
    try:
        with _device_lock:
            json.dump(data, open(DEVICE_FILE, "w"), indent=2)
        return True
    except Exception:
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
    """
    Monitor-only device policy: track which IPs each user connects from,
    auto-register up to the limit, and flag extras as pending.
    Does NOT auto-block — blocking is done manually via the dashboard.
    """
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
        # Track as pending — monitor only, no auto-block
        _touch_ip(policy["pending"], ip, now)
        changed = True

    if changed and not dry_run:
        save_device_db(db)

    pending_now = [ip for ip in policy["pending"] if ip in current]
    rejected_now = [ip for ip in policy["rejected"] if ip in current]
    return {
        "enabled": bool(policy.get("enabled", True)),
        "limit": limit,
        "approved": sorted(policy["approved"].keys()),
        "pending": sorted(policy["pending"].keys()),
        "rejected": sorted(policy["rejected"].keys()),
        "pending_now": sorted(pending_now),
        "rejected_now": sorted(rejected_now),
        "approved_count": len(policy["approved"]),
        "pending_count": len(policy["pending"]),
        "rejected_count": len(policy["rejected"]),
        "warning": bool(pending_now or rejected_now),
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
    approved[ip] = {"first_seen": approved.get(ip, {}).get("first_seen", now), "last_seen": now, "source": "manual_approval"}
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
    item["last_seen"] = now
    item["blocked"] = True
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
    policy["pending"] = {}
    policy["rejected"] = {}
    if not save_device_db(db):
        return None, "Could not reset devices"
    for ip in sorted(blocked):
        write_firewall_command("unblock", ip, scope="device", user=user)
    return {"reset": user, "unblock_queued": sorted(blocked)}, None

def mock_device_policy(user, ips_24h):
    pending = ["203.0.113.44"] if user == "demo" else []
    approved = list(ips_24h[:2]) or (["198.51.100.10"] if pending else [])
    return {
        "enabled": True,
        "limit": DEVICE_LIMIT,
        "approved": approved,
        "pending": pending,
        "rejected": [],
        "pending_now": pending,
        "rejected_now": [],
        "approved_count": len(approved),
        "pending_count": len(pending),
        "rejected_count": 0,
        "warning": bool(pending),
        "mock": bool(pending),
    }

# ── Permanent blocks ───────────────────────────────────────────────────────────

def get_permanent_blocks():
    try:
        d = json.load(open(BLOCKS_FILE))
        return set(d.get("ips", []))
    except Exception:
        return set()

def write_firewall_command(action, ip, scope="permanent", user=""):
    """Queue a firewall command for the host cron to execute."""
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
            except Exception:
                queued = []
        queued.append(cmd)
        json.dump({"commands": queued}, open(PENDING_FW, "w"), indent=2)
        return True
    except Exception:
        return False
