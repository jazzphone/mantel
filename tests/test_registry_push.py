"""Registry changes reach open pages (Phase 6). A page reads /api/registry once as it loads; an area renamed in Home
Assistant afterwards stayed as it was on every open screen until someone reloaded it. Now the snapshot frame carries
the digest of the registry this session may see, and a change sends `{type: "registry", digest}` to each session
whose filtered registry changed -- only those: a Child hears nothing of rooms it cannot see. /api/registry answers
from a cache keyed by that digest, so a repeat (every preview frame of the Home Grid editor) serializes nothing."""
import asyncio
import json

from gateway_fakes import HOUSE_AREAS, HOUSE_ENTITIES, off, recv  # noqa: F401 -- fixtures
from test_wiring import uid


def renamed(area_id, name):
    return [dict(a, name=name) if a["area_id"] == area_id else a for a in HOUSE_AREAS]


async def page(env, username, role, scope=None):
    await env.login(username, role)
    if scope is not None:
        env.app["rbac"].set_scopes("user", uid(env, username), scope)
    env.app["hub"].registry_push_delay = 0.0
    ws = await env.socket(expect_caps=False)
    await ws.send_json({"type": "subscribe", "all": True})
    snap = await recv(ws)
    assert snap["type"] == "snapshot"
    return ws, snap


async def etag(env):
    r = await env.m.client.get("/api/registry")
    assert r.status == 200
    return r.headers["ETag"].strip('"'), await r.json()


async def quiet(ws):
    """Nothing came in before the answer to a ping: the first frame is the pong."""
    await asyncio.sleep(0.05)
    await ws.send_json({"type": "ping"})
    assert await recv(ws) == {"type": "pong"}


def change(env, **lists):
    hub = env.app["hub"]
    hub.registry.update(**lists)
    hub.on_registry()                        # what HaClient does after a debounced registry reload


async def test_an_area_rename_reaches_an_open_page(off):
    ws, snap = await page(off, "avery", "owner")
    before, _ = await etag(off)
    assert snap["registry"] == before, "the snapshot says which registry this session may see"
    change(off, areas=renamed("kitchen", "Big Kitchen"))
    frame = await recv(ws)
    assert frame["type"] == "registry" and frame["digest"] != before
    after, reg = await etag(off)
    assert frame["digest"] == after and reg["areas"]["kitchen"]["name"] == "Big Kitchen"
    change(off, areas=renamed("kitchen", "Big Kitchen"))     # loaded again, the same: nothing to tell
    await quiet(ws)
    await ws.close()


async def test_a_burst_of_reloads_sends_one_frame(off):
    ws, snap = await page(off, "avery", "owner")
    off.app["hub"].registry_push_delay = 0.05
    for n in range(4):
        change(off, areas=renamed("kitchen", f"Kitchen {n}"))
    frame = await recv(ws)
    assert frame == {"type": "registry", "digest": (await etag(off))[0]}
    await quiet(ws)
    await ws.close()


async def test_a_child_hears_nothing_of_what_it_cannot_see(off):
    ws, snap = await page(off, "cody", "child", ["cody_room"])
    mine, reg = await etag(off)
    assert snap["registry"] == mine and set(reg["entities"]) == {"light.cody"}
    # the kitchen renamed, a light added to it: not the Child's
    change(off, areas=renamed("kitchen", "Big Kitchen"),
           entities=HOUSE_ENTITIES + [{"entity_id": "light.kitchen_2", "area_id": "kitchen"}])
    await quiet(ws)
    assert (await etag(off))[0] == mine, "the Child's digest did not change"
    # its own room renamed: that one it hears of
    change(off, areas=renamed("cody_room", "Cody's Den"))
    frame = await recv(ws)
    assert frame["type"] == "registry" and frame["digest"] != mine
    assert frame["digest"] == (await etag(off))[0]
    await ws.close()


def count_registry_dumps(monkeypatch):
    """How many times a registry body (the four registries) is serialized."""
    real, seen = json.dumps, []

    def dumps(obj, *a, **kw):
        if isinstance(obj, dict) and {"entities", "devices", "areas", "floors"} <= set(obj):
            seen.append(1)
        return real(obj, *a, **kw)

    monkeypatch.setattr(json, "dumps", dumps)
    return seen


async def test_a_second_request_serializes_nothing(off, monkeypatch):
    await off.login("avery", "owner")
    c = off.m.client
    seen = count_registry_dumps(monkeypatch)
    first = await c.get("/api/registry", headers={"Accept-Encoding": "gzip"})
    assert first.status == 200 and first.headers.get("Content-Encoding") == "gzip"
    body, tag = await first.json(), first.headers["ETag"]
    n = len(seen)
    again = await c.get("/api/registry", headers={"Accept-Encoding": "gzip"})
    assert again.status == 200 and await again.json() == body and again.headers["ETag"] == tag
    plain = await c.get("/api/registry", headers={"Accept-Encoding": "identity"})
    assert plain.status == 200 and await plain.json() == body
    same = await c.get("/api/registry", headers={"If-None-Match": tag})
    assert same.status == 304 and await same.read() == b""
    assert len(seen) == n, "the repeats were answered from the cache"
    # a change: one new body, once
    change(off, areas=renamed("kitchen", "Big Kitchen"))
    r = await c.get("/api/registry")
    assert r.status == 200 and r.headers["ETag"] != tag
    assert (await c.get("/api/registry", headers={"If-None-Match": tag})).status == 200
    m = len(seen)
    await c.get("/api/registry")
    assert len(seen) == m


