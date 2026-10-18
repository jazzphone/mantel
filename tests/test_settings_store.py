"""P3.5: HK settings in Mantel. The store (versions, history, restore), the thin model's checks, RBAC on
saves, the settings feed after a save, the client API wired as P3.7 will wire it, and the one-time
import from a fake Home Assistant (idempotent; never a write to HA). Fictional data only."""
from __future__ import annotations

import asyncio
import json
import re
import sqlite3
import sys
import threading
import types
from pathlib import Path

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from argon2 import PasswordHasher

from connector_fakes import HA_TOKEN, FakeHa
from mantel_server import readproxy, settings_store as S
from mantel_server.connectors import Ctx, Forbidden, Hooks
from mantel_server.db import Database
from mantel_server.readproxy import READ_ALLOWED, RULES, SERVER_ONLY_READS, FilteredReads, ReadBlocked, ReadProxy
from mantel_server.server import classify
from mantel_server.sessions import Device, Identity, User

ROOT = Path(__file__).resolve().parent.parent

# -------------------------------------------------------------------------------- fictional data
PANEL = {   # what a fictional HA's hk_frontend/panel/get answers (a trimmed copy of its real shape)
    "entry_id": "fictional-entry", "setup_done": True,
    "settings": {
        "weather": {"entity": "weather.fictional_home", "place": "Fictional Town", "humidity": None},
        "look": {"glass": "blur", "flat": False, "frost": 40, "flat_theme": "dark"},
        "sky": {"hemisphere": "north", "seasonal": None},
        "calendar": {"entities": ["calendar.family"], "event_colors": {}},
        "security": {"alarm": "alarm_control_panel.fictional"},
        "counts": {"lights": None},
    },
    "boards": {"dashboard-kitchen": {"menu": "auto", "pages": ["lights", "climate"], "chips": ["lights", "chip:battery"],
                                     "chips_custom": ["battery"], "custom_pages": ["fictional-page"],
                                     "headers": {"home": True}, "tabs": 6}},
    "tablets": {"kitchen": {"name": "Kitchen Tablet", "screen": "dashboard-kitchen", "room": "kitchen", "user": "",
                            "app": "kiosk_satellite", "device": "", "idle_return": None, "idle_time": None,
                            "black_screen": "kiosk", "uid": "tablet_kitchen", "item": "sub-1",
                            "parts": {"screensaver": "switch.kitchen_saver"}}},
    "popups": [{"hash": "front-door", "name": "Front Door", "cards": [], "item": "sub-2"}],
    "custom_pages": [{"path": "fictional-page", "title": "Fictional Page", "view": {"cards": []}, "item": "sub-3",
                      "used_on": ["dashboard-kitchen"]}],
    "custom_chips": [{"key": "battery", "name": "Battery", "after": "end", "card": {"type": "custom:hk-status-chip-card"}}],
    "accessories": {"entities": {"light.fictional_lamp": {"name": "Lamp"}}, "rooms": {}, "into": {}, "pages": {}},
    "choices": {"themes": ["halloween"]}, "presets": [{"key": "tablet"}], "chip_kinds": ["lights"], "page_kinds": ["lights"],
    "scene_pages": [], "shelves": {},
    # what HA works out at run time: not settings, never kept
    "dashboards": [{"path": "dashboard-kitchen"}], "kiosk_devices": [{"id": "d1"}], "users": ["Fictional Person"],
    "counts": {"lights": {"n": 3}}, "thirdparty": {"x": {}}, "integration": {"sidebar": True},
}


def ident(role=None, uid=None, device_role=None, did=None, door="lan"):
    user = User(uid or f"{role}-id", role.title(), role, "hk") if role else None
    device = Device(did or "tablet-1", "Loft Tablet", device_role) if device_role else None
    return Identity(user, device, door)


OWNER, ADMIN, ADULT, CHILD, GUEST = (ident(r) for r in ("owner", "admin", "adult", "child", "guest"))
TABLET = ident(device_role="wall_tablet")
ADULT_AT_TABLET = ident("adult", device_role="wall_tablet")


@pytest.fixture
def db(tmp_path):
    d = Database(tmp_path / "data" / "mantel.db")
    with d.conn:
        for uid, role in (("owner-id", "owner"), ("admin-id", "admin"), ("adult-id", "adult"),
                          ("child-id", "child"), ("guest-id", "guest")):
            d.conn.execute("INSERT INTO users (id, name, role, kind, created, updated) VALUES (?,?,?,?,1,1)",
                           (uid, role.title(), role, "hk"))
    yield d
    d.close()


@pytest.fixture
def now():
    return [1_000_000.0]


@pytest.fixture
def store(db, now):
    return S.SettingsStore(db.conn, lambda: now[0])


async def seeded(store):
    async def fetch():
        return json.loads(json.dumps(PANEL))
    await S.import_settings(store, fetch, actor=S.Actor(label="test"))
    return store


@pytest.fixture
async def svc(store):
    await seeded(store)
    return S.SettingsService(store, S.SettingsHooks(may_configure=S.rbac_may_configure(clock=lambda: 1_000_000.0)),
                             S.ThinModel())


class Feed:
    def __init__(self):
        self.events = []

    def __call__(self, payload):
        self.events.append(payload)


