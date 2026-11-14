"""hk_core.notifications.tv (phase 31): which notifications go to the Apple TVs, and what each card says."""
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from hk_core.house import Entity
from hk_core.notifications import banner as B, rules, settings as P, tv as T
from hk_core.notifications.const import CONF_TV, DEFAULTS, ITEM_FIELDS, TV_DEFAULT

TZ = ZoneInfo("America/New_York")


class House:
    def __init__(self, entities=(), areas=None, now=datetime(2026, 11, 14, 18, 42, tzinfo=TZ)):
        self._entities = {e.entity_id: e for e in entities}
        self._areas = dict(areas or {})
        self.now = now

    def entity(self, entity_id):
        return self._entities.get(entity_id)

    def device(self, _device_id):
        return None

    def area_name(self, area_id):
        return self._areas.get(area_id)

    def local_time(self, when=None):
        return (when or self.now).astimezone(TZ)


def opts(**tv):
    return {**DEFAULTS, CONF_TV: {**TV_DEFAULT, **tv}}


def payload(**kw):
    return {"type": "notification", "kind": "timer", "entity": "timer.pasta", "title": "Pasta Timer",
            "message": "Done", "icon": "hk:timer-sand", "tint": rules.ORANGE, "important": False,
            "camera": None, "snap": None, "tv": True, "tv_look": None, **kw}


HOUSE = House([Entity("timer.pasta", area_id="kitchen")], {"kitchen": "Kitchen"})


def test_off_until_the_house_turns_it_on():
    assert DEFAULTS[CONF_TV]["on"] is False
    assert not T.goes(HOUSE, DEFAULTS, payload())
    assert T.goes(HOUSE, opts(on=True), payload())


def test_each_notification_goes_only_with_its_own_switch():
    assert not T.goes(HOUSE, opts(on=True), payload(tv=False))
    assert not T.goes(HOUSE, opts(on=True), {**payload(), "type": "popup"})


def test_do_not_disturb_holds_back_all_but_important():
    o = {**opts(on=True), "dnd": {"schedule": True, "from": "18:00", "to": "07:00", "while": []}}
    assert not T.goes(HOUSE, o, payload())
    assert T.goes(HOUSE, o, payload(important=True))
    assert T.goes(HOUSE, {**o, CONF_TV: {**o[CONF_TV], "dnd": False}}, payload())


def test_the_card_says_the_room_and_the_time():
    c = T.card(HOUSE, opts(on=True), payload())
    assert (c["look"], c["title"], c["line"], c["caption"]) == ("color", "Pasta Timer", "Done", "Kitchen · 6:42 PM")
    assert (c["glyph"], c["color"], c["critical"], c["snapshot"]) == ("hk:timer-sand", "#FF9F0A", False, False)


def test_a_notification_may_choose_its_own_look():
    assert T.card(HOUSE, opts(on=True, look="black"), payload())["look"] == "black"
    assert T.card(HOUSE, opts(on=True, look="black"), payload(tv_look="glass"))["look"] == "glass"


def test_critical_leads_an_important_leak():
    c = T.card(HOUSE, opts(on=True), payload(kind="leak", important=True, entity="binary_sensor.sink"))
    assert c["critical"] and c["caption"] == "Critical · 6:42 PM"
    assert not T.card(HOUSE, opts(on=True), payload(important=True))["critical"]     # an Important timer isn't critical


def test_the_camera_picture_only_when_asked_and_there_is_one():
    p = payload(kind="doorbell", camera="camera.front_door")
    assert T.card(HOUSE, opts(on=True), p)["snapshot"]
    assert not T.card(HOUSE, opts(on=True, camera=False), p)["snapshot"]
    assert not T.card(HOUSE, opts(on=True), payload())["snapshot"]


def test_long_words_shorten_by_words():
    c = T.card(HOUSE, opts(on=True), payload(message="The water heater in the crawl space reported a leak under the "
                                                     "tank and the valve was closed a few minutes ago"))
    assert len(c["line"]) <= T.LINE_MAX + 1 and c["line"].endswith("…") and not c["line"][:-1].endswith(" ")


@pytest.mark.parametrize("color", [rules.ORANGE, rules.YELLOW, rules.TEAL, rules.GREEN, rules.BLUE, rules.RED,
                                   rules.BROWN, rules.GRAY, "#64D2FF", "#FFD60A"])
def test_color_darkens_until_white_type_reads(color):
    k = T.darken(color)
    assert T.contrast_white(T.shade(color, k)) >= T.WHITE_RATIO
    assert k == 0 or T.contrast_white(T.shade(color, max(0, k - 0.02))) < T.WHITE_RATIO     # no darker than it needs


def test_the_options_are_checked_and_merged():
    o, err = P.apply_house(DEFAULTS, {CONF_TV: {"on": True}})
    assert not err and o[CONF_TV] == {**TV_DEFAULT, "on": True}
    o2, err = P.apply_house(o, {CONF_TV: {"look": "glass"}})
    assert not err and o2[CONF_TV] == {**TV_DEFAULT, "on": True, "look": "glass"}
    assert P.apply_house(o, {CONF_TV: {"look": "neon"}})[1] == {CONF_TV: "choice"}
    assert P.apply_house(o, {CONF_TV: {"loud": True}})[1] == {CONF_TV: "unknown"}
    assert P.tv_options({"on": "yes", "look": 3}) == TV_DEFAULT


def test_the_item_fields_and_the_payload_carry_it():
    assert {"tv", "tv_look"} <= set(ITEM_FIELDS)
    assert P.FIELDS["tv_look"]("auto") is None and P.FIELDS["tv_look"]("black") == "black"
    with pytest.raises(P.Bad):
        P.FIELDS["tv_look"]("neon")


def test_an_automations_own_never_goes():
    class H(House):
        def state(self, _eid):
            return None
    p = B.build_action(H(), {**DEFAULTS}, {"title": "Hello"})
    assert p["tv"] is False and not T.goes(H(), opts(on=True), p)


def test_send_tests_card():
    c = T.test_card(HOUSE, opts(on=True, look="black"))
    assert c["look"] == "black" and c["title"] == "Apple TV" and c["caption"] == "6:42 PM"
    assert T.test_card(HOUSE, opts(on=True), look="glass")["look"] == "glass"