async def test_the_whole_registry_is_serialized_once(off, monkeypatch):
    """2026-10-29: Registry.digest and the body for a subject who sees everything were each a serialization of
    the same registry. One serialization is the digest's and the body's (the page's digest is of that body)."""
    import hashlib
    await off.login("avery", "owner")
    seen = count_registry_dumps(monkeypatch)
    r = await off.m.client.get("/api/registry")
    assert r.status == 200
    assert len(seen) == 1, "serialized once for the digest and the body"
    raw = await r.read()
    assert r.headers["ETag"].strip('W/"') == hashlib.sha256(raw).hexdigest()[:32]


async def test_each_person_gets_their_own_body(off):
    ws, _ = await page(off, "cody", "child", ["cody_room"])
    child_tag, child = await etag(off)
    await ws.close()
    await off.login("avery", "owner")
    owner_tag, owner = await etag(off)
    assert owner_tag != child_tag and set(child["entities"]) == {"light.cody"} and "light.kitchen" in owner["entities"]
    r = await off.m.client.get("/api/registry", headers={"If-None-Match": f'"{child_tag}"'})
    assert r.status == 200, "the Child's ETag is not the Owner's registry"


async def test_a_grant_change_tells_the_page(off):
    """A room added to the Child's scope: its registry has a new room, so the page reads it again."""
    ws, snap = await page(off, "cody", "child", ["cody_room"])
    off.app["rbac"].set_scopes("user", uid(off, "cody"), ["cody_room", "kitchen"])
    from mantel_server.identity.rbac_store import notify_sessions
    notify_sessions(off.app["hub"])
    while (frame := await recv(ws))["type"] != "registry":
        pass
    assert frame["digest"] != snap["registry"]
    await ws.close()


def test_the_digest_follows_the_registry():
    from mantel_server.ha.registry import Registry
    r = Registry()
    r.load(HOUSE_AREAS, [], HOUSE_ENTITIES)
    d = r.digest
    assert r.digest == d and len(d) >= 16
    r.update(areas=HOUSE_AREAS)                    # loaded again, the same lists
    assert r.digest == d
    r.update(areas=renamed("porch", "Front Porch"))
    assert r.digest != d


def test_overlays_merging_in_turn_leave_the_registry_as_it_was():
    """The house, 2026-11-26: every page read the registry again every 5 minutes. Protect's refresh merged its own
    detection sensors in, then the direct cameras' 30 s tick merged the camera in, and each merge put its entries at
    the end: the same entries in another order, a new digest, a `registry` frame to every page. A merge of what is
    already there changes nothing; a real change lands where its entry was."""
    from types import SimpleNamespace

    from mantel_server.cameras.live_tv import LocalEntities
    from mantel_server.ha.registry import Registry
    reg = Registry()
    reg.load(HOUSE_AREAS, [], HOUSE_ENTITIES)
    hub = SimpleNamespace(registry=reg, store=SimpleNamespace(states={}))
    cams, protect = LocalEntities(hub, flag="mantel_direct_camera"), LocalEntities(hub, flag="mantel_protect")

    def entry(eid, flag, **extra):
        return {"entity_id": eid, "platform": flag, "device_id": "mantel_cam_loft", "area_id": None, flag: True, **extra}

    cams.registry = {"camera.mantel_loft": entry("camera.mantel_loft", "mantel_direct_camera")}
    sensors = [f"binary_sensor.mantel_loft_{k}" for k in ("animal_detected", "motion", "person_detected")]
    protect.registry = {eid: entry(eid, "mantel_protect") for eid in sensors}

    def merge(overlay):
        merged = overlay.merged_entities(list(reg.entity_entries))
        if merged is not None:
            reg.update(entities=merged)
        return merged is not None

    assert merge(cams) and merge(protect)
    digest, order = reg.digest, [e["entity_id"] for e in reg.entity_entries]
    for _ in range(3):                          # the refresh and the tick, in turn
        assert not merge(cams) and not merge(protect)
    assert reg.digest == digest
    protect.registry[sensors[0]] = entry(sensors[0], "mantel_protect", area_id="kitchen")
    assert merge(protect) and [e["entity_id"] for e in reg.entity_entries] == order
    assert reg.entries[sensors[0]]["area_id"] == "kitchen" and reg.digest != digest
    del protect.registry[sensors[1]]
    protect.registry["binary_sensor.mantel_loft_vehicle_detected"] = entry("binary_sensor.mantel_loft_vehicle_detected",
                                                                         "mantel_protect")
    assert merge(protect)
    assert [e["entity_id"] for e in reg.entity_entries][-4:] == [
        "camera.mantel_loft", sensors[0], sensors[2], "binary_sensor.mantel_loft_vehicle_detected"]
