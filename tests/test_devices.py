"""P3.1 devices: "Make this a wall tablet" — enrolment, rotation, reuse, revocation, LAN only."""
import asyncio
import json

from mantel_server.devices import RETIRED_GRACE, ROTATE_EVERY
from mantel_server.sessions import token_hash


async def enroll(mantel, **body):
    r = await mantel.post("/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen", **body})
    return r, await r.json()


async def test_owner_turns_the_browser_into_a_wall_tablet(mantel):
    await mantel.user("avery", "owner")
    r, _ = await mantel.sign_in("avery")
    person_refresh = r.cookies["mantel_refresh"].value
    r, body = await enroll(mantel)
    assert r.status == 201 and body["device"]["role"] == "wall_tablet" and body["device"]["room"] == "kitchen"
    c = r.cookies["mantel_device"]
    assert c["httponly"] and c["samesite"] == "Strict"
    assert r.cookies["mantel_session"].value == ""                         # the person's session is gone
    stored = mantel.store.db.execute("SELECT secret_hash FROM devices").fetchone()[0]
    assert stored == token_hash(c.value) and c.value not in "\n".join(mantel.store.db.iterdump())
    me = await (await mantel.get("/api/session")).json()
    assert me["user"] is None and me["device"]["name"] == "Kitchen tablet" and me["csrf"]
    assert await (await mantel.get("/api/me")).json() == {"ha_user_id": None, "name": "Kitchen tablet",
                                                          "role": "wall_tablet", "ha_address": None}
    # the old person session cannot come back through its refresh token
    mantel.set_cookies(mantel_refresh=person_refresh)
    assert (await (await mantel.get("/api/session")).json())["user"] is None
    # the tablet reads state over the WebSocket like any client; commands stay disabled
    ws = await mantel.client.ws_connect("/ws")
    await ws.send_json({"type": "ping"})
    assert (await asyncio.wait_for(ws.receive_json(), 2))["type"] == "pong"
    await ws.send_json({"type": "command", "cmd": "light.turn_on"})
    assert (await asyncio.wait_for(ws.receive_json(), 2))["code"] == "commands_disabled"
    await ws.close()


async def test_enrolment_is_refused_on_the_tunnel_door(mantel):
    uid = await mantel.user("avery", "owner")
    issued = mantel.app["sessions"].create(uid, "tunnel", "passkey")
    mantel.client.session.cookie_jar.update_cookies({"mantel_session": issued.access, "mantel_csrf": issued.csrf})
    r = await mantel.post("/api/devices/enroll", {"name": "x"}, tunnel=True)
    assert r.status == 403 and (await r.json())["error"] == "lan_only"
    assert "mantel_device" not in r.cookies
    assert mantel.store.db.execute("SELECT COUNT(*) FROM devices").fetchone()[0] == 0


async def test_device_credential_is_refused_on_the_tunnel_door(mantel):
    await mantel.user("avery", "owner")
    await mantel.sign_in("avery")
    await enroll(mantel)
    assert (await mantel.get("/api/session")).status == 200
    assert (await mantel.get("/api/session", tunnel=True)).status == 401
    assert (await mantel.get("/api/entities", tunnel=True)).status == 401


async def test_who_may_enrol_and_which_roles(mantel):
    await mantel.user("kid", "child")
    await mantel.sign_in("kid")
    assert (await enroll(mantel))[0].status == 403
    mantel.forget_cookies()
    await mantel.user("ada", "admin")
    await mantel.sign_in("ada")
    assert (await enroll(mantel, role="owner"))[0].status == 400            # devices never get Owner/Admin
    r, body = await enroll(mantel, role="guest")
    assert r.status == 201 and body["device"]["role"] == "guest"
    assert (await enroll(mantel))[0].status in (403, 409)                   # already a device now
    mantel.forget_cookies()
    await mantel.user("loft", "wall_tablet")                                # a Wall Tablet account, for itself
    await mantel.sign_in("loft")
    r, body = await enroll(mantel, role="adult", name="Loft")
    assert r.status == 201 and body["device"]["role"] == "wall_tablet"


async def test_a_room_typed_by_name_is_stored_as_its_id(mantel):
    """HK's tablets and HA's areas name rooms by id (loft, master_bedroom); a tablet enrolled with the room typed as
    "Master Bedroom" found neither its HK tablet nor its screen (the house, 2026-10-19)."""
    from mantel_server.devices import room_id
    assert room_id("Master Bedroom") == "master_bedroom" and room_id(" Loft ") == "loft"
    assert room_id("living_room") == "living_room" and room_id("") is None and room_id(None) is None
    await mantel.user("loft", "wall_tablet")
    await mantel.sign_in("loft")
    r, body = await enroll(mantel, name="Loft", room="Master Bedroom")
    assert r.status == 201 and body["device"]["room"] == "master_bedroom"


