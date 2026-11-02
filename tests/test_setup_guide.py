"""Set Up Mantel (setup_guide.py) and the first run around it.

* GET /api/setup: every step worked out from the house as it is (Home Assistant connected, screens, people, the
  Owner's factors, the alarm, commands), for Owners and Admins; only an Owner marks a step for later, confirms the
  two judgement steps, or closes the guide. The overview carries whether it opens first.
* Setup Check's House Commands line says how commands are turned on where this Mantel runs.
* The settings import on a Home Assistant without HK Frontend says there is nothing to import (409), not a raw 502.
* Enrolling into a room no HK tablet has: an Owner or Admin may have that HK tablet made with the device.
"""
from __future__ import annotations

import pytest

from conftest import PASSWORD  # noqa: F401  (the fixture's password, for sign_in)
from mantel_server import setup_check, setup_guide


class FakeProxy:
    """Home Assistant's reads, as far as these tests need them."""

    def __init__(self, components=(), settings_error=None):
        self.components = list(components)
        self.settings_error = settings_error

    async def request(self, msg, **kw):
        assert msg["type"] == "get_config"
        return {"location_name": "Fictional House", "version": "2026.9.1", "time_zone": "Europe/Berlin",
                "country": "DE", "language": "de", "unit_system": {"temperature": "°C", "length": "km"},
                "components": self.components}

    async def close(self):
        pass

    async def read_hk_settings(self):
        raise self.settings_error or RuntimeError("unknown_command")


async def owner(m, name="avery"):
    await m.user(name, "owner")
    await m.sign_in(name)


async def put(m, path, body):
    return await m.client.put(path, json=body, headers=m.headers())


def by_id(got):
    return {s["id"]: s for s in got["steps"]}


async def test_a_fresh_mantel_lists_what_it_still_needs(mantel):
    await owner(mantel)
    r = await mantel.get("/api/setup")
    assert r.status == 200
    got = await r.json()
    steps = by_id(got)
    assert [s["id"] for s in got["steps"]] == ["ha", "home", "screens", "people", "protect", "tablets", "music",
                                               "link", "files", "commands"]    # no alarm panel: no Alarm PIN step
    for sid in ("ha", "home", "screens", "people", "protect", "commands"):
        assert steps[sid]["state"] == "todo" and not steps[sid]["optional"], sid
    assert all(steps[s]["optional"] for s in ("tablets", "music", "link", "files"))
    assert got["complete"] is False and got["dismissed"] is False and got["can_edit"] is True
    assert got["install"] == "dev" and "Allow Control of the House" in steps["commands"]["how"]
    assert steps["commands"]["route"] == "#/mantel/general"
    assert steps["ha"]["route"] == "#/mantel/connections/ha" and steps["home"]["route"] == "#/setup"
    ov = await (await mantel.get("/api/admin/overview")).json()
    assert ov["setup"] == {"dismissed": False, "open": True}


async def test_only_managers_read_and_only_an_owner_changes(mantel):
    await mantel.user("avery", "owner")
    await mantel.user("sam", "admin")
    await mantel.user("riley", "adult")
    await mantel.sign_in("sam")
    got = await (await mantel.get("/api/setup")).json()
    assert got["can_edit"] is False
    assert (await put(mantel, "/api/setup/steps/people", {"state": "skipped"})).status == 403
    assert (await put(mantel, "/api/setup", {"dismissed": True})).status == 403
    mantel.forget_cookies()
    await mantel.sign_in("riley")
    assert (await mantel.get("/api/setup")).status == 403
    assert (await (await mantel.get("/api/admin/overview")).json())["setup"] is None


async def test_later_and_looks_right_are_kept_and_checked(mantel):
    await owner(mantel)
    assert (await put(mantel, "/api/setup/steps/people", {"state": "skipped"})).status == 200
    assert (await put(mantel, "/api/setup/steps/home", {"state": "confirmed"})).status == 200
    assert (await put(mantel, "/api/setup/steps/ha", {"state": "skipped"})).status == 400        # needed: never later
    assert (await put(mantel, "/api/setup/steps/people", {"state": "confirmed"})).status == 400  # the house decides
    assert (await put(mantel, "/api/setup/steps/nope", {"state": None})).status == 404
    assert (await put(mantel, "/api/setup/steps/home", {"state": "maybe"})).status == 400
    steps = by_id(await (await mantel.get("/api/setup")).json())
    assert steps["people"]["state"] == "skipped" and steps["home"]["state"] == "done"
    assert (await put(mantel, "/api/setup/steps/people", {"state": None})).status == 200
    assert by_id(await (await mantel.get("/api/setup")).json())["people"]["state"] == "todo"
    # without the CSRF token nothing is kept
    r = await mantel.client.put("/api/setup/steps/people", json={"state": "skipped"})
    assert r.status == 403


