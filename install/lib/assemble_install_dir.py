"""Assemble the install-dir staging tree.

This is the orchestrator ``install.sh`` calls after detection + crypto fill.
It writes a complete, self-consistent tree under ``params.staging_dir`` that
mirrors the target install layout (``/opt/archie`` by default) so the deferred
apply step can rsync/cp it into place.

Layout produced (relative to staging root):

    .env                              # docker compose reads this
    docker-compose.vpn.yml            # copied from repo root (unchanged)
    vpn-api-v3/                       # copy of repo api/  (compose mounts ./vpn-api-v3)
    vpn-dashboard-v3/                 # copy of repo dashboard/
    vpn-dashboard-v3/.env.production  # NEXT_PUBLIC_* baked into the build
    scripts/apply-vpn-changes.sh      # host-side applier (copied from repo)
    nginx/nginx.conf                  # generated per mode
    nginx/conf.d/archie.conf          # generated per mode
    nginx/html/index.html
    nginx/cloudflare-ips.conf         # Mode B only
    nginx/htpasswd                    # only if --dashboard-basic-auth
    data/certbot/{conf,www}/          # empty dirs for certbot volumes
    host/                             # files destined for /etc on the host
      xray/config.json                # /usr/local/etc/xray/config.json
      xray/geoip.dat -> symlink src   # placeholder; apply downloads
      hysteria/config.yaml            # /etc/hysteria/config.yaml
      hysteria/cert.pem               # Mode A: self-signed; B/C: staged from operator
      hysteria/key.pem
      wireguard/wg0.conf              # /etc/wireguard/wg0.conf
      wireguard/clients.json
      systemd/xray.service
      systemd/hysteria-server.service
      systemd/archie-traffic-poller.service
      systemd/archie-traffic-poller.timer
      systemd/archie-apply-changes.service
    manifest.json                     # what was generated, for self-check + apply

Option B (``p.prebuilt``) differs only in the compose stack: it stages
``docker-compose.release.yml`` plus empty ``state/`` and ``dashboard-data/`` dirs
instead of copying ``api/``/``dashboard/`` source (the pre-built ghcr.io images
carry the code). Everything under ``host/`` and ``nginx/`` is identical.
"""

from __future__ import annotations

import fnmatch
import json
import shutil
from pathlib import Path

from . import gen_compose, gen_env, gen_hysteria, gen_nginx, gen_systemd, gen_wireguard, gen_xray_config
from . import crypto
from .common import Params, atomic_write, info, ok, warn, write_json


def _repo_root() -> Path:
    """The Archie repo root (parent of the install/ dir)."""
    # This file: <repo>/install/lib/assemble_install_dir.py
    return Path(__file__).resolve().parents[2]


def _ignored(name: str, patterns: set[str]) -> bool:
    """True if name matches any glob pattern in the ignore set."""
    return any(fnmatch.fnmatch(name, pat) for pat in patterns)


def _copy_tree(src: Path, dst: Path, ignore: set[str]) -> None:
    """Copy src dir into dst, recursively, skipping names matching `ignore`.

    `ignore` supports glob patterns (e.g. ``"*.json"``, ``".DS_Store"``) and is
    applied to every directory level, not just the top.
    """
    dst.mkdir(parents=True, exist_ok=True)
    for entry in src.iterdir():
        if _ignored(entry.name, ignore):
            continue
        target = dst / entry.name
        if entry.is_dir():
            # Recurse so nested junk (.git, node_modules, __pycache__) is skipped.
            _copy_tree(entry, target, ignore)
        else:
            shutil.copy2(entry, target)


