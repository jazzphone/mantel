"""Mantel for Android managed from Mantel Settings, through the tablet's page (apps/tablet_app.py)."""
import asyncio
import json
from types import SimpleNamespace

from mantel_server.apps import tablet_app as T
from mantel_server.identity import device_claim as C


async def paired_tablet(mantel):
    """An Owner, and a tablet paired by code; the cookies left are the tablet's. Returns the device id."""
    await mantel.user("avery", "owner")
    await mantel.sign_in("avery")
    code = (await (await mantel.post(C.CODES_API, {"room": "kitchen", "name": "Kitchen Kiosk"})).json())["code"]
    mantel.forget_cookies()
    r = await mantel.post(C.CLAIM_API, {"code": code}, csrf=False)
    return (await r.json())["device"]["id"]


async def owner_again(mantel):
    mantel.forget_cookies()
    await mantel.sign_in("avery")


def commands_on(mantel):
    mantel.app["gateway"] = SimpleNamespace(commander=object())


async def frames(ws, kind, timeout=3.0):
    end = asyncio.get_running_loop().time() + timeout
    while True:
        m = await asyncio.wait_for(ws.receive_json(), max(0.05, end - asyncio.get_running_loop().time()))
        if m.get("type") == kind:
            return m


def test_commands_and_their_values_are_a_closed_list():
    assert T.checked("screen", True) == ("screen", True) and T.checked("screen", 1) is None
    assert T.checked("brightness", 0.5) == ("brightness", 0.5) and T.checked("brightness", 2) is None
    assert T.checked("brightness", True) is None and T.checked("reload", None) == ("reload", None)
    assert T.checked("reload", "x") is None and T.checked("menu_pin", "1234") == ("menu_pin", "1234")
    assert T.checked("menu_pin", "12a4") is None and T.checked("uninstall", None) is None
    # the screen's rotation (2026-11-13): Android's own four, or left to Android; nothing else, and never a number
    assert [T.checked("rotation", v) for v in ("auto", "90", "270")] == [("rotation", "auto"), ("rotation", "90"), ("rotation", "270")]
    assert T.checked("rotation", "45") is None and T.checked("rotation", 90) is None and T.checked("rotation", None) is None
    # AirPlay (phase 30): the receiver and its three offers, each on or off and nothing else
    assert [T.checked(c, True) for c in ("airplay", "airplay_mirroring", "airplay_video", "airplay_audio")] == \
        [("airplay", True), ("airplay_mirroring", True), ("airplay_video", True), ("airplay_audio", True)]
    assert T.checked("airplay", "on") is None and T.checked("airplay_audio", None) is None
    # its AirPlay name (2026-11-16): trimmed, up to 40 printable characters; empty is the app's own name again
    assert T.checked("airplay_name", "  Kitchen ") == ("airplay_name", "Kitchen") and T.checked("airplay_name", "") == ("airplay_name", "")
    assert T.checked("airplay_name", "x" * 41) is None and T.checked("airplay_name", "a\nb") is None and T.checked("airplay_name", True) is None
    assert T.checked("settings", {"airplay_name": "Kitchen"}) is None                 # never copied from another tablet
    # the tablet's own options (2026-11-13): switches, the page's size from a short list, and a copy of several at once
    assert [T.checked(c, False) for c in ("keep_awake", "keep_screen_on", "adaptive_brightness", "wireless_debugging")] == \
        [("keep_awake", False), ("keep_screen_on", False), ("adaptive_brightness", False), ("wireless_debugging", False)]
    assert T.checked("scale", 125) == ("scale", 125) and T.checked("scale", 123) is None
    assert T.checked("scale", True) is None and T.checked("scale", "125") is None
    copy = {"kiosk_mode": True, "rotation": "90", "scale": 110, "keep_awake": True, "airplay": False}
    assert T.checked("settings", copy) == ("settings", copy)
    assert T.checked("settings", {}) is None and T.checked("settings", {"scale": 111}) is None
    # never another tablet's wireless debugging, screen, brightness or PIN
    for k, v in (("wireless_debugging", True), ("screen", False), ("brightness", 0.5), ("menu_pin", "1")):
        assert T.checked("settings", {"scale": 100, k: v}) is None
    assert T._clean({"keep_awake": True, "scale": 110, "adb_port": 37011, "wireless_debugging": True}) == \
        {"keep_awake": True, "scale": 110, "adb_port": 37011, "wireless_debugging": True}
    assert T._clean({"airplay": True, "airplay_state": "Mirroring", "airplay_name": "Kitchen Kiosk", "airplay_pin": "1234"}) == \
        {"airplay": True, "airplay_state": "Mirroring", "airplay_name": "Kitchen Kiosk"}
    assert T._clean({"version": "0.1.1", "battery": 82, "screen": True, "secret": "x", "brightness": "high"}) == \
        {"version": "0.1.1", "battery": 82.0, "screen": True}


