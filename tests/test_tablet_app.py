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
    assert T._clean({"version": "0.1.1", "battery": 82, "screen": True, "secret": "x", "brightness": "high"}) == \
        {"version": "0.1.1", "battery": 82.0, "screen": True}


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
