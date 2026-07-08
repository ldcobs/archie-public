"""Tests for the --apply plan builder (pure; no host mutation)."""

from __future__ import annotations

from pathlib import Path

from install.lib import apply
from install.lib.apply import build_plan


def _plan(p):
    return build_plan(p, Path("/tmp/staging"))


def _by_name(steps):
    return {s.name: s for s in steps}


def _names(steps):
    return [s.name for s in steps]


def test_plan_is_pure_returns_steps(params_a):
    steps = _plan(params_a)
    assert steps and all(isinstance(s, apply.Step) for s in steps)


def test_mode_a_core_steps_present_and_ordered(params_a):
    names = _names(_plan(params_a))
    for n in ("pkg-base", "docker", "xray", "hysteria", "xray-config",
              "systemd-units", "sync-stack", "xray-test", "host-services",
              "ailab-net", "compose-up"):
        assert n in names, f"missing step {n}"
    # packages before host files before stack before compose
    assert names.index("pkg-base") < names.index("xray-config")
    assert names.index("xray-config") < names.index("sync-stack")
    assert names.index("xray-test") < names.index("compose-up")


def test_idempotency_checks_on_expensive_steps(params_a):
    by = _by_name(_plan(params_a))
    assert by["docker"].check and "docker compose version" in by["docker"].check
    assert by["xray"].check == "test -x /usr/local/bin/xray"
    assert by["hysteria"].check == "test -x /usr/local/bin/hysteria"
    assert by["ailab-net"].check and "network inspect ailab" in by["ailab-net"].check
    assert by["xray-config"].check and "cmp -s" in by["xray-config"].check


def test_xray_config_validation_is_not_allowed_to_fail(params_a):
    by = _by_name(_plan(params_a))
    assert by["xray-test"].allow_fail is False
    assert "run -test" in by["xray-test"].sh


def test_mode_a_compose_uses_overlay_and_two_services(params_a):
    by = _by_name(_plan(params_a))
    sh = by["compose-up"].sh
    assert "-f docker-compose.vpn.yml -f docker-compose.modeA.yml" in sh
    assert "vpn-api-v3 vpn-dashboard-v3" in sh
    assert "nginx" not in sh


def test_mode_a_network_subnet_pinned(params_a):
    by = _by_name(_plan(params_a))
    assert "--subnet 172.20.0.0/16 ailab" in by["ailab-net"].sh


def test_mode_a_opens_dashboard_but_not_domain_ports(params_a):
    # Mode A publishes the dashboard by IP (8080), so ufw-dash IS present — but
    # still no domain-mode ports (no 80/8443/2053, no CDN inbound range).
    by = _by_name(_plan(params_a))
    names = list(by)
    assert "ufw-dash" in names
    assert by["ufw-dash"].sh == "ufw allow 8080/tcp"
    assert "ufw-cdn" not in names
    assert "ufw-tls" not in names
    assert not any(s.sh == "ufw allow 80/tcp" for s in by.values())


def test_mode_a_dashboard_override_published_on_ip(params_a):
    from install.lib import gen_compose
    ov = gen_compose.build_mode_a_override(params_a)
    # Mode A has no domain, so the dashboard is reachable by IP (no SSH tunnel).
    assert '0.0.0.0:8080:3000' in ov
    assert '127.0.0.1:' not in ov


def test_mode_a_ufw_allows_core_protocol_ports(params_a):
    by = _by_name(_plan(params_a))
    assert by["ufw-reality"].sh == "ufw allow 443/tcp"
    assert by["ufw-hy2"].sh == "ufw allow 2096/udp"
    assert by["ufw-wg"].sh == "ufw allow 51820/udp"
    # Shadowsocks is public in Mode A (direct protocol), restricted in B/C.
    assert by["ufw-ss"].sh == "ufw allow 8388/tcp"


def test_mode_bc_shadowsocks_is_docker_restricted(params_b):
    by = _by_name(_plan(params_b))
    assert "172.20.0.0/16" in by["ufw-ss"].sh
    # Xray control api is always docker-restricted, never public.
    assert "172.20.0.0/16" in by["ufw-api"].sh


def test_ssh_allowed_before_ufw_enable(params_a):
    names = _names(_plan(params_a))
    assert names.index("ufw-ssh") < names.index("ufw-enable")


