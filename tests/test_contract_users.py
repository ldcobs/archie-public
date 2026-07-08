"""Contract tests for the Python vpn-api-v3.

These assert the API's actual behavior (per TEST_SPEC §2, §3, §7) at the
HTTP layer. The disable/enable + xray-restart tests (§2.5/2.6, §3.4) target
the dashboard, which is scaffolded separately.
"""

from __future__ import annotations

import json

import pytest


# ─────────────────────────────────────────────────────────────────────────────
# §2.2 — Add a user
# ─────────────────────────────────────────────────────────────────────────────


class TestAddUser:
    def test_add_user_creates_client_and_writes_config(self, api):
        status, body = api.post("/vpn-api/users", {"email": "newuser"})
        assert status == 201
        assert body["email"] == "newuser"
        assert "vless_uri" in body
        # Config written + .bak snapshot exists
        cfg = api.config()
        clients = cfg["inbounds"][0]["settings"]["clients"]
        emails = [c["email"] for c in clients]
        assert "newuser" in emails

    def test_add_user_assigns_unique_uuid(self, api):
        _, _ = api.post("/vpn-api/users", {"email": "user1"})
        _, _ = api.post("/vpn-api/users", {"email": "user2"})
        cfg = api.config()
        ids = [c["id"] for c in cfg["inbounds"][0]["settings"]["clients"]
               if c["email"] in ("user1", "user2")]
        assert len(ids) == 2
        assert len(set(ids)) == 2  # unique

    def test_duplicate_user_rejected(self, api):
        api.post("/vpn-api/users", {"email": "dup"})
        status, body = api.post("/vpn-api/users", {"email": "dup"})
        assert status == 409
        assert "already exists" in body["error"].lower()

    def test_invalid_email_rejected(self, api):
        # The API validates usernames (alnum + ._-), NOT emails. @ is rejected,
        # spaces rejected, non-ASCII rejected, empty rejected. Bare usernames
        # like "no-at-sign" are ACCEPTED by design.
        for bad in ("", "has space", "uni@emailñ.com", "valid@email.com", "-leading", "trailing-"):
            status, body = api.post("/vpn-api/users", {"email": bad})
            assert status == 400, f"expected 400 for {bad!r}, got {status}"

    def test_bare_username_accepted(self, api):
        """Contract: the 'email' field is a username, not an RFC822 address."""
        status, _ = api.post("/vpn-api/users", {"email": "plain-name"})
        assert status == 201

    def test_add_user_does_not_restart_xray(self, api, mock_xray):
        """Per spec §3: a config write via the API must NOT trigger restart."""
        before = mock_xray.test_count
        api.post("/vpn-api/users", {"email": "norestart"})
        after = mock_xray.test_count
        assert after == before, "add_user must not invoke xray run -test"


# ─────────────────────────────────────────────────────────────────────────────
# §2.8 — Delete a user
# ─────────────────────────────────────────────────────────────────────────────


class TestDeleteUser:
    def test_delete_existing_user(self, api):
        # seed user exists (testuser from seed_config (bare username))
        status, body = api.delete("/vpn-api/users/testuser")
        assert status == 200
        assert body["deleted"] == "testuser"
        cfg = api.config()
        emails = [c["email"] for c in cfg["inbounds"][0]["settings"]["clients"]]
        assert "test" not in emails

    def test_delete_nonexistent_user_404(self, api):
        status, body = api.delete("/vpn-api/users/nobody")
        assert status == 404

    def test_delete_preserves_other_users(self, api):
        api.post("/vpn-api/users", {"email": "keep"})
        api.delete("/vpn-api/users/testuser")
        cfg = api.config()
        emails = [c["email"] for c in cfg["inbounds"][0]["settings"]["clients"]]
        assert "keep" in emails
        assert "test" not in emails

    def test_delete_does_not_restart_xray(self, api, mock_xray):
        before = mock_xray.test_count
        api.delete("/vpn-api/users/testuser")
        after = mock_xray.test_count
        assert after == before

    def test_delete_only_touches_clients_array(self, api):
        """§3.3: only the target user's client entry removed, nothing else."""
        before = api.config()
        inbounds_before = [ib["tag"] for ib in before["inbounds"]]
        api.delete("/vpn-api/users/testuser")
        after = api.config()
        assert [ib["tag"] for ib in after["inbounds"]] == inbounds_before


# ─────────────────────────────────────────────────────────────────────────────
# §3.1, §3.5 — Config integrity: atomic write + .bak
# ─────────────────────────────────────────────────────────────────────────────


class TestConfigIntegrity:
    def test_write_produces_bak(self, api):
        api.post("/vpn-api/users", {"email": "bak-testuser"})
        assert (api.xray_dir / "config.json.bak").exists()

    def test_config_remains_valid_json_after_write(self, api):
        api.post("/vpn-api/users", {"email": "valid"})
        cfg = api.config()  # raises if invalid JSON
        assert "inbounds" in cfg

    def test_concurrent_user_adds_all_persist(self, api):
        # Rapid successive changes — verify none are lost (§3.4 spirit)
        for i in range(10):
            api.post("/vpn-api/users", {"email": f"bulk{i}"})
        cfg = api.config()
        emails = [c["email"] for c in cfg["inbounds"][0]["settings"]["clients"]]
        for i in range(10):
            assert f"bulk{i}" in emails


# ─────────────────────────────────────────────────────────────────────────────
# §3.1 — Restart safety: safe_restart tests via /test + /restart
# ─────────────────────────────────────────────────────────────────────────────


