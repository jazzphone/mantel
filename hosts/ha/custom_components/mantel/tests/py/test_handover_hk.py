"""THE BRIDGE HAND-OVER with the real HK Frontend (slice 9.3; collected only
with HK_FRONTEND_COMPONENT, a built HK Frontend): HK Frontend and Mantel Link
in one Home Assistant, both linked to the stand-in Mantel. Mantel owns the Hall
tablet; HK Frontend mirrors it until the bridge is handed to Mantel Link, then
Mantel Link does, and back. The same registry entries move (their ids, entity
ids, device and area kept), a script waiting on the black screen's `confirmed`
never fails, hk_frontend.set_black_screen reaches the tablet whoever holds the
bridge, and an interrupted move completes at the next start."""
from __future__ import annotations

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.setup import async_setup_component

from mantel_fake import BLACK, ENTRY, INSTANCE, INUSE, PHOTOS, SLEEP, TOKEN, UIDS, until

HALL = (BLACK, PHOTOS, SLEEP, INUSE)
HK_HOLDS = {"house": "ha", "tablets": ["hall"], "bridge": "hk_frontend"}
LINK_HOLDS = {"house": "ha", "tablets": ["hall"], "bridge": "mantel"}


def hk_entry(hass, fake, owners):
    e = MockConfigEntry(domain="hk_frontend", entry_id=ENTRY, unique_id="hk_frontend", title="HK Frontend",
                        version=1, minor_version=13, options={},
                        data={"mantel_link": {"url": fake.url, "token": TOKEN}, "mantel_owners": owners})
    e.add_to_hass(hass)
    return e


def link_entry(hass, fake, owners):
    e = MockConfigEntry(domain="mantel", unique_id=INSTANCE, title="Mantel",
                        data={"url": fake.url, "token": TOKEN, "owners": owners})
    e.add_to_hass(hass)
    return e


def platforms(hass):
    reg = er.async_get(hass)
    return {eid: reg.async_get(eid).platform if reg.async_get(eid) else None for eid in HALL}


def live(hass):
    return all((st := hass.states.get(eid)) is not None and st.state not in ("unavailable", "unknown") for eid in HALL)


async def hand(hass, fake, owners):
    fake.owners = dict(owners)
    await fake.push({"type": "owners", "owners": fake.owners})


@pytest.fixture
async def house(hass, hk_base, mantel):
    """Both linked, HK Frontend holding the bridge, the Hall tablet Mantel's."""
    mantel.owners = dict(HK_HOLDS)
    hk = hk_entry(hass, mantel, HK_HOLDS)
    link = link_entry(hass, mantel, HK_HOLDS)
    assert await hass.config_entries.async_setup(hk.entry_id)
    assert await hass.config_entries.async_setup(link.entry_id)
    await until(hass, lambda: live(hass) and link.runtime_data.connected)
    yield hk, link


