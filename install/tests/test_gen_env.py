"""Tests for the .env generator."""

from __future__ import annotations

from install.lib import gen_env
from install.lib.common import Params


def _env_lines(p: Params) -> list[str]:
    return gen_env.build_root_env(p).splitlines()


def _kv(lines: list[str]) -> dict[str, str]:
    out = {}
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v
    return out


def test_required_secrets_are_present_and_nonempty(params_a):
    kv = _kv(_env_lines(params_a))
    assert kv.get("AUTH_SECRET") == params_a.auth_secret
    assert kv.get("VPN_API_V3_TOKEN") == params_a.api_token
    assert len(kv["VPN_API_V3_TOKEN"]) >= 32


def test_reality_public_values_mirrored_to_next_public(params_a):
    kv = _kv(_env_lines(params_a))
    assert kv["VLESS_PBK"] == params_a.reality_pbk
    assert kv["NEXT_PUBLIC_VLESS_PBK"] == params_a.reality_pvk[:0] or kv["NEXT_PUBLIC_VLESS_PBK"] == params_a.reality_pbk
    assert kv["VLESS_SID"] == params_a.reality_sid
    assert kv["NEXT_PUBLIC_VLESS_SID"] == params_a.reality_sid
    assert kv["VLESS_SNI"] == params_a.reality_sni


def test_server_identity_baked(params_a):
    kv = _kv(_env_lines(params_a))
    assert kv["NEXT_PUBLIC_SERVER_IP"] == params_a.server_ip
    assert kv["SERVER_IP"] == params_a.server_ip
    # Mode A has no TLS anywhere — https:// here would send every generated
    # invite/subscription link to Xray's Reality listener on :443 instead of
    # the dashboard (that exact bug shipped and was caught live).
    assert kv["NEXT_PUBLIC_PUBLIC_BASE_URL"].startswith("http://")
    assert kv["NEXT_PUBLIC_PUBLIC_BASE_URL"].endswith(params_a.base_path)


def test_mode_a_url_uses_ip_http_and_dashboard_port(params_a):
    kv = _kv(_env_lines(params_a))
    # Must match gen_compose.MODE_A_DASHBOARD_PORT (8080) — the dashboard's
    # actual published port for a Mode A install.
    assert kv["NEXT_PUBLIC_PUBLIC_BASE_URL"] == f"http://{params_a.server_ip}:8080/v3"


def test_mode_b_url_uses_domain(params_b):
    kv = _kv(_env_lines(params_b))
    assert kv["NEXT_PUBLIC_SERVER_DOMAIN"] == "vpn.example.com"
    assert kv["NEXT_PUBLIC_PUBLIC_BASE_URL"] == "https://vpn.example.com:8443/v3"


def test_mode_c_url_uses_dashboard_tls_port(params_c):
    kv = _kv(_env_lines(params_c))
    assert kv["NEXT_PUBLIC_SERVER_DOMAIN"] == "vpn.example.com"
    assert kv["NEXT_PUBLIC_PUBLIC_BASE_URL"] == "https://vpn.example.com:8443/v3"


def test_no_api_auth_token_var_to_avoid_divergence(params_a):
    # We deliberately only emit VPN_API_V3_TOKEN (compose forwards it as
    # API_AUTH_TOKEN inside the container). A second API_AUTH_TOKEN in .env
    # would risk the two diverging.
    kv = _kv(_env_lines(params_a))
    assert "API_AUTH_TOKEN" not in kv


def test_paths_point_at_container_layout(params_a):
    kv = _kv(_env_lines(params_a))
    assert kv["XRAY_CFG"] == "/etc/xray/config.json"
    assert kv["STATE_DIR"] == "/app/vpn-api"
    assert kv["DATA_DIR"] == "/app/data"
    assert kv["VPN_API_INTERNAL_URL"] == "http://vpn-api-v3:5900"
    assert kv["WG_CLIENTS_FILE"] == "/etc/wireguard/clients.json"


