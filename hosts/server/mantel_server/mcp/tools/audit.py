"""The audit log (the ``audit`` scope): "what changed this week?", and an assistant checking its own work.
Reading it is ``configure`` on the feature ``audit``, the Audit Log page's own rule (gateway.audit_list)."""
from __future__ import annotations

from ..dispatch import ToolError
from . import Tool

KINDS = ("service", "ws", "http", "ma", "config", "system", "tablet")


async def audit_recent(caller, args: dict) -> dict:
    authz = caller.app["authz"]
    if not authz.decide(caller.principal.subject, "configure", None, feature="audit").allowed:
        raise ToolError("forbidden", "reading the audit log is configure on audit (Owners and Admins by default)")
    audit = caller.app.get("audit")
    if audit is None:
        raise ToolError("unavailable", "the audit log is not ready")
    kw = {k: args[k] for k in ("actor", "kind", "since", "until", "before") if k in args}
    if args.get("mine"):
        kw["via"] = caller.via
    elif "via" in args:
        kw["via"] = args["via"]
    rows, nxt = audit.query(limit=args.get("limit", 50), **kw)
    keep = ("id", "timestamp", "actor", "actor_name", "role", "device", "kind", "action", "target", "decision",
            "reason", "door", "result", "via")
    return {"rows": [{k: r.get(k) for k in keep} for r in rows], "next_before": nxt}


TOOLS = [
    Tool("audit_recent", "Recent audit log",
         "Mantel's audit log, newest first: settings and account changes, commands (allowed and denied), who made "
         "them, from where, and through which assistant (`via`). Filter by person (`actor`, a user id), `kind`, time "
         "(`since`/`until`, Unix seconds), `via` ('mcp' every assistant's, '-' none, 'mcp:<name>'), or `mine: true` "
         "for this assistant's own. `before`: the next page.",
         {"actor": {"type": "string", "maxLength": 64}, "kind": {"type": "string", "enum": list(KINDS)},
          "since": {"type": "number"}, "until": {"type": "number"}, "via": {"type": "string", "maxLength": 70},
          "mine": {"type": "boolean"}, "before": {"type": "integer", "minimum": 1},
          "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 50}},
         audit_recent, needs="audit"),
]
