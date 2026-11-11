"""Mantel's side of Mantel Link (decision 28, docs/phase9/MANTEL-LINK.md): protocol 2 on the linked endpoint
(who is calling, the instance id, the `report`), the bridge (who mirrors Mantel's entities in Home Assistant:
HK Frontend or Mantel Link; handed over by an Owner, audited, only when Home Assistant's side can take it),
and Mantel reading Mantel Link's registry entries as HK Frontend's. A FICTIONAL house; fakes only."""
import asyncio

import pytest

from mantel_server import linked as L
from test_features import ENTRY, Linked, build, make_env  # noqa: F401

LINKED_ON = {"linked": {"enabled": True, "entry_id": ENTRY}}


class Client(Linked):
    """A linked client that says who it is (X-Mantel-Link), or not (HK Frontend before 9.10)."""

    def __init__(self, env, header=None):
        super().__init__(env)
        self.header = header

    async def connect(self):
        h = {"Authorization": f"Bearer {self.token}", **({"X-Mantel-Link": self.header} if self.header else {})}
        self.env.m.client.session.headers.pop("Origin", None)
        try:
            self.ws = await self.env.m.client.ws_connect("/linked/ws", headers=h)
        finally:
            self.env.m.client.session.headers["Origin"] = self.env.m.origin
        return await self.ws.receive_json(timeout=5)


async def put(env, unit, owner):
    return await env.m.client.put("/api/linked/owners", json={"unit": unit, "owner": owner}, headers=env.m.headers())


def test_the_link_header():
    assert L.parse_link_header(None) == ("hk_frontend", 1, frozenset())
    assert L.parse_link_header("domain=mantel; protocol=2; features=bridge,phones") == (
        "mantel", 2, frozenset({"bridge", "phones"}))
    assert L.parse_link_header("domain=hk_frontend; protocol=1; features=bridge") == (
        "hk_frontend", 1, frozenset({"bridge"}))
    # an unknown domain is HK Frontend; a newer protocol is answered with Mantel's newest; junk features dropped
    assert L.parse_link_header("domain=evil; protocol=9; features=a b,ok") == ("hk_frontend", 2, frozenset({"ok"}))
    assert L.wire_owners({"house": "mantel", "tablets": ["b", "a", "a"], "bridge": "nope"}) == {
        "house": "mantel", "tablets": ["a", "b"], "bridge": "hk_frontend"}


async def test_hk_frontend_unchanged_mantel_link_gets_protocol_2(make_env):
    env = await make_env(settings=LINKED_ON, owned=())
    hk = Client(env)
    hello = await hk.connect()
    assert hello["protocol"] == 1 and "instance" not in hello
    assert hello["owners"] == {"house": "ha", "tablets": [], "bridge": "hk_frontend"}
    res, _ = await hk.call(1, type="report", report={"hk_frontend": {"installed": True}})
    assert res["success"] is False and res["error"]["code"] == "bad_request", "protocol 1 has no report"
    link = Client(env, "domain=mantel; protocol=2; features=bridge")
    hello = await link.connect()
    inst = env.app["linked"].instance
    assert hello["protocol"] == 2 and hello["instance"] == inst and len(inst) == 32
    assert env.app["linked_owners"].instance_id() == inst, "made once, kept"
    res, _ = await link.call(1, type="report", report={"hk_frontend": {"installed": True, "loaded": True,
                                                                       "linked": False}})
    assert res["success"] is True
    c = env.app["linked"].registry.clients_of("mantel")[0]
    assert c.report == {"hk_frontend": {"installed": True, "loaded": True, "linked": False}}
    for bad in ({"x": 1}, {"hk_frontend": {"installed": "yes"}}, "nope"):
        res, _ = await link.call(2, type="report", report=bad)
        assert res["error"]["code"] == "invalid", bad
    # a refusal names the action as the caller knows it
    res, _ = await link.call(3, type="call_service", service="launch_rockets", data={})
    assert res["error"]["code"] == "unknown_service" and res["error"]["message"].startswith("mantel.launch_rockets")
    # protocol 2 forwards HK's other actions too (linked_actions.py); HK Frontend's protocol 1 never did
    res, _ = await hk.call(2, type="call_service", service="music_play", data={})
    assert res["error"]["code"] == "unknown_service" and res["error"]["message"].startswith("hk_frontend.music_play")
    assert "music_play" in hello["services"] and "clean_areas" in hello["services"]
    # Mantel Settings sees both links, never a credential
    await env.login("owner1", "owner")
    body = await (await env.m.get("/api/linked/owners")).json()
    assert sorted((x["domain"], x["protocol"]) for x in body["links"]) == [("hk_frontend", 1), ("mantel", 2)]
    assert body["bridge"]["holder"] == "hk_frontend"
    assert hk.token not in repr(body) and link.token not in repr(body)
    await hk.ws.close()
    await link.ws.close()


