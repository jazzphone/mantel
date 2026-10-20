"""HK Settings' Alarm PIN page, answered by Mantel (alarm_pin.py "HK Settings' Alarm PIN page"): the page reads and
saves Mantel's own keypad table, commands on or off, and nothing about the PIN goes to Home Assistant, so HK Frontend
can be removed. While HK Frontend still runs the house's keypads (Mantel doesn't own ``house``), 8d48e95's way is
kept: HA first, then copied here. A FICTIONAL house and fakes only."""
import json

from gateway_fakes import gw, off  # noqa: F401 -- fixtures
from mantel_server import alarm_pin as A
from mantel_server import features as F
from test_alarm_pin import ALARM, HOUSE_CODE, PANEL, add_panel, disarm, secrets_absent, tablet

import gateway_fakes as GF


async def save(ws, rid, msg):
    await ws.send_json({"type": "settings_write", "id": rid, "msg": msg})
    while True:
        got = await GF.recv(ws)
        if got.get("type") == "settings_result" and got.get("id") == rid:
            return got


async def read(ws, rid, msg):
    await ws.send_json({"type": "read", "id": rid, "msg": msg})
    while True:
        got = await GF.recv(ws)
        if got.get("type") == "read_result" and got.get("id") == rid:
            return got


class NoHa:
    """A Home Assistant that must not be asked anything about the PIN."""
    def __init__(self):
        self.asked = []

    async def read_server(self, msg):
        self.asked.append(msg["type"])
        raise AssertionError("Home Assistant was asked about the Alarm PIN")

    async def close(self):
        pass


def only_alarm(env):
    """The house has one alarm and no keypad panel of anyone's yet."""
    hub = env.app["hub"]
    hub.store.apply_event({"a": {ALARM: {"s": "armed_away", "a": {"friendly_name": "House Alarm"}, "lc": 1.0, "lu": 1.0}}})


async def test_the_page_adds_changes_and_removes_a_pin_in_mantel_only(off):
    """Commands OFF: still saved (a settings write, not a house command); nothing reaches HA."""
    only_alarm(off)
    off.app["hub"].readproxy = ha = NoHa()
    assert not A.hk_runs_keypads(off.app)
    await off.login("avery", "owner")
    ws = await off.socket(expect_caps=False)
    page = (await read(ws, 1, {"type": "hk_alarm_pin/settings/get"}))["result"]
    assert page["configured"] is True and page["alarms"] == []
    assert page["choices"] == [{"entity_id": ALARM, "name": "House Alarm", "entry": None}]
    got = await save(ws, 2, {"type": "hk_alarm_pin/add", "alarm": ALARM, "pin": HOUSE_CODE, "pin_again": HOUSE_CODE,
                             "arm_required": False})
    (a,) = got["result"]["alarms"]
    assert a["panel"] == a["entry_id"] == "alarm_control_panel.house_alarm_pin" and a["alarm"] == ALARM
    assert a["pin_set"] is True and a["arm_required"] is False
    assert got["result"]["choices"][0]["entry"] == a["panel"], "the alarm now has a PIN"
    e = off.app["alarm_pin"].entry(a["panel"])
    assert e.forward_to == ALARM and e.house_code and e.tablets
    # a new PIN, the arm rule
    got = await save(ws, 3, {"type": "hk_alarm_pin/settings/set", "entry_id": a["panel"],
                             "changes": {"pin": "97531", "pin_again": "97531", "arm_required": True}})
    assert got["result"]["alarms"][0]["arm_required"] is True
    assert await off.app["alarm_pin"].house_matches(a["panel"], "97531")
    # refused by field, as HA's page was
    got = await save(ws, 4, {"type": "hk_alarm_pin/settings/set", "entry_id": a["panel"],
                             "changes": {"pin": "1", "pin_again": "2"}})
    assert got["error"]["code"] == "invalid_format" and "pin" in json.loads(got["error"]["message"])
    got = await save(ws, 5, {"type": "hk_alarm_pin/settings/set", "entry_id": a["panel"], "changes": {"colour": 1}})
    assert set(json.loads(got["error"]["message"])) == {"colour"}
    got = await save(ws, 6, {"type": "hk_alarm_pin/add", "alarm": ALARM, "pin": "2468", "pin_again": "2468"})
    assert json.loads(got["error"]["message"]) == {"alarm": A.PAGE_MSG["taken"]}
    got = await save(ws, 7, {"type": "hk_alarm_pin/add", "alarm": a["panel"], "pin": "2468", "pin_again": "2468"})
    assert "alarm" in json.loads(got["error"]["message"]), "never a keypad in front of a keypad"
    got = await save(ws, 8, {"type": "hk_alarm_pin/add", "alarm": "alarm_control_panel.nowhere", "pin": "2468",
                             "pin_again": "2468"})
    assert json.loads(got["error"]["message"]) == {"alarm": A.PAGE_MSG["not_alarm"]}
    # removed
    got = await save(ws, 9, {"type": "hk_alarm_pin/remove", "entry_id": a["panel"]})
    assert got["result"]["alarms"] == [] and off.app["alarm_pin"].entry(a["panel"]) is None
    got = await save(ws, 10, {"type": "hk_alarm_pin/remove", "entry_id": a["panel"]})
    assert json.loads(got["error"]["message"]) == {"entry_id": A.PAGE_MSG["no_entry"]}
    await ws.close()
    assert ha.asked == []
    acts = [r["action"] for r in off.audit(kind="config")]
    assert ["alarm_pin.add", "alarm_pin.set", "alarm_pin.remove"] == [x for x in acts if x.startswith("alarm_pin.")]
    secrets_absent(off, HOUSE_CODE, "97531")


