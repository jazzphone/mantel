"""HK Frontend's other actions (slice 9.8): music, Clean Areas and automation snooze, as mantel.* and (with no HK
Frontend running) hk_frontend.*, forwarded to Mantel with exactly their data; answers come back; Mantel's refusal
(commands off) is the caller's error in words."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from homeassistant.exceptions import ServiceValidationError

from conftest import linked
from mantel_fake import until


@pytest.mark.parametrize("domain", ["mantel", "hk_frontend"])
async def test_forwarded_with_exactly_their_data(hass, mantel, domain):
    await linked(hass, mantel)
    await until(hass, lambda: hass.services.has_service(domain, "clean_areas"))

    async def answer(ws, msg):
        return {"id": msg["id"], "type": "result", "success": True,
                "result": {"ok": True, "echo": msg["service"]}}
    mantel.answer = answer
    r = await hass.services.async_call(domain, "music_play", {"rooms": "media_player.kitchen", "playlist": "Morning"},
                                       blocking=True, return_response=True)
    assert r == {"ok": True, "echo": "music_play"}
    r = await hass.services.async_call(domain, "clean_areas", {"areas": ["kitchen"]}, blocking=True,
                                       return_response=True)
    assert r == {"ok": True, "echo": "clean_areas"}
    at = datetime(2026, 10, 20, 6, 0, tzinfo=timezone.utc)
    await hass.services.async_call(domain, "pause_automation", {"entity_id": "automation.porch", "until": at},
                                   blocking=True)
    await hass.services.async_call(domain, "resume_automation", {"entity_id": "automation.porch"}, blocking=True)
    await hass.services.async_call(domain, "music_transport", {"player": "media_player.kitchen", "command": "next"},
                                   blocking=True)
    got = [(m["service"], m["data"]) for m in mantel.calls()]
    assert got == [("music_play", {"rooms": ["media_player.kitchen"], "playlist": "Morning"}),
                   ("clean_areas", {"areas": ["kitchen"], "dry_run": False}),
                   ("pause_automation", {"entity_id": ["automation.porch"], "until": "2026-10-20T06:00:00+00:00"}),
                   ("resume_automation", {"entity_id": ["automation.porch"]}),
                   ("music_transport", {"player": "media_player.kitchen", "command": "next"})]
    with pytest.raises(Exception):
        await hass.services.async_call(domain, "music_transport", {"player": "media_player.kitchen",
                                                                   "command": "self_destruct"}, blocking=True)
    with pytest.raises(Exception):
        await hass.services.async_call(domain, "pause_automation", {"entity_id": "light.porch"}, blocking=True)


async def test_commands_off_is_refused_in_words(hass, mantel):
    await linked(hass, mantel)

    async def refuse(ws, msg):
        return {"id": msg["id"], "type": "result", "success": False,
                "error": {"code": "commands_disabled",
                          "message": "house commands are disabled on this Mantel Server; nothing was sent"}}
    mantel.answer = refuse
    with pytest.raises(ServiceValidationError, match="Mantel refused mantel.clean_areas: house commands are disabled"):
        await hass.services.async_call("mantel", "clean_areas", {"areas": ["kitchen"]}, blocking=True)
