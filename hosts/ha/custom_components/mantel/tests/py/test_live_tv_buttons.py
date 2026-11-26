"""Live TV in Apple's Home app as a TV a screen, in Home Assistant (Mantel's cameras/live_tv_buttons.py): Mantel's TVs
are mirrored as media players (on while Mantel says the screen plays, its input the channel), every command goes to
Mantel as an entity command (an input with its name), the Remote's up and down are channel up and down, each TV gets
its own HomeKit entry through HomeKit's import flow in accessory mode, removed with its screen's TV or with Remove from
Home App, and reported to Mantel (`report.homekit_tvs`); the switches' bridge of 0.1.16-0.1.17 and their registry
entries go once Mantel publishes TVs, and are left alone while it doesn't. mantel.live_tv_play / live_tv_stop are
forwarded as called. Home Assistant's HomeKit integration itself is not loaded here: the entries' shape is checked, not
HomeKit's own work."""
from __future__ import annotations

from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.config_entries import SOURCE_IMPORT

from conftest import linked
from mantel_fake import ENTRY, until

DEN, STUDY = "s0123456789ab", "sba9876543210"
TV, STUDY_TV, CARRIER = f"{ENTRY}_live_tv_tv_{DEN}", f"{ENTRY}_live_tv_tv_{STUDY}", f"{ENTRY}_live_tv_buttons"
DEN_EID, STUDY_EID = "media_player.den_homeview_live_tv", "media_player.study_tv_live_tv"


def tv(uid: str = TV, name: str = "Den HomeView Live TV", eid: str = DEN_EID, state: str = "off",
       source: str | None = None) -> dict:
    return {"unique_id": uid, "platform": "media_player", "entity_id": eid, "name": name, "has_entity_name": False,
            "state": state, "attributes": {"source": source, "screen": DEN},
            "features": {"live_tv_home": True, "device_class": "tv", "sources": ["NBC", "WFAK-DT"]}}


def carrier(include: list[str], want: bool = True, bridge: str = "live_tv_tv") -> dict:
    return {"unique_id": CARRIER, "platform": "sensor", "entity_id": "sensor.mantel_live_tv", "name": "Mantel Live TV",
            "has_entity_name": False, "state": len(include), "attributes": {},
            "features": {"homekit": {"bridge": bridge, "want": want, "include": include}}}


def entries_made(hass, monkeypatch, port: int = 21131) -> tuple[list, list]:
    """HomeKit's import flow and entry removal, stood in: (made, removed)."""
    from custom_components.mantel import homekit_entry as H
    ports = iter(range(port, port + 20))
    monkeypatch.setattr(H, "_free_port", lambda _hass: next(ports))
    made: list = []
    removed: list = []

    async def init(domain, context=None, data=None):
        made.append((domain, context, data))
        MockConfigEntry(domain="homekit", source=SOURCE_IMPORT, data={"name": data["name"], "port": data["port"]},
                        options={"filter": data["filter"], "mode": data["mode"]},
                        title=f"{data['name']}:{data['port']}").add_to_hass(hass)
        return {"type": "create_entry"}

    async def remove(entry_id):
        removed.append(hass.config_entries.async_get_entry(entry_id).data["name"])
        hass.config_entries._entries.pop(entry_id)
        return {"require_restart": False}
    monkeypatch.setattr(hass.config_entries.flow, "async_init", init)
    monkeypatch.setattr(hass.config_entries, "async_remove", remove)
    return made, removed


