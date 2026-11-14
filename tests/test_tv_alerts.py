"""Phase 31, Mantel's side: the Apple TVs' card drawn (tv_card.py, image_work.render_card), the queue and the pulse
(features/tv_alerts.py), the two entities Mantel Link mirrors, the link's `camera_image` and `report.homekit`."""
import asyncio
import base64
import io
import types
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from hk_core.notifications import rules
from hk_core.notifications.const import CONF_TV, DEFAULTS, TV_DEFAULT
from mantel_server.cameras import tv_card
from mantel_server.features import tv_alerts as TA
from mantel_server.linked import Linked, LinkedError, LinkedRegistry, check_entity

TZ = ZoneInfo("America/New_York")
resvg = pytest.importorskip("resvg_py")


class House:
    def entity(self, _eid):
        return None

    def device(self, _did):
        return None

    def area_name(self, _aid):
        return None

    def local_time(self, when=None):
        return (when or datetime(2026, 11, 14, 18, 42, tzinfo=TZ)).astimezone(TZ)


class Host:
    def __init__(self, **tv):
        self.house = House()
        self.notifier = types.SimpleNamespace(opts={**DEFAULTS, CONF_TV: {**TV_DEFAULT, **tv}})
        self.docs = {}
        self.snaps = None

    def doc(self, key):
        return dict(self.docs.get(key) or {})

    def write_doc(self, key, body, identity=None, message=""):
        self.docs[key] = dict(body)

    def now(self):
        return datetime(2026, 11, 14, 18, 42, tzinfo=TZ)


def make(**tv):
    reg = LinkedRegistry()
    lk = Linked(reg, handler=None, accounts=None)
    app = {"linked": lk, "cfg": None}
    t = TA.TvAlerts(app, Host(**tv))
    t.hold = t.gap = t.settle = 0
    return t, reg


def event(**kw):
    return {"type": "notification", "kind": "timer", "entity": "timer.pasta", "title": "Pasta Timer", "message": "Done",
            "icon": "hk:timer-sand", "tint": rules.ORANGE, "important": False, "camera": None, "snap": None,
            "tv": True, "tv_look": None, **kw}


def jpeg_size(data):
    from PIL import Image
    with Image.open(io.BytesIO(data)) as im:
        return im.format, im.size


@pytest.mark.parametrize("look", ["color", "black", "glass"])
def test_each_look_draws_a_1080p_picture(look):
    fonts, glyphs = tv_card.Fonts(None, None), tv_card.Glyphs(None)
    fonts.refresh()
    assert fonts.family == "Inter" and not fonts.apple and not glyphs.apple
    card = {"look": look, "title": "Pasta Timer", "line": "Timer ended", "caption": "Kitchen · 6:42 PM",
            "glyph": "hk:timer-sand", "kind": "timer", "color": "#FF9F0A", "critical": False, "snapshot": False}
    svg = tv_card.svg(card, fonts, glyphs)
    assert 'font-family="Inter"' in svg and "Pasta Timer" in svg
    from mantel_server.cameras.image_work import render_card
    assert jpeg_size(render_card(svg, fonts.files, fonts.family)) == ("JPEG", (1920, 1080))


def test_a_long_title_shrinks_to_its_room():
    fonts = tv_card.Fonts(None, None)
    fonts.refresh()
    short = fonts.width("Washer", 168, 700)
    assert 0 < short < 1110
    assert tv_card._fit(fonts, "Washer", 168, 700, 1110) == 168
    assert tv_card._fit(fonts, "The Guest Bathroom Exhaust Fan", 168, 700, 1110) < 168


def test_words_are_escaped_and_glyphs_stand_in():
    fonts, glyphs = tv_card.Fonts(None, None), tv_card.Glyphs(None)
    fonts.refresh()
    svg = tv_card.svg({"look": "black", "title": "<b>Tom & Jerry</b>", "line": "", "caption": "", "glyph": "hk:nothing-like-it",
                       "kind": "state", "color": "#0A84FF", "critical": False, "snapshot": False}, fonts, glyphs)
    assert "&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;" in svg and "<b>" not in svg
    assert tv_card.GLYPHS["bell"][0][0] in svg                       # an unknown glyph: the bell
    assert tv_card.GLYPHS["washer"][0][0] in glyphs.draw("hk:washing-machine", 0, 0, 24, "#fff")


