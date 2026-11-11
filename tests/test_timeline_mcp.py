"""The House Timeline's MCP tools (docs/phase19/HOUSE-TIMELINE.md "MCP"): read scope, the caller's own view (an Adult
sees no System row, a wall tablet's principal no names), never pictures."""
from __future__ import annotations

import json
from types import SimpleNamespace as NS

import pytest
from argon2 import PasswordHasher

from mantel_server.config import Config
from mantel_server.mcp.dispatch import ToolError
from mantel_server.mcp.tools import all_tools
from mantel_server.mcp.tools import timeline as T
from mantel_server.server import build_app
from mantel_server.identity.sessions import Identity
from mantel_server.store import Store
from mantel_server.timeline.store import Row

NOW = 1_800_000_000.0


@pytest.fixture
def app(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", port=0, ha_url="",
                 token_file=tmp_path / "none", ma_token_file=tmp_path / "none2")
    store = Store(cfg.data_dir / "mantel.db")
    a = build_app(cfg, "", store=store, connect_ha=False, clock=lambda: NOW)
    a["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    hub = a["hub"]
    hub.registry.load([{"area_id": "hall", "name": "Hallway"}], [],
                      [{"entity_id": "lock.back_door", "area_id": "hall"}])
    hub.store.replace_all({"a": {"lock.back_door": {"s": "locked", "a": {"friendly_name": "Back Door"}, "lc": NOW}}})
    tl = a["timeline"]
    tl.push(Row(src="r1", at=NOW - 600, family="lock", kind="unlocked", title="Back Door unlocked",
                entity="lock.back_door", area="hall", search="back door unlocked hallway", actor="u-emma",
                actor_name="Emma", how="home"))
    tl.push(Row(src="r2", at=NOW - 300, family="system", kind="raised", title="Home Assistant disconnected",
                search="home assistant disconnected"))
    tl.push(Row(src="r3", at=NOW - 100, family="detection", kind="person", title="Person at Driveway Cam",
                entity="camera.driveway", search="person driveway cam"))
    tl.flush()
    with store.db:
        store.db.execute("INSERT INTO timeline_pics (id, event, camera, at, size) VALUES (?, 3, 'camera.driveway', ?, 3)",
                         ("a" * 32, NOW))
    yield a
    store.db.close()


def caller(app, role):
    user = NS(id=f"u-{role}", role=role, name=role.title(), disabled=False)
    principal = app["authz"].principal_of(Identity(user=user, device=None, door="lan"))
    return NS(app=app, user=user, principal=principal)


async def test_the_tools_are_read_only_and_follow_the_callers_view(app):
    tools = {t.name: t for t in all_tools()}
    for name in ("timeline_find", "timeline_digest"):
        assert tools[name].needs == "read" and not tools[name].write
    owner = await T.timeline_find(caller(app, "owner"), {})
    titles = [e["title"] for e in owner["events"]]
    assert "Home Assistant disconnected" in titles and "Back Door unlocked" in titles
    assert next(e for e in owner["events"] if e["title"] == "Back Door unlocked")["who"]["name"] == "Emma"
    adult = await T.timeline_find(caller(app, "adult"), {"family": "locks", "q": "back door"})
    assert [e["title"] for e in adult["events"]] == ["Back Door unlocked"]
    everything = await T.timeline_find(caller(app, "adult"), {})
    assert all(e["family"] != "system" for e in everything["events"])
    # never a picture, nor its address
    assert "a" * 32 not in json.dumps(owner) and "/api/timeline/pic" not in json.dumps(owner)
    got = await T.timeline_digest(caller(app, "owner"), {"window": "24h"})
    assert got["window"] == "24h" and "lines" in got


async def test_a_guest_and_a_child_are_refused(app):
    for role in ("guest", "child"):
        with pytest.raises(ToolError) as refused:
            await T.timeline_find(caller(app, role), {})
        assert refused.value.code == "forbidden"