def _copy_repo_files(p: Params, staging: Path) -> None:
    """Stage the compose stack.

    Source path (default): copy docker-compose.vpn.yml + api/ + dashboard/ source
    so apply builds on the box. Option B (``p.prebuilt``): stage
    docker-compose.release.yml and create the empty runtime dirs the pre-built
    images mount — no source copy, apply pulls the sealed ghcr.io images instead.
    """
    repo = _repo_root()

    if p.prebuilt:
        # Option B — the sealed images ARE the code. Stage only the release
        # compose + the empty host dirs its bind-mounts expect. Runtime state
        # lives in ./state (STATE_DIR=/data, shared by both containers + the host
        # applier); the dashboard's sqlite lives in ./dashboard-data.
        compose_src = repo / "docker-compose.release.yml"
        if compose_src.exists():
            shutil.copy2(compose_src, staging / "docker-compose.release.yml")
        else:
            warn("docker-compose.release.yml not found in repo; Option B install cannot proceed")
        (staging / "state").mkdir(parents=True, exist_ok=True)
        (staging / "dashboard-data").mkdir(parents=True, exist_ok=True)
        # The host applier reads the dashboard's queued firewall/config JSON. Under
        # Option B those files live in ./state (not vpn-api-v3/), so point the v3
        # queue paths there; the legacy v2 paths go to a dir that never exists so
        # their existence checks stay false.
        _stage_apply_script(
            p, repo, staging,
            v3_dir=f"{p.install_dir}/state",
            v2_dir=f"{p.install_dir}/state-v2-unused",
        )
        return

    # ── source build path (dev / prod) — unchanged ──
    # Compose file — copied verbatim so apply doesn't depend on repo layout.
    compose_src = repo / "docker-compose.vpn.yml"
    if compose_src.exists():
        shutil.copy2(compose_src, staging / "docker-compose.vpn.yml")
    else:
        warn("docker-compose.vpn.yml not found in repo; staging will reference it at apply time")

    # api/ -> vpn-api-v3/  (compose mounts ./vpn-api-v3).
    # Exclude runtime state (.json files are gitignored volatile state) and logs.
    _copy_tree(
        repo / "api",
        staging / "vpn-api-v3",
        ignore={
            "__pycache__", "*.pyc",
            "*.json", "pending_config_audit.log", "*.log",
        },
    )
    # dashboard/ -> vpn-dashboard-v3/.
    # Exclude build output, deps, dev-only env, and data so the staged build
    # context is clean. .env.production is written separately by _emit_env.
    _copy_tree(
        repo / "dashboard",
        staging / "vpn-dashboard-v3",
        ignore={
            "node_modules", ".next", ".git", "data",
            ".env.local", ".env.local.example",
            ".DS_Store", "tsconfig.tsbuildinfo",
            "*.log",
        },
    )

    # Host-side applier — v3 queues live beside the source under vpn-api-v3/.
    _stage_apply_script(
        p, repo, staging,
        v3_dir=f"{p.install_dir}/vpn-api-v3",
        v2_dir=f"{p.install_dir}/vpn-api-v3",
    )


def _stage_apply_script(p: Params, repo: Path, staging: Path, *, v3_dir: str, v2_dir: str) -> None:
    """Copy scripts/apply-vpn-changes.sh, rewriting its __ARCHIE_DATA__ queue-path
    placeholder to this install's layout.

    The repo ships a neutral __ARCHIE_DATA__ placeholder. ``v3_dir`` is where the
    v3 dashboard writes its pending config/firewall JSON (vpn-api-v3/ for a source
    build; state/ for Option B); ``v2_dir`` is the legacy v2 queue dir. We only
    touch the copied file.
    """
    apply_src = repo / "scripts" / "apply-vpn-changes.sh"
    if not apply_src.exists():
        return
    target = staging / "scripts" / "apply-vpn-changes.sh"
    target.parent.mkdir(parents=True, exist_ok=True)
    text = apply_src.read_text()
    # Order matters: rewrite the vpn-api-v3 path first so the bare vpn-api/
    # replace below doesn't clobber the already-rewritten v3 path.
    text = text.replace("__ARCHIE_DATA__/vpn-api-v3/", f"{v3_dir}/")
    text = text.replace("__ARCHIE_DATA__/vpn-api/", f"{v2_dir}/")
    text = text.replace("__ARCHIE_DATA__", str(p.install_dir))
    target.write_text(text)
    target.chmod(0o755)


def _emit_env(p: Params, staging: Path) -> None:
    atomic_write(staging / ".env", gen_env.build_root_env(p), mode=0o600)
    # Option B bakes NEXT_PUBLIC_* as sentinels and swaps them at container start
    # from the root .env — there is no on-box build context, so no .env.production.
    if p.prebuilt:
        return
    # Source build: dashboard build-time env rides along in the copied context.
    atomic_write(
        staging / "vpn-dashboard-v3" / ".env.production",
        gen_env.build_dashboard_env_production(p),
    )