def test_graphics_commands_are_closed_too():
    """How the tablet draws (the app's Graphics.kt): the renderer, the resolution, and the pairing of its own adb."""
    assert T.checked("renderer", "opengl") == ("renderer", "opengl") and T.checked("renderer", "default") == ("renderer", "default")
    assert T.checked("renderer", "vulkan") is None and T.checked("renderer", True) is None
    assert [T.checked("render_size", v) for v in (100, 83, 67)] == [("render_size", 100), ("render_size", 83), ("render_size", 67)]
    assert T.checked("render_size", 50) is None and T.checked("render_size", True) is None and T.checked("render_size", "83") is None
    assert T.checked("adb_pair", {"port": 37123, "code": "482913"}) == ("adb_pair", {"port": 37123, "code": "482913"})
    for bad in ({"port": 37123, "code": "4829"}, {"port": 0, "code": "482913"}, {"port": "37123", "code": "482913"},
                {"port": 37123, "code": "482913", "extra": 1}, {"port": True, "code": "482913"}, "482913", None):
        assert T.checked("adb_pair", bad) is None, bad
    assert "renderer" not in T.COPYABLE and "render_size" not in T.COPYABLE   # each tablet's own
    st = T._clean({"renderer": "opengl", "renderer_now": "default", "render_size": 83, "adb_paired": True, "junk": 1})
    assert st == {"renderer": "opengl", "renderer_now": "default", "render_size": 83, "adb_paired": True}


async def test_the_tablet_reports_and_an_owner_reads_it(mantel):
    did = await paired_tablet(mantel)
    ws = await mantel.client.ws_connect("/ws")
    await ws.send_json({"type": "tablet_app", "event": "status", "status": {"version": "0.1.1", "screen": True,
                                                                            "brightness": 0.6, "battery": 82, "pin": "9"}})
    await asyncio.sleep(0.1)
    await owner_again(mantel)
    r = await mantel.get(f"/api/devices/{did}/app")
    got = await r.json()
    assert r.status == 200 and got["connected"] and got["fresh"]
    assert got["status"] == {"version": "0.1.1", "screen": True, "brightness": 0.6, "battery": 82.0}
    assert "restart" in got["commands"]
    # only the managers, only at home
    assert (await mantel.get(f"/api/devices/{did}/app", tunnel=True)).status in (401, 403)
    await ws.close()


async def test_a_command_reaches_the_tablets_page_and_its_answer_comes_back(mantel):
    did = await paired_tablet(mantel)
    ws = await mantel.client.ws_connect("/ws")
    await owner_again(mantel)
    commands_on(mantel)

    async def page():
        m = await frames(ws, "tablet_app")
        assert m["event"] == "command" and m["command"] == "brightness" and m["value"] == 0.4
        await ws.send_json({"type": "tablet_app", "event": "done", "nonce": m["nonce"], "ok": True,
                            "status": {"brightness": 0.4}})
    answering = asyncio.create_task(page())
    r = await mantel.post(f"/api/devices/{did}/app", {"command": "brightness", "value": 0.4})
    await answering
    got = await r.json()
    assert r.status == 200 and got["answered"] and got["status"] == {"brightness": 0.4}
    [row] = [x for x in mantel.app["audit"].rows(kind="config") if x["action"] == "device.app_command"]
    assert json.loads(row["target"])["command"] == "brightness"
    await ws.close()


async def test_refusals(mantel):
    did = await paired_tablet(mantel)
    await owner_again(mantel)
    r = await mantel.post(f"/api/devices/{did}/app", {"command": "reload"})
    assert r.status == 503 and (await r.json())["error"] == "commands_disabled"       # house commands off
    commands_on(mantel)
    r = await mantel.post(f"/api/devices/{did}/app", {"command": "reload"})
    assert r.status == 409 and (await r.json())["error"] == "not_connected"           # no page open
    r = await mantel.post(f"/api/devices/{did}/app", {"command": "format_disk"})
    assert r.status == 400
    r = await mantel.post(f"/api/devices/{did}/app", {"command": "menu_pin", "value": "12ab"})
    assert r.status == 400
    assert not [x for x in mantel.app["audit"].rows(kind="config") if x["action"] == "device.app_command"]
    assert (await mantel.post("/api/devices/" + "0" * 32 + "/app", {"command": "reload"})).status == 404