def test_log_paths_use_host_remap(params_a):
    kv = _kv(_env_lines(params_a))
    assert kv["LOG_ACCESS"] == "/var/log/xray/access.log"
    assert kv["LOG_AUTH"] == "/var/log/host/auth.log"
    # HOST_TCP6 is no longer env-driven — vpn-api-v3/vpn-dashboard-v3 both read
    # /proc/1/net/tcp6 directly via `pid: host` (see docker-compose.vpn.yml).
    assert "HOST_TCP6" not in kv


def test_telegram_emitted_only_when_token_present(params_a):
    kv = _kv(_env_lines(params_a))
    assert "TELEGRAM_BOT_TOKEN" not in kv
    params_a.tg_token = "tok"
    params_a.tg_chat_id = "123"
    kv = _kv(_env_lines(params_a))
    assert kv["TELEGRAM_BOT_TOKEN"] == "tok"
    assert kv["TELEGRAM_CHAT_ID"] == "123"


def test_abuseipdb_emitted_only_when_present(params_a):
    kv = _kv(_env_lines(params_a))
    assert "ABUSEIPDB_API_KEY" not in kv
    params_a.abuseipdb_key = "abc"
    kv = _kv(_env_lines(params_a))
    assert kv["ABUSEIPDB_API_KEY"] == "abc"


def test_dashboard_env_production_has_only_next_public(params_a):
    text = gen_env.build_dashboard_env_production(params_a)
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k = line.partition("=")[0]
        # build-time env must be all NEXT_PUBLIC_* (inlined by next build)
        assert k.startswith("NEXT_PUBLIC_"), f"unexpected build-time var {k}"


def test_dashboard_env_production_has_no_secrets(params_a):
    text = gen_env.build_dashboard_env_production(params_a)
    assert "AUTH_SECRET" not in text
    assert "VPN_API_V3_TOKEN" not in text
    assert "API_AUTH_TOKEN" not in text


def test_base_path_is_v3(params_a):
    kv = _kv(_env_lines(params_a))
    assert kv["NEXT_PUBLIC_BASE_PATH"] == "/v3"


def test_smtp_absent_when_no_host(params_a):
    kv = _kv(_env_lines(params_a))
    assert "SMTP_HOST" not in kv
    assert "SMTP_PASS" not in kv


def test_smtp_emitted_when_host_present(params_a):
    params_a.smtp_host = "smtp.example.com"
    params_a.smtp_port = "465"
    params_a.smtp_secure = "true"
    params_a.smtp_user = "invites@example.com"
    params_a.smtp_pass = "s3cr3t"
    params_a.smtp_from = "My VPN <invites@example.com>"
    kv = _kv(_env_lines(params_a))
    assert kv["SMTP_HOST"] == "smtp.example.com"
    assert kv["SMTP_PORT"] == "465"
    assert kv["SMTP_SECURE"] == "true"
    assert kv["SMTP_USER"] == "invites@example.com"
    assert kv["SMTP_PASS"] == "s3cr3t"
    assert kv["SMTP_FROM"].startswith("My VPN")


def test_smtp_optional_fields_omitted_when_blank(params_a):
    # Host present but no port/secure/user → those keys are not emitted, the
    # app applies its own defaults (587 / STARTTLS).
    params_a.smtp_host = "smtp.example.com"
    params_a.smtp_from = "VPN <a@b.com>"
    kv = _kv(_env_lines(params_a))
    assert kv["SMTP_HOST"] == "smtp.example.com"
    assert "SMTP_PORT" not in kv
    assert "SMTP_SECURE" not in kv
    assert "SMTP_USER" not in kv


def test_no_smtp_suppresses_emission(params_a):
    params_a.smtp_host = "smtp.example.com"
    params_a.smtp_from = "VPN <a@b.com>"
    params_a.no_smtp = True
    kv = _kv(_env_lines(params_a))
    assert "SMTP_HOST" not in kv
