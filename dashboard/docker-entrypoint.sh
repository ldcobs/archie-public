#!/bin/sh
# Runtime injection for the pre-built dashboard image (Option B).
#
# NEXT_PUBLIC_* values are inlined into the JS bundle at build time. The image is
# built once with __ARCHIE_*__ sentinels; here we replace them with this install's
# real runtime env before starting the server. One image, every customer.
#
# Safe for the on-box build path too: that build bakes real values (no sentinels),
# so every replace below is a harmless no-op and the server starts unchanged.
set -e

swap() {
  sentinel="$1"; value="$2"
  [ -z "$value" ] && return 0
  esc=$(printf '%s' "$value" | sed -e 's/[&/\]/\\&/g')
  # Only files that actually contain the sentinel; scoped to build output.
  grep -rl "$sentinel" /app/.next /app/server.js 2>/dev/null | while IFS= read -r f; do
    sed -i "s/$sentinel/$esc/g" "$f"
  done
}

swap __ARCHIE_SERVER_IP__        "$NEXT_PUBLIC_SERVER_IP"
swap __ARCHIE_SERVER_DOMAIN__    "$NEXT_PUBLIC_SERVER_DOMAIN"
swap __ARCHIE_SERVER_PORT__      "${NEXT_PUBLIC_SERVER_PORT:-443}"
swap __ARCHIE_PUBLIC_BASE_URL__  "$NEXT_PUBLIC_PUBLIC_BASE_URL"
swap __ARCHIE_BRAND_NAME__       "$NEXT_PUBLIC_BRAND_NAME"
swap __ARCHIE_VLESS_PBK__        "$NEXT_PUBLIC_VLESS_PBK"
swap __ARCHIE_VLESS_SID__        "$NEXT_PUBLIC_VLESS_SID"
swap __ARCHIE_VLESS_SNI__        "$NEXT_PUBLIC_VLESS_SNI"

exec "$@"