# ------------------------------------------------------------------------------------- migration
def test_migration_creates_the_tables_and_history_is_append_only(db, store):
    names = {r[0] for r in db.conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"settings_docs", "settings_history", "settings_import"} <= names
    assert db.conn.execute("SELECT name FROM schema_version WHERE version=3").fetchone()[0] == "settings"
    store.write([("house", "settings", {"look": {"glass": "blur"}})], actor=S.Actor(label="t"))
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        with db.conn:
            db.conn.execute("UPDATE settings_history SET actor='someone else'")
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        with db.conn:
            db.conn.execute("DELETE FROM settings_history")
    with pytest.raises(sqlite3.IntegrityError):
        with db.conn:
            db.conn.execute("INSERT INTO settings_docs (scope, key, version, body, updated) VALUES ('nope','k',1,'{}',1)")


# ----------------------------------------------------------------------------- versions, history
def test_versions_history_and_diff(store, now):
    a = S.Actor(user_id="owner-id", role="owner")
    [v1] = store.write([("house", "settings", {"look": {"glass": "blur", "frost": 40}})], actor=a, message="m1")
    assert (v1.version, v1.updated_by) == (1, "owner-id")
    assert store.write([("house", "settings", {"look": {"glass": "blur", "frost": 40}})], actor=a) == []   # unchanged
    now[0] += 60
    [v2] = store.write([("house", "settings", {"look": {"glass": "clear", "frost": 40}, "sky": {"x": 1}})],
                       actor=S.Actor(user_id="admin-id", role="admin", device_id="dev-9"), message="hk_frontend/settings/set")
    assert v2.version == 2 and store.get("house", "settings").version == 2
    hist = store.history("house", "settings")
    assert [h["version"] for h in hist] == [2, 1]
    assert hist[0]["diff"] == {"added": {"sky": {"x": 1}}, "removed": {}, "changed": {"look.glass": ["blur", "clear"]}}
    assert (hist[0]["actor"], hist[0]["actor_role"], hist[0]["device"], hist[0]["created"], hist[0]["message"]) == \
        ("admin-id", "admin", "dev-9", 1_000_060.0, "hk_frontend/settings/set")
    assert hist[1]["diff"]["added"] == {"look": {"glass": "blur", "frost": 40}}
    assert "body" not in hist[0] and store.history("house", "settings", bodies=True)[1]["body"] == v1.body


def test_key_order_is_kept_and_a_reorder_alone_is_no_version(store):
    a = S.Actor(label="t")
    store.write([("house", "custom_pages", {"items": [{"view": {"cards": [{"type": "tile", "entity": "light.x"}]}}]})], actor=a)
    card = store.get("house", "custom_pages").body["items"][0]["view"]["cards"][0]
    assert list(card) == ["type", "entity"]                         # a card's YAML reads back as it was written
    assert store.write([("house", "custom_pages", {"items": [{"view": {"cards": [{"entity": "light.x", "type": "tile"}]}}]})],
                       actor=a) == []


def test_restore_makes_a_new_version_from_an_old_body(store):
    a = S.Actor(user_id="owner-id", role="owner")
    store.write([("board", "dashboard-x", {"menu": "auto"})], actor=a)
    store.write([("board", "dashboard-x", {"menu": "tabbar"})], actor=a)
    got = store.restore("board", "dashboard-x", 1, actor=S.Actor(user_id="admin-id", role="admin"))
    assert got.version == 3 and got.body == {"menu": "auto"}
    h = store.history("board", "dashboard-x")
    assert (h[0]["action"], h[0]["source"], h[0]["actor"]) == ("restore", "v1", "admin-id")
    assert store.restore("board", "dashboard-x", 1, actor=a) is None          # already that body: no version
    with pytest.raises(S.SettingsError) as err:
        store.restore("board", "dashboard-x", 9, actor=a)
    assert err.value.code == "no_version"


def test_a_multi_document_write_is_all_or_nothing(store):
    a = S.Actor(label="t")
    store.write([("board", "b1", {"menu": "auto"})], actor=a)
    with pytest.raises(S.SettingsError):
        store.write([("board", "b1", {"menu": "open"}), ("nope", "x", {})], actor=a)
    assert store.get("board", "b1").body == {"menu": "auto"} and store.get("board", "b1").version == 1
    with pytest.raises(S.SettingsError) as err:
        store.write([("board", "b1", {"menu": "open"})], actor=a, expect={("board", "b1"): 7})
    assert err.value.code == "conflict"
    with pytest.raises(S.SettingsError) as err:
        store.write([("board", "b1", {"blob": "x" * (S.MAX_DOC + 1)})], actor=a)
    assert err.value.code == "too_big"


# ------------------------------------------------------------------------------------ the model
HOUSE = {"look": {"glass": "blur", "flat": False, "frost": 40}, "weather": {"entity": "weather.home", "place": "X"},
         "calendar": {"entities": ["calendar.a"]}, "sky": {}}


@pytest.mark.parametrize("changes, errors", [
    ({"look.glass": "clear"}, {}),
    ({"look.frost": 70, "weather.place": "Y"}, {}),
    ({"sky.anything_new": "ok"}, {}),                                 # a section with no stored keys yet
    ({"look.glass": True}, {"look.glass": "text"}),
    ({"look.flat": "yes"}, {"look.flat": "bool"}),
    ({"look.nope": 1}, {"look.nope": "unknown"}),
    ({"nosection.key": 1}, {"nosection.key": "unknown"}),
    ({"look": {"glass": "clear"}}, {"look": "unknown"}),
    ({"weather.entity": "not an entity"}, {"weather.entity": "entity"}),
    ({"weather.entity": None}, {}),
    ({"calendar.entities": ["calendar.b", "bad"]}, {"calendar.entities": "entity"}),
    ({"sidebar": False}, {"sidebar": "ha_only"}),
    ({"files_folder": "/config/x"}, {"files_folder": "ha_only"}),
    ({"sky.reset": True}, {"sky.reset": "needs_model"}),
    ({"look.flat_colors.accent": "red"}, {"look.flat_colors.accent": "needs_model"}),
    ({"look.glass": "clear", "look.flat": 3}, {"look.flat": "bool"}),           # all or nothing
    ({"weather.place": "x" * (S.MAX_VALUE + 10)}, {"weather.place": "too_big"}),
    ({"weather.place": float("nan")}, {"weather.place": "invalid"}),
])
def test_house_checks(changes, errors):
    new, got = S.ThinModel().apply_house(HOUSE, changes)
    assert got == errors
    if errors:
        assert new == HOUSE
    else:
        for path, value in changes.items():
            section, key = path.split(".")
            assert new[section][key] == value
    assert HOUSE["look"]["glass"] == "blur"                                      # never mutated