async def test_the_bridge_moves_only_when_home_assistant_can_take_it(make_env):
    env = await make_env(settings=LINKED_ON, owned=())
    await env.login("owner1", "owner")
    owners = env.app["linked_owners"]
    # no Mantel Link connected
    r = await put(env, "bridge", "mantel")
    assert r.status == 400 and (await r.json())["error"]["code"] == "mantel_link_not_connected"
    link = Client(env, "domain=mantel; protocol=2; features=bridge")
    await link.connect()
    # an HK Frontend without the hand-over hooks is linked: it would keep mirroring
    old_hk = Client(env)
    await old_hk.connect()
    r = await put(env, "bridge", "mantel")
    assert r.status == 400 and (await r.json())["error"]["code"] == "hk_frontend_too_old"
    await old_hk.ws.close()
    # Mantel Link says its Home Assistant has HK Frontend, which isn't linked: it can't let go
    await link.call(1, type="report", report={"hk_frontend": {"installed": True, "loaded": True, "linked": False}})
    r = await put(env, "bridge", "mantel")
    assert r.status == 400 and (await r.json())["error"]["code"] == "hk_frontend_not_linked"
    # HK Frontend's last release, linked: the hand-over goes, audited, both told at once
    hk = Client(env, "domain=hk_frontend; protocol=1; features=bridge")
    await hk.connect()
    r = await put(env, "bridge", "mantel")
    body = await r.json()
    assert r.status == 200 and body["changed"] is True and body["wire"]["bridge"] == "mantel"
    assert owners.bridge() == "mantel" and owners.mantel_tablets() == [], "the bridge row is not a tablet"
    row = env.audit(kind="config")[-1]
    assert row["action"] == "linked.bridge"
    for c in (link, hk):
        f = await c.ws.receive_json(timeout=3)
        assert f == {"type": "owners", "owners": {"house": "ha", "tablets": [], "bridge": "mantel"}}
    assert [t["unit"] for t in body["tablets"]] == ["hall"], "the bridge isn't listed as a tablet"
    # and back to HK Frontend (it is linked with its hooks)
    r = await put(env, "bridge", "hk_frontend")
    assert r.status == 200 and (await r.json())["wire"]["bridge"] == "hk_frontend"
    await hk.ws.close()
    await link.call(2, type="report", report={"hk_frontend": {"installed": False, "loaded": False, "linked": False}})
    for _ in range(50):
        if not env.app["linked"].registry.clients_of("hk_frontend"):
            break
        await asyncio.sleep(0.02)
    r = await put(env, "bridge", "mantel")
    assert r.status == 200, "Mantel Link alone, its HK Frontend gone: nothing to wait for"
    r = await put(env, "bridge", "hk_frontend")
    assert r.status == 400 and (await r.json())["error"]["code"] == "hk_frontend_not_linked"
    # the bridge is not a tablet to move with the tablet rules
    r = await put(env, "bridge", "ha")
    assert r.status == 400 and (await r.json())["error"]["code"] == "invalid"
    await link.ws.close()


def test_mantel_link_s_registry_entries_are_hk_frontend_s_to_mantel():
    from mantel_server.ha.registry import Registry
    reg = Registry()
    reg.update(entities=[{"entity_id": "camera.tv_channel_nine", "platform": "mantel", "unique_id": "x_9.1_camera"},
                         {"entity_id": "camera.porch", "platform": "unifiprotect", "unique_id": "p"}])
    shapes = reg.frontend_shapes()["entities"]
    assert shapes["camera.tv_channel_nine"]["platform"] == "hk_frontend", "HK's pages leave Live TV's channels out"
    assert shapes["camera.porch"]["platform"] == "unifiprotect"


async def test_a_house_without_hk_frontend_gets_mantel_s_own_unique_ids(make_env):
    env = await make_env(settings={"linked": {"enabled": True}}, owned=("hall",))
    inst = env.app["linked"].instance
    assert env.host.entry_id() == inst
    assert all(uid.startswith(inst + "_") for uid in env.app["linked"].registry.entities)


async def test_the_house_s_entities_held_by_mantel_link_are_still_the_house_s(make_env):
    """After the hand-over HA's registry has them under Mantel Link (platform `mantel`, its own entry): Mantel still
    knows them by HK Frontend's unique ids and keeps their entity ids (linked_house.LINK_PLATFORMS)."""
    import test_linked_owners as TLO
    moved = [{**e, "platform": "mantel", "config_entry_id": "01MANTELLINKENTRY000000000"} if e["platform"] == "hk_frontend"
             else e for e in TLO.HA_REGISTRY]
    env = await make_env(settings=LINKED_ON)
    hub = env.app["hub"]
    from test_features import AREAS, DEVICES, ENTITIES
    hub.registry.load(AREAS, DEVICES, ENTITIES + moved)
    hub.store.apply_event({"a": {TLO.ALARM_PANEL: {"s": "armed_away", "lc": 1.0, "a": {
        "protects": "alarm_control_panel.house", "code_arm_required": True, "code_format": "number"}}}})
    await env.login("owner1", "owner")
    assert (await put(env, "house", "mantel")).status == 200
    reg = env.app["linked"].registry
    assert reg.get(f"{ENTRY}_seasonal_decorations")["entity_id"] == "switch.hk_frontend_seasonal_decorations"
    assert reg.get(f"{TLO.LIVE}_4.1_now")["entity_id"] == "sensor.tv_wnbc_now"
    assert reg.get(TLO.ALARM_ITEM)["entity_id"] == TLO.ALARM_PANEL
    assert reg.get("x") is None