def test_mode_b_has_cf_cert_and_cdn_ufw(params_b):
    names = _names(_plan(params_b))
    assert "cf-origin-cert" in names
    assert "ufw-cdn" in names and "ufw-tls" in names
    by = _by_name(_plan(params_b))
    assert by["compose-up"].sh.count("-f ") == 1
    assert "nginx" in by["compose-up"].sh


def test_mode_b_validates_cert_key_pair_before_install(params_b):
    # A mismatched/typo'd Cloudflare Origin cert+key must fail fast with a clear
    # step, not surface later as a cryptic nginx/Hysteria handshake error —
    # verified live during Mode B bring-up (openssl pubkey pair-check).
    names = _names(_plan(params_b))
    assert "cf-cert-validate" in names
    assert names.index("cf-cert-validate") < names.index("cf-origin-cert")
    by = _by_name(_plan(params_b))
    # must be a hard gate (not allow_fail) and actually compare the two pubkeys
    assert by["cf-cert-validate"].allow_fail is False
    assert "openssl" in by["cf-cert-validate"].sh
    assert "cloudflare-origin.key" in by["cf-cert-validate"].sh


def test_mode_b_does_not_issue_a_lets_encrypt_cert(params_b):
    # Mode B gets its cert from Cloudflare (uploaded), never Let's Encrypt — the
    # plan must contain no ACME issuance step. (The certbot container may still
    # sit idle in the compose stack; what must NOT happen is a cert being issued
    # here, i.e. no `certonly`/`--standalone` and no `le-issue` step.)
    by = _by_name(_plan(params_b))
    assert "le-issue" not in by
    assert not any("certonly" in s.sh for s in _plan(params_b))


def test_mode_c_runs_certbot_issue(params_c):
    by = _by_name(_plan(params_c))
    assert "le-issue" in by
    assert "vpn.example.com" in by["le-issue"].sh
    # The certbot container's /etc/letsencrypt is bind-mounted from
    # <install-dir>/data/certbot/conf on the HOST. This check runs directly on
    # the host shell (not inside a container), so it must probe the host-side
    # mount path — bare /etc/letsencrypt/live/... is untouched on the host and
    # a check against it would always fail even after a successful issuance.
    assert by["le-issue"].check and "data/certbot/conf/live/vpn.example.com" in by["le-issue"].check
    # The certbot compose service's entrypoint is a long-running renewal loop
    # that silently swallows any command appended by `docker compose run`
    # unless --entrypoint overrides it — without this, every Mode C install
    # hangs forever on `certbot renew` (no-op) + `sleep 12h` instead of
    # actually issuing the cert.
    assert "--entrypoint certbot" in by["le-issue"].sh
    # nginx's generated config for mode C references the LE cert path, so
    # nginx cannot start until the cert exists — but nginx (started later, in
    # compose-up) is what would normally serve a --webroot HTTP-01 challenge.
    # --standalone breaks that deadlock: certbot binds port 80 itself.
    assert "certonly --standalone" in by["le-issue"].sh
    assert "--publish 80:80" in by["le-issue"].sh


def test_mode_c_hysteria_cert_uses_host_mount_path(params_c):
    # Same host-vs-container path pitfall as le-issue's check: the real cert
    # lives at <install-dir>/data/certbot/conf/live/<domain>/ on the host.
    by = _by_name(_plan(params_c))
    assert "hysteria-cert" in by
    assert "data/certbot/conf/live/vpn.example.com/fullchain.pem" in by["hysteria-cert"].sh
    assert "data/certbot/conf/live/vpn.example.com/privkey.pem" in by["hysteria-cert"].sh


def test_mode_c_ailab_net_before_le_issue(params_c):
    names = _names(_plan(params_c))
    # le-issue runs `docker compose run --rm certbot`, and the compose file
    # declares ailab as an external network — compose refuses to run any
    # service if a declared external network doesn't exist yet.
    assert names.index("ailab-net") < names.index("le-issue")


def test_no_firewall_drops_ufw_steps(params_a):
    params_a.no_firewall = True
    names = _names(_plan(params_a))
    assert not any(n.startswith("ufw-") for n in names)


def test_no_fail2ban_excluded_from_packages_and_services(params_a):
    params_a.no_fail2ban = True
    by = _by_name(_plan(params_a))
    assert "fail2ban" not in by["pkg-base"].sh
    assert "fail2ban" not in by["host-services"].sh


