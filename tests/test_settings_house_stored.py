"""House settings stored as differences (SET-2, docs/phase3/SETTINGS.md "How the house settings are kept").

Mantel keeps ``house/settings`` as Home Assistant's HK Frontend keeps its options: per section, only what differs
from the defaults (hk_core ``model.house_stored``). Every reader that needs the whole shape reads
``SettingsService.house_settings()`` (``model.merged``), so the feed, HK Settings and the linked frame keep the
merged shape. A FICTIONAL house."""
from __future__ import annotations

import json

import pytest

from hk_core.settings import model as M
from mantel_server import linked_settings as LS
from mantel_server import settings_store as S
from mantel_server.db import Database

OWNER = {"user_id": "owner-id", "role": "owner"}
NORMALISED = "normalised to stored differences"


@pytest.fixture
def db(tmp_path):
    d = Database(tmp_path / "data" / "mantel.db")
    with d.conn:
        d.conn.execute("INSERT INTO users (id, name, role, kind, created, updated) VALUES ('owner-id','Owner','owner','hk',1,1)")
    yield d
    d.close()


@pytest.fixture
def store(db):
    return S.SettingsStore(db.conn, lambda: 1_000_000.0)


@pytest.fixture
def svc(store):
    return S.SettingsService(store, S.SettingsHooks(may_configure=lambda identity, scope: True), S.load_model())


@pytest.fixture
def place():
    """The house's place is module state (set_house_place): put it back as found."""
    was = dict(M._PLACE)
    yield M.set_house_place
    M._PLACE.update(was)


def old_merged(**choices) -> dict:
    """What a Mantel before 0.1.78 stored: the house settings merged, every default baked in."""
    return M.merged({M.CONF_DASHBOARD: choices})


def canon(x) -> str:
    return json.dumps(x, sort_keys=True, separators=(",", ":"))


async def save(svc, changes):
    return await svc.save(OWNER, {"type": "hk_frontend/settings/set", "changes": changes})


# ------------------------------------------------------------------------------------- saves
async def test_a_save_stores_only_what_differs_and_answers_the_whole_shape(svc, store, place):
    place()
    got = await save(svc, {"look.glass": "blur", "menu.accent": "blue"})
    assert store.body("house", "settings") == {"look": {"glass": "blur"}, "menu": {"accent": "blue"}}
    assert got["settings"] == svc.house_settings() == M.merged({M.CONF_DASHBOARD: store.body("house", "settings")})
    assert set(got["settings"]) == set(M.merged(None))


async def test_a_southern_house_gets_its_hemisphere_after_a_save(svc, store, place):
    place()                                                       # Home Assistant not asked yet
    await save(svc, {"look.glass": "blur"})
    place(-33.9, "AU")                                            # ... then it answers: southern, not the US
    sky = svc.house_feed()["sky"]
    assert sky["hemisphere"] == "south"
    assert "thanksgiving" not in sky["themes"] and "fourth-of-july" not in sky["themes"]
    assert "hemisphere" not in store.body("house", "settings").get("sky", {})


async def test_a_chosen_hemisphere_is_kept(svc, store, place):
    place(-33.9, "AU")
    await save(svc, {"sky.hemisphere": "north"})
    assert store.body("house", "settings")["sky"] == {"hemisphere": "north"}
    assert svc.house_feed()["sky"]["hemisphere"] == "north"


# ------------------------------------------------------------------------------ the normalisation
def test_normalising_keeps_the_feed_and_the_linked_frame_and_writes_one_version(svc, store, place):
    place()
    store.write([("house", "settings", old_merged(look={"glass": "blur"}, sky={"decorations": False}))],
                actor=S.Actor(label="old"))
    before_feed, before_frame = svc.house_feed(), LS.frame_of(svc)
    assert S.normalise_house(store) is True
    after_feed, after_frame = svc.house_feed(), LS.frame_of(svc)
    assert canon(after_feed) == canon(before_feed)
    assert canon(after_frame) == canon(before_frame)
    assert store.body("house", "settings") == {"look": {"glass": "blur"}, "sky": {"decorations": False}}
    hist = store.history("house", "settings")
    assert [h["version"] for h in hist] == [2, 1] and hist[0]["message"] == NORMALISED
    # a second start does nothing
    assert S.normalise_house(store) is False
    assert len(store.history("house", "settings")) == 2