async def test_a_tv_sends_every_command_to_mantel_and_shows_what_mantel_says_plays(hass, mantel):
    mantel.entities += [tv(), carrier([TV], want=False)]
    await linked(hass, mantel)
    assert "features=bridge,live_tv,live_tv_home,live_tv_tv" in mantel.headers[-1]["X-Mantel-Link"]
    await until(hass, lambda: hass.states.get(DEN_EID) is not None)
    st = hass.states.get(DEN_EID)
    assert st.state == "off" and st.attributes["friendly_name"] == "Den HomeView Live TV"
    assert st.attributes["device_class"] == "tv" and st.attributes["source_list"] == ["NBC", "WFAK-DT"]
    await hass.services.async_call("media_player", "turn_on", {"entity_id": DEN_EID}, blocking=True)
    cmd = mantel.calls("entity_command")[-1]
    assert (cmd["unique_id"], cmd["command"], cmd["data"]) == (TV, "turn_on", {})
    assert hass.states.get(DEN_EID).state == "off", "on only once Mantel says the screen plays"
    await mantel.push({"type": "state", "unique_id": TV, "state": "playing",
                       "attributes": {"source": "WFAK-DT", "screen": DEN}, "available": True})
    await until(hass, lambda: hass.states.get(DEN_EID).state == "playing")
    assert hass.states.get(DEN_EID).attributes["source"] == "WFAK-DT"
    await hass.services.async_call("media_player", "select_source", {"entity_id": DEN_EID, "source": "NBC"}, blocking=True)
    assert mantel.calls("entity_command")[-1]["data"] == {"source": "NBC"}
    for service in ("media_next_track", "media_previous_track", "media_pause", "turn_off"):
        await hass.services.async_call("media_player", service, {"entity_id": DEN_EID}, blocking=True)
        assert mantel.calls("entity_command")[-1]["command"] == service
    # the Remote in Control Center: up and down are channel up and down; any other key, or another TV, nothing
    n = len(mantel.calls("entity_command"))
    for key, eid in (("arrow_up", DEN_EID), ("arrow_down", DEN_EID), ("select", DEN_EID), ("arrow_up", "media_player.x")):
        hass.bus.async_fire("homekit_tv_remote_key_pressed", {"key_name": key, "entity_id": eid})
    await until(hass, lambda: len(mantel.calls("entity_command")) >= n + 2)
    assert [c["command"] for c in mantel.calls("entity_command")[n:]] == ["media_next_track", "media_previous_track"]
    # the script actions: forwarded as called, never under HK Frontend's name
    await hass.services.async_call("mantel", "live_tv_play", {"channel": "4.1", "screen": "Den HomeView"}, blocking=True)
    await hass.services.async_call("mantel", "live_tv_stop", {"screen": "Den HomeView"}, blocking=True)
    got = [(c["service"], c["data"]) for c in mantel.calls()][-2:]
    assert got == [("live_tv_play", {"channel": "4.1", "screen": "Den HomeView"}),
                   ("live_tv_stop", {"screen": "Den HomeView"})]
    assert not hass.services.has_service("hk_frontend", "live_tv_play")


async def test_each_tv_gets_its_own_homekit_entry_kept_and_removed_as_mantel_says(hass, mantel, monkeypatch):
    made, removed = entries_made(hass, monkeypatch)
    mantel.entities += [tv(), carrier([TV])]
    await linked(hass, mantel)
    await until(hass, lambda: made)
    domain, ctx, data = made[0]
    assert (domain, ctx) == ("homekit", {"source": SOURCE_IMPORT})
    assert (data["name"], data["port"], data["mode"], data["filter"]["include_entities"]) == (
        "Mantel Den HomeView Live TV", 21131, "accessory", [DEN_EID])
    await until(hass, lambda: {"homekit_tvs": {TV: {"state": "starting"}}} in mantel.reports)
    assert not any("homekit" in (r or {}) for r in mantel.reports), "the Apple TV camera's entry is another matter"

    # another screen's TV: an entry of its own, the first one untouched
    await mantel.push({"type": "entity", "entity": tv(STUDY_TV, "Study TV Live TV", STUDY_EID)})
    await mantel.push({"type": "entity", "entity": carrier([TV, STUDY_TV])})
    await until(hass, lambda: len(made) == 2)
    assert made[1][2]["name"] == "Mantel Study TV Live TV" and made[1][2]["port"] == 21132
    await until(hass, lambda: {"homekit_tvs": {TV: {"state": "starting"}, STUDY_TV: {"state": "starting"}}} in mantel.reports)
    assert not removed
    # the Den's last channel unchecked: its TV leaves HomeKit, the Study's stays
    await mantel.push({"type": "entity", "entity": carrier([STUDY_TV])})
    await until(hass, lambda: removed)
    assert removed == ["Mantel Den HomeView Live TV"] and len(made) == 2
    # Remove from Home App: every TV's entry goes
    await mantel.push({"type": "entity", "entity": carrier([STUDY_TV], want=False)})
    await until(hass, lambda: len(removed) == 2)
    assert removed[1] == "Mantel Study TV Live TV"
    await until(hass, lambda: {"homekit_tvs": {STUDY_TV: {"state": "none"}}} in mantel.reports)


