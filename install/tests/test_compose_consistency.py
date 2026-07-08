"""Cross-checks apply.py's shell commands against the real docker-compose.vpn.yml
so drift between the two fails a fast local test instead of a live install.

Two real Mode C bugs shipped past the existing apply.py tests because those
only inspect the generated shell STRING in isolation, never the actual
compose file it targets:

  1. `docker compose run --rm certbot certonly ...` silently drops the
     appended command whenever the compose service defines its own
     `entrypoint:` (here, a long-running renewal loop) — the run just hangs
     on that loop forever unless `--entrypoint` overrides it.
  2. Bind-mounted volumes mean a container-side path (e.g. /etc/letsencrypt)
     and its real host-side path (e.g. <install-dir>/data/certbot/conf) are
     NOT the same location — a step that runs directly on the host (not
     inside `docker compose run/exec`) but references the container path
     silently operates on the wrong, usually-empty directory.

Both classes are checked here for every apply.py step, across every mode.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

from install.lib.apply import build_plan

REPO_ROOT = Path(__file__).resolve().parents[2]
COMPOSE_FILE = REPO_ROOT / "docker-compose.vpn.yml"


def _plan(p):
    return build_plan(p, Path("/tmp/staging"))


@pytest.fixture(scope="module")
def compose() -> dict:
    return yaml.safe_load(COMPOSE_FILE.read_text())


def _services_with_custom_entrypoint(compose: dict) -> set[str]:
    return {
        name for name, svc in compose.get("services", {}).items()
        if "entrypoint" in svc
    }


def _divergent_bind_mounts(compose: dict) -> dict[str, str]:
    """container_path -> host_path, for every mount where they differ.

    Passthrough mounts (host path == container path, e.g. the Cloudflare
    Origin cert) are never a footgun and are excluded.
    """
    divergent: dict[str, str] = {}
    for svc in compose.get("services", {}).values():
        for v in svc.get("volumes", []) or []:
            if not isinstance(v, str):
                continue
            parts = v.split(":")
            if len(parts) < 2:
                continue
            host, container = parts[0], parts[1]
            if host != container and container.startswith("/"):
                divergent[container] = host
    return divergent


@pytest.mark.parametrize("mode_fixture", ["params_a", "params_b", "params_c"])
def test_docker_compose_run_overrides_custom_entrypoints(compose, mode_fixture, request):
    p = request.getfixturevalue(mode_fixture)
    custom = _services_with_custom_entrypoint(compose)
    assert custom, "expected >=1 service with a custom entrypoint (certbot) — did the compose file change shape?"

    for step in _plan(p):
        m = re.search(r"docker compose[^&]*\brun\b[^&]*", step.sh)
        if not m:
            continue
        run_cmd = m.group(0)
        for svc in custom:
            if re.search(rf"\b{re.escape(svc)}\b", run_cmd) and "--entrypoint" not in run_cmd:
                pytest.fail(
                    f"[{p.mode}] step '{step.name}' runs `docker compose run` "
                    f"against service '{svc}', which has a custom entrypoint in "
                    f"compose, without passing --entrypoint — that entrypoint "
                    f"will silently swallow the appended command:\n  {run_cmd}"
                )


@pytest.mark.parametrize("mode_fixture", ["params_a", "params_b", "params_c"])
def test_host_steps_use_real_host_paths_not_container_paths(compose, mode_fixture, request):
    p = request.getfixturevalue(mode_fixture)
    divergent = _divergent_bind_mounts(compose)
    assert divergent, "expected >=1 divergent bind mount (letsencrypt) — did the compose file change shape?"

    for step in _plan(p):
        runs_in_container = "docker compose" in step.sh or "docker exec" in step.sh
        if runs_in_container:
            continue  # inside the container, the container-side path is correct
        for container_path, host_path in divergent.items():
            # Path-boundary match, not substring — "/etc/xray" must not match
            # inside "/usr/local/etc/xray" (a different, legitimate host path
            # that happens to end with the same characters).
            pattern = r"(?<![\w./-])" + re.escape(container_path) + r"(?![\w.-])"
            if re.search(pattern, step.sh):
                pytest.fail(
                    f"[{p.mode}] step '{step.name}' runs on the HOST and "
                    f"references '{container_path}', which is only valid "
                    f"inside a container — it's bind-mounted from '{host_path}' "
                    f"on the host, and that's the path the host step needs:\n"
                    f"  {step.sh}"
                )