async def test_closing_the_guide_stops_it_opening_first(mantel):
    await owner(mantel)
    assert (await put(mantel, "/api/setup", {"dismissed": True})).status == 200
    ov = await (await mantel.get("/api/admin/overview")).json()
    assert ov["setup"] == {"dismissed": True, "open": False}
    assert (await (await mantel.get("/api/setup")).json())["dismissed"] is True
    assert (await put(mantel, "/api/setup", {"dismissed": "yes"})).status == 400


async def test_what_home_assistant_says_is_shown(mantel):
    mantel.app["hub"].readproxy = FakeProxy(components=["hk_frontend"])
    await owner(mantel)
    got = await (await mantel.get("/api/setup")).json()
    assert got["house"]["country"] == "DE" and got["house"]["hk_frontend"] is True
    steps = by_id(got)
    assert "Fictional House" in steps["home"]["detail"] and "°C" in steps["home"]["detail"]
    assert steps["screens"]["hk_frontend"] is True


async def test_hks_own_setup_assistant_finishing_makes_your_home_done(mantel):
    from mantel_server.settings_store import Actor
    await owner(mantel)
    store = mantel.app["settings"].store
    store.write([("house", "setup", {"setup_done": True})], actor=Actor(label="test"), message="test")
    assert by_id(await (await mantel.get("/api/setup")).json())["home"]["state"] == "done"


async def test_the_owners_factors_decide_protect(mantel):
    await owner(mantel)
    steps = by_id(await (await mantel.get("/api/setup")).json())
    assert steps["protect"]["state"] == "todo" and "passkey" in steps["protect"]["detail"]
    db = mantel.store.db
    uid = db.execute("SELECT id FROM users WHERE username = 'avery'").fetchone()["id"]
    with db:
        db.execute("INSERT INTO totp_credentials (user_id, seed_enc, confirmed, created) VALUES (?, ?, ?, ?)",
                   (uid, b"x", 1.0, 1.0))
    assert by_id(await (await mantel.get("/api/setup")).json())["protect"]["state"] == "done"


async def test_an_alarm_panel_adds_the_alarm_pin_step(mantel):
    await owner(mantel)
    mantel.app["hub"].store.states["alarm_control_panel.house"] = {"state": "disarmed", "attributes": {}}
    steps = by_id(await (await mantel.get("/api/setup")).json())
    assert steps["alarm"]["state"] == "todo" and steps["alarm"]["route"] == "#/features/alarm"


async def test_a_pin_keypad_covers_its_alarm_and_other_panels_are_only_named(mantel):
    """The house Alarm PIN on a keypad that forwards to the alarm (Mantel's own Alarm PIN keypad) is the step done:
    the keypad and its alarm count once; a second alarm or another integration's keypad is named, not a To Do."""
    await owner(mantel)
    st = mantel.app["hub"].store.states
    for eid, name in (("alarm_control_panel.house", "House Alarm"), ("alarm_control_panel.house_pin", "House Alarm PIN"),
                      ("alarm_control_panel.lyric", "Lyric Alarm")):
        st[eid] = {"state": "disarmed", "attributes": {"friendly_name": name}}
    await mantel.app["alarm_pin"].set("alarm_control_panel.house_pin", forward_to="alarm_control_panel.house",
                                      pin="482915", pin_again="482915")
    step = by_id(await (await mantel.get("/api/setup")).json())["alarm"]
    assert step["state"] == "done", step
    assert "Lyric Alarm has none" in step["detail"] and "House Alarm" not in step["detail"].split("asks")[1]


def test_setup_check_says_how_commands_turn_on_where_mantel_runs():
    class App(dict):
        pass

    from mantel_server.config import Config
    # Mantel Settings on every installation; only the kill switch is the installation's own
    for cfg, words in ((Config(), "Mantel Settings → General"),
                       (Config(public_url="https://mantel.example.com/"), "Allow Control of the House"),
                       (Config(ha_managed_by_app=True), "Allow Control of the House"),
                       (Config(ha_managed_by_app=True, read_only=True), "turn off Read-only"),
                       (Config(public_url="https://mantel.example.com/", read_only=True), "MANTEL_READ_ONLY"),
                       (Config(read_only=True), "--read-only")):
        app = App(cfg=cfg)
        line = next(x for x in setup_check.lines(app, 0) if x["title"] == "House Commands")
        assert words in line["detail"], (cfg, line)
        screens = next(x for x in setup_check.lines(app, 0) if x["title"] == "Screens")
        assert "builds a Home screen" in screens["detail"]
    assert setup_guide.install(Config(ha_managed_by_app=True)) == "app"