def test_board_tablet_and_user_checks():
    m = S.ThinModel()
    board = {"menu": "auto", "tabs": 6, "headers": {"home": True}}
    assert m.apply_board(board, {"menu": "tabbar", "tabs": 4}) == ({"menu": "tabbar", "tabs": 4, "headers": {"home": True}}, {})
    assert m.apply_board(board, {"menu.x": 1})[1] == {"menu.x": "needs_model"}
    assert m.apply_board(board, {"unknown_key": 1})[1] == {"unknown_key": "unknown"}
    assert m.apply_board(board, {"tabs": "six"})[1] == {"tabs": "number"}
    with pytest.raises(S.SettingsError):
        m.apply_board(board, {})
    with pytest.raises(S.SettingsError):
        m.apply_board(board, {f"k{i}": 1 for i in range(S.MAX_CHANGES + 1)})
    tablet = {"name": "Kitchen", "screen": "dashboard-kitchen", "uid": "tablet_kitchen"}
    assert m.apply_tablet(tablet, {"name": "  Den  "}, "kitchen")[0]["name"] == "Den"
    assert m.apply_tablet(tablet, {"name": "  "}, "kitchen")[1] == {"name": "name_needed"}
    assert m.apply_tablet(tablet, {"uid": "other"}, "kitchen")[1] == {"uid": "unknown"}
    mine, err = m.apply_user({}, {"look.glass": "clear"}, HOUSE)
    assert (mine, err) == ({"look": {"glass": "clear"}}, {})
    assert m.apply_user(mine, {"look.glass": None}, HOUSE) == ({}, {})
    assert m.apply_user({}, {"weather.place": "Mine"}, HOUSE)[1] == {"weather.place": "not_personal"}
    assert m.apply_user({}, {"look.glass": 1}, HOUSE)[1] == {"look.glass": "text"}
    chip, err = m.chip(" Battery ", None, {"type": "custom:x"})
    assert chip == {"name": "Battery", "after": "end", "card": {"type": "custom:x"}} and not err
    assert m.chip("", "middle", {"type": ""})[1] == {"name": "name_needed", "after": "choice", "card": "chip_card"}
    assert m.chip("x", "end", {"type": "t", "big": "x" * S.CHIP_CARD_MAX})[1] == {"card": "chip_card"}


def test_hk_core_model_plugs_in_when_present(monkeypatch):
    calls = []
    fake = types.ModuleType("hk_core.settings.changes")
    schema = types.ModuleType("hk_core.settings.model")
    schema.merged = lambda options: {**{"look": {"glass": "blur"}}, **options["dashboard"]}

    def apply_house(options, changes):
        calls.append(changes)
        if "look.glass" in changes and changes["look.glass"] not in ("blur", "clear"):
            return options, {"look.glass": "choice"}
        return {"dashboard": {**options["dashboard"], "look": {"glass": changes.get("look.glass", "blur")}}}, {}
    fake.apply_house = apply_house
    fake.apply_board = lambda data, changes: ({**data, **changes}, {})
    fake.apply_tablet = lambda data, changes, tid: ({**data, **changes}, {})
    monkeypatch.setitem(sys.modules, "hk_core.settings.changes", fake)
    monkeypatch.setitem(sys.modules, "hk_core.settings.model", schema)
    model = S.load_model()
    assert isinstance(model, S.HkCoreModel)
    assert model.apply_house({"look": {"glass": "blur"}}, {"look.glass": "clear"}) == ({"look": {"glass": "clear"}}, {})
    assert model.apply_house({"look": {"glass": "blur"}}, {"look.glass": "rainbow"})[1] == {"look.glass": "choice"}
    assert model.apply_house({}, {"sidebar": True})[1] == {"sidebar": "ha_only"} and len(calls) == 2
    del fake.apply_tablet
    assert type(S.load_model()) is S.ThinModel                     # incomplete: the thin model, not half of one


def test_the_real_hk_core_settings_model_is_the_one_used():
    # hk_core/settings/ is in the repo: saves are checked by the same model HA uses
    model = S.load_model()
    assert isinstance(model, S.HkCoreModel)
    ok, errors = model.apply_house({}, {"sky.decorations": False})
    assert errors == {} and ok["sky"]["decorations"] is False, "a real setting is saved through hk_core's checks"
    _, bad = model.apply_house({}, {"sky.decorations": "rainbow"})
    assert bad, "a wrong value is refused by name"


