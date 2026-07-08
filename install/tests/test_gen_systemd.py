"""Tests for the systemd unit generator."""

from __future__ import annotations

from install.lib import gen_systemd


def test_xray_unit_runs_confdir():
    unit = gen_systemd.build_xray_unit()
    assert "[Unit]" in unit
    assert "ExecStart=/usr/local/bin/xray run -confdir /usr/local/etc/xray" in unit
    assert "ExecStartPre=/usr/local/bin/xray run -test" in unit
    assert "Restart=on-failure" in unit
    assert "WantedBy=multi-user.target" in unit


def test_xray_unit_binds_privileged_port():
    unit = gen_systemd.build_xray_unit()
    assert "CAP_NET_BIND_SERVICE" in unit


def test_hysteria_unit_points_at_config():
    unit = gen_systemd.build_hysteria_unit()
    assert "[Unit]" in unit
    assert "/etc/hysteria/config.yaml" in unit
    assert "ExecStart=/usr/local/bin/hysteria server" in unit


def test_hysteria_unit_has_no_invalid_prestart():
    # `hysteria server` has no validate-only mode and rejects --disable-brutal;
    # an ExecStartPre would either fail or launch a second instance.
    unit = gen_systemd.build_hysteria_unit()
    assert "--disable-brutal" not in unit
    assert "ExecStartPre" not in unit


def test_traffic_poller_timer_15min():
    timer = gen_systemd.build_traffic_poller_timer()
    assert "OnUnitActiveSec=15min" in timer
    assert "WantedBy=timers.target" in timer


def test_apply_changes_unit_calls_shell_script():
    unit = gen_systemd.build_apply_changes_unit()
    assert "apply-vpn-changes.sh" in unit
    assert "Restart=always" in unit


def test_traffic_poller_service_runs_python():
    unit = gen_systemd.build_traffic_poller_unit()
    assert "traffic_poller.py" in unit
    assert "Type=oneshot" in unit