async def test_hand_over_and_back_keeps_every_id(hass, mantel, house):
    hk, link = house
    reg, devs = er.async_get(hass), dr.async_get(hass)
    assert platforms(hass) == dict.fromkeys(HALL, "hk_frontend"), "HK Frontend mirrors while it holds the bridge"
    assert link.runtime_data.state == "dormant"
    # Both links report once connected, each from a task of its own: Mantel Link what it sees of HK Frontend (in
    # mantel.reports with it), HK Frontend its dashboards, on each socket it opens
    link_reports = lambda: [r for r in mantel.reports if "hk_frontend" in r]  # noqa: E731
    hk_sockets = lambda: [h for h in mantel.headers if "domain=hk_frontend" in h.get("X-Mantel-Link", "")]  # noqa: E731
    hk_reported = lambda: [m for m in mantel.by_domain.get("hk_frontend", []) if m.get("type") == "report"]  # noqa: E731
    await until(hass, lambda: link_reports() and len(hk_reported()) == len(hk_sockets()) == 1)
    assert link_reports()[-1]["hk_frontend"] == {"installed": True, "loaded": True, "linked": True}
    hk_header = hk_sockets()[0]
    assert hk_header["X-Mantel-Link"] == "domain=hk_frontend; protocol=1; features=bridge,settings,actions,reads"
    before = {eid: reg.async_get(eid).id for eid in HALL}
    dev = devs.async_get(reg.async_get(BLACK).device_id)
    devs.async_update_device(dev.id, area_id="loft", name_by_user="Loft Tablet")
    reg.async_update_entity(SLEEP, name="Loft sleep")

    hk_before = len(hk_sockets())
    await hand(hass, mantel, LINK_HOLDS)
    await until(hass, lambda: platforms(hass) == dict.fromkeys(HALL, "mantel") and live(hass), timeout=15)
    assert {eid: reg.async_get(eid).id for eid in HALL} == before, "the same registry entries, moved"
    assert all(reg.async_get(eid).unique_id == UIDS[eid] for eid in HALL)
    assert all(reg.async_get(eid).config_entry_id == link.entry_id for eid in HALL)
    d = devs.async_get(reg.async_get(BLACK).device_id)
    # Home Assistant gives each integration its own devices: Mantel Link's for the tablet, with what the
    # person set on HK Frontend's (its room, its name)
    assert d.identifiers == {("mantel", f"{ENTRY}_hall")} and link.entry_id in d.config_entries
    assert d.area_id == "loft" and d.name_by_user == "Loft Tablet" and d.manufacturer == "Mantel"
    assert all(reg.async_get(eid).device_id == d.id for eid in HALL)
    assert reg.async_get(SLEEP).name == "Loft sleep"
    assert not [e for e in reg.entities.values() if e.entity_id.endswith("_2")], "no second entity anywhere"
    assert hk.data["mantel_owners"]["bridge"] == "mantel" and link.runtime_data.state == "mirroring"

    # hk_frontend.set_black_screen (HK Frontend's, it is still loaded) reaches the tablet through Mantel Link.
    # The hand-over reloaded HK Frontend too: its link opens a socket again and reports its dashboards on it --
    # on a busy machine after the entities have moved, and the report was taken for the service call. Its
    # socket is watched once its reload is done.
    await until(hass, lambda: len(hk_sockets()) > hk_before and len(hk_reported()) == len(hk_sockets()))
    mantel.by_domain.clear()
    await hass.services.async_call("hk_frontend", "set_black_screen", {"entity_id": BLACK, "black": True,
                                                                      "brightness": 90}, blocking=True)
    # (it reaches the fake Mantel over the link's socket: on a busy machine a moment after the call returns --
    # the suite once failed here with every test running at once)
    sent = lambda: [m for m in mantel.by_domain.get("mantel", []) if m.get("type") == "call_service"]  # noqa: E731
    await until(hass, sent)
    got = sent()
    assert got and got[-1]["service"] == "set_black_screen" and got[-1]["data"] == {"black": True, "brightness": 90}
    assert not mantel.by_domain.get("hk_frontend"), ("not through HK Frontend's own link", mantel.by_domain["hk_frontend"])

    # and back
    await hand(hass, mantel, HK_HOLDS)
    await until(hass, lambda: platforms(hass) == dict.fromkeys(HALL, "hk_frontend") and live(hass), timeout=15)
    assert {eid: reg.async_get(eid).id for eid in HALL} == before
    assert all(reg.async_get(eid).config_entry_id == hk.entry_id for eid in HALL)
    assert reg.async_get(BLACK).device_id == dev.id, "back on HK Frontend's own device"
    assert devs.async_get(dev.id).area_id == "loft"
    assert not [e for e in reg.entities.values() if e.entity_id.endswith("_2")]
    await until(hass, lambda: link.runtime_data.state == "dormant")


