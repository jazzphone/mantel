"""Phase 31: Mantel's Apple TV camera and its motion sensor in Home Assistant. The camera's picture is asked for over
the link (`camera_image`) only when its version changes; the sensor is a motion sensor; Mantel's Add to HomeKit makes
Home Assistant's HomeKit Bridge entry (its import flow) and Remove from HomeKit removes it; how it stands is reported
to Mantel (`report.homekit`). Home Assistant's HomeKit integration itself is not loaded here (its helpers are
stood in for): the entry's shape is checked, not HomeKit's own work."""
from __future__ import annotations

import base64
import types

from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.components.camera import async_get_image
from homeassistant.config_entries import SOURCE_IMPORT

from conftest import linked
from mantel_fake import ENTRY, until

CAM, SENSOR = "camera.mantel_alerts", "binary_sensor.mantel_alerts"
CAM_UID, SENSOR_UID = f"{ENTRY}_tv_alerts_camera", f"{ENTRY}_tv_alerts_motion"
JPEG = b"\xff\xd8\xff\xe0" + b"card" * 25 + b"\xff\xd9"


def tv(want: bool = False, version: int = 1) -> list[dict]:
    dev = {"identifier": f"{ENTRY}_tv_alerts", "name": "Mantel Alerts", "model": "Notifications on Apple TV"}
    return [
        {"unique_id": CAM_UID, "platform": "camera", "entity_id": CAM, "name": "Mantel Alerts", "has_entity_name": False,
         "device": dev, "state": "idle", "attributes": {"still": version},
         "features": {"still": True, "homekit": {"want": want, "sensor": SENSOR_UID}}},
        {"unique_id": SENSOR_UID, "platform": "binary_sensor", "entity_id": SENSOR, "name": "Mantel Alerts",
         "has_entity_name": False, "device": dev, "state": "off", "attributes": {}, "features": {"device_class": "motion"}},
    ]


def answering(mantel, asked: list):
    async def answer(ws, msg):
        if msg["type"] == "camera_image":
            asked.append(msg["unique_id"])
            return {"id": msg["id"], "type": "result", "success": True,
                    "result": {"version": len(asked), "jpeg": base64.b64encode(JPEG).decode()}}
        return await mantel.ok(ws, msg)
    return answer


async def test_the_picture_comes_over_the_link_once_per_version(hass, mantel):
    asked: list = []
    mantel.entities += tv()
    mantel.answer = answering(mantel, asked)
    await linked(hass, mantel)
    await until(hass, lambda: hass.states.get(CAM) is not None and hass.states.get(SENSOR) is not None)
    assert hass.states.get(SENSOR).attributes["device_class"] == "motion"
    assert (await async_get_image(hass, CAM)).content == JPEG
    assert (await async_get_image(hass, CAM)).content == JPEG
    assert asked == [CAM_UID]                                        # kept while the version stays
    await mantel.push({"type": "state", "unique_id": CAM_UID, "state": "idle", "attributes": {"still": 2},
                       "available": True})
    await until(hass, lambda: hass.states.get(CAM).attributes.get("still") == 2)
    await async_get_image(hass, CAM)
    assert asked == [CAM_UID, CAM_UID]
    await mantel.push({"type": "state", "unique_id": SENSOR_UID, "state": "on", "attributes": {}, "available": True})
    await until(hass, lambda: hass.states.get(SENSOR).state == "on")


async def test_add_to_homekit_makes_the_entry_and_remove_removes_it(hass, mantel, monkeypatch):
    from custom_components.mantel import homekit_entry as H
    monkeypatch.setattr(H, "_validate", lambda cfg: {k: {**v, "video_codec": "libx264"} for k, v in cfg.items()})
    monkeypatch.setattr(H, "_free_port", lambda _hass: 21130)
    made: list = []

    async def init(domain, context=None, data=None):
        made.append((domain, context, data))
        MockConfigEntry(domain="homekit", source=SOURCE_IMPORT, data={"name": H.BRIDGE_NAME, "port": 21130},
                        title="Mantel Alerts:21130").add_to_hass(hass)
        return {"type": "create_entry"}
    monkeypatch.setattr(hass.config_entries.flow, "async_init", init)
    mantel.entities += tv(want=True)
    await linked(hass, mantel)
    await until(hass, lambda: made)
    domain, ctx, data = made[0]
    assert (domain, ctx) == ("homekit", {"source": SOURCE_IMPORT})
    assert (data["name"], data["port"], data["mode"], data["filter"]["include_entities"]) == (
        "Mantel Alerts", 21130, "accessory", [CAM])
    assert data["entity_config"] == {CAM: {"linked_motion_sensor": SENSOR, "support_audio": False,
                                           "video_codec": "libx264"}}
    # not running here (HomeKit isn't loaded): Mantel is told it is starting
    await until(hass, lambda: {"homekit": {"state": "starting"}} in mantel.reports)

    removed: list = []

    async def remove(entry_id):
        removed.append(entry_id)
        hass.config_entries._entries.pop(entry_id)
        return {"require_restart": False}
    monkeypatch.setattr(hass.config_entries, "async_remove", remove)
    cam = tv(want=False)[0]
    await mantel.push({"type": "entity", "entity": cam})
    await until(hass, lambda: removed)
    await until(hass, lambda: {"homekit": {"state": "none"}} in mantel.reports)
    assert len(made) == 1


async def test_how_it_stands_is_read_from_the_driver(hass):
    from custom_components.mantel import homekit_entry as H
    assert H.status(hass) == {"state": "none"}
    e = MockConfigEntry(domain="homekit", source=SOURCE_IMPORT, data={"name": H.BRIDGE_NAME, "port": 21130})
    e.add_to_hass(hass)
    assert H.status(hass) == {"state": "starting"}
    state = types.SimpleNamespace(paired=False, pincode=b"123-45-678")
    driver = types.SimpleNamespace(state=state, accessory=types.SimpleNamespace(xhm_uri=lambda: "X-HM://0023ISYWY1234"))
    e.runtime_data = types.SimpleNamespace(homekit=types.SimpleNamespace(driver=driver))
    assert H.status(hass) == {"state": "unpaired", "code": "123-45-678", "uri": "X-HM://0023ISYWY1234"}
    state.paired = True
    assert H.status(hass) == {"state": "paired"}
    # another HomeKit Bridge entry of the house's is never ours
    other = MockConfigEntry(domain="homekit", data={"name": "HK Lights", "port": 21066})
    other.add_to_hass(hass)
    assert H.ours(hass) is e
