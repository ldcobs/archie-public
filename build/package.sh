#!/usr/bin/env bash
# =============================================================================
#  build/package.sh — produce the clean "golden image" the customer installs.
#
#  Takes the dev repo and emits dist/archie-<version>.tgz containing ONLY the
#  product files — none of the internal/dev material (design/, docs/, backups/,
#  tests/, .github, node_modules, .next, …).
#
#  This is an ALLOWLIST: only the paths named below are copied. A safety scan
#  then hard-fails if any known-internal file is present, so the dev repo can
#  never leak into a release.
#
#  Usage:  build/package.sh [VERSION]      (default: 0.1.5, or $VERSION)
#  Output: dist/archie-<version>.tgz  +  dist/archie-<version>.tgz.sha256
# =============================================================================

set -Eeuo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

VERSION="${1:-${VERSION:-0.1.5}}"
NAME="archie-$VERSION"
STAGE="build/.stage/$NAME"
DIST="dist"

c_ok(){ printf '\033[1;32m[+]\033[0m %s\n' "$*"; }
c_in(){ printf '\033[1;34m[*]\033[0m %s\n' "$*"; }
c_no(){ printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; }

c_in "building golden image: $NAME"
rm -rf "$STAGE"; mkdir -p "$STAGE" "$DIST"

# ── 1. install engine (no venv/cache/staging/tests) ──────────────────────────
rsync -a --prune-empty-dirs \
  --exclude '__pycache__' --exclude '*.pyc' \
  --exclude '.venv' --exclude '.pytest_cache' --exclude '.staging' \
  --exclude 'tests' --exclude 'pytest.ini' --exclude 'shellcheck.conf' \
  install/ "$STAGE/install/"

# ── 2. dashboard build context (no deps/build output/dev env/editor state) ───
rsync -a \
  --exclude 'node_modules' --exclude '.next' --exclude 'data' \
  --exclude 'tsconfig.tsbuildinfo' --exclude '*.log' --exclude '.DS_Store' \
  --exclude '.*/' \
  --exclude 'CHECKPOINT*' --exclude '.env.local' --exclude '.env.local.example' \
  dashboard/ "$STAGE/dashboard/"

# ── 3. api control plane — source only (no runtime state/logs) ───────────────
mkdir -p "$STAGE/api"
rsync -a --include '*.py' --exclude '*' api/ "$STAGE/api/"

# ── 4. compose + host applier + license ──────────────────────────────────────
cp docker-compose.vpn.yml "$STAGE/"
# Option B (pre-built images): the wizard stages this when ARCHIE_PREBUILT=1, so
# it must ship in the package or an image-based install can't find it.
cp docker-compose.release.yml "$STAGE/"
mkdir -p "$STAGE/scripts"; cp scripts/apply-vpn-changes.sh "$STAGE/scripts/"
cp LICENSE "$STAGE/"
printf '%s\n' "$VERSION" > "$STAGE/VERSION"

# ── 5. safety net: refuse to ship anything internal ──────────────────────────
c_in "scanning for internal files that must never ship..."
FORBIDDEN=$(find "$STAGE" \( \
     -name 'PLAN.md' -o -name 'PROGRESS.md' -o -name 'CHECKPOINT*' \
  -o -name 'MULTIGATEWAY_SCALE_PLAN.md' -o -name 'CONTRIBUTING.md' \
  -o -name '*.pyc' -o -name '.DS_Store' \
  -o -path '*/node_modules/*' -o -path '*/.next/*' -o -path '*/.git/*' \
  -o -path '*/__pycache__/*' -o -path '*/.venv/*' -o -path '*/tests/*' \
  -o -path '*/design/*' -o -path '*/docs/*' -o -path '*/backups/*' \
  -o -path '*/fixtures/*' \
  \) -print 2>/dev/null || true)
if [[ -n "$FORBIDDEN" ]]; then
  c_no "internal files found in the package — aborting:"; echo "$FORBIDDEN" >&2
  exit 1
fi
# api must carry no runtime state
if find "$STAGE/api" -name '*.json' -o -name '*.log' | grep -q .; then
  c_no "api runtime state leaked into the package — aborting"; exit 1
fi
c_ok "clean — no internal files present"

# ── 6. archive + checksum ────────────────────────────────────────────────────
# Strip macOS extended attributes (com.apple.provenance, AppleDouble) so the
# tarball doesn't spew "Ignoring unknown extended header keyword" warnings when
# GNU tar on the Linux target extracts it. --no-xattrs is portable across BSD
# tar (macOS) and GNU tar; --no-mac-metadata + COPYFILE_DISABLE are macOS-only
# extras applied only when the local tar accepts them.
TARBALL="$DIST/$NAME.tgz"
TAR_FLAGS="--no-xattrs"
if tar --no-mac-metadata --version >/dev/null 2>&1 || tar --help 2>&1 | grep -q -- --no-mac-metadata; then
  TAR_FLAGS="$TAR_FLAGS --no-mac-metadata"
fi
COPYFILE_DISABLE=1 tar $TAR_FLAGS -C build/.stage -czf "$TARBALL" "$NAME"
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$DIST" && sha256sum "$NAME.tgz" > "$NAME.tgz.sha256")
else
  (cd "$DIST" && shasum -a 256 "$NAME.tgz" > "$NAME.tgz.sha256")
fi

SIZE=$(du -h "$TARBALL" | cut -f1)
FILES=$(tar -tzf "$TARBALL" | grep -vc '/$' || true)
c_ok "built $TARBALL ($SIZE, $FILES files)"
c_ok "checksum: $(cat "$DIST/$NAME.tgz.sha256")"
echo ""
c_in "top-level contents:"
tar -tzf "$TARBALL" | sed "s#^$NAME/##" | awk -F/ 'NF<=2 && $0!="" {print $1"/"$2}' | sort -u | sed 's#/$##' | grep -v '^$' | head -40
