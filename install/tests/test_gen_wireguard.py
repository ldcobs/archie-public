"""Tests for the WireGuard config generator."""

from __future__ import annotations

import json

from install.lib import gen_wireguard


def test_interface_section_has_private_key(params_a):
    conf = gen_wireguard.build_wg0_conf(params_a)
    assert "[Interface]" in conf
    assert f"PrivateKey = {params_a.wg_private}" in conf


def test_listen_port_51820(params_a):
    conf = gen_wireguard.build_wg0_conf(params_a)
    assert "ListenPort = 51820" in conf


def test_tunnel_address_10_7_0_1(params_a):
    conf = gen_wireguard.build_wg0_conf(params_a)
    assert "Address = 10.7.0.1/24" in conf


def test_nat_postup_postdown_present(params_a):
    conf = gen_wireguard.build_wg0_conf(params_a)
    assert "PostUp" in conf
    assert "PostDown" in conf
    assert "MASQUERADE" in conf


def test_nat_uses_detected_wan_iface(params_a):
    params_a.wan_iface = "ens3"
    conf = gen_wireguard.build_wg0_conf(params_a)
    assert "-o ens3" in conf


def test_no_peer_blocks_initially(params_a):
    # Installer ships empty peer list; dashboard adds [Peer] blocks.
    conf = gen_wireguard.build_wg0_conf(params_a)
    assert "[Peer]" not in conf


def test_clients_json_is_empty_array(params_a):
    data = json.loads(gen_wireguard.build_clients_json())
    assert data == []


def test_server_public_for_env(params_a):
    assert gen_wireguard.server_public_for_env(params_a) == params_a.wg_public
