"""Phase 5: Service accounts (PLAN §5 "Service"): machine credentials scoped to endpoints, stored as
hashes only, revocable, managed by an Owner on the LAN (REST) or the CLI."""
import json
import sqlite3

import pytest
from aiohttp.test_utils import TestClient, TestServer
from argon2 import PasswordHasher

from conftest import Mantel
from mantel_server import db
from mantel_server.identity import service_accounts
from mantel_server.identity.service_accounts import ServiceAccountError, ServiceAccounts


@pytest.fixture
def accounts(tmp_path):
    database = db.Database(tmp_path / "mantel.db")
    now = [1000.0]
    yield ServiceAccounts(database.conn, lambda: now[0]), database
    database.close()


def test_the_migration_is_numbered_and_applied_by_the_runner(accounts):
    _, database = accounts
    assert any(m.version == 5 and m.name == "service_accounts" for m in db.discover())
    assert database.conn.execute("SELECT name FROM schema_version WHERE version=5").fetchone()[0] == "service_accounts"
    cols = {r["name"] for r in database.conn.execute("PRAGMA table_info(service_accounts)")}
    assert {"id", "name", "scopes", "secret_hash", "revoked"} <= cols and "token" not in cols
    # idempotent on a bare connection too
    conn = sqlite3.connect(":memory:")
    service_accounts.ensure_schema(conn)
    service_accounts.ensure_schema(conn)


def test_create_verify_scope_and_revoke(accounts, tmp_path):
    acc, database = accounts
    acct, token = acc.create("home-assistant", ["linked"], by="owner-id")
    assert token.startswith("msvc_" + acct.id + "_") and len(token) == 5 + 16 + 1 + 43
    got = acc.verify(token, "linked", source_ip="127.0.0.1")
    assert got == acct and got.scopes == frozenset({"linked"})
    assert acc.verify(token, "gateway") is None, "a scope it was not given"
    for bad in (None, "", token + "x", token[:-1] + ("A" if token[-1] != "A" else "B"),
                "msvc_" + "0" * 16 + "_" + "A" * 43, token.replace("msvc_", "Bearer ")):
        assert acc.verify(bad, "linked") is None, bad
    row = acc.list()[0]
    assert row["last_ip"] == "127.0.0.1" and row["scopes"] == ["linked"] and "secret_hash" not in row
    assert acc.revoke(acct.id) and not acc.revoke(acct.id)
    assert acc.verify(token, "linked") is None and not acc.live(acct.id)
    # only the hash is kept
    database.conn.execute("PRAGMA wal_checkpoint(FULL)")
    raw = b"".join(p.read_bytes() for p in tmp_path.iterdir() if p.name.startswith("mantel.db"))
    assert token.encode() not in raw and token.split("_", 2)[2].encode() not in raw


def test_bad_names_and_scopes_are_refused(accounts):
    acc, _ = accounts
    for name, scopes in (("", ["linked"]), ("x" * 65, ["linked"]), ("ok", []), ("ok", ["everything"]),
                         ("bad\nname", ["linked"])):
        with pytest.raises(ServiceAccountError):
            acc.create(name, scopes)


def test_an_unreadable_row_never_widens(accounts):
    acc, database = accounts
    acct, token = acc.create("ha", ["linked"])
    database.conn.execute("UPDATE service_accounts SET scopes='not json' WHERE id=?", (acct.id,))
    assert acc.verify(token, "linked") is None


def test_the_cli_prints_the_credential_once_and_revokes(tmp_path, capsys):
    from mantel_server.__main__ import main
    data = str(tmp_path / "data")
    assert main(["service-account", "create", "--name", "home-assistant", "--scope", "linked",
                 "--data-dir", data]) == 0
    out = capsys.readouterr().out
    token = next(w for w in out.split() if w.startswith("msvc_"))
    assert main(["service-account", "list", "--data-dir", data]) == 0
    listed = capsys.readouterr().out
    assert "home-assistant" in listed and "live" in listed and token not in listed
    sid = token.split("_")[1]
    assert main(["service-account", "revoke", "--id", sid, "--data-dir", data]) == 0
    assert "revoked" in capsys.readouterr().out
    database = db.Database(tmp_path / "data" / "mantel.db")
    try:
        assert ServiceAccounts(database.conn).verify(token, "linked") is None
    finally:
        database.close()