# ---------------------------------------------------------------------------------- RBAC on saves
@pytest.mark.parametrize("who, scope, ok", [
    (OWNER, S.Scope("house", "settings"), True),
    (ADMIN, S.Scope("house", "settings"), True),
    (ADMIN, S.Scope("board", "dashboard-kitchen"), True),
    (ADULT, S.Scope("house", "settings"), False),
    (ADULT, S.Scope("board", "dashboard-kitchen"), False),
    (ADULT, S.Scope("tablet", "kitchen"), False),
    (ADULT, S.Scope("user", "adult-id"), True),                    # their own: feature profile
    (ADULT, S.Scope("user", "child-id"), False),                   # someone else's: feature settings
    (CHILD, S.Scope("user", "child-id"), True),
    (GUEST, S.Scope("user", "guest-id"), False),
    (OWNER, S.Scope("user", "adult-id"), True),
    (TABLET, S.Scope("house", "settings"), False),                 # a wall tablet alone
    (ADULT_AT_TABLET, S.Scope("user", "adult-id"), False),         # the person's rights ∩ the tablet's
    (ident("owner", door="tunnel"), S.Scope("house", "settings"), True),
    (None, S.Scope("house", "settings"), False),
    ({"user_id": "owner-id", "role": "owner"}, S.Scope("house", "settings"), True),
])
def test_rbac_may_configure(who, scope, ok):
    assert S.rbac_may_configure(clock=lambda: 1.0)(who, scope) is ok


async def test_owner_and_admin_save_house_wide_adults_only_their_own(svc, store):
    got = await svc.save(OWNER, {"type": "hk_frontend/settings/set", "changes": {"look.glass": "clear"}})
    assert got["settings"]["look"]["glass"] == "clear"
    await svc.save(ADMIN, {"type": "hk_frontend/board/set", "dashboard": "dashboard-kitchen", "changes": {"menu": "tabbar"}})
    for who, msg in ((ADULT, {"type": "hk_frontend/settings/set", "changes": {"look.glass": "blur"}}),
                     (ADULT, {"type": "hk_frontend/board/set", "dashboard": "dashboard-kitchen", "changes": {"menu": "off"}}),
                     (ADULT, {"type": "mantel/settings/user/set", "user_id": "child-id", "changes": {"look.glass": "blur"}}),
                     (TABLET, {"type": "hk_frontend/tablet/set", "tablet": "kitchen", "changes": {"name": "Mine"}}),
                     (GUEST, {"type": "mantel/settings/user/set", "changes": {"look.glass": "blur"}})):
        with pytest.raises(S.SettingsError) as err:
            await svc.save(who, msg)
        assert err.value.code == "forbidden", msg
    mine = await svc.save(ADULT, {"type": "mantel/settings/user/set", "changes": {"look.glass": "frosted"}})
    assert mine == {"user_id": "adult-id", "settings": {"look": {"glass": "frosted"}}}
    other = await svc.save(OWNER, {"type": "mantel/settings/user/set", "user_id": "child-id", "changes": {"sky.hemisphere": "south"}})
    assert other["settings"] == {"sky": {"hemisphere": "south"}}
    with pytest.raises(S.SettingsError) as err:
        await svc.save(OWNER, {"type": "mantel/settings/user/set", "user_id": "nobody", "changes": {"look.glass": "x"}})
    assert err.value.code == "no_user"
    assert store.get("house", "settings").body["look"]["glass"] == "clear"
    assert store.get("board", "dashboard-kitchen").body["menu"] == "tabbar"
    assert store.history("house", "settings")[0]["actor"] == "owner-id"


async def test_saves_check_shapes_and_answer_like_ha(svc, store):
    with pytest.raises(S.SettingsError) as err:
        await svc.save(OWNER, {"type": "hk_frontend/settings/set", "changes": {"look.glass": 5, "look.frost": 10}})
    assert err.value.code == "invalid_format" and json.loads(str(err.value)) == {"look.glass": "text"}
    assert store.get("house", "settings").body["look"]["frost"] == 40              # nothing written
    with pytest.raises(S.SettingsError) as err:
        await svc.save(OWNER, {"type": "hk_frontend/settings/set", "changes": {}, "extra": 1})
    assert json.loads(str(err.value)) == {"extra": "unexpected"}
    with pytest.raises(S.SettingsError) as err:
        await svc.save(OWNER, {"type": "hk_frontend/board/set", "dashboard": "dashboard-none", "changes": {"menu": "x"}})
    assert err.value.code == "no_item"
    with pytest.raises(S.SettingsError) as err:
        await svc.save(OWNER, {"type": "hk_frontend/tablet/set", "tablet": "den", "changes": {"name": "x"}})
    assert err.value.code == "no_tablet"
    assert await svc.save(OWNER, {"type": "hk_frontend/setup/done", "done": False}) == {"setup_done": False}
    assert await svc.save(OWNER, {"type": "hk_frontend/calendar/color", "key": "event-1", "color": "teal"}) == \
        {"event_colors": {"event-1": "teal"}}
    with pytest.raises(S.SettingsError):
        await svc.save(OWNER, {"type": "hk_frontend/calendar/color", "key": "event-1", "color": "plaid"})
    t = await svc.save(OWNER, {"type": "hk_frontend/tablet/set", "tablet": "kitchen", "changes": {"name": "Galley"}})
    assert t["tablet"]["name"] == "Galley" and "parts" not in t["tablet"]


async def test_chips_save_and_remove_from_every_screen(svc, store):
    got = await svc.save(OWNER, {"type": "hk_frontend/chip/save", "name": "Fictional Pool", "card": {"type": "custom:x"}})
    assert got["key"] == "fictional-pool" and [c["key"] for c in got["custom_chips"]] == ["battery", "fictional-pool"]
    got = await svc.save(OWNER, {"type": "hk_frontend/chip/save", "key": "fictional-pool", "name": "Pool", "after": "lights",
                                 "card": {"type": "custom:y"}})
    assert [c for c in got["custom_chips"] if c["key"] == "fictional-pool"][0]["after"] == "lights"
    with pytest.raises(S.SettingsError) as err:
        await svc.save(OWNER, {"type": "hk_frontend/chip/save", "key": "gone", "name": "X", "card": {"type": "t"}})
    assert json.loads(str(err.value)) == {"key": "chip_gone"}
    before = store.get("board", "dashboard-kitchen").version
    await svc.save(OWNER, {"type": "hk_frontend/chip/remove", "key": "battery"})
    board = store.get("board", "dashboard-kitchen")
    assert board.body["chips"] == ["lights"] and board.body["chips_custom"] == [] and board.version == before + 1
    assert [c["key"] for c in store.body("house", "custom_chips")["items"]] == ["fictional-pool"]


