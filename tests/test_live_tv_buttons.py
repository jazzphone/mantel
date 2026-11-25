"""Live TV's buttons for Apple's Home app (cameras/live_tv_buttons.py), on the Live TV rig (test_live_tv.py) with a fake
AirPlay screen (airplay_fakes.py) and a stand-in Mantel Link: the Owner saves which channel on which screen, Mantel
publishes the buttons (only to a Mantel Link that has them), a press plays the channel on the screen as the linked
Service actor, audited, and that actor may watch exactly the buttons' channels, only while a button is set up."""
from __future__ import annotations

import json
import re
import types

from airplay_fakes import FakeScreen
from test_airplay_out_routes import _paired
from test_feature_pages import save
from test_live_tv import ITEM, _mantel_link, rig  # noqa: F401 -- the fixture
from mantel_server.linked import CallCtx, LinkedClient, LinkedError, LinkedRegistry

LINK_ENTRY = "e2e0entry0id"


async def _set_up(r, monkeypatch, screen):
    sender = r.app["airplay_sender"]
    monkeypatch.setattr(sender, "_base", lambda: "https://house.example")
    ws = await r.socket("owner1", "owner")
    sid = await _paired(r, ws, screen)
    _mantel_link(r, monkeypatch, ("bridge", "live_tv", "buttons"))
    resp = await r.env.m.client.put("/api/linked/owners", json={"unit": "house", "owner": "mantel"},
                                    headers=r.env.m.headers())
    assert resp.status == 200
    return ws, sid


def _press(r, uid):
    ctx = CallCtx(types.SimpleNamespace(id="svc_link", name="Mantel Link"), "127.0.0.1", "mantel", 2,
                  frozenset({"bridge", "live_tv", "buttons"}))
    return r.app["linked"].entity_command({"unique_id": uid, "command": "press"}, ctx)


async def test_a_button_in_the_home_app_plays_its_channel_on_its_screen(rig, monkeypatch):  # noqa: F811
    r = await rig(linked=True)
    screen = await FakeScreen().start()
    try:
        ws, sid = await _set_up(r, monkeypatch, screen)
        authz, reg = r.app["authz"], r.app["linked"].registry
        assert authz.tv_button_cameras() == ()                     # no button: the linked actor has nothing
        got = await save(ws, 1, {"type": "hk_tv/settings/set", "changes": {
            "buttons": [{"screen": sid, "channel": "4.1"}], "homekit": True}})
        page = got["result"]["home_app"]
        assert page["buttons"] == [{"screen": sid, "channel": "4.1"}] and page["homekit_wanted"] is True
        assert page["link"]["buttons"] and page["link"]["house"] and page["screens"][0]["name"] == "Den HomeView"
        await r.app["linked_house"].refresh()
        play, stop, carrier = (f"{LINK_ENTRY}_live_tv_{sid}_4_1", f"{LINK_ENTRY}_live_tv_{sid}_stop",
                               f"{LINK_ENTRY}_live_tv_buttons")
        b = reg.get(play)
        assert (b["platform"], b["name"], b["entity_id"]) == ("button", "NBC on Den HomeView",
                                                             "button.den_homeview_live_tv_nbc")
        assert reg.get(stop)["name"] == "Stop Live TV on Den HomeView"
        assert reg.get(carrier)["features"]["homekit"] == {"bridge": "live_tv", "want": True, "include": [play, stop]}
        assert authz.tv_button_cameras() == ("camera.tv_nbc",)

        # a press: the channel plays on the screen as the linked actor, under its own key, audited
        got = await _press(r, play)
        assert got == {"playing": {"channel": "4.1", "name": "NBC"}, "screen": sid}
        item = next(d["inner"]["item"] for w, h, d in screen.requests
                    if isinstance(d, dict) and "inner" in d and d["inner"]["type"] == "insertPlayQueueItem")
        m = re.fullmatch(r"https://house\.example/go2rtc/(key/.+)", item["Content-Location"])
        r.env.m.forget_cookies()
        assert (await r.env.m.client.get("/go2rtc/" + m.group(1))).status == 200   # the screen fetches it signed out
        row = next(row for row in r.app["audit"].rows() if row["action"] == "live_tv.airplay.play")
        detail = json.loads(row["target"])
        assert row["actor"] == "mantel:linked" and detail["via"] == "home_app" and detail["screen"] == sid

        # Stop: the show ends
        assert (await _press(r, stop)) == {"playing": None, "screen": sid}
        assert any(w.startswith("TEARDOWN") for w, h, d in screen.requests)
        await ws.close()

        # no button left: the grant goes, the buttons go; the sensor stays while the bridge is wanted
        await r.env.login("owner1", "owner")
        ws = await r.env.socket(expect_caps=False)
        await save(ws, 2, {"type": "hk_tv/settings/set", "changes": {"buttons": []}})
        await r.app["linked_house"].refresh()
        assert authz.tv_button_cameras() == ()
        assert reg.get(play) is None and reg.get(stop) is None
        assert reg.get(carrier)["features"]["homekit"]["include"] == []
        from mantel_server.alarm_pin import linked_principal
        p = linked_principal(r.app)
        assert not authz.may_view(p, "camera.tv_nbc")
        assert not authz.decide(p.subject, "view", None, feature="live_tv").allowed
        await ws.close()
    finally:
        await screen.close()


