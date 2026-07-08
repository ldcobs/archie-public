"""Option B (pre-built images) install path.

`p.prebuilt=True` must stage the image-based release compose and pull the sealed
ghcr.io images instead of copying api/+dashboard/ source and building on the box.
These tests pin the differences from the source-build path so a regression in
either direction fails locally instead of on a live customer install.

The source-build path (`prebuilt=False`) is covered by the rest of the suite;
here we assert only what Option B changes, plus that it does NOT leak into the
default path.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from install.lib.apply import build_plan, _compose_base, _compose_files
from install.lib.assemble_install_dir import assemble
from install.lib import gen_env


def _prebuilt(params, tmp_path: Path):
    p = copy.copy(params)
    p.prebuilt = True
    p.install_dir = "/opt/archie"
    p.staging_dir = str(tmp_path / "staging")
    return p


# ── assembly ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("mode_fixture", ["params_a", "params_b", "params_c"])
def test_prebuilt_stages_release_compose_not_source(mode_fixture, tmp_path, request):
    p = _prebuilt(request.getfixturevalue(mode_fixture), tmp_path)
    staging = assemble(p)

    assert (staging / "docker-compose.release.yml").exists()
    assert not (staging / "docker-compose.vpn.yml").exists()
    # No source is copied — the images ARE the code.
    assert not (staging / "vpn-api-v3").exists()
    assert not (staging / "vpn-dashboard-v3").exists()
    # Empty runtime dirs the images bind-mount.
    assert (staging / "state").is_dir()
    assert (staging / "dashboard-data").is_dir()


@pytest.mark.parametrize("mode_fixture", ["params_a", "params_b", "params_c"])
def test_prebuilt_omits_dashboard_build_env(mode_fixture, tmp_path, request):
    p = _prebuilt(request.getfixturevalue(mode_fixture), tmp_path)
    staging = assemble(p)
    # NEXT_PUBLIC_* are swapped at container start from the root .env — there is
    # no on-box build, so no build-time .env.production.
    assert (staging / ".env").exists()
    assert not (staging / "vpn-dashboard-v3" / ".env.production").exists()


@pytest.mark.parametrize("mode_fixture", ["params_a", "params_b", "params_c"])
def test_prebuilt_applier_reads_state_dir_not_source(mode_fixture, tmp_path, request):
    p = _prebuilt(request.getfixturevalue(mode_fixture), tmp_path)
    staging = assemble(p)
    script = (staging / "scripts" / "apply-vpn-changes.sh").read_text()
    # The dashboard writes its queued firewall/config JSON to STATE_DIR (/data ->
    # host ./state) under Option B, so the host applier must read ./state.
    assert "/opt/archie/state/pending_config.json" in script
    assert "/opt/archie/state/pending_firewall.json" in script
    # It must NOT still point at the (nonexistent) source dir.
    assert "vpn-api-v3" not in script


@pytest.mark.parametrize("mode_fixture", ["params_a", "params_b", "params_c"])
def test_prebuilt_manifest_points_at_release_compose(mode_fixture, tmp_path, request):
    p = _prebuilt(request.getfixturevalue(mode_fixture), tmp_path)
    staging = assemble(p)
    m = json.loads((staging / "manifest.json").read_text())
    assert m["files"]["compose"] == "docker-compose.release.yml"
    assert m["files"]["dashboard_env_production"] is None
    assert m["compose_files"][0] == "docker-compose.release.yml"
    if p.mode == "A":
        assert m["compose_files"] == ["docker-compose.release.yml", "docker-compose.modeA.yml"]


# ── .env ─────────────────────────────────────────────────────────────────────


def test_root_env_exposes_bare_public_base_url(params_a):
    # docker-compose.release.yml passes ${PUBLIC_BASE_URL} to the dashboard.
    env = gen_env.build_root_env(params_a)
    assert f"PUBLIC_BASE_URL={params_a.public_base_url}" in env


# ── apply plan ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize("mode_fixture", ["params_a", "params_b", "params_c"])
def test_prebuilt_compose_up_pulls_no_build(mode_fixture, tmp_path, request):
    p = _prebuilt(request.getfixturevalue(mode_fixture), tmp_path)
    step = next(s for s in build_plan(p, Path(p.staging_dir)) if s.name == "compose-up")
    assert "pull" in step.sh
    assert "--build" not in step.sh
    assert "docker-compose.release.yml" in step.sh


@pytest.mark.parametrize("mode_fixture", ["params_a", "params_b", "params_c"])
def test_source_build_still_builds(mode_fixture, request):
    # Default path is untouched: builds from the source compose.
    p = request.getfixturevalue(mode_fixture)
    assert p.prebuilt is False
    assert _compose_base(p) == "docker-compose.vpn.yml"
    step = next(s for s in build_plan(p, Path("/tmp/staging")) if s.name == "compose-up")
    assert "--build" in step.sh
    assert "docker-compose.release.yml" not in step.sh


def test_prebuilt_mode_c_le_issue_uses_release_compose(params_c, tmp_path):
    p = _prebuilt(params_c, tmp_path)
    step = next(s for s in build_plan(p, Path(p.staging_dir)) if s.name == "le-issue")
    assert "-f docker-compose.release.yml" in step.sh
    # The custom-entrypoint override must survive the compose-file swap.
    assert "--entrypoint certbot" in step.sh


# ── release compose shape (pins what the apply code assumes) ──────────────────


def test_release_compose_shape():
    import yaml
    repo = Path(__file__).resolve().parents[2]
    compose = yaml.safe_load((repo / "docker-compose.release.yml").read_text())
    svcs = compose["services"]
    # The v3 services must be image-based (pulled), never build-based.
    for name in ("vpn-api-v3", "vpn-dashboard-v3"):
        assert "image" in svcs[name] and "build" not in svcs[name], name
        assert "archie-" in svcs[name]["image"]
    # certbot keeps its custom entrypoint — justifies apply's --entrypoint override.
    assert "entrypoint" in svcs["certbot"]
    # Runtime state is the shared host ./state mount (STATE_DIR=/data), so the host
    # traffic poller / applier can read+write the same files as the containers.
    api_env = svcs["vpn-api-v3"]["environment"]
    assert any(e == "STATE_DIR=/data" for e in api_env)
