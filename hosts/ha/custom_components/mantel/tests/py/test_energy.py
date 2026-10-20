"""mantel/energy/sources (energy.py): which sensor each helper sensor counts, read from the sensors' own objects
for Mantel's Energy plan, so it needs no HK Frontend. Admin only, read only."""
from __future__ import annotations

from types import SimpleNamespace

from homeassistant.components.sensor import DATA_COMPONENT
from homeassistant.setup import async_setup_component


async def test_the_helpers_sources_admin_only_and_read_only(hass, hass_ws_client, hass_admin_user, monkeypatch):
    objs = {"sensor.office_utility": SimpleNamespace(_sensor_source_id="sensor.office_integral"),
            "sensor.office_integral": SimpleNamespace(_source_entity="sensor.office_watts"),
            "sensor.office_watts": SimpleNamespace(),
            "sensor.odd": SimpleNamespace(_sensor_source_id=7)}
    for eid in objs:
        hass.states.async_set(eid, "1")
    real = hass.data.get(DATA_COMPONENT)

    class Comp:
        def get_entity(self, eid):
            return objs.get(eid)

        def __getattr__(self, name):
            return getattr(real, name)
    monkeypatch.setitem(hass.data, DATA_COMPONENT, Comp())
    assert await async_setup_component(hass, "mantel", {})
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "mantel/energy/sources"})
    got = await ws.receive_json()
    assert got["success"] and got["result"] == {"sources": {"sensor.office_utility": "sensor.office_integral",
                                                            "sensor.office_integral": "sensor.office_watts"}}
    hass_admin_user.groups = []                       # not an admin any more
    await ws.send_json({"id": 2, "type": "mantel/energy/sources"})
    got = await ws.receive_json()
    assert not got["success"] and got["error"]["code"] == "unauthorized"
