"""HK's per-person frontend user data is Mantel's own (user_data.py, migration 0013): the Music page's
speaker (`hk_music_focus`) is saved with `user_data_set` and followed with `frontend/subscribe_user_data`,
per person, with commands on or off, and none of it is a house command or reaches Home Assistant."""
from __future__ import annotations

import re
from pathlib import Path
from types import SimpleNamespace

import pytest
from aiohttp.test_utils import TestClient, TestServer

import gateway_fakes as GF
from conftest import Mantel
from mantel_server.storage import user_data as UD

ROOT = Path(__file__).resolve().parent.parent
FOCUS = {"key": "media_player.office", "at": 1700000000000}
SUB = {"type": "frontend/subscribe_user_data", "key": "hk_music_focus"}


def house(commands: bool):
    @pytest.fixture
    async def env(tmp_path, monkeypatch):
        app, store, now, fake = await GF.make(tmp_path, monkeypatch, commands=commands)
        async with TestClient(TestServer(app)) as client:
            origin = str(client.make_url("")).rstrip("/")
            client.session.headers["Origin"] = origin
            yield GF.Env(Mantel(app, client, store, now, origin), fake)
        store.db.close()
    return env


on = house(True)
off = house(False)


def count(env):
    return env.app["store"].db.execute("SELECT COUNT(*) FROM user_data").fetchone()[0]


async def rpc(ws, msg):
    await ws.send_json(msg)
    while True:
        got = await GF.recv(ws)
        if got.get("id") == msg["id"]:
            return got


async def sub(ws, rid=70, msg=SUB):
    await ws.send_json({"type": "read_subscribe", "id": rid, "msg": msg})
    result = event = None
    while result is None or event is None:
        got = await GF.recv(ws)
        if got.get("id") != rid:
            continue
        if got["type"] == "read_result":
            result = got
            if "error" in got:
                return got, None
        elif got["type"] == "read_event":
            event = got["event"]
    return result, event


async def event(ws, rid=70):
    while True:
        got = await GF.recv(ws)
        if got.get("type") == "read_event" and got["id"] == rid:
            return got["event"]


def save(value, rid=5, key="hk_music_focus"):
    return {"type": "user_data_set", "id": rid, "key": key, "value": value}


async def test_set_then_subscribe_round_trip_with_commands_off(off):
    await off.login("jamie", "adult")
    ws = await off.socket(expect_caps=False)
    res, first = await sub(ws)
    assert "error" not in res and first == {"value": None}          # nothing stored yet: null, not an error
    assert (await rpc(ws, save(FOCUS)))["result"] is None
    assert await event(ws) == {"value": FOCUS}                       # every change follows
    await ws.close()
    # a new screen of the same person reads it back first
    ws = await off.socket(expect_caps=False)
    _, first = await sub(ws, rid=71)
    assert first == {"value": FOCUS}
    got = await rpc(ws, {"type": "read", "id": 9, "msg": {"type": "frontend/get_user_data", "key": "hk_music_focus"}})
    assert got["result"] == {"value": FOCUS}
    assert count(off) == 1                                           # in Mantel's database, not HA's
    await ws.close()


async def test_another_screen_of_the_same_person_follows(off):
    await off.login("jamie", "adult")
    a, b = await off.socket(expect_caps=False), await off.socket(expect_caps=False)
    await sub(a)
    await rpc(b, save(FOCUS))
    assert await event(a) == {"value": FOCUS}
    await rpc(b, save(None, rid=6))                                  # cleared
    assert await event(a) == {"value": None}
    await a.close()
    await b.close()


async def test_each_person_has_their_own(off):
    await off.login("jamie", "adult")
    jamie = await off.socket(expect_caps=False)
    await rpc(jamie, save(FOCUS))
    await off.login("kim", "adult")
    kim = await off.socket(expect_caps=False)
    _, first = await sub(kim)
    assert first == {"value": None}, "kim must not see jamie's speaker"
    other = {"key": "media_player.den", "at": 5}
    await rpc(kim, save(other))
    assert await event(kim) == {"value": other}
    _, first = await sub(jamie)
    assert first == {"value": FOCUS}, "kim's save did not touch jamie's"
    await jamie.close()
    await kim.close()


async def test_unknown_key_and_bad_values_are_refused(off):
    await off.login("jamie", "adult")
    ws = await off.socket(expect_caps=False)
    assert (await rpc(ws, save({"x": 1}, key="sidebar")))["error"]["code"] == "not_allowed"
    res, _ = await sub(ws, msg={"type": "frontend/subscribe_user_data", "key": "sidebar"})
    assert res["error"]["code"] == "not_allowed"
    got = await rpc(ws, {"type": "read", "id": 9, "msg": {"type": "frontend/get_user_data", "key": "sidebar"}})
    assert got["error"]["code"] == "not_allowed"
    for bad in ("text", {"key": "light.kitchen2 "}, {"key": "media_player.a", "extra": 1}, {"at": 1}, [1]):
        assert (await rpc(ws, save(bad)))["error"]["code"] == "invalid", bad
    assert (await rpc(ws, {**save(FOCUS), "more": 1}))["error"]["code"] == "invalid"
    assert count(off) == 0
    await ws.close()


async def test_size_limit(off):
    await off.login("jamie", "adult")
    ws = await off.socket(expect_caps=False)
    assert (await rpc(ws, save({"key": "media_player." + "x" * 100, "at": 1})))["result"] is None
    huge = {"key": "media_player.office", "at": 1, "pad": "y" * 5000}
    assert (await rpc(ws, save(huge, rid=6)))["error"]["code"] == "too_large"
    with pytest.raises(UD.Refused) as exc:
        off.app["user_data"].set("u:x", "hk_music_focus", {"key": "media_player." + "z" * 600})
    assert exc.value.code == "too_large"
    await ws.close()


