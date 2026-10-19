"""SCRATCH HA ONLY (tools/testha, `testha.py up --supervisor-probe`): what the Supervisor does with an App's
discovery, for a Home Assistant that has no Supervisor. `POST /api/mantel_e2e/discovery` (an administrator's token)
with the App's `{service, config}` starts that integration's hassio discovery flow, exactly as HA's hassio
integration would on the Supervisor's word. The Mantel App's real announcer (supervisor_discovery.py) is pointed at a
stand-in Supervisor in the test, which posts here (tools/e2e/mantel_link_e2e.py --phase docs)."""
from __future__ import annotations

from aiohttp import web

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.helpers import discovery_flow
from homeassistant.helpers.service_info.hassio import HassioServiceInfo

DOMAIN = "mantel_e2e_supervisor"


class Discovery(HomeAssistantView):
    url = "/api/mantel_e2e/discovery"
    name = "api:mantel_e2e:discovery"
    requires_auth = True

    async def post(self, request: web.Request) -> web.Response:
        if not request["hass_user"].is_admin:
            return web.json_response({"error": "admin only"}, status=403)
        body = await request.json()
        if body.get("service") != "mantel" or not isinstance(body.get("config"), dict):
            return web.json_response({"error": "not mantel"}, status=400)
        hass: HomeAssistant = request.app["hass"]
        discovery_flow.async_create_flow(hass, "mantel", {"source": "hassio"}, HassioServiceInfo(
            config=body["config"], name="Mantel", slug="local_mantel", uuid=str(body.get("uuid") or "e2e")))
        return web.json_response({"ok": True})


async def async_setup(hass: HomeAssistant, config) -> bool:
    hass.http.register_view(Discovery())
    return True