def _emit_xray(p: Params, host: Path) -> None:
    cfg = gen_xray_config.build_config(p)
    write_json(host / "xray" / "config.json", cfg)
    # geoip/geosite placeholders — apply step downloads the real files.
    (host / "xray").mkdir(parents=True, exist_ok=True)
    note = (
        "# Placeholder. The apply step downloads geoip.dat and geosite.dat from\n"
        "# https://github.com/Loyalsoldier/v2ray-rules-dat into this directory.\n"
    )
    atomic_write(host / "xray" / "README-geo.txt", note)


def _emit_hysteria(p: Params, host: Path, *, self_signed: bool) -> None:
    cert_path, key_path = gen_hysteria.cert_paths()
    cfg = gen_hysteria.build_config(
        p,
        cert_path="/etc/hysteria/cert.pem",
        key_path="/etc/hysteria/key.pem",
        insecure=self_signed,
    )
    atomic_write(host / "hysteria" / "config.yaml", cfg)
    # Stage cert material. Mode A: generate self-signed into staging so the
    # apply step just copies them. B/C: leave placeholders the operator fills.
    if self_signed:
        try:
            cert, key = crypto.self_signed_cert(p.server_ip)
            atomic_write(host / "hysteria" / "cert.pem", cert)
            atomic_write(host / "hysteria" / "key.pem", key, mode=0o600)
        except RuntimeError as exc:
            warn(f"could not generate self-signed HY2 cert: {exc} (apply step will retry)")
            atomic_write(host / "hysteria" / "cert.pem", "# operator-supplied\n")
            atomic_write(host / "hysteria" / "key.pem", "# operator-supplied\n", mode=0o600)
    else:
        atomic_write(host / "hysteria" / "cert.pem.STAGED-BY-OPERATOR", "")
        atomic_write(host / "hysteria" / "key.pem.STAGED-BY-OPERATOR", "")


def _emit_cf_origin_cert(p: Params, host: Path) -> None:
    """Mode B: stage the operator's Cloudflare Origin cert/key into the tree.

    ``validate()`` already guarantees ``cf_origin_cert`` is non-empty for Mode B,
    so the apply-plan ``cf-origin-cert`` step
    (``install {host}/cloudflare-origin.pem ...``) always finds real material
    here. The key is 0o600 to match the ``install -m 600`` on the host side.
    """
    cert = p.cf_origin_cert if p.cf_origin_cert.endswith("\n") else p.cf_origin_cert + "\n"
    key = p.cf_origin_key if p.cf_origin_key.endswith("\n") else p.cf_origin_key + "\n"
    atomic_write(host / "cloudflare-origin.pem", cert)
    atomic_write(host / "cloudflare-origin.key", key, mode=0o600)


def _emit_wireguard(p: Params, host: Path) -> None:
    atomic_write(host / "wireguard" / "wg0.conf", gen_wireguard.build_wg0_conf(p))
    atomic_write(host / "wireguard" / "clients.json", gen_wireguard.build_clients_json())


def _emit_nginx(p: Params, staging: Path) -> None:
    ngx = staging / "nginx"
    atomic_write(ngx / "nginx.conf", gen_nginx.build_nginx_conf(p))
    atomic_write(ngx / "conf.d" / "archie.conf", gen_nginx.build_archie_conf(p))
    atomic_write(ngx / "html" / "index.html", gen_nginx.build_html_index(p))
    if p.mode == "B":
        atomic_write(ngx / "cloudflare-ips.conf", gen_nginx.build_cloudflare_ips_conf())
    if p.dashboard_basic_auth:
        atomic_write(ngx / "htpasswd", gen_nginx.build_htpasswd_placeholder())


def _emit_systemd(host: Path) -> None:
    sd = host / "systemd"
    atomic_write(sd / "xray.service", gen_systemd.build_xray_unit())
    atomic_write(sd / "hysteria-server.service", gen_systemd.build_hysteria_unit())
    atomic_write(sd / "archie-traffic-poller.service", gen_systemd.build_traffic_poller_unit())
    atomic_write(sd / "archie-traffic-poller.timer", gen_systemd.build_traffic_poller_timer())
    atomic_write(sd / "archie-apply-changes.service", gen_systemd.build_apply_changes_unit())