async def test_rotation_keeps_the_old_secret_until_the_new_one_returns(mantel):
    await mantel.user("avery", "owner")
    await mantel.sign_in("avery")
    r, _ = await enroll(mantel)
    first = r.cookies["mantel_device"].value
    mantel.now[0] += ROTATE_EVERY + 1
    r = await mantel.get("/api/session")
    second = r.cookies["mantel_device"].value
    assert second != first
    # the response with the new secret was lost: the old one still works and a fresh one is issued later
    mantel.set_cookies(mantel_device=first)
    r = await mantel.get("/api/session")
    assert r.status == 200 and "mantel_device" not in r.cookies             # re-issue waits a minute
    mantel.now[0] += 61
    r = await mantel.get("/api/session")
    third = r.cookies["mantel_device"].value
    assert third not in (first, second)
    # the browser sends the new one: promoted; the old one is retired
    assert (await mantel.get("/api/session")).status == 200
    row = mantel.store.db.execute("SELECT secret_hash, retired_hash, next_hash FROM devices").fetchone()
    assert row["secret_hash"] == token_hash(third) and row["retired_hash"] == token_hash(first)
    assert row["next_hash"] is None
    # requests already in flight with the old secret are tolerated briefly …
    mantel.set_cookies(mantel_device=first)
    assert (await mantel.get("/api/session")).status == 200
    # … but after the grace a copy of the retired secret means theft: the device is revoked
    mantel.now[0] += RETIRED_GRACE + 1
    assert (await mantel.get("/api/session")).status == 401
    mantel.set_cookies(mantel_device=third)
    assert (await mantel.get("/api/session")).status == 401
    assert mantel.store.db.execute("SELECT revoked_reason FROM devices").fetchone()[0] == "credential_reuse"


async def test_revoke_in_one_call(mantel):
    await mantel.user("avery", "owner")
    await mantel.sign_in("avery")
    r, body = await enroll(mantel)
    device_cookie = r.cookies["mantel_device"].value
    device_id = body["device"]["id"]
    mantel.forget_cookies()
    await mantel.sign_in("avery")
    listed = (await (await mantel.get("/api/devices")).json())["devices"]
    assert [d["id"] for d in listed] == [device_id] and "secret_hash" not in listed[0]
    r = await mantel.client.delete(f"/api/devices/{device_id}", headers=mantel.headers())
    assert r.status == 200
    mantel.forget_cookies()
    mantel.client.session.cookie_jar.update_cookies({"mantel_device": device_cookie})
    assert (await mantel.get("/api/session")).status == 401


async def test_device_requests_need_its_csrf_token_and_cannot_manage(mantel):
    await mantel.user("avery", "owner")
    await mantel.sign_in("avery")
    r, body = await enroll(mantel)
    device_id = body["device"]["id"]
    assert (await mantel.get("/api/devices")).status == 403                 # a tablet is not a manager
    r = await mantel.client.delete(f"/api/devices/{device_id}")             # no CSRF header
    assert r.status == 403
    r = await mantel.client.delete(f"/api/devices/{device_id}", headers={"X-CSRF-Token": body["csrf"]})
    assert r.status == 200                                                  # a tablet may forget itself
    assert (await mantel.get("/api/session")).status == 401


async def test_person_signed_in_at_a_tablet_carries_both(mantel):
    from mantel_server.sessions import identity
    await mantel.user("avery", "owner")
    await mantel.sign_in("avery")
    await enroll(mantel)
    await mantel.user("riley", "child")
    await mantel.sign_in("riley")
    seen = {}

    async def probe(request):
        from aiohttp import web
        seen["ident"] = identity(request)
        return web.json_response({})

    mantel.app.router._frozen = False
    mantel.app.router.add_get("/api/probe", probe)
    mantel.app.router._frozen = True
    await mantel.get("/api/probe")
    ident = seen["ident"]
    assert ident.user.role == "child" and ident.device.role == "wall_tablet" and ident.device.room == "kitchen"


# -- the device's room: one of HK's wall tablets or an HA area, changed in place (the house, 2026-10-19) ---------------
def house_tablets(mantel):
    """Three of HK's wall tablets, and HA's areas (one with no tablet)."""
    from hk_core.settings import model as SM
    mantel.app["features"].tablets = {
        tid: SM.tablet({"name": name, "screen": "dashboard-" + tid, "room": room, "user": ""}, tid)
        for tid, name, room in (("kitchen", "Kitchen", "kitchen"), ("living", "Living Room", "living_room"),
                                ("master", "Master Bedroom", "master_bedroom"))}
    mantel.app["hub"].registry.areas = {"kitchen": "Kitchen", "living_room": "Living Room",
                                        "master_bedroom": "Master Bedroom", "garage": "Garage"}