async def test_history_get_and_restore_through_the_api(svc, store):
    await svc.save(OWNER, {"type": "hk_frontend/settings/set", "changes": {"weather.place": "Elsewhere"}})
    h = await svc.history(ADMIN, {"type": "mantel/settings/history", "scope": "house", "key": "settings"})
    assert h["version"] == 2 and [x["action"] for x in h["history"]] == ["set", "import"]
    assert h["history"][0]["diff"]["changed"] == {"weather.place": ["Fictional Town", "Elsewhere"]}
    with pytest.raises(Forbidden):
        await svc.history(ADULT, {"type": "mantel/settings/history", "scope": "house", "key": "settings"})
    own = await svc.history(ADULT, {"type": "mantel/settings/history", "scope": "user", "key": "adult-id"})
    assert own["version"] == 0 and own["history"] == []
    r = await svc.save(OWNER, {"type": "mantel/settings/restore", "scope": "house", "key": "settings", "version": 1})
    assert r == {"scope": "house", "key": "settings", "version": 3, "restored_from": 1, "changed": True}
    assert store.body("house", "settings")["weather"]["place"] == "Fictional Town"
    got = await svc.get(OWNER, {"type": "mantel/settings/get", "scope": "house", "key": "settings"})
    assert got["version"] == 3
    with pytest.raises(S.SettingsError) as err:
        await svc.save(ADULT, {"type": "mantel/settings/restore", "scope": "house", "key": "settings", "version": 1})
    assert err.value.code == "forbidden"
    with pytest.raises(S.SettingsError) as err:
        await svc.save(OWNER, {"type": "mantel/settings/restore", "scope": "house", "key": "catalog", "version": 1})
    assert err.value.code == "forbidden"
    with pytest.raises(S.SettingsError) as err:
        await svc.save(OWNER, {"type": "mantel/settings/restore", "scope": "house", "key": "settings", "version": 99})
    assert err.value.code == "no_version"


# ------------------------------------------------------------------------- refusals: HA and later
def _client_writes():
    src = (ROOT / "web/client/hk-client.js").read_text()
    block = re.search(r"var WRITES = \[(.*?)\];", src, re.S).group(1)
    return set(re.findall(r"'([^']+)'", block))


def test_every_frontend_write_is_classified():
    writes = _client_writes()
    assert writes and writes <= set(S.SAVE_KINDS), sorted(writes - set(S.SAVE_KINDS))
    assert S.SETTINGS_SAVES <= writes
    assert not (S.SETTINGS_SAVES | S.MANTEL_SAVES) & (S.HA_WRITES | S.NOT_YET)


@pytest.mark.parametrize("t, code", [
    ("hk_frontend/tablet/add", "ha_write"), ("input_select/create", "ha_write"), ("lovelace/dashboards/create", "ha_write"),
    ("call_service", "ha_write"), ("hk_frontend/tablet/act", "ha_write"), ("image/delete", "ha_write"),
    ("hk_music/settings/set", "not_yet"), ("hk_notify/settings/set", "not_yet"), ("hk_frontend/accessory/set", "not_yet"),
    ("get_states", "unknown_type"), ("hk_frontend/panel/get", "unknown_type"),
])
async def test_saves_that_touch_ha_or_are_not_here_are_refused(svc, t, code):
    with pytest.raises(S.SettingsError) as err:
        await svc.save(OWNER, {"type": t, "changes": {}})
    assert err.value.code == code


# ----------------------------------------------------------------------------------- the feed
async def test_feed_payload_and_events_after_a_save(svc):
    feeds = {who: Feed() for who in ("owner", "adult", "child")}
    ends = [svc.subscribe_feed(OWNER, feeds["owner"]), svc.subscribe_feed(ADULT, feeds["adult"]),
            svc.subscribe_feed(CHILD, feeds["child"])]
    first = feeds["owner"].events[0]
    assert first["configured"] is True and first["weather"]["place"] == "Fictional Town"
    assert "counts" not in first and first["boards"]["dashboard-kitchen"]["menu"] == "auto"
    assert first["tablet_items"]["kitchen"]["screen"] == "dashboard-kitchen"
    assert [p["path"] for p in first["custom_pages"]] == ["fictional-page"] and first["personal"] == {}
    await svc.save(OWNER, {"type": "hk_frontend/settings/set", "changes": {"weather.place": "Saved Town"}})
    assert [len(f.events) for f in feeds.values()] == [2, 2, 2]
    assert all(f.events[-1]["weather"]["place"] == "Saved Town" for f in feeds.values())
    await svc.save(ADULT, {"type": "mantel/settings/user/set", "changes": {"look.glass": "clear"}})
    assert [len(f.events) for f in feeds.values()] == [2, 3, 2]                       # only that person's feed
    assert feeds["adult"].events[-1]["look"]["glass"] == "clear" and feeds["adult"].events[-1]["personal"] == \
        {"look": {"glass": "clear"}}
    assert feeds["owner"].events[-1]["look"]["glass"] == "blur"
    await svc.save(OWNER, {"type": "hk_frontend/settings/set", "changes": {"weather.place": "Saved Town"}})
    assert [len(f.events) for f in feeds.values()] == [2, 3, 2]                       # unchanged: no event
    for end in ends:
        end()
    await svc.save(OWNER, {"type": "hk_frontend/settings/set", "changes": {"weather.place": "Later"}})
    assert [len(f.events) for f in feeds.values()] == [2, 3, 2]


