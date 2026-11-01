"""Mantel's MCP server: an assistant that can read the house, change settings and build screens, safely
(docs/phase12/MCP-SERVER.md).

**MCP is another door, not another way in.** Nothing here holds authority of its own: a tool call becomes the
frame a page would send (dispatch.py), checked by the same code, as the same person (auth.py), recorded in the same
audit log and settings history with ``via = mcp:<assistant>``. Off by default (Mantel Settings → Advanced →
Assistants).

==================  =================================================================================================
module              what it is
==================  =================================================================================================
config.py           the house's switches (on, from away, commands, rate, key lifetime)
grants.py           a credential: a person's ``mcp`` session plus its ceiling (scopes); personal keys
auth.py             who is calling ``/mcp``: the bearer, its door, its person, its scopes; rate limits
protocol.py         ``/mcp``: Streamable HTTP, both eras (2026-07-28 stateless; 2025-11-25..2025-03-26 initialize)
dispatch.py         a tool call as a page's read / save / command; plan, then apply
plans.py            the signed plan handle (no session to keep it in)
tools/              the tools, one module per area
resources.py        resources and prompts
oauth.py            signing an assistant in: OAuth 2.1 + PKCE, registration, consent, tokens, revocation
preview.py          a screen's read-only preview link
admin.py            the REST behind Mantel Settings' page
==================  =================================================================================================
"""
from __future__ import annotations

from aiohttp import web


def register(app: web.Application) -> None:
    """After sessions, authz and the settings store exist (server.build_app's wire)."""
    from . import admin, oauth, preview, protocol
    from .config import McpSettings
    from .grants import Grants
    from .plans import Plans
    app["mcp_settings"] = McpSettings(app["store"].db, lambda: app["clock"]())
    app["mcp_grants"] = Grants(app["store"].db, app["sessions"], lambda: app["clock"]())
    app["mcp_plans"] = Plans(lambda: app["clock"]())
    protocol.register(app)
    oauth.register(app)
    preview.register(app)
    admin.register(app)
