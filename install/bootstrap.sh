#!/usr/bin/env bash
# =============================================================================
#  install/bootstrap.sh — the one-line entrypoint for installing Archie.
#
#  It downloads a *version-pinned, checksum-verified* package from GitHub
#  Releases, extracts it to /opt/archie, and launches the web setup wizard.
#  Nothing on the host is installed/configured by this script — the wizard does
#  that, after you confirm at its Review step.
#
#  Published one-liner (PUBLIC — no token, anonymous download):
#     curl -fsSL https://raw.githubusercontent.com/ldcobs/archie/main/install/bootstrap.sh | sudo bash
#  It pulls the version-pinned release tarball from the repo's PUBLIC GitHub
#  Releases (anonymous). A private-repo fallback ('github', needs a token) exists
#  for private mirrors but is NOT needed for the public install.
#
#  The wizard can be reached two ways — you're asked to choose interactively
#  (unless ARCHIE_PUBLIC is preset, e.g. for scripted/CI installs):
#    1) SSH tunnel (default/recommended): wizard binds 127.0.0.1 only. Needs
#       an SSH key/credentials to this server, but nothing is ever exposed
#       to the internet.
#    2) Temporary public URL: wizard binds 0.0.0.0, gated by a one-time
#       random token in the URL. No SSH needed — just open a browser. Risk:
#       the wizard (and the token) are reachable by anyone who gets the URL
#       for as long as it stays running; the token can leak via shell
#       history, logs, or screen-sharing. Stop it (printed command) as soon
#       as setup finishes.
#
#  Env overrides:
#    ARCHIE_VERSION     package version / release tag        (default 0.1.5)
#    ARCHIE_SOURCE      where to fetch the package from:     (default public)
#                         public → public GitHub Releases download (no token)
#                         github → private repo release asset (uses ARCHIE_GH_TOKEN)
#    ARCHIE_GH_TOKEN    GitHub token for the 'github' source (required there)
#    ARCHIE_REPO        GitHub owner/repo to fetch from       (default ldcobs/archie)
#    ARCHIE_TGZ         use this LOCAL .tgz, skip download    (dev / offline / air-gap)
#    ARCHIE_PREBUILT=1  Option B: install pulls pre-built images (no on-box build)
#    ARCHIE_INSTALL_DIR install location                      (default /opt/archie)
#    ARCHIE_PORT        wizard port                           (default 8899)
#    ARCHIE_PUBLIC=1    skip the prompt: bind 0.0.0.0 + require token
#    ARCHIE_PUBLIC=0    skip the prompt: bind 127.0.0.1 (tunnel-only)
#    ARCHIE_NO_LAUNCH=1 extract only; don't start the wizard
#    ARCHIE_SKIP_ROOT=1 skip the root check                   (testing only)
#
#  The default 'public' source downloads anonymously from the repo's public
#  GitHub Releases. The 'github' source is an opt-in private-repo fallback that
#  needs ARCHIE_GH_TOKEN.
# =============================================================================

set -Eeuo pipefail

VERSION="${ARCHIE_VERSION:-0.1.5}"
# Local tgz forces the local source regardless of ARCHIE_SOURCE (dev/offline).
SOURCE="${ARCHIE_SOURCE:-public}"
[[ -n "${ARCHIE_TGZ:-}" ]] && SOURCE="local"
REPO="${ARCHIE_REPO:-ldcobs/archie}"
INSTALL_DIR="${ARCHIE_INSTALL_DIR:-/opt/archie}"
PORT="${ARCHIE_PORT:-8899}"
NAME="archie-$VERSION"
STATE_DIR="$INSTALL_DIR/.install"

c_ok(){ printf '\033[1;32m[+]\033[0m %s\n' "$*"; }
c_in(){ printf '\033[1;34m[*]\033[0m %s\n' "$*"; }
c_no(){ printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; }
die(){ c_no "$*"; exit 1; }

# ── preflight: privileges + required tools ───────────────────────────────────
if [[ "${ARCHIE_SKIP_ROOT:-0}" != 1 && "$(id -u)" != 0 ]]; then
  die "must run as root (use: curl -fsSL …/bootstrap.sh | sudo bash)"
fi

