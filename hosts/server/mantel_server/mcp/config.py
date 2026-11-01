"""The house's switches for assistants (Mantel Settings → Advanced → Assistants (MCP)).

Kept in the ``server_settings`` table beside General's (server_settings.py), under keys of their own:

=====================  =========  ===============================================================================
key                    default    what it does
=====================  =========  ===============================================================================
``mcp_enabled``        off        ``/mcp`` answers at all. Off, every credential is refused (and kept).
``mcp_away``           off        an assistant that SIGNED IN (OAuth) and was allowed "from away" may be used on
                                  the tunnel door. Personal keys are home-network only, always.
``mcp_commands``       off        the ``commands`` scope may be given at all (on a sign-in, never a key), and is
                                  honoured: house commands through the gateway, as a page's. Allow Control of
                                  the House (General) must be on too.
``mcp_write_rate``     60         changes per minute per assistant (plans don't count; reads have their own,
                                  higher ceiling, READS_PER_MINUTE).
``mcp_key_days``       30         how long a new personal key lasts (1 to 365).
=====================  =========  ===============================================================================

Only an Owner changes them, with a fresh factor away from home (connections.edit_rule's rule, as General's), and
every change is audited before it is made.
"""
from __future__ import annotations

import json
from typing import Any

DEFAULTS: dict[str, Any] = {"mcp_enabled": False, "mcp_away": False, "mcp_commands": False, "mcp_write_rate": 60,
                            "mcp_key_days": 30}
WRITE_RATE = (1, 600)
KEY_DAYS = (1, 365)
READS_PER_MINUTE = 600


class Invalid(ValueError):
    pass


def clean(key: str, value: Any) -> Any:
    if key in ("mcp_enabled", "mcp_away", "mcp_commands"):
        if not isinstance(value, bool):
            raise Invalid("on or off")
        return value
    if key == "mcp_write_rate":
        if isinstance(value, bool) or not isinstance(value, int) or not WRITE_RATE[0] <= value <= WRITE_RATE[1]:
            raise Invalid(f"changes per minute, from {WRITE_RATE[0]} to {WRITE_RATE[1]}")
        return value
    if key == "mcp_key_days":
        if isinstance(value, bool) or not isinstance(value, int) or not KEY_DAYS[0] <= value <= KEY_DAYS[1]:
            raise Invalid(f"days, from {KEY_DAYS[0]} to {KEY_DAYS[1]}")
        return value
    raise Invalid("not a setting")


class McpSettings:
    """``app["mcp_settings"]``: read at each use, so a change applies to the very next request."""

    def __init__(self, db, clock) -> None:
        self.db = db
        self.clock = clock

    def get(self, key: str) -> Any:
        try:
            row = self.db.execute("SELECT value FROM server_settings WHERE key = ?", (key,)).fetchone()
        except Exception:  # noqa: BLE001 -- a bare test database: the defaults (off)
            row = None
        if row is None:
            return DEFAULTS[key]
        try:
            return clean(key, json.loads(row["value"]))
        except (Invalid, ValueError, TypeError):
            return DEFAULTS[key]                      # an unreadable row never turns anything on

    def all(self) -> dict[str, Any]:
        return {k: self.get(k) for k in DEFAULTS}

    def put(self, key: str, value: Any, by: str | None) -> Any:
        value = clean(key, value)
        with self.db:
            self.db.execute("INSERT INTO server_settings (key, value, source, set_by, updated) VALUES (?,?,?,?,?) "
                            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, source = excluded.source, "
                            "set_by = excluded.set_by, updated = excluded.updated",
                            (key, json.dumps(value), "settings", by, self.clock()))
        return value

    @property
    def enabled(self) -> bool:
        return bool(self.get("mcp_enabled"))
