# Archie VPN control-plane API — pre-built image (Option B distribution).
#
# The API is plain stdlib Python (no pip deps). This image bakes the source into
# a versioned artifact instead of bind-mounting it at runtime.
#
# Runtime state (*.json), logs, and the xray/wireguard tooling are NOT part of
# this image — they arrive via the bind mounts declared in the release compose.
# See api/.dockerignore.
FROM python:3.12-slim

WORKDIR /app

# Source only. Explicit file list (not `COPY . .`) so runtime state never leaks
# into the image even if a dev left *.json in the context.
COPY vpn-api.py vpn_extensions.py vpn_extensions_v3.py ./

CMD ["python3", "/app/vpn-api.py"]