need(){ command -v "$1" >/dev/null 2>&1 || die "missing required tool: $1"; }
need tar; need python3
if [[ -z "${ARCHIE_TGZ:-}" ]]; then need curl; fi

# pick a sha256 tool (Linux: sha256sum; macOS dev box: shasum -a 256)
if command -v sha256sum >/dev/null 2>&1; then
  sha256(){ sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
  sha256(){ shasum -a 256 "$1" | awk '{print $1}'; }
else
  die "missing required tool: sha256sum (or shasum)"
fi

# ── HTTP helpers for the token-gated sources ─────────────────────────────────
# _http_get GETs $1 into $2 using the headers in the _HDRS array and echoes the
# HTTP status code (000 on a network error). No -f, so a 4xx body is captured
# and the status is inspected by _http_check for a human-readable failure.
# curl -L strips the Authorization header on a cross-host redirect by default
# (since 7.58), so a Worker→R2 or GitHub→S3 presigned redirect works safely.
_HDRS=()
_http_get(){ # url outfile
  local url="$1" out="$2" code
  code="$(curl -sSL --connect-timeout 10 -o "$out" -w '%{http_code}' "${_HDRS[@]}" "$url" 2>/dev/null)" || code=000
  printf '%s' "$code"
}
_http_check(){ # code url source
  case "$1" in
    2??) return 0 ;;
    401|403) die "access denied (HTTP $1) from the '$3' source — for the 'github'
       source your ARCHIE_GH_TOKEN is missing, invalid, or expired. The default
       'public' source needs no token." ;;
    404) die "not found (HTTP $1): $2 — is version v$VERSION published on the '$3' source?" ;;
    000) die "network error contacting the '$3' source ($2)" ;;
    *)   die "unexpected HTTP $1 from the '$3' source ($2)" ;;
  esac
}

# ── 1. acquire the package + its checksum ────────────────────────────────────
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
TGZ="$WORK/$NAME.tgz"

case "$SOURCE" in
  local)
    [[ -f "$ARCHIE_TGZ" ]] || die "ARCHIE_TGZ not found: $ARCHIE_TGZ"
    c_in "using local package: $ARCHIE_TGZ"
    cp "$ARCHIE_TGZ" "$TGZ"
    if [[ -f "$ARCHIE_TGZ.sha256" ]]; then
      EXPECT="$(awk '{print $1}' "$ARCHIE_TGZ.sha256")"
    else
      c_in "no sibling .sha256 — computing checksum from the local file (self-consistent only)"
      EXPECT="$(sha256 "$TGZ")"
    fi
    ;;
  public)
    # Public GitHub Releases download — anonymous, no token. GitHub redirects
    # the asset URL to a signed objects host; curl -L follows it (and we send no
    # Authorization header, so nothing sensitive can leak across the redirect).
    PBASE="https://github.com/$REPO/releases/download/v$VERSION"
    c_in "downloading $NAME.tgz from public GitHub Releases ($REPO v$VERSION)"
    _HDRS=()
    _http_check "$(_http_get "$PBASE/$NAME.tgz"        "$TGZ")"        "$PBASE/$NAME.tgz"        public
    _http_check "$(_http_get "$PBASE/$NAME.tgz.sha256" "$TGZ.sha256")" "$PBASE/$NAME.tgz.sha256" public
    EXPECT="$(awk '{print $1}' "$TGZ.sha256")"
    ;;
  github)
    [[ -n "${ARCHIE_GH_TOKEN:-}" ]] || die "the 'github' source requires ARCHIE_GH_TOKEN (a fine-grained read-only 'contents' token for the private $REPO)."
    API="https://api.github.com/repos/$REPO/releases/tags/v$VERSION"
    META="$WORK/release.json"
    c_in "resolving release v$VERSION assets on $REPO (private)"
    _HDRS=(-H "Authorization: Bearer $ARCHIE_GH_TOKEN" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")
    _http_check "$(_http_get "$API" "$META")" "$API" github
    fetch_asset(){ # asset-name outfile
      local id
      id="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(next((a["id"] for a in d.get("assets",[]) if a["name"]==sys.argv[2]), ""))' "$META" "$1")"
      [[ -n "$id" ]] || die "release v$VERSION on $REPO has no asset named '$1'"
      _HDRS=(-H "Authorization: Bearer $ARCHIE_GH_TOKEN" -H "Accept: application/octet-stream")
      _http_check "$(_http_get "https://api.github.com/repos/$REPO/releases/assets/$id" "$2")" "asset $1" github
    }
    fetch_asset "$NAME.tgz"        "$TGZ"
    fetch_asset "$NAME.tgz.sha256" "$TGZ.sha256"
    EXPECT="$(awk '{print $1}' "$TGZ.sha256")"
    ;;
  *)
    die "unknown ARCHIE_SOURCE='$SOURCE' (expected: public | github, or a local ARCHIE_TGZ)"
    ;;
