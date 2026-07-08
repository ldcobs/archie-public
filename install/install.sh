#!/usr/bin/env bash
# =============================================================================
#  install.sh — Archie VPN installer
#
#  Single entry point. Parses flags, runs read-only detection, fills crypto
#  material, then calls the Python generators to emit a staging tree.
#
#  By default this is non-mutating: it writes only to --staging (default
#  .staging/archie-<mode>). Real system mutation (apt/docker/ufw/systemd/
#  certbot) is gated behind --apply.
#
#  See: install/README.md
# =============================================================================

set -Eeuo pipefail
shopt -s inherit_errexit 2>/dev/null || true

INSTALL_DIR_DEFAULT="/opt/archie"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/lib"

# ── state ──
MODE=""
DOMAIN=""
BRAND="Archie VPN"
SERVER_IP_FLAG=""
INSECURE_IP=0
REALITY_PBK=""
REALITY_PVK=""
REALITY_SID=""
REALITY_SNI=""
AUTH_SECRET=""
API_TOKEN=""
TG_TOKEN=""
TG_CHAT_ID=""
ABUSEIPDB_KEY=""
SMTP_HOST=""
SMTP_PORT=""
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM=""
SMTP_SECURE=""
NO_SMTP=0
CF_ORIGIN_CERT=""
CF_ORIGIN_KEY=""
WG_PRIVATE=""
WG_PUBLIC=""
EXTRA_PROTOCOLS=""
DASHBOARD_BASIC_AUTH=0
NO_FAIL2BAN=0
NO_FIREWALL=0
INSTALL_DIR="$INSTALL_DIR_DEFAULT"
STAGING_DIR=""
UPGRADE=0
ASSUME_YES=0
DRY_RUN=1          # ON by default; --apply turns mutation on (still stubbed here)
APPLY=0
VERBOSE=0

# ── colors / logging ──
if [[ -t 1 ]]; then
    C_BLUE=$'\033[1;34m'; C_GREEN=$'\033[1;32m'; C_YELLOW=$'\033[1;33m'
    C_RED=$'\033[1;31m'; C_BOLD=$'\033[1m'; C_RST=$'\033[0m'
else
    C_BLUE=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_BOLD=""; C_RST=""
fi
log()  { printf '%s[*]%s %s\n' "$C_BLUE" "$C_RST" "$*" >&2; }
oklog(){ printf '%s[+]%s %s\n' "$C_GREEN" "$C_RST" "$*" >&2; }
warn() { printf '%s[!]%s %s\n' "$C_YELLOW" "$C_RST" "$*" >&2; }
err()  { printf '%s[x]%s %s\n' "$C_RED" "$C_RST" "$*" >&2; }
dbg()  { (( VERBOSE )) && printf '%s[.]%s %s\n' "$C_BLUE" "$C_RST" "$*" >&2 || true; }
die()  { err "$*"; exit 1; }

