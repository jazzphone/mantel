"""Mantel's screens in HA's sidebar (frontend.py; slice 9.6): Mantel Link's script is served and added to HA's pages,
and `mantel/frontend/config` names the only addresses it believes a framed screen from (Mantel's, from the link's
hello). The script itself is tested in node (test_frontend_js.py)."""
from __future__ import annotations

import json
import os
from unittest.mock import AsyncMock, MagicMock, patch

from homeassistant.setup import async_setup_component

from conftest import COMPONENT, linked
from mantel_fake import until

VERSION = json.load(open(os.path.join(COMPONENT, "manifest.json")))["version"]


async def test_the_script_is_served_and_added_to_ha_s_pages(hass):
    hass.config.components.update({"http", "frontend"})
    hass.http = MagicMock()
    hass.http.async_register_static_paths = AsyncMock()
    with patch("homeassistant.components.frontend.add_extra_js_url") as add:
        assert await async_setup_component(hass, "mantel", {})
        await hass.async_block_till_done()
    paths = hass.http.async_register_static_paths.call_args[0][0]
    assert paths[0].url_path == "/mantel_link" and paths[0].path.endswith("/mantel/frontend")
    assert add.call_args[0][1] == f"/mantel_link/mantel-link.js?v={VERSION}"   # cached by version


async def test_the_config_names_mantel_s_screen_addresses_only(hass, hass_ws_client, mantel):
    e = await linked(hass, mantel)
    await until(hass, lambda: e.runtime_data.link.hello.get("screen_origins"))
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "mantel/frontend/config"})
    got = await ws.receive_json()
    assert got["success"] and got["result"]["origins"] == ["https://mantel.example.com"]
    mantel.screen_origins = ["javascript:alert(1)", "https://ok.example.com"]
    await mantel.drop()
    await until(hass, lambda: e.runtime_data.link.hello.get("screen_origins") == mantel.screen_origins)
    await ws.send_json({"id": 2, "type": "mantel/frontend/config"})
    assert (await ws.receive_json())["result"]["origins"] == ["https://ok.example.com"]