esac

# ── 2. verify BEFORE extracting or running anything ──────────────────────────
[[ -n "$EXPECT" ]] || die "could not read expected checksum"
ACTUAL="$(sha256 "$TGZ")"
if [[ "$ACTUAL" != "$EXPECT" ]]; then
  die "checksum MISMATCH — refusing to extract.
       expected: $EXPECT
       actual:   $ACTUAL"
fi
c_ok "checksum verified ($ACTUAL)"

# ── 3. extract into the install dir ──────────────────────────────────────────
tar -xzf "$TGZ" -C "$WORK"
[[ -d "$WORK/$NAME" ]] || die "unexpected archive layout (no $NAME/ at top level)"
mkdir -p "$INSTALL_DIR"
if command -v rsync >/dev/null 2>&1; then
  rsync -a "$WORK/$NAME/" "$INSTALL_DIR/"
else
  cp -a "$WORK/$NAME/." "$INSTALL_DIR/"
fi
mkdir -p "$STATE_DIR"
c_ok "extracted to $INSTALL_DIR"

SERVE="$INSTALL_DIR/install/wizard/serve.py"
[[ -f "$SERVE" ]] || die "wizard service missing at $SERVE — package may be incomplete"

if [[ "${ARCHIE_NO_LAUNCH:-0}" == 1 ]]; then
  c_ok "package staged (ARCHIE_NO_LAUNCH=1) — start the wizard with:"
  echo "    python3 $SERVE --port $PORT"
  exit 0
fi

# ── 4. don't double-launch ───────────────────────────────────────────────────
PIDFILE="$STATE_DIR/wizard.pid"
if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
  c_ok "wizard already running (pid $(cat "$PIDFILE")) on port $PORT — leaving it up"
  exit 0
fi

# ── 5. pick how the wizard is reached: SSH tunnel vs. temporary public URL ───
# ARCHIE_PUBLIC, if set, skips the prompt (scripted/CI installs). Otherwise
# ask interactively — reading from /dev/tty so this still works when the
# script itself arrived via `curl | sudo bash` (stdin is the pipe, not a tty).
PUBLIC="${ARCHIE_PUBLIC:-}"
if [[ -z "$PUBLIC" ]]; then
  if [[ -e /dev/tty ]] && ( : <>/dev/tty ) 2>/dev/null && exec 3<>/dev/tty; then
    echo "" >&3
    c_in "How do you want to reach the setup wizard?" >&3
    echo "    1) SSH tunnel (default, recommended) — private, needs an SSH key to this server" >&3
    echo "    2) Temporary public URL — no SSH needed, but the wizard (token-gated) is briefly" >&3
    echo "       reachable by anyone with the link until you stop it. Token can leak via shell" >&3
    echo "       history, logs, or screen-sharing." >&3
    printf '  Choose [1/2] (default 1): ' >&3
    read -r CHOICE <&3 || CHOICE=""
    exec 3<&-
    [[ "$CHOICE" == "2" ]] && PUBLIC=1 || PUBLIC=0
  else
    c_in "no TTY available to ask — defaulting to SSH-tunnel mode (set ARCHIE_PUBLIC=1 to skip this prompt and expose it publicly)"
    PUBLIC=0
  fi
fi

HOST=127.0.0.1; TOKEN=""
if [[ "$PUBLIC" == 1 ]]; then
  HOST=0.0.0.0
  TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')"
  c_in "binding $HOST — temporary public exposure, gated by a one-time token"
fi

