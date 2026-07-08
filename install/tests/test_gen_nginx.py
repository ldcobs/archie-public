"""Tests for the nginx config generator."""

from __future__ import annotations

from install.lib import gen_nginx


# ── Mode A ──


def test_mode_a_nginx_has_no_stream_block(params_a):
    conf = gen_nginx.build_nginx_conf(params_a)
    assert "stream {" not in conf


def test_mode_a_archie_conf_is_http_only(params_a):
    conf = gen_nginx.build_archie_conf(params_a)
    assert "listen 80;" in conf
    assert "listen 8443" not in conf
    assert "ssl_certificate" not in conf


# ── Modes B and C ──


def test_mode_b_uses_cloudflare_origin_cert(params_b):
    conf = gen_nginx.build_nginx_conf(params_b)
    assert "/etc/ssl/cloudflare-origin.pem" in conf
    assert "/etc/ssl/cloudflare-origin.key" in conf


def test_mode_b_archie_conf_includes_cloudflare_ips(params_b):
    conf = gen_nginx.build_archie_conf(params_b)
    assert "include /etc/nginx/cloudflare-ips.conf;" in conf


def test_mode_c_uses_lets_encrypt_cert(params_c):
    conf = gen_nginx.build_nginx_conf(params_c)
    assert "/etc/letsencrypt/live/vpn.example.com/fullchain.pem" in conf
    assert "/etc/letsencrypt/live/vpn.example.com/privkey.pem" in conf


def test_mode_c_has_acme_challenge_block(params_c):
    conf = gen_nginx.build_archie_conf(params_c)
    assert "acme-challenge" in conf
    assert "root /var/www/certbot" in conf


def test_mode_c_omits_cloudflare_ips(params_c):
    conf = gen_nginx.build_archie_conf(params_c)
    assert "cloudflare-ips.conf" not in conf


def test_both_b_c_have_stream_2053_block(params_b, params_c):
    for p in (params_b, params_c):
        conf = gen_nginx.build_nginx_conf(p)
        assert "listen      2053 ssl;" in conf
        assert "proxy_pass  172.20.0.1:10003;" in conf


def test_https_server_listens_on_8443(params_b):
    conf = gen_nginx.build_archie_conf(params_b)
    assert "listen 8443 ssl;" in conf


def test_protocol_routing_to_host_xray(params_b):
    conf = gen_nginx.build_archie_conf(params_b)
    for loc, port in [
        ("/vmess-ws", "10001"),
        ("/vmess-grpc", "10002"),
        ("/vless-ws", "10004"),
        ("/vless-grpc", "10005"),
        ("/trojan-ws", "10006"),
    ]:
        assert f"location {loc}" in conf
        # the port should appear in the proxy_pass / grpc_pass line
        assert f"172.20.0.1:{port}" in conf


def test_http_to_https_redirect(params_b):
    conf = gen_nginx.build_archie_conf(params_b)
    assert "return 301 https://$host$request_uri" in conf


def test_dashboard_route_present(params_b):
    conf = gen_nginx.build_archie_conf(params_b)
    assert "location /v3/" in conf
    # No port suffix: archie_dashboard is an `upstream {}` block, which already
    # encodes the port — `proxy_pass http://archie_dashboard:3000` is invalid
    # nginx syntax ("upstream may not have port") once a name is an upstream.
    assert "proxy_pass http://archie_dashboard;" in conf
    assert "proxy_pass http://archie_dashboard:3000" not in conf


def test_subscription_route_present(params_b):
    conf = gen_nginx.build_archie_conf(params_b)
    assert "location /v3/api/sub/" in conf


# ── Basic auth ──


def test_basic_auth_off_by_default(params_b):
    conf = gen_nginx.build_archie_conf(params_b)
    assert "auth_basic" not in conf


def test_basic_auth_on_when_flagged(params_b):
    params_b.dashboard_basic_auth = True
    conf = gen_nginx.build_archie_conf(params_b)
    assert 'auth_basic "Archie"' in conf
    assert "auth_basic_user_file /etc/nginx/htpasswd" in conf
    # subscription route must bypass basic auth
    assert "auth_basic off" in conf


# ── Mount artifacts ──


def test_cloudflare_ips_conf_has_allow_and_deny():
    conf = gen_nginx.build_cloudflare_ips_conf()
    assert "allow " in conf
    assert "deny all;" in conf
    # spot-check a known CF range
    assert "173.245.48.0/20" in conf


def test_html_index_has_brand(params_a):
    html = gen_nginx.build_html_index(params_a)
    assert "Test VPN" in html
    assert "<html>" in html


def test_htpasswd_placeholder_is_comment():
    text = gen_nginx.build_htpasswd_placeholder()
    assert text.startswith("#")