async def test_panel_get_shape_and_rights(svc):
    p = await svc.panel_get(ADMIN, {"type": "hk_frontend/panel/get"})
    for key in ("entry_id", "settings", "boards", "tablets", "popups", "custom_pages", "custom_chips", "accessories",
                "setup_done", "choices", "presets", "chip_kinds", "page_kinds", "dashboards", "users", "kiosk_devices"):
        assert key in p, key
    assert p["settings"]["counts"] == {"lights": None} and p["setup_done"] is True
    assert p["custom_pages"][0]["used_on"] == ["dashboard-kitchen"] and p["tablets"]["kitchen"]["parts"] == {}
    assert p["choices"] == {"themes": ["halloween"]} and p["users"] == [] and p["dashboards"] == []
    assert p["versions"]["house/settings"] == 1
    with pytest.raises(Forbidden):
        await svc.panel_get(ADULT, {"type": "hk_frontend/panel/get"})


# ---------------------------------------------------------------------------- read-proxy allowlist
class SettingsHa(FakeHa):
    """The fake HA, also answering HK Settings' one read with fictional settings."""

    def __init__(self, panel=None):
        super().__init__()
        self.panel = PANEL if panel is None else panel

    async def answer(self, ws, msg):
        if msg.get("type") == "hk_frontend/panel/get":
            return await ws.send_json({"id": msg["id"], "type": "result", "success": True, "result": self.panel})
        return await super().answer(ws, msg)


@pytest.fixture
async def ha():
    fake = SettingsHa()
    async with TestServer(fake.app()) as server:
        proxy = ReadProxy(str(server.make_url("")).rstrip("/"), HA_TOKEN)
        yield type("Ha", (), dict(fake=fake, proxy=proxy, url=str(server.make_url("")).rstrip("/")))
        await proxy.close()


def test_panel_get_is_on_the_allowlist_as_a_server_only_read():
    assert READ_ALLOWED["hk_frontend/panel/get"] == frozenset()
    assert SERVER_ONLY_READS == {"hk_frontend/panel/get", "hk_notify/settings/get", "hk_clean_areas/settings/get",
                                 "hk_energy/settings/get", "hk_tv/settings/get"} and "hk_frontend/panel/get" in RULES
    readproxy.check_read({"type": "hk_frontend/panel/get"})
    with pytest.raises(ReadBlocked):
        readproxy.check_read({"type": "hk_frontend/panel/get", "entry_id": "x"})
    for write in ("hk_frontend/settings/set", "hk_frontend/board/set", "hk_frontend/setup/done"):
        assert write not in READ_ALLOWED


async def test_a_page_can_never_read_panel_get_from_ha(ha):
    with pytest.raises(ReadBlocked):
        await ha.proxy.request({"type": "hk_frontend/panel/get"})            # server.py's Phase 0 path
    reads = FilteredReads(lambda: ha.proxy, Hooks(may_read=lambda who, kind, ids: ids))
    with pytest.raises(ReadBlocked):
        await reads.request("owner", {"type": "hk_frontend/panel/get"})
    assert ha.fake.frames == []                                               # not even a connection
    assert await ha.proxy.read_hk_settings() == PANEL
    assert ha.fake.sent_types() == ["auth", "hk_frontend/panel/get"]


# ------------------------------------------------------------------------------------- the import
async def test_import_from_ha_writes_version_1_and_records_the_source(ha, store):
    got = await S.import_settings(store, ha.proxy.read_hk_settings, actor=S.Actor(user_id="owner-id", role="owner"))
    assert got["imported"] is True and got["source"] == "ha:fictional-entry" and got["skipped"] == []
    assert set(got["written"]) == {"house/settings", "house/setup", "house/popups", "house/custom_pages", "house/custom_chips",
                                   "house/accessories", "house/catalog", "board/dashboard-kitchen", "tablet/kitchen"}
    assert ha.fake.sent_types() == ["auth", "hk_frontend/panel/get"]          # one read, nothing written to HA
    for key in got["written"]:
        scope, k = key.split("/")
        d = store.get(scope, k)
        assert d.version == 1 and d.updated_by == "owner-id"
        h = store.history(scope, k)
        assert len(h) == 1 and (h[0]["action"], h[0]["source"], h[0]["message"]) == \
            ("import", "ha:fictional-entry", "hk_frontend/panel/get")
    assert store.body("house", "settings")["weather"]["place"] == "Fictional Town"
    assert "parts" not in store.body("tablet", "kitchen") and "used_on" not in store.body("house", "custom_pages")["items"][0]
    assert store.body("house", "catalog")["presets"] == [{"key": "tablet"}]
    assert not any(store.get("house", k) for k in ("dashboards", "users", "kiosk_devices"))
    rec = store.import_record()
    assert rec["source"] == "ha:fictional-entry" and rec["read"] == "hk_frontend/panel/get" and len(rec["checksum"]) == 64