async def enrolled_tablet(mantel, **body):
    """A device enrolled by the Owner, and the Owner signed in again (elsewhere) to manage it."""
    await mantel.user("avery", "owner")
    await mantel.sign_in("avery")
    r, got = await enroll(mantel, **body)
    assert r.status == 201, got
    cookie = r.cookies["mantel_device"].value
    mantel.forget_cookies()
    await mantel.sign_in("avery")
    return got["device"], cookie


async def patch(mantel, device_id, body):
    r = await mantel.client.patch(f"/api/devices/{device_id}", json=body, headers=mantel.headers())
    return r, await r.json()


async def test_enrolment_takes_an_hk_tablets_room_and_refuses_a_room_the_house_has_not(mantel):
    house_tablets(mantel)
    await mantel.user("avery", "owner")
    await mantel.sign_in("avery")
    r, body = await enroll(mantel, room=None, tablet="living")
    assert r.status == 201 and body["device"]["room"] == "living_room"
    mantel.forget_cookies()
    await mantel.sign_in("avery")
    for bad in ({"room": "Livingroom"}, {"room": "Masterbedroom"}, {"tablet": "nope"}, {"room": 3}):
        r, got = await enroll(mantel, **bad)
        assert r.status == 400 and got["error"] in ("unknown_room", "unknown_tablet", "invalid"), bad
    r, body = await enroll(mantel, room="Garage")                            # an HA area with no HK tablet
    assert r.status == 201 and body["device"]["room"] == "garage"


async def test_the_devices_list_names_each_devices_hk_tablet(mantel):
    house_tablets(mantel)
    await enrolled_tablet(mantel, room="garage")
    got = await (await mantel.get("/api/devices")).json()
    [d] = got["devices"]
    assert d["room"] == "garage" and d["hk_tablets"] == []                  # its touches would reach nothing
    assert got["tablets"]["master"] == {"name": "Master Bedroom", "room": "master_bedroom", "screen": "dashboard-master"}


async def test_an_owner_moves_a_device_to_a_tablet_in_place_audited_and_its_cookie_kept(mantel):
    house_tablets(mantel)
    device, cookie = await enrolled_tablet(mantel, room="garage")
    r, got = await patch(mantel, device["id"], {"tablet": "master"})
    assert r.status == 200 and got["device"]["room"] == "master_bedroom" and got["device"]["hk_tablets"] == ["master"]
    [row] = [x for x in mantel.app["audit"].rows(kind="config") if x["action"] == "device.room"]
    assert row["actor"] and row["role"] == "owner"
    assert json.loads(row["target"]) == {"device": device["id"], "name": "Kitchen tablet", "from": "garage",
                                         "to": "master_bedroom", "tablet": "master"}
    r, got = await patch(mantel, device["id"], {"room": "Living Room"})     # an area, by name or id
    assert r.status == 200 and got["device"]["room"] == "living_room"
    # the tablet keeps its credential: no new enrolment, and its own requests carry the new room
    mantel.forget_cookies()
    mantel.set_cookies(mantel_device=cookie)
    me = await (await mantel.get("/api/session")).json()
    assert me["device"]["id"] == device["id"] and me["device"]["room"] == "living_room"


async def test_moving_a_device_refuses_unknown_rooms_revoked_devices_and_non_managers(mantel):
    house_tablets(mantel)
    device, _ = await enrolled_tablet(mantel, room="kitchen")
    for bad, code in (({"room": "Livingroom"}, "unknown_room"), ({"tablet": "loft"}, "unknown_tablet"),
                      ({"room": ["kitchen"]}, "invalid"), ({}, "invalid"), ({"name": "x"}, "invalid")):
        r, got = await patch(mantel, device["id"], bad)
        assert r.status == 400 and got["error"] == code, bad
    assert mantel.store.db.execute("SELECT room FROM devices").fetchone()[0] == "kitchen"
    assert not [x for x in mantel.app["audit"].rows(kind="config") if x["action"] == "device.room"]
    assert (await patch(mantel, "nope", {"room": "kitchen"}))[0].status == 404
    # an Admin may; an Adult may not
    await mantel.user("ada", "admin")
    mantel.forget_cookies()
    await mantel.sign_in("ada")
    assert (await patch(mantel, device["id"], {"room": "garage"}))[0].status == 200
    await mantel.user("al", "adult")
    mantel.forget_cookies()
    await mantel.sign_in("al")
    assert (await patch(mantel, device["id"], {"room": "kitchen"}))[0].status == 403
    # a revoked device stays revoked: nothing to move
    mantel.forget_cookies()
    await mantel.sign_in("avery")
    await mantel.client.delete(f"/api/devices/{device['id']}", headers=mantel.headers())
    assert (await patch(mantel, device["id"], {"room": "kitchen"}))[0].status == 404