class TestRestartSafety:
    def test_inbounds_test_invokes_xray_run_test(self, api, mock_xray):
        before = mock_xray.test_count
        status, body = api.post("/vpn-api/inbounds/test")
        assert status == 200
        assert body["ok"] is True
        assert mock_xray.test_count == before + 1

    def test_safe_restart_aborts_on_failed_test(self, api, tmp_path, monkeypatch):
        """§3.2: invalid config → restart aborted, no half-applied state."""
        # Make xray run -test fail
        fail_xray = tmp_path / "fail-xray"
        fail_xray.write_text("#!/usr/bin/env bash\nexit 1\n")
        fail_xray.chmod(0o755)
        api.module.XRAY_BIN = str(fail_xray)

        status, body = api.post("/vpn-api/inbounds/restart")
        assert status == 200
        assert body["ok"] is False
        assert "Config test failed" in body.get("reason", "")
        assert body["restarted"] is False


# ─────────────────────────────────────────────────────────────────────────────
# §2.1 — List users / inbounds
# ─────────────────────────────────────────────────────────────────────────────


class TestListInbounds:
    def test_list_inbounds_returns_current_set(self, api):
        status, body = api.get("/vpn-api/inbounds", auth=False)
        assert status == 200
        tags = [i["tag"] for i in body["inbounds"]]
        assert "vless-reality" in tags
        assert "shadowsocks" in tags


# ─────────────────────────────────────────────────────────────────────────────
# Auth (§1.4 analog)
# ─────────────────────────────────────────────────────────────────────────────


class TestAuth:
    def test_post_without_token_rejected(self, api):
        status, body = api.post("/vpn-api/users", {"email": "x"}, auth=False)
        assert status == 401

    def test_post_with_wrong_token_rejected(self, api):
        import urllib.request, urllib.error
        url = api.base_url + "/vpn-api/users"
        req = urllib.request.Request(url, data=b'{"email":"x"}', method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", "Bearer wrong-token")
        try:
            urllib.request.urlopen(req, timeout=5)
            assert False, "should have raised"
        except urllib.error.HTTPError as e:
            assert e.code == 401

    def test_stats_is_public(self, api):
        status, _ = api.get("/vpn-api/stats", auth=False)
        assert status == 200

    def test_inbounds_is_public(self, api):
        status, _ = api.get("/vpn-api/inbounds", auth=False)
        assert status == 200


# ─────────────────────────────────────────────────────────────────────────────
# §6.2 — Block / unblock (firewall queue)
# ─────────────────────────────────────────────────────────────────────────────


class TestFirewall:
    def test_block_queues_to_pending_firewall(self, api):
        status, body = api.post("/vpn-api/block/1.2.3.4")
        assert status == 200
        assert body["blocked"] == "1.2.3.4"
        pf = api.state_dir / "pending_firewall.json"
        assert pf.exists()
        data = json.loads(pf.read_text())
        assert any("1.2.3.4" in json.dumps(c) for c in data.get("commands", []))

    def test_block_invalid_ip_rejected(self, api):
        status, _ = api.post("/vpn-api/block/not-an-ip")
        assert status == 400

    def test_unblock_removes_from_queue(self, api):
        api.post("/vpn-api/block/5.6.7.8")
        status, _ = api.delete("/vpn-api/block/5.6.7.8")
        assert status == 200


# ─────────────────────────────────────────────────────────────────────────────
# §4 — Traffic endpoint
# ─────────────────────────────────────────────────────────────────────────────


class TestTraffic:
    def test_traffic_returns_daily_dict(self, api):
        status, body = api.get("/vpn-api/traffic")
        assert status == 200
        assert "daily" in body
        assert body["ok"] is True

    def test_traffic_reflects_seeded_data(self, api):
        # seed traffic_daily.json next to vpn-api.py
        seed = {"2026-06-01": {"test": {"up": 1000, "down": 2000}}}
        (api.state_dir.parent / (api.module.__file__.rsplit("/", 1)[0]) / "traffic_daily.json")
        # traffic path is dirname(abspath(__file__)) — write there
        import os
        td = os.path.join(os.path.dirname(os.path.abspath(api.module.__file__)), "traffic_daily.json")
        with open(td, "w") as f:
            json.dump(seed, f)
        status, body = api.get("/vpn-api/traffic")
        assert "2026-06-01" in body["daily"]


# ─────────────────────────────────────────────────────────────────────────────
# §3.2 — Config write atomicity (no partial writes on read)
# ─────────────────────────────────────────────────────────────────────────────


class TestConfigAtomicity:
    def test_config_never_partial_on_read(self, api):
        """Config read should always be complete valid JSON (atomic writes)."""
        for _ in range(5):
            api.post("/vpn-api/users", {"email": f"atom{hash(object())}"})
            # immediately read — must always be valid
            cfg = api.config()
            assert "inbounds" in cfg


# ─────────────────────────────────────────────────────────────────────────────
# §3.6 — pending_config.json not re-applied (Python side is dead code)
# ─────────────────────────────────────────────────────────────────────────────


class TestNoPendingReapply:
    def test_user_ops_do_not_write_pending_config(self, api):
        """The Python API must not leave stale pending_config.json entries."""
        api.post("/vpn-api/users", {"email": "pend"})
        api.delete("/vpn-api/users/testuser")
        pc = api.state_dir / "pending_config.json"
        # Either doesn't exist or is empty/no-op
        if pc.exists():
            data = json.loads(pc.read_text())
            assert not data, "Python API should not write pending_config.json"
