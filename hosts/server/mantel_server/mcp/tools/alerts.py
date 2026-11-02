"""System alerts and the update check (docs/phase14/SYSTEM-ALERTS.md "MCP"): what Mantel raised lately, whether
there's an update, and a test message to one alert channel. Owners and Admins only, as Mantel Settings → Alerts.
``alerts_test`` sends a real message, so it counts as a change: planned first, audited before it goes, the Owner's."""
from __future__ import annotations

from ... import dry_run
from ..dispatch import ToolError, change
from . import Tool


def _alerts(caller):
    if caller.user is None or caller.user.role not in ("owner", "admin"):
        raise ToolError("forbidden", "system alerts are for Owners and Admins (Mantel Settings → Alerts)")
    got = caller.app.get("alerts")
    if got is None:
        raise ToolError("unavailable", "system alerts are not ready")
    return got


async def alerts_recent(caller, args: dict) -> dict:
    a = _alerts(caller)
    group = args.get("group")
    keep = ("at", "kind", "key", "group", "level", "up", "title", "body", "sent_to")
    names = {c["id"]: c["name"] for c in a.channels.all()} | {"app": "Mantel apps"}
    rows = [{k: r.get(k) for k in keep} | {"sent_to": [names.get(x, x) for x in r["sent_to"]]}
            for r in a.log.recent(args.get("limit", 50), group)]
    return {"active": a.center.active(), "log": rows,
            "channels": [{"id": c["id"], "kind": c["kind"], "name": c["name"], "enabled": c["enabled"],
                          "last_ok": c.get("last_ok"), "last_error": c.get("last_error")} for c in a.channels.all()]}


async def updates_status(caller, args: dict) -> dict:
    a = _alerts(caller)
    if a.updates is None:
        raise ToolError("unavailable", "the update check is not ready")
    return a.updates.public()


async def alerts_test(caller, args: dict) -> dict:
    a = _alerts(caller)
    if caller.user.role != "owner":
        raise ToolError("owner_only", "only the Owner sends to the alert channels (Mantel Settings → Alerts)")
    ch = a.channels.get(args["channel"])
    if ch is None:
        raise ToolError("not_found", "no alert channel with that id (alerts_recent lists them)")

    async def run():
        if dry_run.active():
            return {"would": f"send a test message to {ch['name']} ({ch['kind']})"}
        failed = await a.test(ch)
        if failed is not None:
            raise ToolError("send_failed", failed)
        return {"sent": True, "channel": ch["name"]}
    return await change(caller, "alerts_test", args, run)


TOOLS = [
    Tool("alerts_recent", "Recent system alerts",
         "Mantel's own alerts (Home Assistant disconnected, a backup failed, a tablet offline, an update): what is up "
         "now, the last 30 days of raises and clears newest first (`up` false is \"back\"), and which channels took "
         "each. Filter by `group`. Owners and Admins.",
         {"group": {"type": "string", "enum": ["connections", "backups", "tablets", "mantel", "updates", "security"]},
          "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 50}},
         alerts_recent),
    Tool("updates_status", "Update check",
         "Whether Mantel, Mantel Link or HK Frontend has a newer release on GitHub than the one installed, when it "
         "was last checked, and how to update this install. Owners and Admins.",
         {}, updates_status),
    Tool("alerts_test", "Test an alert channel",
         "Send a real test message to one of Mantel Settings → Alerts' channels (its `id` from alerts_recent). It "
         "counts as a change: plan it, then apply. The Owner's.",
         {"channel": {"type": "string", "maxLength": 32}}, alerts_test, needs="settings", required=("channel",),
         write=True, idempotent=True),
]