# fail loudly if something we don't control already owns this port, instead
# of racing it and silently reporting a stale/foreign process as "our" wizard
if python3 -c "import socket,sys; s=socket.socket(); s.settimeout(0.3);
sys.exit(0 if s.connect_ex(('127.0.0.1',$PORT))==0 else 1)" 2>/dev/null; then
  die "port $PORT is already in use by another process (not tracked by $PIDFILE) — free it first, e.g.: sudo ss -tlnp | grep $PORT"
fi

LOG="$STATE_DIR/wizard.log"
# Option B: pass the pre-built-images flag through to the wizard's install
# (serve.py reads ARCHIE_PREBUILT into Params.prebuilt). Default 0 = build from
# source, so a source package still installs the way it always has.
export ARCHIE_PREBUILT="${ARCHIE_PREBUILT:-0}"
# When publicly exposed, tell the install plan (apply.py) which port to keep
# open in UFW — otherwise the install's own ufw-enable step firewalls off
# the wizard the customer is actively using to watch the install finish.
[[ "$PUBLIC" == 1 ]] && export ARCHIE_WIZARD_PORT="$PORT"
# detach so it survives this shell / SSH disconnect (nohup ignores SIGHUP);
# state + logs persist under $STATE_DIR so the UI re-attaches after a reconnect.
nohup python3 "$SERVE" --host "$HOST" --port "$PORT" --state-dir "$STATE_DIR" \
  ${TOKEN:+--token "$TOKEN"} >"$LOG" 2>&1 < /dev/null &
WPID=$!
echo "$WPID" > "$PIDFILE"

# give it a moment, then confirm it's actually listening — check the PID we
# just spawned is still alive first, so a crash (e.g. address-in-use) is
# reported accurately instead of being masked by some other process
# answering on the same port.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if ! kill -0 "$WPID" 2>/dev/null; then
    c_no "wizard process (pid $WPID) exited immediately — last log lines:"; tail -n 20 "$LOG" >&2 || true
    die "startup failed"
  fi
  if python3 -c "import socket,sys; s=socket.socket(); s.settimeout(0.3);
sys.exit(0 if s.connect_ex(('127.0.0.1',$PORT))==0 else 1)" 2>/dev/null; then
    LISTENING=1; break
  fi
  sleep 0.3
done
if [[ "${LISTENING:-0}" != 1 ]]; then
  c_no "wizard did not come up on port $PORT — last log lines:"; tail -n 20 "$LOG" >&2 || true
  die "startup failed"
fi
c_ok "wizard running (pid $WPID) — log: $LOG"

# ── 6. tell the operator how to reach it ─────────────────────────────────────
# Resolve the real public IP: try AWS IMDSv2 first (works with no internet
# egress needed off-box), then an external lookup, then give up and say so
# rather than print an unusable placeholder.
public_ip() {
  local ip=""
  if command -v curl >/dev/null 2>&1; then
    local tok
    tok="$(curl -fsS -m 1 -X PUT 'http://169.254.169.254/latest/api/token' \
      -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' 2>/dev/null || true)"
    if [[ -n "$tok" ]]; then
      ip="$(curl -fsS -m 1 -H "X-aws-ec2-metadata-token: $tok" \
        'http://169.254.169.254/latest/meta-data/public-ipv4' 2>/dev/null || true)"
    fi
    [[ -z "$ip" ]] && ip="$(curl -fsS -m 2 https://ifconfig.me 2>/dev/null || true)"
  fi
  echo "$ip"
}

echo ""
if [[ "$HOST" == 127.0.0.1 ]]; then
  c_in "The installer is private (localhost only). Open an SSH tunnel from YOUR machine:"
  echo "    ssh -L $PORT:localhost:$PORT <user>@<this-server>"
  echo "  then browse to:  http://localhost:$PORT"
else
  IP="$(public_ip)"
  c_in "The installer is publicly reachable (temporary, token-gated)."
  echo "  Required one-time token (keep it secret):"
  echo "    $TOKEN"
  if [[ -n "$IP" ]]; then
    echo "  Open:  http://$IP:$PORT/?token=$TOKEN"
  else
    echo "  Could not auto-detect this server's public IP — open:"
    echo "    http://<this-server-public-ip>:$PORT/?token=$TOKEN"
  fi
fi
echo ""
echo "  To stop the installer:  kill \$(cat $PIDFILE)"
