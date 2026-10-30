"""THE SIDE PANE'S TO-DO LISTS, HOME ASSISTANT'S SIDE (hk_core/todo.py).

`hk_frontend/todo/items`: one list's items for the page, read with Home Assistant's own
`todo.get_items` through the House port (HaHouse), the decisions -- which items, in what order, how
many -- hk_core's. Any signed-in user may read a list their dashboard shows, as they may see its count.
Checking an item off is the page's own `todo.update_item` call, as any tap on a tile is.
"""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

from .hk_core import todo as TD
from .house import HaHouse


@websocket_api.websocket_command({
    vol.Required("type"): "hk_frontend/todo/items",
    vol.Required("entity_id"): vol.All(str, vol.Match(TD.LIST_ID)),
    vol.Optional("completed", default=False): bool,
})
@websocket_api.async_response
async def ws_todo_items(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                        msg: dict[str, Any]) -> None:
    if hass.states.get(msg["entity_id"]) is None:
        connection.send_error(msg["id"], "not_found", "no such to-do list")
        return
    try:
        got = await TD.items(HaHouse(hass), msg["entity_id"], msg["completed"])
    except (HomeAssistantError, ValueError) as err:
        connection.send_error(msg["id"], "failed", str(err) or "the list could not be read")
        return
    connection.send_result(msg["id"], got)


def register_commands(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_todo_items)