async def test_the_import_is_idempotent_and_never_reads_again(ha, store):
    first = await S.import_settings(store, ha.proxy.read_hk_settings, actor=S.Actor(label="cli"))
    store.write([("house", "settings", {**store.body("house", "settings"), "look": {"glass": "clear"}})],
                actor=S.Actor(user_id="owner-id", role="owner"))
    frames = len(ha.fake.frames)
    again = await S.import_settings(store, ha.proxy.read_hk_settings, actor=S.Actor(label="cli"))
    assert again == {"imported": False, "already": store.import_record()}
    assert again["already"]["written"] == first["written"]
    assert len(ha.fake.frames) == frames                                     # HA was not asked again
    assert store.get("house", "settings").version == 2 and store.body("house", "settings")["look"] == {"glass": "clear"}


async def test_the_import_leaves_existing_documents_alone(store):
    store.write([("board", "dashboard-kitchen", {"menu": "open"})], actor=S.Actor(user_id="owner-id"))

    async def fetch():
        return PANEL
    got = await S.import_settings(store, fetch, actor=S.Actor(label="t"))
    assert got["skipped"] == ["board/dashboard-kitchen"] and "board/dashboard-kitchen" not in got["written"]
    assert store.get("board", "dashboard-kitchen").body == {"menu": "open"}


@pytest.mark.parametrize("payload", [None, [], {"entry_id": "x"}, {"settings": "nope"}])
async def test_the_import_refuses_what_is_not_hk_settings(store, payload):
    async def fetch():
        return payload
    with pytest.raises(S.SettingsError) as err:
        await S.import_settings(store, fetch, actor=S.Actor(label="t"))
    assert err.value.code == "not_hk_settings" and store.empty() and store.import_record() is None


async def test_two_imports_at_once_write_once(store):
    gate = asyncio.Event()

    async def fetch():
        await gate.wait()
        return json.loads(json.dumps(PANEL))
    a = asyncio.create_task(S.import_settings(store, fetch, actor=S.Actor(label="a")))
    b = asyncio.create_task(S.import_settings(store, fetch, actor=S.Actor(label="b")))
    await asyncio.sleep(0)
    gate.set()
    got = await asyncio.gather(a, b)
    assert sorted(g["imported"] for g in got) == [False, True]
    assert all(len(store.history("house", "settings")) == 1 for _ in got)


def test_the_cli_imports_once_from_ha(tmp_path, capsys):
    from mantel_server.__main__ import main
    fake = SettingsHa()
    loop = asyncio.new_event_loop()
    runner = web.AppRunner(fake.app())
    loop.run_until_complete(runner.setup())
    site = web.TCPSite(runner, "127.0.0.1", 0)
    loop.run_until_complete(site.start())
    port = site._server.sockets[0].getsockname()[1]
    thread = threading.Thread(target=loop.run_forever, daemon=True)
    thread.start()
    try:
        token = tmp_path / "ha_token"
        token.write_text(HA_TOKEN)
        args = ["import-settings", "--data-dir", str(tmp_path / "data"), "--ha-url", f"http://127.0.0.1:{port}",
                "--token-file", str(token)]
        assert main(args) == 0
        assert "imported HK settings from ha:fictional-entry: 10 documents written as version 1" in capsys.readouterr().out
        assert main(args) == 0
        assert "already imported from ha:fictional-entry" in capsys.readouterr().out
        assert fake.sent_types() == ["auth", "hk_frontend/panel/get"]
        assert main(args[:-1] + [str(tmp_path / "missing")]) == 2
    finally:
        asyncio.run_coroutine_threadsafe(runner.cleanup(), loop).result(5)
        loop.call_soon_threadsafe(loop.stop)
        thread.join(5)
    d = Database(tmp_path / "data" / "mantel.db")
    assert d.conn.execute("SELECT COUNT(*) FROM settings_docs").fetchone()[0] == 10      # + house/mantel_features (no features added in HA)
    d.close()


# ------------------------------------------------------------- the client API, wired as P3.7 will
class Page:
    """One client connection: a Ctx whose sends are collected."""

    def __init__(self, identity):
        self.frames = []
        self.ctx = Ctx(send=self._send, identity=identity)

    async def _send(self, msg):
        self.frames.append(msg)

    def of(self, kind, rid=None):
        return [f for f in self.frames if f.get("type") == kind and (rid is None or f.get("id") == rid)]


async def settle():
    for _ in range(5):
        await asyncio.sleep(0)


@pytest.fixture
async def wired(store, ha):
    await seeded(store)
    app = web.Application()
    hub = types.SimpleNamespace(readproxy=ha.proxy)
    readproxy.register(app, hub, Hooks(may_read=lambda who, kind, ids: ids))
    service = S.register(app, hub, S.SettingsHooks(may_configure=S.rbac_may_configure()), store=store,
                         model=S.ThinModel())
    return type("Wired", (), dict(app=app, service=service, handlers=app["ws_handlers"], ha=ha))