async def test_a_persons_page_speaks_for_no_tablet(mantel):
    did = await paired_tablet(mantel)
    await owner_again(mantel)
    ws = await mantel.client.ws_connect("/ws")                 # the Owner's own page, not a tablet's
    await ws.send_json({"type": "tablet_app", "event": "status", "status": {"version": "6.6.6"}})
    await asyncio.sleep(0.1)
    assert (await (await mantel.get(f"/api/devices/{did}/app")).json())["status"] is None
    await ws.close()


async def test_a_picture_of_the_glass_rides_back_and_is_served_to_the_managers_only(mantel):
    import base64
    did = await paired_tablet(mantel)
    ws = await mantel.client.ws_connect("/ws")
    await owner_again(mantel)
    commands_on(mantel)
    jpeg = b"\xff\xd8\xff\xe0" + b"fictional picture" * 10

    async def page():
        m = await frames(ws, "tablet_app")
        assert m["command"] == "screenshot" and m["value"] is None
        await ws.send_json({"type": "tablet_app", "event": "done", "nonce": m["nonce"], "ok": True,
                            "image": base64.b64encode(jpeg).decode()})
    answering = asyncio.create_task(page())
    r = await mantel.post(f"/api/devices/{did}/app", {"command": "screenshot"})
    await answering
    got = await r.json()
    assert r.status == 200 and got["image"].startswith(f"/api/devices/{did}/app/screenshot?at=")
    r = await mantel.get(got["image"])
    assert r.status == 200 and r.headers["Content-Type"] == "image/jpeg" and await r.read() == jpeg
    assert r.headers["Cache-Control"] == "no-store"
    # a picture nobody asked for, or not a JPEG, is dropped
    await ws.send_json({"type": "tablet_app", "event": "done", "nonce": "nobody", "ok": True,
                        "image": base64.b64encode(b"\xff\xd8\xff other").decode()})
    await asyncio.sleep(0.1)
    assert await (await mantel.get(got["image"])).read() == jpeg
    assert T._jpeg(base64.b64encode(b"GIF89a").decode()) is None and T._jpeg("not base64!") is None
    assert (await mantel.get(got["image"], tunnel=True)).status in (401, 403)
    await ws.close()


def test_what_an_app_is_sent_to_follow_all_tablets():
    """All Tablets' options with a tablet's own over them (hk_core app_wanted), sent where the app says otherwise."""
    st = {"keep_awake": True, "scale": 100, "renderer": "default", "render_size": 100, "airplay": False, "adb_paired": False}
    assert T.to_send({"keep_awake": True, "scale": 100}, st) == []
    assert T.to_send({"keep_awake": False, "scale": 125, "airplay": True}, st) == \
        [("settings", {"keep_awake": False, "scale": 125, "airplay": True})]
    # the renderer and the resolution only through the app's own adb, each its own command
    assert T.to_send({"renderer": "opengl", "render_size": 67}, st) == []
    assert T.to_send({"renderer": "opengl", "render_size": 67}, {**st, "adb_paired": True}) == \
        [("renderer", "opengl"), ("render_size", 67)]
    # an option the app doesn't say (an older app) is left alone
    assert T.to_send({"keep_screen_on": False}, st) == []


async def test_an_app_follows_all_tablets_and_its_own(mantel):
    from mantel_server.settings_store.store import Actor
    did = await paired_tablet(mantel)
    ws = await mantel.client.ws_connect("/ws")
    commands_on(mantel)
    mantel.app["settings"].store.write(
        [("house", "settings", {"tablets": {"app": {"keep_awake": False, "scale": 110}}}),
         ("tablet", "kitchen", {"name": "Kitchen", "screen": "dashboard-kitchen", "room": "kitchen", "app": "android_app",
                                "app_options": {"scale": 125}})],
        actor=Actor(label="test"), message="All Tablets and the Kitchen's own")
    await ws.send_json({"type": "tablet_app", "event": "status",
                        "status": {"keep_awake": True, "scale": 100, "renderer": "default", "adb_paired": False}})
    m = await frames(ws, "tablet_app")
    assert m["event"] == "command" and m["command"] == "settings" and m["value"] == {"keep_awake": False, "scale": 125}
    # the same again within FOLLOW_AGAIN is not sent twice
    assert await T.follow(mantel.app, did, {"keep_awake": True, "scale": 100}, "kitchen") == 0
    # a device in a room no tablet has is sent nothing
    assert await T.follow(mantel.app, did, {"keep_awake": True, "scale": 100}, "garage") == 0
    await ws.close()