async def test_a_save_names_a_paired_screen_and_a_chosen_channel(rig, monkeypatch):  # noqa: F811
    r = await rig(linked=True)
    screen = await FakeScreen().start()
    try:
        ws, sid = await _set_up(r, monkeypatch, screen)
        for bad in ([{"screen": "s" + "0" * 12, "channel": "4.1"}], [{"screen": sid, "channel": "9.1"}], "all"):
            got = await save(ws, 3, {"type": "hk_tv/settings/set", "changes": {"buttons": bad}})
            assert "buttons" in str(got), got
        got = await save(ws, 4, {"type": "hk_tv/settings/set", "changes": {"homekit": "yes"}})
        assert "homekit" in str(got)
        assert r.app["features"].settings["live_tv"]["buttons"] == []
        # an adult may not set them up
        other = await r.socket("adult1", "adult")
        got = await save(other, 5, {"type": "hk_tv/settings/set", "changes": {"buttons": [{"screen": sid, "channel": "4.1"}]}})
        assert r.app["features"].settings["live_tv"]["buttons"] == [] and "forbidden" in str(got)
        await other.close()
        await ws.close()
    finally:
        await screen.close()


async def test_a_press_with_no_screen_to_play_on_is_refused_in_home_assistants_words(rig, monkeypatch):  # noqa: F811
    r = await rig(linked=True)
    screen = await FakeScreen().start()
    try:
        ws, sid = await _set_up(r, monkeypatch, screen)
        await save(ws, 1, {"type": "hk_tv/settings/set", "changes": {"buttons": [{"screen": sid, "channel": "4.1"}]}})
        await r.app["linked_house"].refresh()
        uid = f"{LINK_ENTRY}_live_tv_{sid}_4_1"
        screen.refuse_verify = True
        try:
            await _press(r, uid)
            raise AssertionError("a press on a screen that forgot Mantel went through")
        except LinkedError as exc:
            assert exc.code == "unpaired"
        try:
            await r.app["linked"].entity_command({"unique_id": uid, "command": "turn_on"},
                                                 CallCtx(None, None, "mantel", 2))
            raise AssertionError("a button took turn_on")
        except LinkedError as exc:
            assert exc.code == "unknown_command"
        await ws.close()
    finally:
        await screen.close()


async def test_a_script_plays_what_a_button_plays_and_nothing_else(rig, monkeypatch):  # noqa: F811
    """mantel.live_tv_play / live_tv_stop: the screen and the channel by name, exactly a press; a channel no button
    plays is refused (the linked actor may watch only the buttons' channels)."""
    r = await rig(linked=True)
    screen = await FakeScreen().start()
    try:
        ws, sid = await _set_up(r, monkeypatch, screen)
        await save(ws, 1, {"type": "hk_tv/settings/set", "changes": {"buttons": [{"screen": sid, "channel": "4.1"}]}})
        await r.app["linked_house"].refresh()
        ctx = CallCtx(types.SimpleNamespace(id="svc_link"), "127.0.0.1", "mantel", 2)
        lk = r.app["linked"]
        got = await lk.call_service({"service": "live_tv_play", "data": {"channel": "nbc", "screen": "den homeview"}}, ctx)
        assert got == {"playing": {"channel": "4.1", "name": "NBC"}, "screen": sid}
        for data, code in (({"channel": "7.1", "screen": sid}, "forbidden"), ({"channel": "4.1", "screen": "Attic"}, "invalid"),
                           ({"channel": "4.1"}, "invalid")):
            try:
                await lk.call_service({"service": "live_tv_play", "data": data}, ctx)
                raise AssertionError(f"{data} went through")
            except LinkedError as exc:
                assert exc.code == code, (data, exc.code)
        assert (await lk.call_service({"service": "live_tv_stop", "data": {"screen": "Den HomeView"}}, ctx))["playing"] is None
        await ws.close()
    finally:
        await screen.close()


def test_a_button_goes_only_to_a_client_that_mirrors_buttons():
    old = LinkedClient(types.SimpleNamespace(closed=False), None, None, "mantel", 2, frozenset({"bridge"}))
    new = LinkedClient(types.SimpleNamespace(closed=False), None, None, "mantel", 2, frozenset({"bridge", "buttons"}))
    reg = LinkedRegistry()
    reg.entities = {"b": {"unique_id": "b", "platform": "button"}, "s": {"unique_id": "s", "platform": "sensor"}}
    assert [d["unique_id"] for d in reg.snapshot(old)] == ["s"]
    assert [d["unique_id"] for d in reg.snapshot(new)] == ["b", "s"]


def test_the_grant_names_the_linked_actor_as_alarm_pin_does():
    from mantel_server import alarm_pin
    from mantel_server.identity import authz
    assert authz.LINKED_TV_ACTOR == alarm_pin.LINKED_ACTOR
    assert authz.live_tv_button_grants(()) == () and authz.live_tv_button_live(()) == ()
    got = authz.live_tv_button_grants(("camera.tv_nbc",))
    assert [(g.resource_kind, g.resource, tuple(g.actions)) for g in got] == [
        ("feature", "live_tv", ("view",)), ("entity", "camera.tv_nbc", ("view",))]
    assert all(g.users == frozenset({alarm_pin.LINKED_ACTOR}) and not g.roles for g in got)
