"""Validates every generated nginx config with the REAL nginx binary (`nginx -t`),
via the same `nginx:alpine` image the compose stack actually runs.

A real Mode C install hung, then failed to start nginx at all, with:
  nginx: [emerg] upstream "archie_api" may not have port 5900

`gen_nginx.py`'s own unit tests only checked for substrings in the generated
text — they never asked nginx itself whether the config was valid, so a
`proxy_pass http://archie_api:5900` (illegal once `archie_api` is declared as
an `upstream {}` block, which already encodes the port) shipped for every
mode. Mode A never caught it because Mode A doesn't run nginx at all.

This test generates the real config for every mode and hands it to a real
nginx binary. Skipped if Docker isn't available (e.g. some CI runners).
"""
from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

from install.lib.gen_nginx import build_archie_conf, build_cloudflare_ips_conf, build_nginx_conf
from install.lib.common import Params

pytestmark = pytest.mark.skipif(shutil.which("docker") is None, reason="docker not available")


def _make_params(mode: str) -> Params:
    p = Params()
    p.mode = mode
    p.server_ip = "198.51.100.10"
    p.server_domain = "vpn.example.com" if mode != "A" else ""
    p.brand = "Test VPN"
    p.dashboard_basic_auth = False
    return p


def _self_signed_cert(tmp: Path) -> tuple[Path, Path]:
    cert, key = tmp / "fullchain.pem", tmp / "privkey.pem"
    subprocess.run(
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
         "-subj", "/CN=test", "-keyout", str(key), "-out", str(cert)],
        check=True, capture_output=True,
    )
    return cert, key


def _write_config_and_mounts(mode: str, tmp: Path) -> tuple[Params, list[str]]:
    """Write the generated config for `mode` into `tmp` and return the docker
    `-v`/`--add-host` args needed to run it in an nginx:alpine container."""
    p = _make_params(mode)
    (tmp / "conf.d").mkdir()
    (tmp / "nginx.conf").write_text(build_nginx_conf(p))
    (tmp / "conf.d" / "archie.conf").write_text(build_archie_conf(p))

    mounts = [
        "-v", f"{tmp / 'nginx.conf'}:/etc/nginx/nginx.conf:ro",
        "-v", f"{tmp / 'conf.d'}:/etc/nginx/conf.d:ro",
        # Static `upstream {}` blocks are DNS-resolved at config-LOAD time,
        # not just parse time. In production these hostnames resolve via
        # Docker's embedded DNS because every service shares the `ailab`
        # network; this standalone test container isn't on that network, so
        # stub them to any resolvable address purely so nginx can load the
        # config — it never actually needs to connect for these tests.
        "--add-host", "vpn-dashboard-v3:127.0.0.1",
        "--add-host", "vpn-api-v3:127.0.0.1",
    ]

    if mode in ("B", "C"):
        cert, key = _self_signed_cert(tmp)
        if mode == "B":
            mounts += [
                "-v", f"{cert}:/etc/ssl/cloudflare-origin.pem:ro",
                "-v", f"{key}:/etc/ssl/cloudflare-origin.key:ro",
            ]
        else:
            le_dir = tmp / "live" / p.server_domain
            le_dir.mkdir(parents=True)
            cert.rename(le_dir / "fullchain.pem")
            key.rename(le_dir / "privkey.pem")
            mounts += ["-v", f"{le_dir}:/etc/letsencrypt/live/{p.server_domain}:ro"]

    if mode == "B":
        (tmp / "cloudflare-ips.conf").write_text(build_cloudflare_ips_conf())
        mounts += ["-v", f"{tmp / 'cloudflare-ips.conf'}:/etc/nginx/cloudflare-ips.conf:ro"]

    return p, mounts


@pytest.mark.parametrize("mode", ["A", "B", "C"])
def test_generated_nginx_config_is_valid(mode):
    with tempfile.TemporaryDirectory() as td:
        p, mounts = _write_config_and_mounts(mode, Path(td))
        result = subprocess.run(
            ["docker", "run", "--rm", *mounts, "nginx:alpine", "nginx", "-t"],
            capture_output=True, text=True, timeout=60,
        )
        assert result.returncode == 0, (
            f"[mode {mode}] generated nginx config is INVALID per the real nginx "
            f"binary:\n{result.stderr}\n\n--- nginx.conf ---\n{build_nginx_conf(p)}"
            f"\n\n--- archie.conf ---\n{build_archie_conf(p)}"
        )


@pytest.mark.parametrize("mode", ["A", "B", "C"])
def test_bare_v3_does_not_redirect_loop(mode):
    """A real Mode C install got an infinite redirect loop on the dashboard
    URL: a `proxy_pass`-backed `location /v3/` (trailing slash) makes nginx
    itself 301 a bare "/v3" request to "/v3/", but the dashboard app's
    basePath canonical form has NO trailing slash and redirects "/v3/" back
    to "/v3" — the two fight forever. Since there's no real backend here
    (nothing is listening on the stubbed upstream), the app-side leg of that
    loop can't be reproduced directly — but the nginx-side leg can: a bare
    "/v3" request must reach the proxy immediately (any response nginx gets
    from upstream, even a connection error) rather than nginx redirecting it
    to "/v3/" on its own first.
    """
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        _, mounts = _write_config_and_mounts(mode, tmp)
        port = "80" if mode == "A" else "8443"
        container = f"nginx_test_{mode}_{id(tmp)}"
        try:
            subprocess.run(
                ["docker", "run", "-d", "--name", container, *mounts, "nginx:alpine"],
                check=True, capture_output=True, timeout=30,
            )
            # give nginx a moment to finish its entrypoint + start listening
            for _ in range(20):
                probe = subprocess.run(
                    ["docker", "exec", container, "nginx", "-t"],
                    capture_output=True, timeout=10,
                )
                if probe.returncode == 0:
                    break
                subprocess.run(["sleep", "0.2"])
            scheme = "http" if mode == "A" else "https"
            result = subprocess.run(
                ["docker", "exec", container, "curl", "-sk", "-o", "/dev/null",
                 "-w", "%{http_code}", f"{scheme}://127.0.0.1:{port}/v3"],
                capture_output=True, text=True, timeout=15,
            )
            # 301/308 here means nginx redirected the bare path on its own —
            # exactly the bug. Any other code (even 502, since nothing real is
            # listening on the stubbed upstream) means nginx forwarded the
            # request to the app instead of redirecting it itself.
            assert result.stdout not in ("301", "308"), (
                f"[mode {mode}] nginx auto-redirected bare /v3 (HTTP {result.stdout}) "
                f"instead of proxying it through — this is the redirect-loop bug."
            )
        finally:
            subprocess.run(["docker", "rm", "-f", container], capture_output=True)
