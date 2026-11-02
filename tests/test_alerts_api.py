"""Phase 14's Alerts REST (docs/phase14/SYSTEM-ALERTS.md "The API, roles and audit"): who reads and who changes,
the fresh factor from away, audit before the change (and no change without it), CSRF, and a channel's secret never
in a response, a log line or an audit row."""
from __future__ import annotations

import json
import logging

import pytest
from aiohttp.test_utils import TestClient, TestServer
from argon2 import PasswordHasher

from mantel_server.config import Config
from mantel_server.server import build_app
from mantel_server.store import Store

PASSWORD = "correct horse battery staple"
HOOK = "https://discord.com/api/webhooks/123456789012345678/" + "S3cretW3bh00kT0ken-abcdefghijklmnopqrstuvwxyz0123"
HOOK2 = "https://discord.com/api/webhooks/223456789012345678/" + "An0therT0ken-zyxwvutsrqponmlkjihgfedcba98765432"


class Env:
    def __init__(self, app, client, store, now):
        self.app, self.client, self.store, self.now = app, client, store, now
        self.bodies: list[str] = []
        self.posts: list[tuple[str, dict, bytes]] = []
        self.answer = (204, {}, b"")

        async def transport(method, url, headers, body):
            self.posts.append((url, headers, body))
            return self.answer
        app["alerts"].transport = transport

    def cookie(self, name):
        jar = self.client.session.cookie_jar.filter_cookies(self.client.make_url("/"))
        return jar[name].value if name in jar else None

    async def call(self, method, path, body=None, tunnel=False, csrf=True):
        headers = {}
        if csrf and self.cookie("mantel_csrf"):
            headers["X-CSRF-Token"] = self.cookie("mantel_csrf")
        if tunnel:
            headers["X-Mantel-Door"] = "tunnel"
        r = await self.client.request(method, path, json=body, headers=headers)
        text = await r.text()
        self.bodies.append(text)
        try:
            return r.status, json.loads(text)
        except ValueError:
            return r.status, text

    async def user(self, name, role):
        return await self.app["accounts"].create_user(name, name.title(), role, PASSWORD)

    async def sign_in(self, name):
        r = await self.client.post("/api/auth/password", json={"username": name, "password": PASSWORD})
        assert r.status == 200, await r.text()

    def audit_rows(self, prefix="alerts."):
        rows = self.store.db.execute("SELECT action, target FROM action_audit WHERE kind = 'config' "
                                     "ORDER BY rowid").fetchall()
        return [(r[0], r[1]) for r in rows if r[0] and r[0].startswith(prefix)]


@pytest.fixture
async def env(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", port=0, ha_url="",
                 token_file=tmp_path / "none", ma_token_file=tmp_path / "none2")
    store = Store(cfg.data_dir / "mantel.db")
    now = [1_000_000.0]
    app = build_app(cfg, "", store=store, connect_ha=False, clock=lambda: now[0])
    app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    client = TestClient(TestServer(app))
    await client.start_server()
    client.session.headers["Origin"] = str(client.make_url("")).rstrip("/")
    e = Env(app, client, store, now)
    yield e
    await client.close()
    store.db.close()


async def owner(env, name="avery"):
    await env.user(name, "owner")
    await env.sign_in(name)


async def add_discord(env, url=HOOK, **kw):
    return await env.call("POST", "/api/alerts/channels", {"kind": "discord", "name": "House", "secret": {"url": url},
                                                           **kw})