def _emit_manifest(p: Params, staging: Path) -> None:
    """Record what was generated so the apply step + self-check can verify it."""
    from .gen_xray_config import inbound_tags_for_mode
    from .gen_compose import MODE_A_DASHBOARD_PORT
    cert_path, _ = gen_hysteria.cert_paths()
    # Option B pulls the image-based release compose; the source build uses the
    # build-based vpn compose. Both keep the same mode-A overlay + service set.
    base_compose = "docker-compose.release.yml" if p.prebuilt else "docker-compose.vpn.yml"
    # What `--apply` runs for `docker compose` + where to probe the dashboard.
    if p.mode == "A":
        compose_files = [base_compose, "docker-compose.modeA.yml"]
        compose_services = ["vpn-api-v3", "vpn-dashboard-v3"]
        # Local probe URL. The customer-facing URL is public_base_url
        # (http://<server-ip>:8080/v3), but self-check runs on the host and can
        # avoid cloud-firewall/hairpin quirks by probing localhost.
        dashboard_check_url = f"http://127.0.0.1:{MODE_A_DASHBOARD_PORT}/v3"
    else:
        compose_files = [base_compose]
        compose_services = ["nginx", "certbot", "vpn-api-v3", "vpn-dashboard-v3"]
        dashboard_check_url = "https://127.0.0.1:8443/v3"
    manifest = {
        "mode": p.mode,
        "server_ip": p.server_ip,
        "server_domain": p.server_domain,
        "brand": p.brand,
        "install_dir": p.install_dir,
        "staging_dir": str(staging),
        "public_base_url": p.public_base_url,
        "compose_files": compose_files,
        "compose_services": compose_services,
        "dashboard_check_url": dashboard_check_url,
        "inbound_tags": inbound_tags_for_mode(p.mode, p.extra_protocols),
        "needs_nginx": p.needs_nginx,
        "dashboard_basic_auth": p.dashboard_basic_auth,
        "wan_iface": p.wan_iface,
        "wg_server_pub": p.wg_public,
        "hysteria_cert_mode": "self-signed" if p.mode == "A" else "operator-staged",
        "hysteria_cert_paths": {"cert": cert_path},
        "tls_cert_source": (
            "cloudflare-origin" if p.mode == "B"
            else "lets-encrypt" if p.mode == "C"
            else "none"
        ),
        "apply_notes": [
            "traffic_poller.py is optional; apply enables the timer only when "
            "the script is shipped.",
            "geoip.dat / geosite.dat must be downloaded by the apply step.",
            "Mode A: self-signed hysteria cert staged under host/hysteria/.",
            "Mode B/C: operator must stage CF Origin / LE certs.",
        ],
        "files": {
            "env": ".env",
            # Option B injects NEXT_PUBLIC_* at runtime — no build-time env file.
            "dashboard_env_production": (
                None if p.prebuilt else "vpn-dashboard-v3/.env.production"
            ),
            "compose": base_compose,
            "xray_config": "host/xray/config.json",
            "hysteria_config": "host/hysteria/config.yaml",
            "wireguard_config": "host/wireguard/wg0.conf",
            "nginx_conf": "nginx/nginx.conf",
            "archie_conf": "nginx/conf.d/archie.conf",
        },
    }
    write_json(staging / "manifest.json", manifest)


def assemble(p: Params) -> Path:
    """Top-level entry: build the full staging tree and return its path."""
    p.validate()
    staging = Path(p.staging_dir)
    if staging.exists():
        # Re-runs are idempotent: clear only our own generated tree, never the
        # repo. We only ever write under staging_dir.
        info(f"clearing existing staging dir {staging}")
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    host = staging / "host"

    info(f"assembling staging tree for mode {p.mode} at {staging}")
    _copy_repo_files(p, staging)
    _emit_env(p, staging)
    _emit_xray(p, host)
    _emit_hysteria(p, host, self_signed=(p.mode == "A"))
    if p.mode == "B":
        _emit_cf_origin_cert(p, host)
    _emit_wireguard(p, host)
    if p.needs_nginx:
        _emit_nginx(p, staging)
    else:
        info("mode A — nginx config omitted (host-direct protocols)")
        atomic_write(staging / "docker-compose.modeA.yml", gen_compose.build_mode_a_override(p))
    _emit_systemd(host)
    _emit_manifest(p, staging)

    ok(f"staging tree complete: {staging}")
    return staging
