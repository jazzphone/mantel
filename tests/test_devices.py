"""P3.1 devices: "Make this a wall tablet" — enrolment, rotation, reuse, revocation, LAN only."""
import asyncio

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
                                                          "role": "wall_tablet"}
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