async def test_the_owner_adds_tests_changes_and_deletes_a_channel_and_the_secret_never_comes_back(env, caplog):
    caplog.set_level(logging.DEBUG)
    await owner(env)
    status, body = await add_discord(env)
    assert status == 201, body
    ch = body["channel"]
    assert ch["kind"] == "discord" and ch["hint"] == HOOK[-4:] and ch["has_secret"] and not ch["needs_secret"]
    assert set(ch["events"]) >= {"ha.lost", "backup.failed"} and "backup.ok" not in ch["events"]
    assert ch["quiet"]["critical"] is True
    status, body = await env.call("POST", f"/api/alerts/channels/{ch['id']}/test")
    assert status == 200 and body["sent"] is True
    url, headers, payload = env.posts[-1]
    assert url.startswith(HOOK) and json.loads(payload)["allowed_mentions"] == {"parse": []}
    env.answer = (404, {}, b'{"message": "Unknown Webhook"}')
    status, body = await env.call("POST", f"/api/alerts/channels/{ch['id']}/test")
    assert status == 502 and body["message"] == "Discord said 404: the webhook was deleted"
    # a change without the secret keeps it; with one replaces it
    status, body = await env.call("PUT", f"/api/alerts/channels/{ch['id']}", {"name": "Family", "min_level": "warning"})
    assert status == 200 and body["channel"]["name"] == "Family" and body["channel"]["hint"] == HOOK[-4:]
    status, body = await env.call("PUT", f"/api/alerts/channels/{ch['id']}", {"secret": {"url": HOOK2}})
    assert status == 200 and body["channel"]["hint"] == HOOK2[-4:]
    for path in ("/api/alerts", "/api/alerts/channels", "/api/alerts/log"):
        assert (await env.call("GET", path))[0] == 200
    status, _ = await env.call("DELETE", f"/api/alerts/channels/{ch['id']}")
    assert status == 200 and env.app["alerts"].channels.all() == []
    actions = [a for a, _ in env.audit_rows()]
    assert actions == ["alerts.channel.saved", "alerts.channel.tested", "alerts.channel.tested",
                       "alerts.channel.saved", "alerts.channel.saved", "alerts.channel.deleted"]
    secret_parts = [HOOK.rsplit("/", 1)[1], HOOK2.rsplit("/", 1)[1]]
    everything = "\n".join(env.bodies) + caplog.text + json.dumps(env.audit_rows())
    assert not [s for s in secret_parts if s in everything]
    raw = env.store.db.execute("SELECT * FROM alert_log").fetchall()
    assert not [s for s in secret_parts if s in repr([tuple(r) for r in raw])]


async def test_another_host_is_refused_at_save(env):
    await owner(env)
    for bad in ("https://evil.example/api/webhooks/1234567/abcdefghijklmnopqrstuvwxyz",
                "http://discord.com/api/webhooks/123456789012/abcdefghijklmnopqrstuvwxyz",
                "https://discord.com.evil.example/api/webhooks/123456789012/abcdefghijklmnopqrstuvwxyz",
                "https://user:pw@discord.com/api/webhooks/123456789012/abcdefghijklmnopqrstuvwxyz"):
        status, body = await add_discord(env, url=bad)
        assert status == 400 and body["error"] == "invalid_webhook", bad
    assert env.posts == [] and env.app["alerts"].channels.all() == []


async def test_who_may_read_and_who_may_change(env):
    await env.user("avery", "owner")
    await env.sign_in("avery")
    _, body = await add_discord(env)
    cid = body["channel"]["id"]
    await env.user("boss", "admin")
    await env.user("mom", "adult")
    await env.sign_in("mom")
    assert (await env.call("GET", "/api/alerts"))[0] == 403
    await env.sign_in("boss")
    status, body = await env.call("GET", "/api/alerts")
    assert status == 200 and body["can_edit"] is False and body["channels"][0]["hint"] == HOOK[-4:]
    for method, path, payload in (("POST", "/api/alerts/channels", {"kind": "discord", "secret": {"url": HOOK}}),
                                  ("PUT", f"/api/alerts/channels/{cid}", {"name": "x"}),
                                  ("DELETE", f"/api/alerts/channels/{cid}", None),
                                  ("POST", f"/api/alerts/channels/{cid}/test", None),
                                  ("PUT", "/api/alerts/settings", {"holds": {"connections": 60}})):
        status, body = await env.call(method, path, payload)
        assert status == 403 and body["error"] == "owner_only", path
    assert env.posts == []


async def test_csrf_and_a_wall_tablet(env):
    await owner(env)
    status, _ = await env.call("POST", "/api/alerts/channels", {"kind": "discord", "secret": {"url": HOOK}},
                               csrf=False)
    assert status == 403 and env.app["alerts"].channels.all() == []
    status, _ = await env.call("POST", "/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen"})
    assert status == 201
    assert (await env.call("GET", "/api/alerts"))[0] == 403


async def test_from_away_a_change_needs_a_fresh_factor(env):
    uid = await env.user("avery", "owner")
    issued = env.app["sessions"].create(uid, "tunnel", "passkey")
    env.client.session.cookie_jar.update_cookies({"mantel_session": issued.access, "mantel_csrf": issued.csrf},
                                                 response_url=env.client.make_url("/"))
    env.now[0] += 360
    status, body = await env.call("GET", "/api/alerts", tunnel=True)
    assert status == 200 and body["needs_fresh"] is True
    status, body = await env.call("POST", "/api/alerts/channels", {"kind": "discord", "secret": {"url": HOOK}},
                                  tunnel=True)
    assert status == 403 and body["error"] == "step_up_required"