def test_normalising_nothing_writes_nothing(store):
    assert S.normalise_house(store) is False
    assert store.get("house", "settings") is None
    store.write([("house", "settings", {"look": {"glass": "blur"}})], actor=S.Actor(label="t"))
    assert S.normalise_house(store) is False
    assert len(store.history("house", "settings")) == 1


def test_the_server_normalises_at_start(tmp_path, place):
    """build_app: house/settings as stored differences before anything reads it, once."""
    place()
    from mantel_server.config import Config
    from mantel_server.server import build_app
    from mantel_server.store import Store
    store = Store(tmp_path / "mantel.db")
    try:
        st = S.SettingsStore(store.db)
        st.write([("house", "settings", old_merged(menu={"accent": "blue"}))], actor=S.Actor(label="old"))
        for _ in range(2):                                       # two starts: one version
            build_app(Config(data_dir=tmp_path, secrets_dir=tmp_path / "never"), "unused", store=store,
                      connect_ha=False)
        assert st.body("house", "settings") == {"menu": {"accent": "blue"}}
        assert [h["message"] for h in st.history("house", "settings")] == [NORMALISED, None]
    finally:
        store.db.close()


async def test_a_restored_merged_version_is_stored_as_differences(svc, store, place):
    place()
    store.write([("house", "settings", old_merged(look={"glass": "blur"}))], actor=S.Actor(label="old"))
    S.normalise_house(store)
    await save(svc, {"look.glass": "clear"})
    got = await svc.save(OWNER, {"type": "mantel/settings/restore", "scope": "house", "key": "settings", "version": 1})
    assert got["changed"] is True
    assert store.body("house", "settings") == {"look": {"glass": "blur"}}
    assert svc.house_settings() == old_merged(look={"glass": "blur"})


async def test_a_restored_merged_version_from_before_the_place_takes_the_place(svc, store, place):
    """A body saved before Home Assistant said where the house is baked north in; restored in a southern house,
    the hemisphere is the house's default again."""
    place()
    store.write([("house", "settings", old_merged(look={"glass": "blur"}))], actor=S.Actor(label="old"))
    await save(svc, {"look.glass": "clear"})
    place(-33.9, "AU")
    await svc.save(OWNER, {"type": "mantel/settings/restore", "scope": "house", "key": "settings", "version": 1})
    assert "sky" not in store.body("house", "settings")
    assert svc.house_feed()["sky"]["hemisphere"] == "south"


# ------------------------------------------------------------------------------------- the import
async def test_the_import_from_home_assistant_stores_differences(store, place):
    place()
    merged = old_merged(look={"glass": "blur"}, weather={"entity": "weather.fictional_home"})
    merged["browse"]["discover"] = M.discover_rows(merged["browse"]["discover"])   # as a feed would send them

    async def fetch():
        return {"entry_id": "fictional-entry", "settings": json.loads(json.dumps(merged))}
    await S.import_settings(store, fetch, actor=S.Actor(label="test"))
    assert store.body("house", "settings") == {"look": {"glass": "blur"}, "weather": {"entity": "weather.fictional_home"}}


# ------------------------------------------------------------------------------------- the feed
async def test_the_feed_fills_the_car_viewports_as_home_assistants_does(svc, store, place):
    place()
    store.write([("board", "dashboard-car", M.board({"car": True, "car_width": 1200})),
                 ("board", "dashboard-kitchen", M.board({}))], actor=S.Actor(label="t"))
    car = svc.house_feed()["car"]
    stored = S.stored_of(store)
    assert car == M.as_client(stored)["car"] == {"dashboards": ["dashboard-car"], "widths": {"dashboard-car": 1200}}


async def test_a_person_s_values_are_checked_against_the_whole_house(svc, store, place):
    place()
    await save(svc, {"look.glass": "blur"})
    got = await svc.save(OWNER, {"type": "mantel/settings/user/set", "changes": {"look.frost": 30}})
    assert got["settings"] == {"look": {"frost": 30}}