async def test_the_pages_reads_and_saves_go_to_the_store_never_ha(wired):
    h = wired.handlers
    assert {"settings_write", "read", "read_subscribe"} <= set(h)
    assert set(S.READS) <= set(wired.app["read_routes"])
    owner, adult = Page(OWNER), Page(ADULT)
    await h["read"](owner.ctx, {"type": "read", "id": 1, "msg": {"type": "hk_frontend/panel/get"}})
    assert owner.of("read_result", 1)[0]["result"]["settings"]["weather"]["place"] == "Fictional Town"
    await h["read"](adult.ctx, {"type": "read", "id": 1, "msg": {"type": "hk_frontend/panel/get"}})
    assert adult.of("read_result", 1)[0]["error"]["code"] == "forbidden"
    await h["read_subscribe"](adult.ctx, {"type": "read_subscribe", "id": 2, "msg": {"type": "hk_frontend/settings/subscribe"}})
    await settle()
    assert adult.of("read_result", 2)[0]["result"] is None
    assert adult.of("read_event", 2)[0]["event"]["weather"]["place"] == "Fictional Town"
    # a save, as the page sends it to HA, inside settings_write -> settings_result, and the feed follows
    await h["settings_write"](owner.ctx, {"type": "settings_write", "id": 3, "msg": {
        "type": "hk_frontend/settings/set", "changes": {"weather.place": "Wired Town"}}})
    await settle()
    assert owner.of("settings_result", 3)[0]["result"]["settings"]["weather"]["place"] == "Wired Town"
    assert adult.of("read_event", 2)[-1]["event"]["weather"]["place"] == "Wired Town"
    await h["settings_write"](adult.ctx, {"type": "settings_write", "id": 4, "msg": {
        "type": "hk_frontend/settings/set", "changes": {"weather.place": "Adult Town"}}})
    assert adult.of("settings_result", 4)[0]["error"]["code"] == "forbidden"
    await h["settings_write"](owner.ctx, {"type": "settings_write", "id": 5, "msg": {"type": "hk_frontend/tablet/add", "tablet": {}}})
    assert owner.of("settings_result", 5)[0]["error"]["code"] == "ha_write"
    await h["settings_write"](owner.ctx, {"type": "settings_write", "id": 6, "service": "lock.unlock", "msg": {}})
    assert owner.of("settings_result", 6)[0]["error"]["code"] == "invalid_format"
    await h["settings_write"](owner.ctx, {"type": "settings_write", "id": 7, "msg": {
        "type": "hk_frontend/settings/set", "changes": {"look.glass": False}}})
    err = owner.of("settings_result", 7)[0]["error"]
    assert err["code"] == "invalid_format" and json.loads(err["message"]) == {"look.glass": "text"}
    await h["read"](owner.ctx, {"type": "read", "id": 8, "msg": {"type": "mantel/settings/history", "scope": "house",
                                                                 "key": "settings", "limit": 1}})
    assert owner.of("read_result", 8)[0]["result"]["history"][0]["actor"] == "owner-id"
    await adult.ctx.close()                                       # the socket ends: its feed ends
    assert wired.service._feeds == {}
    assert wired.ha.fake.frames == []                             # not one frame to Home Assistant


def test_settings_saves_are_not_commands_so_they_work_while_commands_are_disabled():
    # server.classify refuses command-shaped frames with commands_disabled; a settings save is HK's own
    # data, not a house command, so it passes on to app["ws_handlers"] (P3.7's dispatch).
    save = {"type": "settings_write", "id": 1, "msg": {"type": "hk_frontend/settings/set", "changes": {"look.glass": "clear"}}}
    assert classify(save) == "unknown"
    assert classify({"type": "settings_write", "id": 1, "service": "lock.unlock"}) == "command"


# -------------------------------------------------------------------------------- REST: import
@pytest.fixture
async def mantel_app(tmp_path, monkeypatch):
    from mantel_server.config import Config
    from mantel_server.ha_client import HaClient
    from mantel_server.server import build_app
    from mantel_server.store import Store

    async def forbidden(*args, **kwargs):
        pytest.fail("attempted upstream access")

    monkeypatch.setattr(HaClient, "run", forbidden)
    monkeypatch.setattr(ReadProxy, "request", forbidden)
    cfg = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", port=0)
    st = Store(cfg.data_dir / "mantel.db")
    app = build_app(cfg, "unused-fictional-token", store=st, connect_ha=False)
    app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    fetched = []

    async def fetch():
        fetched.append(1)
        return PANEL
    # build_app registers the settings store (server.wire); this test gives it a fake HA to import from
    service = app["settings"]
    service.hooks = S.SettingsHooks(may_configure=S.rbac_may_configure(), fetch_ha_settings=fetch)
    async with TestClient(TestServer(app)) as client:
        origin = str(client.make_url("")).rstrip("/")
        client.session.headers["Origin"] = origin
        yield type("M", (), dict(app=app, client=client, service=service, fetched=fetched))
    st.db.close()


async def _sign_in(m, username, role):
    await m.app["accounts"].create_user(username, username.title(), role, "correct horse battery staple")
    m.client.session.cookie_jar.clear()
    r = await m.client.post("/api/auth/password", json={"username": username, "password": "correct horse battery staple"})
    assert r.status == 200, await r.text()
    jar = m.client.session.cookie_jar.filter_cookies(m.client.make_url("/"))
    return {"X-CSRF-Token": jar["mantel_csrf"].value}


async def test_rest_import_is_owner_only_and_idempotent(mantel_app):
    m = mantel_app
    h = await _sign_in(m, "fictional-admin", "admin")
    assert (await m.client.post("/api/settings/import", headers=h)).status == 403
    assert (await (await m.client.get("/api/settings/import")).json()) == {"import": None, "empty": True}
    h = await _sign_in(m, "fictional-adult", "adult")
    assert (await m.client.get("/api/settings/import")).status == 403
    h = await _sign_in(m, "fictional-owner", "owner")
    assert (await m.client.post("/api/settings/import")).status == 403         # no CSRF token
    r = await m.client.post("/api/settings/import", headers=h)
    body = await r.json()
    assert r.status == 200 and body["imported"] is True and body["source"] == "ha:fictional-entry"
    r = await m.client.post("/api/settings/import", headers=h)
    assert (await r.json())["imported"] is False and m.fetched == [1]
    status = await (await m.client.get("/api/settings/import")).json()
    assert status["import"]["source"] == "ha:fictional-entry" and status["empty"] is False
    owner_id = m.service.store.get("house", "settings").updated_by
    assert owner_id and owner_id != "system"
