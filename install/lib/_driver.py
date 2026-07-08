"""Driver invoked by install.sh.

This is not part of the importable ``install.lib`` API surface — it's the
thin glue between the bash-parsed flags (read from ``ARCHIE_*`` env vars) and
the generator library. Kept separate so the lib modules stay independently
unit-testable without touching the environment.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _here() -> Path:
    return Path(__file__).resolve().parent  # .../install/lib


def main() -> int:
    # Import the lib package as a package so the generators' relative imports
    # (`from . import common`) resolve. Requires install/ (parent of lib) on path.
    sys.path.insert(0, str(_here().parent))

    from lib.common import Params, set_verbose, info, ok  # noqa: E402
    import lib.detect as detect  # noqa: E402
    import lib.crypto as crypto  # noqa: E402
    from lib.assemble_install_dir import assemble  # noqa: E402

    def env(k: str, d: str = "") -> str:
        return os.environ.get(k, d)

    set_verbose(env("ARCHIE_VERBOSE") == "1")

    p = Params()
    p.mode = env("ARCHIE_MODE")
    p.server_domain = env("ARCHIE_DOMAIN")
    p.brand = env("ARCHIE_BRAND", "Archie VPN")
    p.server_ip = env("ARCHIE_SERVER_IP", "")
    p.reality_pbk = env("ARCHIE_REALITY_PBK")
    p.reality_pvk = env("ARCHIE_REALITY_PVK")
    p.reality_sid = env("ARCHIE_REALITY_SID")
    # Keep the working decoy as the single source of truth (common.py default =
    # www.cloudflare.com). www.microsoft.com's TLS edge stopped working as a
    # Reality decoy — clients connect but pass no traffic.
    p.reality_sni = env("ARCHIE_REALITY_SNI", p.reality_sni)
    p.auth_secret = env("ARCHIE_AUTH_SECRET")
    p.api_token = env("ARCHIE_API_TOKEN")
    p.wg_private = env("ARCHIE_WG_PRIVATE")
    p.wg_public = env("ARCHIE_WG_PUBLIC")
    p.tg_token = env("ARCHIE_TG_TOKEN")
    p.tg_chat_id = env("ARCHIE_TG_CHAT_ID")
    p.abuseipdb_key = env("ARCHIE_ABUSEIPDB")
    p.smtp_host = env("ARCHIE_SMTP_HOST")
    p.smtp_port = env("ARCHIE_SMTP_PORT")
    p.smtp_user = env("ARCHIE_SMTP_USER")
    p.smtp_pass = env("ARCHIE_SMTP_PASS")
    p.smtp_from = env("ARCHIE_SMTP_FROM")
    p.smtp_secure = env("ARCHIE_SMTP_SECURE")
    p.no_smtp = env("ARCHIE_NO_SMTP") == "1"
    p.cf_origin_cert = env("ARCHIE_CF_CERT")
    p.cf_origin_key = env("ARCHIE_CF_KEY")
    p.install_dir = env("ARCHIE_INSTALL_DIR_TARGET", "/opt/archie")
    p.staging_dir = env("ARCHIE_STAGING")
    p.dashboard_basic_auth = env("ARCHIE_BASIC_AUTH") == "1"
    p.no_fail2ban = env("ARCHIE_NO_FAIL2BAN") == "1"
    p.no_firewall = env("ARCHIE_NO_FIREWALL") == "1"
    # Option B: pull pre-built ghcr.io images instead of copying+building source.
    p.prebuilt = env("ARCHIE_PREBUILT") == "1"

    extra = env("ARCHIE_EXTRA", "")
    p.extra_protocols = [x.strip() for x in extra.split(",") if x.strip()]

    # Detection (read-only).
    insecure = env("ARCHIE_INSECURE_IP") == "1"
    info("running read-only environment detection...")
    detect.run_all_detection(p, insecure_ip=insecure)
    info(
        f"  os={p.os_id or '?'} {p.os_version} arch={p.arch} "
        f"docker={p.docker_present} ufw={p.ufw_present} wan={p.wan_iface} "
        f"ip={p.server_ip or '?'}"
    )

    # Crypto fill (generates anything the operator didn't supply).
    info("filling crypto material...")
    crypto.ensure_all(p)
    info(f"  reality pbk={'<set>' if p.reality_pbk else '<gen>'} "
         f"sid={'<set>' if p.reality_sid else '<gen>'}")
    info(f"  wg pub={'<set>' if p.wg_public else '<gen>'}")
    info(f"  auth_secret={'<set>' if p.auth_secret else '<gen>'} "
         f"api_token={'<set>' if p.api_token else '<gen>'}")

    # Validate + assemble.
    p.validate()
    staging = assemble(p)
    ok(f"staging tree written: {staging}")

    apply = env("ARCHIE_APPLY") == "1"
    dry_run = env("ARCHIE_DRY_RUN") == "1"

    if not apply:
        print("", file=sys.stderr)
        info("staging only (pass --apply to mutate the host):")
        print(f"  inspect:  ls -la {staging}", file=sys.stderr)
        print(f"  manifest: cat {staging}/manifest.json", file=sys.stderr)
        print(f"  dashboard url (preview): {p.public_base_url}", file=sys.stderr)
        return 0

    return _run_apply(p, staging, dry_run=dry_run, verbose=env("ARCHIE_VERBOSE") == "1")


def _run_apply(p, staging, *, dry_run: bool, verbose: bool) -> int:
    import os as _os
    from pathlib import Path

    from lib import apply as apply_mod  # noqa: E402
    from lib.common import err, info, ok, warn  # noqa: E402

    if not dry_run and _os.geteuid() != 0:
        err("--apply must run as root (it installs packages, writes /etc, runs docker/ufw)")
        return 2

    steps = apply_mod.build_plan(p, Path(staging))
    info(f"apply plan: {len(steps)} steps (mode {p.mode})")
    rc = apply_mod.run_plan(steps, dry_run=dry_run, verbose=verbose)
    if rc != 0:
        err(f"apply aborted at a failed step (rc={rc})")
        return rc

    if dry_run:
        ok("dry-run complete — no host changes made")
        return 0

    # Post-install self-check.
    print("", file=sys.stderr)
    info("running post-install self-check...")
    results = apply_mod.self_check(p, dashboard_url=_dashboard_url(staging, p))
    all_ok = apply_mod.print_self_check(results)
    print("", file=sys.stderr)
    if all_ok:
        if p.mode == "A":
            # Mode A has no TLS. It is intentionally published on a non-default
            # HTTP port so a first-time customer can finish setup by IP; the
            # cloud firewall/security group should restrict who can reach it.
            ok(f"Archie is up. Open {p.public_base_url} to create your owner account.")
            ok("Mode A uses plain HTTP; restrict dashboard access with your cloud firewall.")
        else:
            ok(f"Archie is up. Open {p.public_base_url} to create your owner account.")
        ok("There is no default password — the first visitor creates the owner account.")
    else:
        warn("Archie installed but some self-checks failed — see the report above.")
    return 0 if all_ok else 1


def _dashboard_url(staging, p) -> str:
    """Prefer the manifest's probe URL; fall back to the public base URL."""
    import json as _json
    from pathlib import Path

    try:
        m = _json.loads((Path(staging) / "manifest.json").read_text())
        return m.get("dashboard_check_url") or p.public_base_url
    except (OSError, ValueError):
        return p.public_base_url


if __name__ == "__main__":
    raise SystemExit(main())