async def test_no_audit_no_change(env):
    await owner(env)

    def broken(_row):
        raise RuntimeError("disk full")
    env.app["audit"].config_event = broken
    status, body = await add_discord(env)
    assert status == 503 and body["error"] == "audit_unavailable" and env.app["alerts"].channels.all() == []


async def test_a_restore_with_another_key_keeps_the_channel_and_asks_for_the_secret(env):
    await owner(env)
    _, body = await add_discord(env)
    cid = body["channel"]["id"]
    env.store.db.execute("UPDATE alert_channels SET sealed = ? WHERE id = ?", (b"\x01" + bytes(40), cid))
    env.store.db.commit()
    _, page = await env.call("GET", "/api/alerts")
    assert page["channels"][0]["needs_secret"] is True
    status, body = await env.call("POST", f"/api/alerts/channels/{cid}/test")
    assert status == 502 and "enter it again" in body["message"] and env.posts == []


async def test_the_me_switch_is_on_for_an_owner_off_for_an_admin_until_turned_on(env):
    await owner(env)
    assert (await env.call("GET", "/api/alerts/me"))[1]["system_alerts"] is True
    await env.user("boss", "admin")
    await env.sign_in("boss")
    assert (await env.call("GET", "/api/alerts/me"))[1]["system_alerts"] is False
    status, _ = await env.call("PUT", "/api/alerts/me", {"system_alerts": True})
    assert status == 200
    names = sorted(p["name"] for p in env.app["alerts"].app_recipients())
    assert names == ["Avery", "Boss"]
    assert ("alerts.me.saved", json.dumps({"system_alerts": True})) in [
        (a, json.dumps(json.loads(d))) for a, d in env.audit_rows()]


async def test_the_heartbeat_is_sealed_and_called(env):
    await owner(env)
    url = "https://hc-ping.com/6f1c2a8e-0000-4000-8000-123456789abc"
    status, body = await env.call("PUT", "/api/alerts/settings", {"heartbeat": {"url": url, "every": 300}})
    assert status == 200 and body["heartbeat"]["on"] is True and url not in json.dumps(body)
    raw = env.store.db.execute("SELECT value FROM alert_settings WHERE key = 'heartbeat'").fetchone()[0]
    assert "6f1c2a8e" not in raw and "hc-ping.com" in raw                  # the service shown, never its key
    await env.app["alerts"].heartbeat()
    assert env.posts[-1][0] == url
    status, body = await env.call("PUT", "/api/alerts/settings", {"heartbeat": {"url": "http://hc-ping.com/x"}})
    assert status == 400
    status, body = await env.call("PUT", "/api/alerts/settings", {"heartbeat": {}})       # the page's Turn Off
    assert status == 200 and body["heartbeat"]["on"] is False and env.app["alerts"].heartbeat_url() is None
    for inside in ("https://127.0.0.1/ping", "https://169.254.169.254/x", "https://10.0.0.5/x", "https://nas.local/x"):
        status, _ = await env.call("PUT", "/api/alerts/settings", {"heartbeat": {"url": inside}})
        assert status == 400, inside


# -- the MCP tools (phase 12's rules) --------------------------------------------------------------------------------
async def test_the_mcp_tools_read_for_managers_and_alerts_test_is_the_owners_planned_change(env):
    from types import SimpleNamespace as NS
    from mantel_server.mcp.dispatch import ToolError
    from mantel_server.mcp.tools import alerts as T, all_tools
    tools = {t.name: t for t in all_tools()}
    assert tools["alerts_recent"].needs == "read" and not tools["alerts_recent"].write
    assert tools["alerts_test"].write and tools["alerts_test"].takes_plan
    await owner(env)
    _, body = await add_discord(env)
    cid = body["channel"]["id"]
    env.app["alerts"].center.raise_("backup.failed", "", {"error": "disk full"})
    admin = NS(app=env.app, user=NS(role="admin"))
    got = await T.alerts_recent(admin, {})
    assert got["log"][0]["title"] == "Backup failed" and got["channels"][0]["name"] == "House"
    assert HOOK.rsplit("/", 1)[1] not in json.dumps(got)
    assert "products" in await T.updates_status(admin, {})
    with pytest.raises(ToolError) as refused:
        await T.alerts_test(admin, {"channel": cid})
    assert refused.value.code == "owner_only"
    with pytest.raises(ToolError):
        await T.alerts_recent(NS(app=env.app, user=NS(role="adult")), {})