# ── usage ──
usage() {
    cat <<'EOF'
Archie installer — generate a mode-specific stack into a staging dir.

Usage: install.sh --mode=A|B|C [options]

Mode (required):
  --mode=A            No CDN: Reality + Hysteria2 + WireGuard (no domain/cert)
  --mode=B            Cloudflare-fronted (needs CF Origin cert + domain)
  --mode=C            Direct-TLS via Let's Encrypt (needs domain)

Identity:
  --server-ip=IP      Public IP clients dial (auto-detected if omitted)
  --insecure-ip       Accept an RFC1918 IP (NAT'd test VMs)
  --domain=HOST       Domain for TLS/CDN protocols (required for B, C)
  --brand="NAME"      Brand label (default "Archie VPN")

Reality (auto-generated if omitted; pvk+pbk must both be set or both empty):
  --reality-pbk=KEY   X25519 public key  (xray x25519)
  --reality-pvk=KEY   X25519 private key (paired)
  --reality-sid=HEX   Short ID           (openssl rand -hex 8)
  --reality-sni=HOST  Decoy SNI (default www.cloudflare.com)

Secrets (auto-generated if omitted):
  --auth-secret=STR   Session cookie HMAC (openssl rand -base64 32)
  --api-token=STR     VPN_API_V3_TOKEN   (openssl rand -hex 32)

WireGuard (auto-generated if omitted):
  --wg-private=KEY    wg genkey output
  --wg-public=KEY     wg pubkey output

Mode B (Cloudflare):
  --cf-origin-cert=PATH|PEM   CF Origin cert (path to file or inline PEM)
  --cf-origin-key=PATH|KEY    CF Origin key

Optional integrations:
  --tg-token=STR      Telegram bot token
  --tg-chat-id=STR    Telegram chat id
  --abuseipdb=KEY     AbuseIPDB API key

Invite email / SMTP (optional; host+from makes it sendable):
  --smtp-host=HOST    SMTP server hostname
  --smtp-port=N       SMTP port (blank → 587)
  --smtp-secure=BOOL  true = implicit TLS (465); false = STARTTLS (587)
  --smtp-user=STR     SMTP username (omit for unauthenticated relays)
  --smtp-pass=STR     SMTP password / app password
  --smtp-from=STR     From header, e.g. "My VPN <invites@example.com>"
  --no-smtp           Skip SMTP even if values are supplied

Behavior:
  --extra-protocols=LIST   Comma list: xhttp,httpupgrade,mkcp (default none)
  --dashboard-basic-auth   Enable nginx auth_basic on the dashboard
  --no-firewall            Skip UFW rule planning
  --no-fail2ban            Skip fail2ban planning
  --upgrade                Upgrade an existing install (backup + in-place)

Output:
  --staging=DIR       Where generators write (default .staging/archie-<mode>)
  --install-dir=DIR   Target install path used inside staging (default /opt/archie)

Execution:
  --apply             Actually mutate the host
  --yes / -y          Skip confirmation prompts
  --dry-run           Force dry-run even with --apply (default ON)
  --verbose / -v      Debug logging
  --help / -h         This message

By default this script writes ONLY to --staging and changes nothing on the host.
EOF
}

# ── arg parsing ──
while (($#)); do
    case "$1" in
        --mode=*)            MODE="${1#*=}";;
        --domain=*)          DOMAIN="${1#*=}";;
        --brand=*)           BRAND="${1#*=}";;
        --server-ip=*)       SERVER_IP_FLAG="${1#*=}";;
        --insecure-ip)       INSECURE_IP=1;;
        --reality-pbk=*)     REALITY_PBK="${1#*=}";;
        --reality-pvk=*)     REALITY_PVK="${1#*=}";;
        --reality-sid=*)     REALITY_SID="${1#*=}";;
        --reality-sni=*)     REALITY_SNI="${1#*=}";;
        --auth-secret=*)     AUTH_SECRET="${1#*=}";;
        --api-token=*)       API_TOKEN="${1#*=}";;
        --wg-private=*)      WG_PRIVATE="${1#*=}";;
        --wg-public=*)       WG_PUBLIC="${1#*=}";;
        --cf-origin-cert=*)  CF_ORIGIN_CERT="${1#*=}";;
        --cf-origin-key=*)   CF_ORIGIN_KEY="${1#*=}";;
        --tg-token=*)        TG_TOKEN="${1#*=}";;
        --tg-chat-id=*)      TG_CHAT_ID="${1#*=}";;
        --abuseipdb=*)       ABUSEIPDB_KEY="${1#*=}";;
        --smtp-host=*)       SMTP_HOST="${1#*=}";;
        --smtp-port=*)       SMTP_PORT="${1#*=}";;
        --smtp-user=*)       SMTP_USER="${1#*=}";;
        --smtp-pass=*)       SMTP_PASS="${1#*=}";;
        --smtp-from=*)       SMTP_FROM="${1#*=}";;
        --smtp-secure=*)     SMTP_SECURE="${1#*=}";;
        --no-smtp)           NO_SMTP=1;;
        --extra-protocols=*) EXTRA_PROTOCOLS="${1#*=}";;
        --dashboard-basic-auth) DASHBOARD_BASIC_AUTH=1;;
        --no-firewall)       NO_FIREWALL=1;;
        --no-fail2ban)       NO_FAIL2BAN=1;;
        --upgrade)           UPGRADE=1;;
        --staging=*)         STAGING_DIR="${1#*=}";;
        --install-dir=*)     INSTALL_DIR="${1#*=}";;
        --apply)             APPLY=1; DRY_RUN=0;;
        --yes|-y)            ASSUME_YES=1;;
        --dry-run)           DRY_RUN=1;;
        --verbose|-v)        VERBOSE=1;;
        --help|-h)           usage; exit 0;;
        --) shift; break;;
        -*) err "unknown flag: $1"; usage; exit 2;;
        *)  err "unexpected argument: $1"; usage; exit 2;;
    esac
    shift
done

# ── validate basics ──
[[ -n "$MODE" ]] || { usage; die "missing --mode="; }
case "$MODE" in
    A|B|C) :;;
    *) die "invalid --mode='$MODE' (expected A, B, or C)";;
esac
[[ "$MODE" == "A" || -n "$DOMAIN" ]] || die "mode $MODE requires --domain="
if [[ "$MODE" == "B" && -z "$CF_ORIGIN_CERT" ]]; then
    die "mode B requires --cf-origin-cert= (path to PEM or inline cert)"
fi
# Reality keyset must be paired or fully empty.
if [[ -n "$REALITY_PBK" && -z "$REALITY_PVK" ]] || [[ -z "$REALITY_PBK" && -n "$REALITY_PVK" ]]; then
    die "--reality-pbk and --reality-pvk must be both set or both empty"
fi
# WG keyset likewise.
if [[ -n "$WG_PRIVATE" && -z "$WG_PUBLIC" ]] || [[ -z "$WG_PRIVATE" && -n "$WG_PUBLIC" ]]; then
    die "--wg-private and --wg-public must be both set or both empty"