async def test_import_without_hk_frontend_says_there_is_nothing_to_import(mantel):
    mantel.app["hub"].readproxy = FakeProxy()
    await owner(mantel)
    r = await mantel.post("/api/settings/import")
    assert r.status == 409
    body = await r.json()
    assert body["error"] == "no_hk_frontend" and "nothing to import" in body["message"]


async def test_enrolling_into_a_new_room_makes_its_hk_tablet(mantel):
    mantel.app["hub"].registry.areas = {"garage": "Garage", "kitchen": "Kitchen"}
    await owner(mantel)
    r = await mantel.post("/api/devices/enroll", {"name": "Garage Tablet", "room": "garage", "new_tablet": True})
    assert r.status == 201, await r.text()
    tablets = mantel.app["settings"].store.docs("tablet")
    assert list(tablets) == ["garage_tablet"] and tablets["garage_tablet"].body["room"] == "garage"
    rows = mantel.store.db.execute("SELECT target FROM action_audit WHERE action = 'device.enroll'").fetchall()
    assert len(rows) == 1 and "new_tablet" in rows[0]["target"]


async def test_an_adult_or_an_unknown_room_never_makes_a_tablet(mantel):
    mantel.app["hub"].registry.areas = {"garage": "Garage"}
    await mantel.user("riley", "wall_tablet")
    await mantel.sign_in("riley")
    r = await mantel.post("/api/devices/enroll", {"name": "Garage", "room": "garage", "new_tablet": True})
    assert r.status == 201
    assert mantel.app["settings"].store.docs("tablet") == {}        # a Wall Tablet account doesn't add HK tablets


async def test_the_house_step_shows_only_while_hk_frontend_is_in_home_assistant(mantel, monkeypatch):
    """Moving from HK Frontend's last step (The House) was found only under Advanced: Set Up Mantel lists it while
    Home Assistant still has HK Frontend, done once Mantel runs the house; a house without HK Frontend never sees it."""
    import types
    await owner(mantel)
    reg = mantel.app["linked"].registry
    hk = types.SimpleNamespace(domain="hk_frontend", protocol=1, report={}, features=("bridge",))
    monkeypatch.setattr(reg, "clients_of", lambda d: [hk] if d == "hk_frontend" else [])
    step = by_id(await (await mantel.get("/api/setup")).json())["house"]
    assert step["state"] == "todo" and not step["optional"]
    assert "HK Frontend still runs" in step["detail"]
    owners = mantel.app["linked_owners"]
    monkeypatch.setattr(owners, "house", lambda: True)
    step = by_id(await (await mantel.get("/api/setup")).json())["house"]
    assert step["state"] == "done" and step["route"] == "#/mantel/connections/ha/moving/advanced"
    monkeypatch.setattr(reg, "clients_of", lambda d: [])
    assert "house" not in by_id(await (await mantel.get("/api/setup")).json())


async def test_a_container_at_its_address_is_shown_mantel_setup(mantel):
    """Docker and the LXC start at the machine's address with Mantel's own certificate (mantel-setup's "try"): the
    Address and HTTPS step says what that means and how to give Mantel a name; with a name it is done. Not shown
    where there is nothing to set (the dev server here, the Home Assistant App)."""
    await owner(mantel)
    cfg = mantel.app["cfg"]
    assert "address" not in by_id(await (await mantel.get("/api/setup")).json())
    object.__setattr__(cfg, "public_url", "https://192.0.2.10/")
    step = by_id(await (await mantel.get("/api/setup")).json())["address"]
    assert step["state"] == "todo" and step["optional"] and step["can_skip"]
    assert step["how"] == "mantel-setup" and "passkeys are off" in step["detail"] and "mantel-setup" in step["how_note"]
    object.__setattr__(cfg, "public_url", "https://mantel.example.com/")
    step = by_id(await (await mantel.get("/api/setup")).json())["address"]
    assert step["state"] == "done" and step["how"] is None and "https://mantel.example.com" in step["detail"]
