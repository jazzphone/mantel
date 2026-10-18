"""Permission and audit proof: fictional identities, temporary DB, no HA connection."""
import sqlite3

import pytest
from aiohttp.test_utils import TestClient, TestServer

from mantel_server.auth import SESSION_COOKIE
from mantel_server.config import Config
from mantel_server.proof2 import ACTION, COMMAND, PATH, TARGET, Grant, decide
from mantel_server.server import build_app
from mantel_server.store import Store


@pytest.fixture
async def env(tmp_path, monkeypatch):
    from mantel_server.ha_client import HaClient
    from mantel_server.readproxy import ReadProxy

    async def forbidden(*args, **kwargs):
        pytest.fail("Proof 2 attempted upstream access")

    monkeypatch.setattr(HaClient, "run", forbidden)
    monkeypatch.setattr(HaClient, "_send", forbidden)
    monkeypatch.setattr(ReadProxy, "request", forbidden)
    store = Store(tmp_path / "proof.db")
    store.link("fictional-owner", "owner")
    now = [1000.0]
    sid = store.create_session("fictional-owner", 60, now[0])
    app = build_app(Config(data_dir=tmp_path), "unused-fictional-token", store=store,
                    connect_ha=False, clock=lambda: now[0])
    async with TestClient(TestServer(app)) as client:
        client.session.cookie_jar.update_cookies({SESSION_COOKIE: sid})
        client.session.headers["Origin"] = str(client.make_url("/")).rstrip("/")
        yield client, store, now
    store.db.close()


def rows(store):
    return [dict(r) for r in store.db.execute("SELECT * FROM command_audit ORDER BY id")]


async def test_owner_allowed_child_denied_and_role_changes_take_effect(env):
    client, store, _ = env
    first = await client.post(PATH, json=COMMAND)
    assert first.status == 200
    assert await first.json() == {"dry_run": True, "executed": False, "decision": "allowed",
                                  "reason": "granted", "audit_id": 1}
    store.link("fictional-owner", "child")
    second = await client.post(PATH, json=COMMAND)
    assert second.status == 403
    assert (await second.json())["reason"] == "no_grant"
    audit = rows(store)
    assert [(r["role"], r["decision"]) for r in audit] == [("owner", "allowed"), ("child", "denied")]
    assert all(r["actor"] == "fictional-owner" and r["device"] == "unknown" and r["dry_run"] == 1
               and r["source_ip"] == "127.0.0.1" for r in audit)
    assert audit[0]["action"] == ACTION and audit[0]["target"] == TARGET


def test_explicit_deny_wins_and_ungranted_roles_are_denied():
    allow = Grant("owner", ACTION, TARGET, "allow")
    deny = Grant("owner", ACTION, TARGET, "deny")
    assert decide("owner", (allow, deny)) == decide("owner", (deny, allow)) == "explicit_deny"
    assert decide("child") == decide("admin") == decide("unknown") == "no_grant"
    assert decide("owner", (Grant("owner", ACTION, "light.other", "allow"),)) == "no_grant"


@pytest.mark.parametrize("body", [
    {}, [], None, {**COMMAND, "dry_run": False}, {**COMMAND, "dry_run": 1},
    {**COMMAND, "cmd": "valve.close_valve", "target": "valve.fictional"},
    {**COMMAND, "target": "light.kitchen"}, {**COMMAND, "role": "owner"},
    {**COMMAND, "user": "forged"}, {**COMMAND, "device_id": "forged"},
    {**COMMAND, "data": {"token": "must-not-be-logged"}},
])
async def test_unsupported_or_forged_requests_are_denied_and_audited(env, body):
    client, store, _ = env
    response = await client.post(PATH, json=body)
    assert response.status == 400
    assert (await response.json())["executed"] is False
    assert rows(store)[0]["decision"] == "denied"
    assert "must-not-be-logged" not in str(rows(store))


async def test_malformed_json_is_audited(env):
    client, store, _ = env
    response = await client.post(PATH, data="{broken", headers={"Content-Type": "application/json"})
    assert response.status == 400
    assert rows(store)[0]["reason"] == "unsupported_command"


@pytest.mark.parametrize("invalidate", ["expire", "unlink", "missing"])
async def test_invalid_session_cannot_use_client_identity(env, invalidate):
    client, store, now = env
    if invalidate == "expire":
        now[0] += 61
    elif invalidate == "unlink":
        store.unlink("fictional-owner")
    else:
        client.session.cookie_jar.clear()
    response = await client.post(PATH, json={**COMMAND, "role": "owner"})
    assert response.status == 401
    audit = rows(store)[0]
    assert audit["actor"] is None and audit["role"] is None and audit["reason"] == "unauthenticated"


async def test_audit_failure_fails_closed(env, monkeypatch):
    client, store, _ = env

    def broken(**kwargs):
        raise sqlite3.OperationalError("disk full")

    monkeypatch.setattr(store, "audit_command", broken)
    response = await client.post(PATH, json=COMMAND)
    assert response.status == 503
    assert await response.json() == {"dry_run": True, "executed": False, "error": "audit_unavailable"}


async def test_child_cannot_claim_owner_or_supply_grants(env):
    client, store, _ = env
    store.link("fictional-owner", "child")
    response = await client.post(PATH, json={**COMMAND, "role": "owner", "grants": ["*"]})
    assert response.status == 400
    assert rows(store)[0]["role"] == "child"


async def test_normal_websocket_commands_remain_disabled(env):
    client, store, _ = env
    # No upstream task is running; the stats loop still has the real client's counters.
    ws = await client.ws_connect("/ws")
    await ws.send_json({"type": "command", **COMMAND})
    assert (await ws.receive_json())["code"] == "commands_disabled"
    await ws.close()


async def test_origin_required_and_foreign_origin_blocked(env):
    client, store, _ = env
    del client.session.headers["Origin"]
    response = await client.post(PATH, json=COMMAND)
    assert response.status == 403
    assert rows(store)[0]["reason"] == "origin_required"
    response = await client.post(PATH, json=COMMAND, headers={"Origin": "http://foreign.example"})
    assert response.status == 403


async def test_audit_survives_reopen_and_cannot_be_modified(env):
    client, store, _ = env
    await client.post(PATH, json=COMMAND)
    db_path = store.db.execute("PRAGMA database_list").fetchone()[2]
    reopened = Store(db_path)
    try:
        assert rows(reopened)[0]["decision"] == "allowed"
        for sql in ("DELETE FROM command_audit", "UPDATE command_audit SET decision='denied'"):
            with pytest.raises(sqlite3.IntegrityError, match="append-only"):
                with reopened.db:
                    reopened.db.execute(sql)
    finally:
        reopened.db.close()
