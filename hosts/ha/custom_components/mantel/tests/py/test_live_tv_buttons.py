"""Live TV's buttons for Apple's Home app in Home Assistant (Mantel's cameras/live_tv_buttons.py): Mantel's buttons are
mirrored (the button platform; the link says `buttons`), a press goes to Mantel as an entity command, the
"Mantel Live TV" HomeKit Bridge entry is made through HomeKit's import flow in bridge mode with exactly the buttons
Mantel names, changed (and reloaded) when they change, removed with Remove from HomeKit, and reported to Mantel
(`report.homekit_tv`). mantel.live_tv_play / live_tv_stop are forwarded as called. Home Assistant's HomeKit integration
itself is not loaded here: the entry's shape is checked, not HomeKit's own work."""
from __future__ import annotations

from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.config_entries import SOURCE_IMPORT

from conftest import linked
from mantel_fake import ENTRY, until

DEN = "s0123456789ab"
PLAY, STOP, CARRIER = f"{ENTRY}_live_tv_{DEN}_4_1", f"{ENTRY}_live_tv_{DEN}_stop", f"{ENTRY}_live_tv_buttons"


def button(uid: str, name: str, eid: str) -> dict:
    return {"unique_id": uid, "platform": "button", "entity_id": eid, "name": name, "has_entity_name": False,
            "state": None, "attributes": {"screen": DEN}}


def carrier(include: list[str], want: bool = True) -> dict:
    return {"unique_id": CARRIER, "platform": "sensor", "entity_id": "sensor.mantel_live_tv", "name": "Mantel Live TV",
            "has_entity_name": False, "state": 1, "attributes": {},
            "features": {"homekit": {"bridge": "live_tv", "want": want, "include": include}}}


def tv(want: bool = True) -> list[dict]:
    return [button(PLAY, "NBC on Den HomeView", "button.den_homeview_live_tv_nbc"),
            button(STOP, "Stop Live TV on Den HomeView", "button.den_homeview_live_tv_stop"),
            carrier([PLAY], want)]


async def test_the_link_says_it_mirrors_buttons_and_a_press_goes_to_mantel(hass, mantel):
    mantel.entities += tv(want=False)
    await linked(hass, mantel)
    assert "features=bridge,live_tv,buttons" in mantel.headers[-1]["X-Mantel-Link"]
    await until(hass, lambda: hass.states.get("button.den_homeview_live_tv_nbc") is not None)
    assert hass.states.get("button.den_homeview_live_tv_nbc").attributes["friendly_name"] == "NBC on Den HomeView"
    await hass.services.async_call("button", "press", {"entity_id": "button.den_homeview_live_tv_nbc"}, blocking=True)
    cmd = mantel.calls("entity_command")[-1]
    assert (cmd["unique_id"], cmd["command"], cmd["data"]) == (PLAY, "press", {})
    # the script actions: forwarded as called, never under HK Frontend's name
    await hass.services.async_call("mantel", "live_tv_play", {"channel": "4.1", "screen": "Den HomeView"}, blocking=True)
    await hass.services.async_call("mantel", "live_tv_stop", {"screen": "Den HomeView"}, blocking=True)
    got = [(c["service"], c["data"]) for c in mantel.calls()][-2:]
    assert got == [("live_tv_play", {"channel": "4.1", "screen": "Den HomeView"}),
                   ("live_tv_stop", {"screen": "Den HomeView"})]
    assert not hass.services.has_service("hk_frontend", "live_tv_play")


async def test_the_live_tv_bridge_is_made_changed_and_removed_as_mantel_says(hass, mantel, monkeypatch):
    from custom_components.mantel import homekit_entry as H
    monkeypatch.setattr(H, "_free_port", lambda _hass: 21131)
    made: list = []

    async def init(domain, context=None, data=None):
        made.append((domain, context, data))
        MockConfigEntry(domain="homekit", source=SOURCE_IMPORT, data={"name": data["name"], "port": data["port"]},
                        options={"filter": data["filter"], "mode": data["mode"]},
                        title=f"{data['name']}:21131").add_to_hass(hass)
        return {"type": "create_entry"}
    reloaded: list = []

    async def reload(entry_id):
        reloaded.append(entry_id)
        return True
    monkeypatch.setattr(hass.config_entries.flow, "async_init", init)
    monkeypatch.setattr(hass.config_entries, "async_reload", reload)
    mantel.entities += tv(want=True)
    await linked(hass, mantel)
    await until(hass, lambda: made)
    domain, ctx, data = made[0]
    assert (domain, ctx) == ("homekit", {"source": SOURCE_IMPORT})
    assert (data["name"], data["port"], data["mode"], data["filter"]["include_entities"]) == (
        "Mantel Live TV", 21131, "bridge", ["button.den_homeview_live_tv_nbc"])
    await until(hass, lambda: {"homekit_tv": {"state": "starting"}} in mantel.reports)
    assert not any("homekit" in (r or {}) for r in mantel.reports), "the Apple TV camera's entry is another matter"

    # another button: the same entry, its filter changed and reloaded (the bridge keeps its pairing)
    more = button(f"{ENTRY}_live_tv_{DEN}_7_1", "WFAK-DT on Den HomeView", "button.den_homeview_live_tv_wfak_dt")
    await mantel.push({"type": "entity", "entity": more})
    await mantel.push({"type": "entity", "entity": carrier([PLAY, more["unique_id"]])})
    await until(hass, lambda: reloaded)
    entry = H.ours(hass, H.TV_BRIDGE_NAME)
    assert entry.options["filter"]["include_entities"] == [
        "button.den_homeview_live_tv_nbc", "button.den_homeview_live_tv_wfak_dt"]
    assert len(made) == 1 and H.ours(hass) is None

    # Remove from HomeKit
    removed: list = []

    async def remove(entry_id):
        removed.append(entry_id)
        hass.config_entries._entries.pop(entry_id)
        return {"require_restart": False}
    monkeypatch.setattr(hass.config_entries, "async_remove", remove)
    await mantel.push({"type": "entity", "entity": carrier([PLAY, more["unique_id"]], want=False)})
    await until(hass, lambda: removed)
    await until(hass, lambda: {"homekit_tv": {"state": "none"}} in mantel.reports)


async def test_mantel_publishing_no_buttons_leaves_the_bridge_alone(hass, mantel, monkeypatch):
    from custom_components.mantel import homekit_entry as H
    e = MockConfigEntry(domain="homekit", source=SOURCE_IMPORT, data={"name": H.TV_BRIDGE_NAME, "port": 21131})
    e.add_to_hass(hass)

    async def never(*a, **k):
        raise AssertionError("the bridge was touched")
    monkeypatch.setattr(hass.config_entries, "async_remove", never)
    monkeypatch.setattr(hass.config_entries.flow, "async_init", never)
    await linked(hass, mantel)
    for _ in range(20):
        await hass.async_block_till_done()
    assert H.ours(hass, H.TV_BRIDGE_NAME) is e