def test_the_entities_only_while_wanted_and_they_pass_the_registry_check():
    t, _reg = make()
    assert t.descriptors("e1") == {}
    t, _reg = make(on=True)
    descs = t.descriptors("e1")
    cam, sensor = TA.uids("e1")
    assert set(descs) == {cam, sensor}
    c, s = check_entity(descs[cam][0]), check_entity(descs[sensor][0])
    assert (c["entity_id"], c["features"]["still"], c["features"]["homekit"]) == (
        TA.CAMERA_ID, True, {"want": False, "sensor": sensor})
    assert (s["entity_id"], s["state"], s["features"]) == (TA.SENSOR_ID, "off", {"device_class": "motion"})
    t2, _ = make()
    t2.host.docs[TA.DOC] = {"homekit": True}                         # Add to HomeKit alone publishes them too
    assert t2.descriptors("e1")[cam][0]["features"]["homekit"]["want"] is True


async def test_a_notification_draws_then_pulses_the_sensor():
    t, reg = make(on=True)
    for desc, _kind in t.descriptors("e1").values():
        await reg.publish(desc)
    seen = []
    orig = reg.update

    async def spy(uid, **kw):
        seen.append((uid, kw))
        return await orig(uid, **kw)
    reg.update = spy
    t.on_event(event(tv=False))                                      # its switch off: nothing
    t.on_event({"type": "popup"})
    assert not t.queue and t.task is None
    t.on_event(event())
    await t.task
    cam, sensor = TA.uids("e1")
    assert [(u, k) for u, k in seen] == [(cam, {"attributes": {"still": 1}}), (sensor, {"state": "on"}),
                                         (sensor, {"state": "off"})]
    assert jpeg_size(t.jpeg) == ("JPEG", (1920, 1080)) and t.version == 1
    assert t.sent[-1]["title"] == "Pasta Timer" and t.sent[-1]["ok"]


async def test_a_burst_keeps_the_newest():
    t, _ = make(on=True)
    for n in range(TA.QUEUE_MAX + 3):
        t.queue.append({"title": str(n)})
    t.add({"title": "last"})
    assert len(t.queue) == TA.QUEUE_MAX and t.queue[-1]["title"] == "last" and t.dropped == 4
    t.task.cancel()


async def test_mantel_link_asks_for_the_picture():
    t, _ = make(on=True)
    t.descriptors("e1")
    with pytest.raises(LinkedError):
        await t.camera_image(None, {"unique_id": "someone_else"})
    got = await t.camera_image(None, {"unique_id": TA.uids("e1")[0]})
    assert got["version"] == 0 and jpeg_size(base64.b64decode(got["jpeg"]))[1] == (1920, 1080)


def test_homekits_report_is_checked():
    reg = LinkedRegistry()
    lk = Linked(reg, handler=None, accounts=None)
    client = types.SimpleNamespace(report={})
    lk.take_report(client, {"homekit": {"state": "unpaired", "code": "123-45-678", "uri": "X-HM://0023ISYWY1234"}})
    assert client.report["homekit"]["state"] == "unpaired"
    for bad in ({"state": "maybe"}, {"state": "unpaired", "code": "12345678"}, {"state": "paired", "pin": "x"},
                {"state": "error", "error": "x" * 300}):
        with pytest.raises(LinkedError):
            lk.take_report(client, {"homekit": bad})


def test_status_says_what_the_page_needs():
    t, _ = make(on=True, look="black")
    s = t.status()
    assert (s["on"], s["look"], s["renderer"], s["homekit"], s["linked"]) == (True, "black", None, {"state": "none"}, False)


def test_the_test_route_and_homekit_are_declared():
    from mantel_server.identity.guards import spec_of
    assert spec_of(TA.post_homekit).audit == ("tv_alerts.homekit",)
    assert spec_of(TA.post_test).no_audit and spec_of(TA.get_status).reads == "admin"
    assert asyncio.iscoroutinefunction(TA.get_preview)