def test_apply_changes_service_is_enabled(params_a):
    # The dashboard queues firewall block/unblock commands (and the legacy
    # config-restart fallback) to archie-apply-changes.service. The unit ships
    # in staging/systemd/ unconditionally, so it must always be enabled here —
    # otherwise queued commands are written but never applied on any install.
    by = _by_name(_plan(params_a))
    assert "archie-apply-changes" in by["host-services"].sh


def test_traffic_poller_timer_is_conditional_when_script_missing(params_a):
    by = _by_name(_plan(params_a))
    step = by["poller-timer"]
    assert "test -f /opt/archie/vpn-api-v3/traffic_poller.py" in step.sh
    assert "systemctl enable --now archie-traffic-poller.timer" in step.sh
    assert "systemctl disable --now archie-traffic-poller.timer" in step.sh
    # absent script must also clear any failed state so the install ends clean
    assert "systemctl reset-failed archie-traffic-poller" in step.sh
    assert step.allow_fail is False


def test_rhel_uses_dnf_or_yum(params_a):
    params_a.os_id = "rocky"
    by = _by_name(_plan(params_a))
    assert by["pkg-base"].sh.startswith(("dnf", "yum"))


def test_debian_uses_apt(params_a):
    params_a.os_id = "ubuntu"
    by = _by_name(_plan(params_a))
    assert "apt-get install" in by["pkg-base"].sh


def test_dry_run_executes_nothing(params_a, capsys):
    steps = _plan(params_a)
    rc = apply.run_plan(steps, dry_run=True)
    assert rc == 0
    captured = capsys.readouterr()
    out = captured.out + captured.err
    # every step's command line is printed under a `$` prefix
    assert out.count("$ ") >= len(steps)


def test_self_check_dashboard_accepts_301(monkeypatch, params_a):
    # nginx's own trailing-slash normalization (e.g. /v3 -> /v3/) returns 301,
    # a healthy response — verified live where a real running dashboard was
    # wrongly reported as down because 301 wasn't in the accepted set.
    calls: list[str] = []

    def fake_probe(cmd: str) -> bool:
        calls.append(cmd)
        return True

    monkeypatch.setattr(apply, "_probe", fake_probe)
    apply.self_check(params_a, dashboard_url="http://198.51.100.10:8080/v3")
    dash_cmd = next(c for c in calls if "http_code" in c)
    assert "301" in dash_cmd


def test_self_check_dashboard_resolves_domain_to_localhost(params_c):
    # A cloud instance often can't reach its own public IP over the internet-
    # facing route (AWS hairpin NAT) — verified live: a working dashboard
    # (200 externally, 200 via 127.0.0.1) was reported "down" because the
    # self-check curled the real public domain from inside the box itself.
    # --resolve keeps Host/SNI as the real domain (nginx still routes
    # correctly, real cert still exercised) but skips the self-connect.
    calls: list[str] = []

    def fake_probe(cmd: str) -> bool:
        calls.append(cmd)
        return True

    import install.lib.apply as apply_mod
    orig = apply_mod._probe
    apply_mod._probe = fake_probe
    try:
        apply_mod.self_check(params_c, dashboard_url=f"https://{params_c.server_domain}:8443/v3")
    finally:
        apply_mod._probe = orig
    dash_cmd = next(c for c in calls if "http_code" in c)
    assert f"--resolve {params_c.server_domain}:8443:127.0.0.1" in dash_cmd


def test_self_check_mode_b_probes_through_cloudflare_not_localhost(params_b):
    # Opposite of Mode C: in Mode B the domain resolves to Cloudflare (not the
    # box) and the origin nginx allowlists Cloudflare IPs, denying everything
    # else. A --resolve to 127.0.0.1 hits the origin directly and gets 403 — a
    # false "down" on a healthy install. Verified live: localhost:8443 -> 403,
    # via Cloudflare -> 200. Mode B must probe the real domain (no --resolve).
    calls: list[str] = []

    def fake_probe(cmd: str) -> bool:
        calls.append(cmd)
        return True

    import install.lib.apply as apply_mod
    orig = apply_mod._probe
    apply_mod._probe = fake_probe
    try:
        apply_mod.self_check(params_b, dashboard_url=f"https://{params_b.server_domain}:8443/v3")
    finally:
        apply_mod._probe = orig
    dash_cmd = next(c for c in calls if "http_code" in c)
    assert "--resolve" not in dash_cmd