async def test_a_moved_tablet_speaks_for_its_new_hk_tablet_after_the_policy_tick(mantel):
    from mantel_server import features as F
    from mantel_server.authz import Principal
    from mantel_server.sessions import Device, Identity
    device, _ = await enrolled_tablet(mantel, room="Livingroom")       # as typed before the picker (no rooms known)
    house_tablets(mantel)
    host, authz = mantel.app["features"], mantel.app["authz"]
    ident = Identity(None, Device(device["id"], device["name"], "wall_tablet", device["room"]), "lan")
    principal = Principal(ident, authz.subject_of(ident))
    assert F.may_speak_for(host, principal, "living") is False                # "livingroom" is no HK tablet's room
    assert (await patch(mantel, device["id"], {"tablet": "living"}))[0].status == 200
    assert authz.refresh(principal) and F.may_speak_for(host, principal, "living") is True


async def test_the_enrol_dialog_reads_hks_tablets_and_has_areas(mantel):
    """GET /api/devices/rooms: the tablets with the devices already in their rooms, and HA's areas; for the people who
    may enrol (a Wall Tablet account too, whose settings page reads no settings feed), nobody else."""
    house_tablets(mantel)
    await enrolled_tablet(mantel, tablet="kitchen")
    got = await (await mantel.get("/api/devices/rooms")).json()
    got_device = (await (await mantel.get("/api/devices")).json())["devices"][0]
    assert got["tablets"]["kitchen"] == {"name": "Kitchen", "room": "kitchen", "screen": "dashboard-kitchen",
                                         "screen_title": None,
                                         "served_by": [{"id": got_device["id"], "name": "Kitchen tablet"}]}
    assert got["tablets"]["living"]["served_by"] == []
    assert [a["id"] for a in got["areas"]] == ["garage", "kitchen", "living_room", "master_bedroom"]
    await mantel.user("loft", "wall_tablet")
    mantel.forget_cookies()
    await mantel.sign_in("loft")
    assert (await mantel.get("/api/devices/rooms")).status == 200
    await mantel.user("al", "adult")
    mantel.forget_cookies()
    await mantel.sign_in("al")
    assert (await mantel.get("/api/devices/rooms")).status == 403


# -- the audit: enrolling and revoking are recorded first, as moving one is ------------------------------
def device_rows(mantel):
    return [(x["action"], x["actor"], x["role"], x["device"], json.loads(x["target"]))
            for x in mantel.app["audit"].rows(kind="config") if x["action"].startswith("device.")]


async def test_enrolling_and_revoking_a_tablet_are_audited(mantel):
    house_tablets(mantel)
    device, cookie = await enrolled_tablet(mantel, room=None, tablet="living")
    owner = mantel.store.db.execute("SELECT id FROM users WHERE username = 'avery'").fetchone()[0]
    assert device_rows(mantel) == [("device.enroll", owner, "owner", None,
                                    {"device": device["id"], "name": "Kitchen tablet", "role": "wall_tablet",
                                     "room": "living_room", "tablet": "living"})]
    r = await mantel.client.delete(f"/api/devices/{device['id']}", headers=mantel.headers())
    assert r.status == 200
    assert device_rows(mantel)[-1] == ("device.revoke", owner, "owner", None,
                                       {"device": device["id"], "name": "Kitchen tablet", "role": "wall_tablet",
                                        "room": "living_room", "by_self": False})
    # revoking it again is a 404, and no second row
    assert (await mantel.client.delete(f"/api/devices/{device['id']}", headers=mantel.headers())).status == 404
    assert len(device_rows(mantel)) == 2


async def test_a_tablet_revoking_itself_is_audited_as_the_tablet(mantel):
    device, cookie = await enrolled_tablet(mantel, room="kitchen")
    mantel.forget_cookies()
    mantel.set_cookies(mantel_device=cookie)
    await mantel.get("/api/session")                                          # the tablet's CSRF cookie
    r = await mantel.client.delete(f"/api/devices/{device['id']}", headers=mantel.headers())
    assert r.status == 200
    action, actor, role, by_device, detail = device_rows(mantel)[-1]
    assert (action, actor, role, by_device, detail["by_self"]) == ("device.revoke", None, None, device["id"], True)


async def test_no_audit_row_no_tablet(mantel, monkeypatch):
    await mantel.user("avery", "owner")
    await mantel.sign_in("avery")

    def broken(event):
        raise OSError("disk full")
    monkeypatch.setattr(mantel.app["audit"], "config_event", broken)
    r, got = await enroll(mantel)
    assert r.status == 503 and got["error"] == "audit_unavailable" and "mantel_device" not in r.cookies
    assert mantel.store.db.execute("SELECT COUNT(*) FROM devices").fetchone()[0] == 0
    assert (await mantel.get("/api/session")).status == 200                  # still the Owner here