async def test_the_switches_bridge_and_switches_go_once_mantel_publishes_tvs(hass, mantel, monkeypatch):
    """0.1.16-0.1.17 kept one bridge of switches, "Mantel Live TV": once Mantel publishes the TVs, it and the switches'
    registry entries Mantel no longer sends go; nothing else of Home Assistant's does."""
    from homeassistant.helpers import entity_registry as er
    from custom_components.mantel import homekit_entry as H
    made, removed = entries_made(hass, monkeypatch)
    MockConfigEntry(domain="homekit", source=SOURCE_IMPORT, data={"name": H.TV_BRIDGE_NAME, "port": 21130},
                    options={"mode": "bridge"}).add_to_hass(hass)
    MockConfigEntry(domain="homekit", source=SOURCE_IMPORT, data={"name": "Living Room", "port": 21129},
                    options={"mode": "bridge"}).add_to_hass(hass)
    mantel.entities += [tv(), carrier([TV])]
    e = await linked(hass, mantel)
    reg = er.async_get(hass)
    old = [reg.async_get_or_create("switch", "mantel", f"{ENTRY}_live_tv_{DEN}_{n}", config_entry=e,
                                   suggested_object_id=f"den_homeview_live_tv_{o}")
           for n, o in (("4_1", "nbc"), ("7_1", "wfak_dt"))]
    keep = reg.async_get_or_create("switch", "mantel", f"{ENTRY}_tablet_black_screen", config_entry=e)
    await mantel.push({"type": "entity", "entity": carrier([TV])})
    await until(hass, lambda: H.TV_BRIDGE_NAME in removed and made and all(reg.async_get(x.entity_id) is None for x in old))
    assert removed == [H.TV_BRIDGE_NAME] and reg.async_get(keep.entity_id) is not None


async def test_a_mantel_from_before_the_tvs_leaves_the_switches_bridge_alone(hass, mantel, monkeypatch):
    from custom_components.mantel import homekit_entry as H
    e = MockConfigEntry(domain="homekit", source=SOURCE_IMPORT, data={"name": H.TV_BRIDGE_NAME, "port": 21131},
                        options={"mode": "bridge"})
    e.add_to_hass(hass)

    async def never(*a, **k):
        raise AssertionError("the bridge was touched")
    monkeypatch.setattr(hass.config_entries, "async_remove", never)
    monkeypatch.setattr(hass.config_entries.flow, "async_init", never)
    # its switches still mirror (and the bridge still serves them); its sensor's homekit is the switches' bridge
    nbc = {"unique_id": f"{ENTRY}_live_tv_{DEN}_4_1", "platform": "switch", "entity_id": "switch.den_homeview_live_tv_nbc",
           "name": "NBC on Den HomeView", "has_entity_name": False, "state": "off", "attributes": {},
           "features": {"live_tv_home": True}}
    mantel.entities += [nbc, carrier([nbc["unique_id"]], bridge="live_tv")]
    await linked(hass, mantel)
    await until(hass, lambda: hass.states.get("switch.den_homeview_live_tv_nbc") is not None)
    for _ in range(20):
        await hass.async_block_till_done()
    assert H.ours(hass, H.TV_BRIDGE_NAME) is e
    assert not any("homekit_tvs" in (r or {}) for r in mantel.reports)
