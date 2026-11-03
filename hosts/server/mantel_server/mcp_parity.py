"""MCP parity (phase 18, A6): an assistant's tool is never easier to use than the REST route it parallels.

The third audit found the same bug five times (SRV-1, 2, 3, 6, 8): an assistant's door granted what the REST route
refused. So a write tool (``mcp/tools/``) names the route it parallels (``like="POST /api/screens"``), or says why
there is none (``no_route=``: most tools are a page's socket frame, given to the very function that frame calls,
mcp/dispatch.py), and declares its own rule: ``who``, ``door`` and ``fresh``, which :func:`check` enforces on every
call before the tool runs. ``route_table`` (R10) compares the two with :func:`looser`.

How an assistant's credential meets a REST rule:

* ``who``: every assistant acts for an Owner or Admin (mcp/auth.py checks the role on every request), so a tool's
  floor is ``manager``; ``owner`` where the route is the Owner's.
* ``door``: a personal key works on the LAN door only; a signed-in token from either. A route on the ``home`` or
  ``lan`` door is a tool with ``door="lan"``.
* ``fresh``: an assistant has no fresh factor of its own (the consent asked for one once, SRV-1). A route that asks
  for one away from home (``away``) is a tool used on the LAN door only; a route that asks for one every time
  (``always``, ``add_factor``) has no tool (decision 4: if a tool can't be as strict, it goes).
"""
from __future__ import annotations

from typing import Any

WHO_RANK = {"signed_in": 0, "person": 1, "manager": 2, "owner": 3}
TOOL_WHO = ("manager", "owner")
TOOL_DOORS = ("any", "lan")
TOOL_FRESH = ("never",)


def looser(tool: Any, row: Any) -> str | None:
    """Why ``tool`` is easier to use than the route ``row`` (a route_table.Row), or None."""
    g = row.guard
    if g is None:
        return None if row.open is not None and row.open.kind != "sign_in" else "parallels a route with no rule"
    who, door = getattr(tool, "who", "manager"), getattr(tool, "door", "any")
    if WHO_RANK[who] < WHO_RANK[g.who]:
        return f"who={who}, the route's {g.who}"
    if g.door in ("home", "lan") and door != "lan":
        return f"door={door}, the route's {g.door}: a tool is LAN only there"
    if g.fresh == "away" and door != "lan":
        return "the route asks for a fresh factor away from home: a tool is LAN only"
    if g.fresh in ("always", "add_factor"):
        return f"the route asks for a fresh factor ({g.fresh}): no assistant has one, so no tool"
    return None


def check(tool: Any, caller: Any) -> None:
    """Enforce a tool's own rule (who, door) for this call, before it runs: what :func:`looser` compared."""
    from .mcp.dispatch import ToolError
    who, door = getattr(tool, "who", "manager"), getattr(tool, "door", "any")
    role = getattr(caller.user, "role", None)
    if who == "owner" and role != "owner":
        raise ToolError("owner_only", f"{tool.name} is the Owner's, as in Mantel Settings")
    if who == "manager" and role not in ("owner", "admin"):
        raise ToolError("forbidden", f"{tool.name} is an Owner's or Admin's")
    if door == "lan" and caller.door != "lan":
        raise ToolError("lan_only", f"{tool.name} works from home only (Mantel Settings asks for a fresh sign-in "
                                    "away from home, and an assistant has none)")
