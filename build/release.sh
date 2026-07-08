#!/usr/bin/env bash
# =============================================================================
#  build/release.sh — build (and optionally push) the pre-built Option B images.
#
#  Produces two versioned, private images the customer install pulls:
#    <prefix>/archie-api:<version>        (stdlib Python control plane)
#    <prefix>/archie-dashboard:<version>  (Next.js, sentinel-baked for runtime swap)
#
#  Usage:
#    build/release.sh [VERSION]              # build + tag only (default)
#    PUSH=1 build/release.sh [VERSION]       # also push to the registry
#    ARCHIE_IMAGE_PREFIX=ghcr.io/ldcobs build/release.sh
#
#  Push requires being logged in to the registry first, e.g.:
#    gh auth token | docker login ghcr.io -u ldcobs --password-stdin
# =============================================================================

set -Eeuo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

VERSION="${1:-${VERSION:-0.1.5}}"
PREFIX="${ARCHIE_IMAGE_PREFIX:-ghcr.io/ldcobs}"
PUSH="${PUSH:-0}"

API_IMG="$PREFIX/archie-api"
DASH_IMG="$PREFIX/archie-dashboard"

c_ok(){ printf '\033[1;32m[+]\033[0m %s\n' "$*"; }
c_in(){ printf '\033[1;34m[*]\033[0m %s\n' "$*"; }

# Customer VPSes are overwhelmingly x86_64, so build for linux/amd64 by default —
# NOT the builder's native arch. On an Apple-Silicon (arm64) Mac a plain
# `docker build` produces arm64 images that die with "exec format error" on an
# amd64 host (found live on the EC2 test, S26). buildx + QEMU cross-builds the
# right arch; override with PLATFORMS (e.g. "linux/amd64,linux/arm64" for a
# multi-arch push, or "linux/arm64" for an ARM VPS).
PLATFORMS="${PLATFORMS:-linux/amd64}"

# A single-platform image can be --load'ed into the local daemon (so the existing
# `docker push` below works); a multi-platform build can only be --push'ed, so it
# requires PUSH=1.
if [[ "$PLATFORMS" == *,* ]]; then
  if [[ "$PUSH" != "1" ]]; then
    printf '\033[1;31m[x]\033[0m %s\n' "multi-arch PLATFORMS ($PLATFORMS) requires PUSH=1 (buildx can't --load multiple arches)" >&2
    exit 1
  fi
  OUT="--push"           # multi-arch: buildx pushes directly
else
  OUT="--load"           # single-arch: load locally, push step below handles upload
fi

# Ensure a buildx builder that can cross-build + push.
docker buildx inspect archie-builder >/dev/null 2>&1 \
  || docker buildx create --name archie-builder --driver docker-container >/dev/null
BUILDER="--builder archie-builder"

c_in "building release images $VERSION for $PLATFORMS (prefix: $PREFIX)"

# ── API image — plain source bake, no build args ─────────────────────────────
c_in "api → $API_IMG:$VERSION"
docker buildx build $BUILDER --platform "$PLATFORMS" $OUT \
  -t "$API_IMG:$VERSION" -t "$API_IMG:latest" api/

# ── Dashboard image — ARCHIE_PREBUILT=1 bakes the __ARCHIE_*__ sentinels ─────
c_in "dashboard → $DASH_IMG:$VERSION (prebuilt/sentinel mode)"
docker buildx build $BUILDER --platform "$PLATFORMS" $OUT --build-arg ARCHIE_PREBUILT=1 \
  -t "$DASH_IMG:$VERSION" -t "$DASH_IMG:latest" dashboard/

# A multi-arch build already pushed via buildx; skip the legacy push below.
[[ "$OUT" == "--push" ]] && PUSH=0 && c_ok "multi-arch images pushed by buildx"

c_ok "built:"
docker image ls --format '  {{.Repository}}:{{.Tag}}  {{.Size}}' \
  | grep -E "archie-(api|dashboard)" || true

# ── Optional push ─────────────────────────────────────────────────────────────
if [[ "$PUSH" == "1" ]]; then
  c_in "pushing to $PREFIX ..."
  docker push "$API_IMG:$VERSION";  docker push "$API_IMG:latest"
  docker push "$DASH_IMG:$VERSION"; docker push "$DASH_IMG:latest"
  c_ok "pushed $VERSION + latest"
else
  c_in "PUSH=1 to publish. (Login first: gh auth token | docker login ghcr.io -u ldcobs --password-stdin)"
fi