# -- REST ---------------------------------------------------------------------------------------------
@pytest.fixture
async def mantel_sa(tmp_path, monkeypatch):
    from mantel_server.config import Config
    from mantel_server.ha_client import HaClient
    from mantel_server.readproxy import ReadProxy
    from mantel_server.server import build_app
    from mantel_server.store import Store

    async def forbidden(*args, **kwargs):
        pytest.fail("attempted upstream access")

    monkeypatch.setattr(HaClient, "run", forbidden)
    monkeypatch.setattr(ReadProxy, "request", forbidden)
    cfg = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", port=0)
    store = Store(cfg.data_dir / "mantel.db")
    now = [1_000_000.0]
    app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False, clock=lambda: now[0])
    app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    service_accounts.register(app, app["hub"])
    async with TestClient(TestServer(app)) as client:
        origin = str(client.make_url("")).rstrip("/")
        client.session.headers["Origin"] = origin
        yield Mantel(app, client, store, now, origin)
    store.db.close()


async def test_rest_is_owner_only_on_the_lan(mantel_sa):
    m = mantel_sa
    await m.user("olive", "owner")
    await m.user("adam", "adult")
    r = await m.client.get("/api/service-accounts")
    assert r.status == 401
    await m.sign_in("adam")
    assert (await m.client.get("/api/service-accounts")).status == 403
    assert (await m.post("/api/service-accounts", {"name": "x", "scopes": ["linked"]})).status == 403
    m.forget_cookies()
    await m.sign_in("olive")
    r = await m.post("/api/service-accounts", {"name": "home-assistant", "scopes": ["linked"]})
    assert r.status == 201 and r.headers["Cache-Control"] == "no-store"
    body = await r.json()
    token = body["token"]
    assert m.app["service_accounts"].verify(token, "linked").name == "home-assistant"
    listed = await (await m.client.get("/api/service-accounts")).json()
    assert [a["name"] for a in listed["accounts"]] == ["home-assistant"] and token not in json.dumps(listed)
    assert (await m.post("/api/service-accounts", {"name": "x", "scopes": ["root"]})).status == 400
    r = await m.client.delete(f"/api/service-accounts/{body['account']['id']}", headers=m.headers())
    assert r.status == 200 and m.app["service_accounts"].verify(token, "linked") is None
    assert (await m.client.delete(f"/api/service-accounts/{body['account']['id']}", headers=m.headers())).status == 404
    # Clear Revoked: the revoked one leaves the list (an Owner's, audited); a live one stays
    keep = (await (await m.post("/api/service-accounts", {"name": "script", "scopes": ["linked"]})).json())["account"]
    listed = (await (await m.client.get("/api/service-accounts")).json())["accounts"]
    assert [(a["name"], a["made_by"], a["used_by"]) for a in listed] == [("home-assistant", "owner", None), ("script", "owner", None)]
    r = await m.client.delete("/api/service-accounts/revoked", headers=m.headers())
    assert r.status == 200 and (await r.json())["removed"] == 1
    assert [a["id"] for a in (await (await m.client.get("/api/service-accounts")).json())["accounts"]] == [keep["id"]]


def test_revoked_accounts_leave_the_list_after_thirty_days(accounts):
    accounts, _db = accounts
    a, _ = accounts.create("old", ["linked"])
    b, _ = accounts.create("new", ["linked"])
    accounts.revoke(a.id)
    accounts.clock = lambda: 2_000_000_000.0 + 31 * 86400
    accounts.revoke(b.id)
    assert accounts.forget_revoked(30 * 86400) == [a.id]
    assert [x["name"] for x in accounts.list()] == ["new"]


async def test_rest_refuses_the_tunnel_door(mantel_sa):
    m = mantel_sa
    await m.user("olive", "owner")
    await m.sign_in("olive")                     # a LAN session is bound to its door...
    resp = await m.client.get("/api/service-accounts", headers={"X-Mantel-Door": "tunnel"})
    assert resp.status in (401, 403), "...and the tunnel never manages Service credentials"
