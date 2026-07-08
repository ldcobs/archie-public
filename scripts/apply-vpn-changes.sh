#!/bin/bash
# The installer rewrites the __ARCHIE_DATA__ placeholder to this install's data
# directory when it stages this script. Do not run this copy directly.
PENDING_VPN="__ARCHIE_DATA__/vpn-api/pending_config.json"
PENDING_VPN_V3="__ARCHIE_DATA__/vpn-api-v3/pending_config.json"
PENDING_FW="__ARCHIE_DATA__/vpn-api/pending_firewall.json"
PENDING_FW_V3="__ARCHIE_DATA__/vpn-api-v3/pending_firewall.json"
LOG="/var/log/vpn-changes.log"

# Ignore legacy v2 config restart requests — v3 is the only allowed Xray restart queue.
if [ -f "$PENDING_VPN" ]; then
    echo "$(date -u +'%Y-%m-%d %H:%M:%S UTC'): Ignored legacy v2 pending config request" >> "$LOG"
    rm -f "$PENDING_VPN"
fi

# Apply v3 VPN config changes.
if [ -f "$PENDING_VPN_V3" ]; then
    REQUEST=$(python3 -c 'import sys; print(sys.stdin.read().replace(chr(10), " ").strip())' < "$PENDING_VPN_V3" 2>/dev/null)
    rm -f "$PENDING_VPN_V3"
    if /usr/local/bin/xray run -test -config /usr/local/etc/xray/config.json >> "$LOG" 2>&1; then
        systemctl restart xray
        echo "$(date -u +'%Y-%m-%d %H:%M:%S UTC'): Restarted xray after v3 config change${REQUEST:+ | $REQUEST}" >> "$LOG"
    else
        echo "$(date -u +'%Y-%m-%d %H:%M:%S UTC'): REFUSED xray restart — config validation failed${REQUEST:+ | $REQUEST}" >> "$LOG"
        if [ -f /usr/local/etc/xray/config.json.bak ]; then
            cp /usr/local/etc/xray/config.json.bak /usr/local/etc/xray/config.json
            echo "$(date -u +'%Y-%m-%d %H:%M:%S UTC'): Restored config from backup" >> "$LOG"
        fi
    fi
fi

# Apply firewall commands (v2 and v3 queues)
if [ -f "$PENDING_FW" ] || [ -f "$PENDING_FW_V3" ]; then
    python3 - << 'PYTHON'
import json, subprocess, os, sys
from datetime import datetime, timezone

QUEUES = [
    ("__ARCHIE_DATA__/vpn-api/pending_firewall.json",
     "__ARCHIE_DATA__/vpn-api/permanent_blocks.json",
     "__ARCHIE_DATA__/vpn-api/device_blocks.json"),
    ("__ARCHIE_DATA__/vpn-api-v3/pending_firewall.json",
     "__ARCHIE_DATA__/vpn-api-v3/permanent_blocks.json",
     "__ARCHIE_DATA__/vpn-api-v3/device_blocks.json"),
]
LOG="/var/log/vpn-changes.log"

def log(msg):
    ts=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    open(LOG,"a").write(f"{ts}: {msg}\n")

for PENDING, BLOCKS, DEVICE_BLOCKS in QUEUES:
    if not os.path.exists(PENDING):
        continue
    try:
        raw=json.load(open(PENDING))
        commands=raw.get("commands") if isinstance(raw,dict) and isinstance(raw.get("commands"),list) else [raw]
        blocks=json.load(open(BLOCKS)) if os.path.exists(BLOCKS) else {"ips":[]}
        device_blocks=json.load(open(DEVICE_BLOCKS)) if os.path.exists(DEVICE_BLOCKS) else {"ips":[]}
        for cmd in commands:
            ip=cmd.get("ip","").strip(); action=cmd.get("action",""); scope=cmd.get("scope","permanent")
            if not ip or action not in ("block","unblock"): continue
            if action=="block":
                subprocess.run(["ufw","deny","from",ip,"to","any"],capture_output=True,text=True)
                if scope=="device":
                    if ip not in device_blocks["ips"]: device_blocks["ips"].append(ip)
                    log(f"Device-policy blocked {ip} for {cmd.get('user','unknown')}")
                else:
                    if ip not in blocks["ips"]: blocks["ips"].append(ip)
                    log(f"Permanently blocked {ip}")
            elif action=="unblock":
                if scope=="device":
                    device_blocks["ips"]=[x for x in device_blocks["ips"] if x!=ip]
                    if ip not in blocks.get("ips",[]) and ip not in device_blocks.get("ips",[]):
                        subprocess.run(["ufw","delete","deny","from",ip,"to","any"],capture_output=True,text=True)
                    log(f"Device-policy unblocked {ip} for {cmd.get('user','unknown')}")
                else:
                    blocks["ips"]=[x for x in blocks["ips"] if x!=ip]
                    if ip not in device_blocks.get("ips",[]):
                        subprocess.run(["ufw","delete","deny","from",ip,"to","any"],capture_output=True,text=True)
                    log(f"Unblocked {ip}")
        json.dump(blocks,open(BLOCKS,"w"))
        json.dump(device_blocks,open(DEVICE_BLOCKS,"w"))
        os.remove(PENDING)
    except Exception as e:
        log(f"Firewall error ({PENDING}): {e}")
PYTHON
fi