ROOMS = ["media_player.kitchen", "media_player.office"]


async def test_the_intercom_sheet_remembers_its_mode_and_rooms_per_person(off):
    """docs/phase17/INTERCOM.md: key `intercom` = {mode: "message"|"live", rooms: [entity ids, at most 64]}, kept
    like the Music page's speaker: per person, with commands off, followed live by the same person's other screens."""
    await off.login("jamie", "adult")
    a, b = await off.socket(expect_caps=False), await off.socket(expect_caps=False)
    msg = {"type": "frontend/subscribe_user_data", "key": "intercom"}
    _, first = await sub(a, msg=msg)
    assert first == {"value": None}
    mine = {"mode": "message", "rooms": ROOMS}
    assert (await rpc(b, save(mine, key="intercom")))["result"] is None
    assert await event(a) == {"value": mine}
    assert (await rpc(b, save({"mode": "live"}, rid=6, key="intercom")))["result"] is None      # either may be left out
    assert (await rpc(b, save({"rooms": []}, rid=7, key="intercom")))["result"] is None
    await off.login("kim", "adult")
    kim = await off.socket(expect_caps=False)
    _, first = await sub(kim, msg=msg)
    assert first == {"value": None}, "kim must not see jamie's rooms"
    assert off.audit() == [], "an own preference is not a house command"
    await a.close()
    await b.close()
    await kim.close()


async def test_the_intercom_value_is_checked(off):
    await off.login("jamie", "adult")
    ws = await off.socket(expect_caps=False)
    many = [f"media_player.room_{i}" for i in range(UD.INTERCOM_ROOMS_MAX)]
    assert (await rpc(ws, save({"mode": "message", "rooms": many}, key="intercom")))["result"] is None
    bad = [{"mode": "walkie"}, {"mode": "live", "rooms": "media_player.kitchen"}, {"rooms": many + ["media_player.x"]},
           {"rooms": ["media_player.kitchen", "media_player.kitchen"]}, {"rooms": ["kitchen"]}, {"rooms": [5]},
           {"rooms": ["media_player.Kitchen"]}, {"mode": "live", "extra": 1}, ["media_player.kitchen"], "message"]
    for i, value in enumerate(bad):
        assert (await rpc(ws, save(value, rid=10 + i, key="intercom")))["error"]["code"] == "invalid", value
    again = await rpc(ws, save({"rooms": many}, rid=40, key="intercom"))
    assert again["result"] is None, "a refused value left the stored one alone"
    await ws.close()


def test_the_subject_is_the_person_or_the_tablet_alone():
    assert UD.subject_of(None) is None
    assert UD.subject_of(SimpleNamespace(valid=False, user=SimpleNamespace(id="a"), device=None)) is None
    assert UD.subject_of(SimpleNamespace(valid=True, user=None, device=None)) is None
    assert UD.subject_of(SimpleNamespace(valid=True, user=SimpleNamespace(id="a"), device=SimpleNamespace(id="t"))) == "u:a"
    assert UD.subject_of(SimpleNamespace(valid=True, user=None, device=SimpleNamespace(id="t"))) == "d:t"


async def test_a_tablet_alone_is_its_own_subject(off):
    data = off.app["user_data"]
    data.set("d:hall", "hk_music_focus", FOCUS)
    assert data.get("d:hall", "hk_music_focus") == FOCUS
    assert data.get("d:kitchen", "hk_music_focus") is None and data.get("u:hall", "hk_music_focus") is None


async def test_nothing_is_a_command_and_ha_is_never_sent_it(on):
    await on.login("jamie", "adult")
    ws = await on.socket()
    await sub(ws)
    await rpc(ws, save(FOCUS))
    assert await event(ws) == {"value": FOCUS}
    assert on.fake.sent == [] and on.fake.frames == []
    assert on.audit() == [], "an own preference is not a house command and leaves no command audit row"
    await ws.close()


async def test_other_user_data_keys_still_go_through_the_gateway(on):
    await on.login("jamie", "adult")
    ws = await on.socket()
    r = await on.command(ws, kind="ws", msg={"type": "frontend/set_user_data", "key": "sidebar", "value": {}})
    assert r["type"] == "command_result" and "error" not in r                       # the gateway path, as before
    assert [f["type"] for f in on.fake.frames] == ["frontend/set_user_data"] and on.fake.frames[0]["key"] == "sidebar"
    await ws.close()


def test_the_page_and_the_server_agree_on_the_keys():
    client = (ROOT / "web/shim/mantel-client.js").read_text()
    host = (ROOT / "web/shim/mantel-host.js").read_text()

    def keys(src, pat):
        return set(re.findall(r"'([^']+)'", re.search(pat, src, re.S).group(1)))
    assert keys(client, r"var USER_DATA_KEYS = \[(.*?)\];") == set(UD.KEYS)
    assert keys(host, r"USER_DATA_KEYS = new Set\(\[(.*?)\]\)") == set(UD.KEYS)


def test_migration_0013_creates_the_table(tmp_path):
    from mantel_server.storage.store import Store
    store = Store(tmp_path / "m.db")
    cols = {r[1] for r in store.db.execute("PRAGMA table_info(user_data)")}
    assert cols == {"subject", "key", "value", "updated"}
    store.db.close()