fi
[[ -n "$STAGING_DIR" ]] || STAGING_DIR="$SCRIPT_DIR/.staging/archie-$MODE"

# Resolve CF Origin cert/key: if the flag is a readable file path, load its PEM.
load_pem() {
    local val="$1"
    [[ -z "$val" ]] && { printf '%s' "$val"; return; }
    if [[ -f "$val" ]]; then
        cat "$val"
    else
        printf '%s' "$val"   # assume inline PEM
    fi
}
CF_ORIGIN_CERT_PEM="$(load_pem "$CF_ORIGIN_CERT")"
CF_ORIGIN_KEY_PEM="$(load_pem "$CF_ORIGIN_KEY")"

[[ -n "$REALITY_SNI" ]] || REALITY_SNI="www.cloudflare.com"

# ── runtime deps ──
command -v python3 >/dev/null || die "python3 is required (host-side, for config generation)"
PY="python3"

# ── banner ──
echo "${C_BOLD}Archie installer${C_RST} — mode ${C_GREEN}$MODE${C_RST}" >&2
if (( ! APPLY )); then
    warn "GENERATE mode: writing only to staging, no host changes"
elif (( DRY_RUN )); then
    warn "APPLY --dry-run: will print the host mutation plan, run nothing"
else
    warn "APPLY mode: will mutate this host (packages, docker, ufw, systemd)"
fi
dbg "staging_dir=$STAGING_DIR install_dir=$INSTALL_DIR"

# ── confirm before apply ──
if (( APPLY )) && (( ! ASSUME_YES )); then
    if (( UPGRADE )); then
        warn "upgrade mode: existing config will be backed up before overwrite"
    fi
    read -r -p "Proceed with apply? [y/N] " ans
    [[ "$ans" == "y" || "$ans" == "Y" ]] || die "aborted"
fi

# =============================================================================
#  Hand off to Python: detect → fill crypto → assemble staging tree.
#  Parsed shell values are exported as ARCHIE_* env vars for the Python driver.
# =============================================================================
export ARCHIE_MODE="$MODE"
export ARCHIE_DOMAIN="$DOMAIN"
export ARCHIE_BRAND="$BRAND"
export ARCHIE_SERVER_IP="$SERVER_IP_FLAG"
export ARCHIE_INSECURE_IP="$INSECURE_IP"
export ARCHIE_REALITY_PBK="$REALITY_PBK"
export ARCHIE_REALITY_PVK="$REALITY_PVK"
export ARCHIE_REALITY_SID="$REALITY_SID"
export ARCHIE_REALITY_SNI="$REALITY_SNI"
export ARCHIE_AUTH_SECRET="$AUTH_SECRET"
export ARCHIE_API_TOKEN="$API_TOKEN"
export ARCHIE_WG_PRIVATE="$WG_PRIVATE"
export ARCHIE_WG_PUBLIC="$WG_PUBLIC"
export ARCHIE_TG_TOKEN="$TG_TOKEN"
export ARCHIE_TG_CHAT_ID="$TG_CHAT_ID"
export ARCHIE_ABUSEIPDB="$ABUSEIPDB_KEY"
export ARCHIE_SMTP_HOST="$SMTP_HOST"
export ARCHIE_SMTP_PORT="$SMTP_PORT"
export ARCHIE_SMTP_USER="$SMTP_USER"
export ARCHIE_SMTP_PASS="$SMTP_PASS"
export ARCHIE_SMTP_FROM="$SMTP_FROM"
export ARCHIE_SMTP_SECURE="$SMTP_SECURE"
export ARCHIE_NO_SMTP="$NO_SMTP"
export ARCHIE_CF_CERT="$CF_ORIGIN_CERT_PEM"
export ARCHIE_CF_KEY="$CF_ORIGIN_KEY_PEM"
export ARCHIE_EXTRA="$EXTRA_PROTOCOLS"
export ARCHIE_BASIC_AUTH="$DASHBOARD_BASIC_AUTH"
export ARCHIE_NO_FAIL2BAN="$NO_FAIL2BAN"
export ARCHIE_NO_FIREWALL="$NO_FIREWALL"
# Option B (pre-built images) — bootstrap.sh exports this; default 0 keeps the
# source-build path. Passed through explicitly so the driver's env is all here.
export ARCHIE_PREBUILT="${ARCHIE_PREBUILT:-0}"
export ARCHIE_INSTALL_DIR_TARGET="$INSTALL_DIR"
export ARCHIE_STAGING="$STAGING_DIR"
export ARCHIE_INSTALL_DIR="$SCRIPT_DIR"   # so the python driver finds lib/
export ARCHIE_VERBOSE="$VERBOSE"
export ARCHIE_APPLY="$APPLY"
export ARCHIE_DRY_RUN="$DRY_RUN"

"$PY" "$LIB_DIR/_driver.py" || exit $?