async def test_a_pin_set_on_the_page_is_what_a_tablet_types(gw):
    only_alarm(gw)
    await gw.login("avery", "owner")
    ws = await gw.socket()
    got = await save(ws, 1, {"type": "hk_alarm_pin/add", "alarm": ALARM, "pin": HOUSE_CODE, "pin_again": HOUSE_CODE})
    panel = got["result"]["alarms"][0]["panel"]
    await ws.close()
    await tablet(gw)
    ws = await gw.socket()
    r = await gw.command(ws, **disarm(HOUSE_CODE, entity=panel))
    assert "result" in r and gw.fake.sent == ["alarm_control_panel.alarm_disarm"], "to the alarm, not the keypad"
    await ws.close()
    secrets_absent(gw, HOUSE_CODE)


async def test_only_owners_and_admins(off):
    only_alarm(off)
    await off.login("kid", "adult")
    ws = await off.socket(expect_caps=False)
    assert (await read(ws, 1, {"type": "hk_alarm_pin/settings/get"}))["error"]["code"] == "forbidden"
    got = await save(ws, 2, {"type": "hk_alarm_pin/add", "alarm": ALARM, "pin": HOUSE_CODE, "pin_again": HOUSE_CODE})
    assert got["error"]["code"] == "forbidden" and off.app["alarm_pin"].entries() == []
    await ws.close()


# -- while HK Frontend still runs the keypads: 8d48e95's way --------------------------------------------------------
def hk_has_alarm_pin(env):
    st = env.app["settings"].store
    body = F.check_settings({**(st.body("house", F.FEATURES_DOC) or {}), "ha": {"added": ["alarm_pin"], "items": {},
                                                                                    "source": "ha:x"}})
    from mantel_server.settings_store import Actor
    st.write([("house", F.FEATURES_DOC, body)], actor=Actor(label="test"))


async def test_while_hk_frontend_runs_the_keypads_the_save_goes_to_ha_first(gw, monkeypatch):
    add_panel(gw)
    hk_has_alarm_pin(gw)
    assert A.hk_runs_keypads(gw.app)
    page = {"configured": True, "alarms": [{"entry_id": "e1", "alarm": ALARM, "panel": PANEL, "arm_required": True,
                                            "pin_set": True}], "choices": []}
    real = gw.fake.call

    async def call(frame, ticket):
        await real(frame, ticket)
        return page
    monkeypatch.setattr(gw.fake, "call", call)
    await gw.login("avery", "owner")
    ws = await gw.socket()
    got = await save(ws, 1, {"type": "hk_alarm_pin/settings/set", "entry_id": "e1",
                             "changes": {"pin": HOUSE_CODE, "pin_again": HOUSE_CODE}})
    assert got["result"]["alarms"][0]["pin_set"] is True
    assert gw.fake.sent == ["hk_alarm_pin/settings/set"], "HA keeps its own copy while its keypad runs"
    assert gw.app["alarm_pin"].entry(PANEL).house_code, "and Mantel's keypads have it"
    rows = gw.audit(action="hk_alarm_pin/settings/set")
    assert rows and rows[-1]["actor"] != "mantel:linked", "the person's own audit row"
    await ws.close()
    secrets_absent(gw, HOUSE_CODE)
    # once Mantel owns the house, nothing goes to HA any more
    owners = gw.app["linked_owners"]
    audit, owners.audit = owners.audit, None
    owners.set("house", "mantel", by="test")
    owners.audit = audit
    assert not A.hk_runs_keypads(gw.app)
    ws = await gw.socket()
    got = await save(ws, 2, {"type": "hk_alarm_pin/settings/set", "entry_id": PANEL, "changes": {"arm_required": False}})
    assert got["result"]["alarms"][0]["arm_required"] is False and gw.fake.sent == ["hk_alarm_pin/settings/set"]
    await ws.close()


async def test_while_hk_frontend_runs_the_keypads_commands_off_say_so(off):
    add_panel(off)
    hk_has_alarm_pin(off)
    await off.login("avery", "owner")
    ws = await off.socket(expect_caps=False)
    got = await save(ws, 1, {"type": "hk_alarm_pin/settings/set", "entry_id": "e1", "changes": {"arm_required": True}})
    assert got["error"]["code"] == "commands_disabled" and "Move the house to Mantel" in got["error"]["message"]
    await ws.close()
