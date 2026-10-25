"""Known gaps in the settings store, pinned (docs/development/Audit-2026-10-second-pass.md, SET-2 and SET-7: deferred,
with the reasons there). Each test states what SHOULD hold and is xfail(strict=True): the day a gap is fixed its
test passes, which fails under strict, and the marker comes off."""
from __future__ import annotations

from pathlib import Path

import pytest

from hk_core.settings import model as M
from mantel_server import settings_store as S
from mantel_server.db import Database

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
OWNER = {"user_id": "owner-id", "role": "owner"}


def grid(*items, **kw):
    return {"v": 1, "cols": 6, "rows": 4, "frame": [1280, 800], "band": True, "items": list(items), **kw}


def block(iid, card, size, at, **more):
    return {"id": iid, "card": card, "size": size, "at": at, **more}


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


# ---------------------------------------------------------------------------------------------- SET-2
# P2. Mantel stores the MERGED house settings (HkCoreModel.apply_house returns merged(options); HA stores only
# what differs, house_stored). So the first save bakes today's defaults in as if they were choices -- including
# the new place defaults (hemisphere, US-only themes). A save made before server.house_tz has read HA's
# get_config (a first run; HA down at start: it retries for ~26 min) fixes "north" + every theme for good, and
# merged() ("a saved choice always wins") never applies the place afterwards. Same for every existing house.
@pytest.mark.xfail(strict=True, reason="SET-2 (deferred): Mantel stores the merged house settings, so a first save fixes today's place defaults")
def test_set2_a_default_is_not_a_saved_choice(place):
    place()                                                         # HA not asked yet
    model = S.load_model()
    doc, errors = model.apply_house({}, {"look.glass": "blur"})
    assert errors == {}
    place(-33.9, "AU")                                              # ... then HA answers: a southern, non-US house
    sky = M.merged({"dashboard": doc})["sky"]
    assert sky["hemisphere"] == "south" and "thanksgiving" not in sky["themes"]
    assert set(doc.get("sky", {})) - {"hemisphere", "themes"} == set(doc.get("sky", {}))   # nothing baked


# ---------------------------------------------------------------------------------------------- SET-7
# P2. Two editors, one screen. board/set carries the whole home_grid and no version (WRITE_KEYS has no place for
# one; _only refuses an extra key), so the second Save silently replaces the first editor's layout: no conflict,
# no merge. (store.write's expect= guards nothing here: _board_set reads and writes with no await between.)
@pytest.mark.xfail(strict=True, reason="SET-7 (deferred): board/set carries no version in either host's schema")
async def test_set7_the_second_editor_does_not_silently_erase_the_first(svc, store):
    store.write([("board", "dashboard-x", M.board({}))], actor=S.Actor(label="t"))
    opened = store.get("board", "dashboard-x").version                   # both editors opened here
    first = grid(block("a1", "timers", "S", [0, 0]))
    second = grid(block("b1", "people", "W", [2, 0]))

    async def save(layout):                                          # exactly what hk-grid-editor.js save() sends
        return await svc.save(OWNER, {"type": "hk_frontend/board/set", "dashboard": "dashboard-x",
                                      "changes": {"home_style": "grid", "home_grid": layout}})
    await save(first)
    # the protocol cannot even say "I edited version `opened`": _only refuses the extra key
    with pytest.raises(S.SettingsError) as unsayable:
        await svc.save(OWNER, {"type": "hk_frontend/board/set", "dashboard": "dashboard-x", "version": opened,
                               "changes": {"home_style": "grid", "home_grid": second}})
    assert unsayable.value.fields == {"version": "unexpected"}
    refused = False
    try:
        await save(second)
    except S.SettingsError as exc:
        refused = exc.code == "conflict"
    ids = [i["id"] for i in store.body("board", "dashboard-x")["home_grid"]["items"]]
    assert refused or "a1" in ids, "the first editor's block is gone and nobody was told"


