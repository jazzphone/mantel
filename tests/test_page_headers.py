"""The Lights page's "Tonight" list on Mantel (page_headers.py): Mantel Link's mantel/page_headers/get, read by Mantel
itself (a server-only read), sent to each screen as HK Frontend sent it, cut down to the lights that person may view,
and read again when an automation switches. A FICTIONAL house; fakes only."""
import asyncio

import gateway_fakes as GF
from mantel_server import page_headers as PH
from mantel_server.ha.readproxy import READ_ALLOWED, SERVER_ONLY_READS
from test_features import make_env  # noqa: F401 -- the fixture

YARD = {"automation": "automation.yard", "trigger_id": "dusk", "kind": "sun", "event": "sunset", "offset_s": -900,
        "effect": "on", "entities": ["light.cody", "light.kitchen"], "area": "Yard", "name": "Yard", "ready": True}
LATE = {"automation": "automation.yard", "trigger_id": "late", "kind": "time", "at": "22:00", "effect": "off",
        "entities": ["light.kitchen"], "area": "Yard", "name": "Yard", "ready": False}


class MantelLink:
    def __init__(self, schedule=None, fail=False):
        self.schedule, self.fail, self.asked = schedule or [], fail, []

    async def read_server(self, msg):
        self.asked.append(msg["type"])
        if self.fail:
            raise RuntimeError("unknown_command")
        return {"lights": {"schedule": self.schedule}}

    async def close(self):
        pass


async def feed(env, ws, rid=5):
    await ws.send_json({"type": "read_subscribe", "id": rid, "msg": {"type": PH.FEED}})
    return await next_event(ws, rid)


async def next_event(ws, rid=5, timeout=3):
    while True:
        m = await asyncio.wait_for(GF.recv(ws), timeout)
        if m.get("id") == rid and m.get("type") == "read_event":
            return m["event"]
        if m.get("id") == rid and m.get("type") == "read_result" and "error" in m:
            return m


def test_the_read_is_mantels_own_and_the_feed_is_answered_here():
    assert READ_ALLOWED[PH.READ] == frozenset() and PH.READ in SERVER_ONLY_READS


async def test_each_person_sees_the_lights_they_may_view(make_env):
    env = await make_env()
    env.app["hub"].readproxy = link = MantelLink([YARD, LATE])
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    got = await feed(env, ws)
    assert got == {"lights": {"schedule": [YARD, LATE]}} and link.asked == [PH.READ]
    await ws.close()
    await env.login("cody", "child")
    uid = env.app["store"].db.execute("SELECT id FROM users WHERE username = 'cody'").fetchone()[0]
    env.app["rbac"].set_scopes("user", uid, ["cody_room"])
    ws = await env.socket(expect_caps=False)
    got = await feed(env, ws, rid=6)
    assert got == {"lights": {"schedule": [{**YARD, "entities": ["light.cody"]}]}}, \
        "only the lights the person may view; an entry with none left is gone"
    await ws.close()


async def test_read_again_when_an_automation_switches(make_env, monkeypatch):
    monkeypatch.setattr(PH, "SOON_S", 0.05)
    env = await make_env()
    env.app["hub"].readproxy = link = MantelLink([YARD])
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    assert (await feed(env, ws))["lights"]["schedule"] == [YARD]
    link.schedule = [YARD, LATE]
    env.app["hub"].ha.on_change({"automation.yard"})
    got = await next_event(ws)
    assert got["lights"]["schedule"] == [YARD, LATE]
    await ws.close()


async def test_without_mantel_link_the_list_is_empty_never_an_error(make_env):
    env = await make_env()
    env.app["hub"].readproxy = MantelLink(fail=True)
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    assert await feed(env, ws) == {"lights": {"schedule": []}}
    await ws.close()


async def test_a_subscription_carrying_anything_is_refused(make_env):
    env = await make_env()
    env.app["hub"].readproxy = MantelLink([YARD])
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    await ws.send_json({"type": "read_subscribe", "id": 9, "msg": {"type": PH.FEED, "entity_id": "x"}})
    got = await next_event(ws, 9)
    assert got.get("error", {}).get("code") in ("not_allowed", "invalid")
    await ws.close()


async def test_an_automation_that_only_ran_is_not_read_again_but_one_that_switched_is(make_env, monkeypatch):
    """2026-11-01 (audit 3, LINK-3): every run of an automation updates `last_triggered`, an attribute-only change,
    and each one scheduled a full read of the schedule from Home Assistant. Only a state change reads again."""
    monkeypatch.setattr(PH, "SOON_S", 0.05)
    env = await make_env()
    env.app["hub"].readproxy = link = MantelLink([YARD])
    ha = env.app["hub"].ha

    def put(state, **attrs):
        ha.store.states["automation.yard"] = {"s": state, "a": attrs, "lc": 1.0, "lu": 1.0}

    put("on", last_triggered="2026-11-01T01:00:00")
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    assert (await feed(env, ws))["lights"]["schedule"] == [YARD]
    ha.on_change({"automation.yard"})                 # the first sighting of this automation's state
    await asyncio.sleep(0.2)
    reads = len(link.asked)
    for n in range(3):                                # it ran three more times: same state, new last_triggered
        put("on", last_triggered=f"2026-11-01T0{n + 2}:00:00")
        ha.on_change({"automation.yard"})
    await asyncio.sleep(0.3)
    assert len(link.asked) == reads, "attribute-only updates schedule no read"
    put("off", last_triggered="2026-11-01T05:00:00")  # an Owner turned it off
    link.schedule = []
    ha.on_change({"automation.yard"})
    got = await next_event(ws)
    assert got["lights"]["schedule"] == [] and len(link.asked) == reads + 1
    await ws.close()