async def test_a_waiting_sleep_script_never_fails(hass, mantel, house):
    """A sleep script turned the screen black and waits for the page's
    `confirmed`; the bridge moves while it waits; the confirm still ends it."""
    hk, link = house
    events = []
    hass.bus.async_listen("sleep_done", lambda e: events.append(e))
    assert await async_setup_component(hass, "script", {"script": {"sleep": {"sequence": [
        {"action": "hk_frontend.set_black_screen", "target": {"entity_id": BLACK},
         "data": {"black": True, "brightness": 40}},
        {"wait_template": "{{ state_attr('switch.hall_black_screen', 'confirmed') }}", "timeout": 60,
         "continue_on_timeout": False},
        {"event": "sleep_done"}]}}})

    async def answer(ws, msg):
        if msg.get("type") == "call_service" and msg.get("service") == "set_black_screen":
            await ws.send_json({"type": "state", "unique_id": UIDS[BLACK], "state": "on", "available": True,
                                "attributes": {"tablet": "hall", "black_screen": "hk", "brightness": 40,
                                               "confirmed": False}})
        return {"id": msg["id"], "type": "result", "success": True, "result": {"ok": True}}
    mantel.answer = answer
    # the script runs as the house runs it, beside everything else (the harness's
    # block-till-done would otherwise sit out its whole wait)
    run = hass.async_create_background_task(
        hass.services.async_call("script", "sleep", blocking=True), "the sleep script")
    await until(hass, lambda: hass.states.get(BLACK).state == "on")
    await hand(hass, mantel, LINK_HOLDS)
    await until(hass, lambda: platforms(hass) == dict.fromkeys(HALL, "mantel") and live(hass), timeout=15)
    assert not run.done(), "still waiting for the page's confirm"
    for e in mantel.entities:
        if e["unique_id"] == UIDS[BLACK]:
            e.update(state="on", attributes={**e["attributes"], "brightness": 40, "confirmed": True})
    await mantel.push({"type": "state", "unique_id": UIDS[BLACK], "state": "on", "available": True,
                       "attributes": {"tablet": "hall", "black_screen": "hk", "brightness": 40, "confirmed": True}})
    await until(hass, lambda: events, timeout=10)
    await run                                   # it ended well: no error
    assert hass.states.get("script.sleep").state == "off"


async def test_an_interrupted_move_completes_at_the_next_start(hass, hk_base, mantel):
    """Home Assistant stopped halfway: two of the Hall's entries already Mantel
    Link's, two still HK Frontend's. The next start finishes the move to
    whoever holds the bridge, either way."""
    reg = er.async_get(hass)
    for holds, first, then in ((LINK_HOLDS, "hk_frontend", "mantel"), (HK_HOLDS, "mantel", "hk_frontend")):
        mantel.owners = dict(holds)
        hk = hk_entry(hass, mantel, holds) if not hass.config_entries.async_entries("hk_frontend") else \
            hass.config_entries.async_entries("hk_frontend")[0]
        link = link_entry(hass, mantel, holds) if not hass.config_entries.async_entries("mantel") else \
            hass.config_entries.async_entries("mantel")[0]
        for eid in HALL:
            if reg.async_get(eid) is None:
                reg.async_get_or_create(eid.split(".")[0], first, UIDS[eid], suggested_object_id=eid.split(".")[1],
                                        config_entry=hk if first == "hk_frontend" else link)
        for eid in HALL[:2]:              # half moved already
            ent = reg.async_get(eid)
            if ent.platform != then:
                reg.async_update_entity_platform(eid, then, new_config_entry_id=(link if then == "mantel" else hk).entry_id)
        hass.config_entries.async_update_entry(hk, data={**hk.data, "mantel_owners": holds})
        hass.config_entries.async_update_entry(link, data={**link.data, "owners": holds})
        for e in (hk, link):
            await hass.config_entries.async_setup(e.entry_id)
        await until(hass, lambda: platforms(hass) == dict.fromkeys(HALL, then) and live(hass), timeout=15)
        assert sorted(platforms(hass)) == sorted(HALL) and not [e for e in reg.entities if e.endswith("_2")]
        for e in (link, hk):
            assert await hass.config_entries.async_unload(e.entry_id)
        await hass.async_block_till_done()


async def test_removing_mantel_link_keeps_the_entity_ids(hass, mantel, house):
    hk, link = house
    await hand(hass, mantel, LINK_HOLDS)
    await until(hass, lambda: platforms(hass) == dict.fromkeys(HALL, "mantel") and live(hass), timeout=15)
    reg = er.async_get(hass)
    before = {eid: reg.async_get(eid).id for eid in HALL}
    await hass.config_entries.async_remove(link.entry_id)
    await hass.async_block_till_done()
    assert platforms(hass) == dict.fromkeys(HALL, "hk_frontend"), "handed back to HK Frontend, not deleted"
    assert {eid: reg.async_get(eid).id for eid in HALL} == before
