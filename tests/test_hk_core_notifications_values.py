"""Goes Off When a value (2026-11-14): an accessory whose state is just a value -- a text sensor such as a mailbox's
status, an enum sensor, a select -- can go off when it changes to one value, picked from what it's known to take or typed."""
from hk_core.house import State
from hk_core.notifications import accessories as A, banner as B, rules, settings as P
from hk_core.notifications.const import DEFAULTS

from test_hk_core_notifications import FakeHouse


def house():
    return FakeHouse(states=[
        State("sensor.mailbox_status", "Mail Delivered & Picked Up", {"friendly_name": "Mailbox Status"}),
        State("sensor.washer_job", "wash", {"friendly_name": "Washer Job", "device_class": "enum",
                                            "options": ["none", "wash", "rinse", "spin", "finish"]}),
        State("binary_sensor.mailbox_contact", "off", {"friendly_name": "Mailbox", "device_class": "door"}),
    ])


def test_a_text_sensor_offers_changes_and_its_state_now():
    d = A.describe(house(), "sensor.mailbox_status")
    assert d["values"] is True
    assert d["choices"] == [["any", "Changes"], ["Mail Delivered & Picked Up", "Changes To “Mail Delivered & Picked Up”"]]


def test_an_enum_sensor_offers_each_of_its_options():
    d = A.describe(house(), "sensor.washer_job")
    assert [c[0] for c in d["choices"]] == ["any", "none", "wash", "rinse", "spin", "finish"]


def test_a_typed_value_is_saved_and_kept_among_the_choices():
    h = house()
    it = P.new_item(h, "sensor.mailbox_status", set())
    assert it["when"] == "any"
    out, err = P.apply_item(h, it, {"when": "Mail Likely Delivered"})
    assert not err and out["when"] == "Mail Likely Delivered"
    page = P.page(h, {**DEFAULTS, "items": [out]}, {}, "loaded")["items"][0]
    assert ["Mail Likely Delivered", "Changes To “Mail Likely Delivered”"] in page["choices"] and page["values"] is True


def test_a_value_is_checked():
    h = house()
    it = P.new_item(h, "sensor.mailbox_status", set())
    for bad, code in ((" padded ", "text"), ("x" * 65, "text"), ("<b>", "text"), ("unavailable", "choice")):
        assert P.apply_item(h, it, {"when": bad})[1] == {"when": code}, bad


def test_only_a_values_kind_takes_one():
    h = house()
    door = P.new_item(h, "binary_sensor.mailbox_contact", set())
    assert A.describe(h, "binary_sensor.mailbox_contact")["values"] is False
    assert P.apply_item(h, door, {"when": "Mail Likely Delivered"})[1] == {"when": "choice"}


def test_it_goes_off_on_that_value_only():
    old, new, other = ("No Activity Today", {}), ("Mail Likely Delivered", {}), ("Mail Delivered & Picked Up", {})
    assert rules.fires("state", "Mail Likely Delivered", old, new)
    assert not rules.fires("state", "Mail Likely Delivered", new, other)
    assert rules.fires("state", "any", new, other)
    h = house()
    item = {**P.new_item(h, "sensor.mailbox_status", set()), "when": "Mail Likely Delivered"}
    p = B.build(h, DEFAULTS, item, State("sensor.mailbox_status", "Mail Likely Delivered", {}))
    assert (p["title"], p["message"]) == ("Mailbox Status", "Changed to Mail Likely Delivered.")
