"""systemd unit generator.

The repo ships no systemd units — they're VPS-only artifacts. The installer
authors the host-level units for the protocols that run *outside* Docker:

- ``xray.service`` — runs the Xray binary on the host (Reality, SS, the 1000x
  inbounds, the api/stats gRPC on 10085). The dashboard/api containers talk to
  it via bind-mounts, not the network.
- ``hysteria-server.service`` — runs the hysteria binary on :2096/udp.

``wg-quick@wg0.service`` is provided by the ``wireguard-tools`` package — we
just ``systemctl enable`` it during apply, not author it.

These units are independent of install params (paths are fixed), so none of
the builders take a Params argument.
"""

from __future__ import annotations


def build_xray_unit() -> str:
    lines: list[str] = []
    lines.append("[Unit]")
    lines.append("Description=Xray service (Archie)")
    lines.append("Documentation=https://xtls.github.io/")
    lines.append("After=network-online.target nss-lookup.target")
    lines.append("Wants=network-online.target")
    lines.append("")
    lines.append("[Service]")
    lines.append("Type=simple")
    lines.append("User=root")
    lines.append("ExecStartPre=/usr/local/bin/xray run -test -confdir /usr/local/etc/xray")
    lines.append("ExecStart=/usr/local/bin/xray run -confdir /usr/local/etc/xray")
    lines.append("ExecReload=/usr/local/bin/xray run -test -confdir /usr/local/etc/xray")
    lines.append("ExecReload=/bin/kill -HUP $MAINPID")
    lines.append("Restart=on-failure")
    lines.append("RestartPreventExitStatus=23")
    lines.append("LimitNPROC=10000")
    lines.append("LimitNOFILE=1000000")
    lines.append("AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE")
    lines.append("CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_BIND_SERVICE")
    lines.append("")
    lines.append("[Install]")
    lines.append("WantedBy=multi-user.target")
    lines.append("")
    return "\n".join(lines)


def build_hysteria_unit() -> str:
    lines: list[str] = []
    lines.append("[Unit]")
    lines.append("Description=Hysteria 2 server (Archie)")
    lines.append("After=network-online.target")
    lines.append("Wants=network-online.target")
    lines.append("")
    lines.append("[Service]")
    lines.append("Type=simple")
    lines.append("User=root")
    lines.append("Environment=HYSTERIA_LOG_LEVEL=info")
    # Hysteria has no validate-only mode, so no ExecStartPre check (running
    # `hysteria server` there would start a second instance).
    lines.append("ExecStart=/usr/local/bin/hysteria server --config /etc/hysteria/config.yaml")
    lines.append("Restart=on-failure")
    lines.append("LimitNOFILE=1048576")
    lines.append("AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE")
    lines.append("CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_BIND_SERVICE")
    lines.append("")
    lines.append("[Install]")
    lines.append("WantedBy=multi-user.target")
    lines.append("")
    return "\n".join(lines)


def build_traffic_poller_unit() -> str:
    """Timer + oneshot for the Xray stats poller that writes traffic_daily.json.

    Host-side cron today (not in the repo). The installer provides a systemd
    timer equivalent so traffic ingestion doesn't depend on a hand-installed
    crontab line. The poller binary itself is shipped with the api dir.
    """
    service = (
        "[Unit]\n"
        "Description=Archie Xray traffic poller\n"
        "After=xray.service\n"
        "\n"
        "[Service]\n"
        "Type=oneshot\n"
        "ExecStart=/usr/bin/python3 /opt/archie/vpn-api-v3/traffic_poller.py\n"
        "WorkingDirectory=/opt/archie/vpn-api-v3\n"
        "\n"
        "[Install]\n"
        "WantedBy=multi-user.target\n"
    )
    return service


def build_traffic_poller_timer() -> str:
    return (
        "[Unit]\n"
        "Description=Run Archie traffic poller every 15 minutes\n"
        "\n"
        "[Timer]\n"
        "OnBootSec=2min\n"
        "OnUnitActiveSec=15min\n"
        "AccuracySec=30s\n"
        "Persistent=true\n"
        "\n"
        "[Install]\n"
        "WantedBy=timers.target\n"
    )


def build_apply_changes_unit() -> str:
    """Wrapper around scripts/apply-vpn-changes.sh as a polling service.

    The dashboard writes pending_config.json; this host-side service applies it
    (xray run -test + restart, UFW changes). The shell script already loops and
    sleeps, so we run it as a simple always-restarting service.
    """
    return (
        "[Unit]\n"
        "Description=Archie pending-config applier\n"
        "After=xray.service docker.service\n"
        "\n"
        "[Service]\n"
        "Type=simple\n"
        "ExecStart=/bin/bash /opt/archie/scripts/apply-vpn-changes.sh\n"
        "WorkingDirectory=/opt/archie\n"
        "Restart=always\n"
        "RestartSec=10s\n"
        "\n"
        "[Install]\n"
        "WantedBy=multi-user.target\n"
    )
