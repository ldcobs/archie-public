#!/usr/bin/env bash
# =============================================================================
#  install/teardown.sh — reset a THROWAWAY test host back to a clean state so
#  the installer can be validated from scratch (no half-installed leftovers that
#  make the plan's idempotency checks report false "already installed").
#
#  Removes ONLY Archie's footprint as created by install/lib/apply.py:
#    - docker stack (vpn-api-v3, vpn-dashboard-v3, nginx, certbot) + ailab net
#    - host services (xray, hysteria-server, wg-quick@wg0, traffic-poller,
#      apply-changes) + their unit files
#    - host configs/binaries (xray, hysteria, wireguard, sysctl, /var/log/xray)
#    - the install dir (/opt/archie)
#    - UFW rules (resets the firewall, keeps SSH)
#  By DEFAULT it keeps the Docker engine + base apt packages (legitimate deps,
#  slow+pointless to reinstall each run). Flags below purge those too.
#
#  !!! NEVER run this on the production VPS. It is for throwaway test hosts only.
#      Guard: refuses if a /etc/archie-production marker exists or the hostname
#      looks like prod, and always requires --yes.
#
#  Usage (on the test host, as root):
#    sudo bash install/teardown.sh --yes            # standard reset
#    sudo bash install/teardown.sh --dry-run        # show what it would do
#    sudo bash install/teardown.sh --yes --purge-docker --purge-packages  # bare
# =============================================================================

set -Eeuo pipefail

YES=0; DRY=0; PURGE_DOCKER=0; PURGE_PACKAGES=0; PURGE_CERTS=0
for a in "$@"; do case "$a" in
  --yes|-y) YES=1 ;;
  --dry-run|-n) DRY=1 ;;
  --purge-docker) PURGE_DOCKER=1 ;;
  --purge-packages) PURGE_PACKAGES=1 ;;
  --purge-certs) PURGE_CERTS=1 ;;
  *) echo "unknown arg: $a" >&2; exit 2 ;;
esac; done

c_ok(){ printf '\033[1;32m[+]\033[0m %s\n' "$*"; }
c_in(){ printf '\033[1;34m[*]\033[0m %s\n' "$*"; }
c_no(){ printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; }
die(){ c_no "$*"; exit 1; }

# run a command, or just print it under --dry-run; never abort on cleanup errors
do_(){ if [[ "$DRY" == 1 ]]; then printf '    would run: %s\n' "$*"; else eval "$*" >/dev/null 2>&1 || true; fi; }

[[ "$(id -u)" == 0 ]] || die "must run as root (sudo)"

# ── prod safety ──────────────────────────────────────────────────────────────
if [[ -f /etc/archie-production ]]; then
  die "this host is marked PRODUCTION (/etc/archie-production) — refusing. Teardown is for throwaway test hosts only."
fi
if [[ "$DRY" != 1 && "$YES" != 1 ]]; then
  die "destructive. Re-run with --yes (or --dry-run to preview). Host: $HN"
fi
SFX=""; [[ "$DRY" == 1 ]] && SFX="  (dry-run)"
c_in "tearing down Archie on: ${HN:-unknown host}$SFX"

# ── 0. stop a running wizard, if any ─────────────────────────────────────────
PIDF=/opt/archie/.install/wizard.pid
[[ -f "$PIDF" ]] && do_ "kill \$(cat $PIDF)"

# ── 1. docker stack ──────────────────────────────────────────────────────────
if command -v docker >/dev/null 2>&1; then
  if [[ -d /opt/archie ]]; then
    do_ "cd /opt/archie && docker compose -f docker-compose.vpn.yml -f docker-compose.modeA.yml down --remove-orphans"
  fi
  do_ "docker rm -f vpn-api-v3 vpn-dashboard-v3 nginx certbot vpn-api vpn-dashboard"
  do_ "docker network rm ailab"
  c_ok "docker stack removed"
fi

# ── 2. host services + unit files ────────────────────────────────────────────
UNITS="xray.service hysteria-server.service wg-quick@wg0.service fail2ban.service \
archie-traffic-poller.timer archie-traffic-poller.service archie-apply-changes.service"
do_ "systemctl disable --now $UNITS"
do_ "rm -f /etc/systemd/system/xray.service /etc/systemd/system/hysteria-server.service \
/etc/systemd/system/archie-traffic-poller.service /etc/systemd/system/archie-traffic-poller.timer \
/etc/systemd/system/archie-apply-changes.service"
do_ "rm -f /etc/wireguard/wg0.conf"          # wg-quick@wg0 unit is package-provided
do_ "systemctl daemon-reload"
c_ok "host services stopped + unit files removed"

# ── 3. host configs / binaries / logs ────────────────────────────────────────
do_ "rm -rf /usr/local/etc/xray /usr/local/share/xray /usr/local/bin/xray"
do_ "rm -f  /usr/local/bin/hysteria"
do_ "rm -rf /etc/hysteria /var/log/xray"
do_ "rm -f  /etc/wireguard/clients.json /etc/sysctl.d/99-archie.conf"
[[ "$PURGE_CERTS" == 1 ]] && do_ "rm -rf /etc/letsencrypt /etc/ssl/cloudflare-origin.pem /etc/ssl/cloudflare-origin.key"
c_ok "host configs + protocol binaries removed"

# ── 4. install dir ───────────────────────────────────────────────────────────
do_ "rm -rf /opt/archie"
c_ok "/opt/archie removed"

# ── 5. firewall ──────────────────────────────────────────────────────────────
if command -v ufw >/dev/null 2>&1; then
  do_ "ufw --force reset"
  do_ "ufw allow 22/tcp"           # never lock ourselves out
  do_ "ufw --force disable"        # leave it off; the next install re-enables it
  c_ok "UFW reset (SSH preserved, firewall left disabled)"
fi

# ── 6. optional deep purge ───────────────────────────────────────────────────
if [[ "$PURGE_DOCKER" == 1 ]] && command -v apt-get >/dev/null 2>&1; then
  do_ "apt-get remove -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"
  do_ "rm -rf /var/lib/docker /var/lib/containerd"
  c_ok "docker engine purged"
fi
if [[ "$PURGE_PACKAGES" == 1 ]] && command -v apt-get >/dev/null 2>&1; then
  do_ "apt-get remove -y wireguard wireguard-tools fail2ban"
  c_ok "base VPN packages purged"
fi

echo ""
if [[ "$DRY" == 1 ]]; then c_ok "dry-run complete — nothing changed. Re-run with --yes to apply.";
else c_ok "teardown complete. Host is ready for a fresh install."; fi
[[ "$PURGE_DOCKER" != 1 ]] && c_in "kept: Docker engine + base apt packages (use --purge-docker / --purge-packages for a bare host)"
