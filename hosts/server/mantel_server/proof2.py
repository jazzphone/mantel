"""Offline-only command proof. No transport, credentials, or live execution path."""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass

from aiohttp import web

from .auth import SESSION_COOKIE

PATH = "/api/proof2/command"
ACTION = "light.turn_on"
TARGET = "light.proof2_demo"
COMMAND = {"dry_run": True, "cmd": ACTION, "target": TARGET}


@dataclass(frozen=True)
class Grant:
    role: str
    action: str
    target: str
    effect: str


PROOF_GRANTS = (Grant("owner", ACTION, TARGET, "allow"),)


def decide(role: str, grants: tuple[Grant, ...] = PROOF_GRANTS) -> str:
    """Exact proof resource only; no wildcard or implicit role privileges."""
    matching = [g for g in grants if (g.role, g.action, g.target) == (role, ACTION, TARGET)]
    if any(g.effect == "deny" for g in matching):
        return "explicit_deny"
    return "granted" if any(g.effect == "allow" for g in matching) else "no_grant"


async def command(request: web.Request) -> web.Response:
    """Resolve identity here so missing/expired sessions also receive an audit record."""
    store = request.app["store"]
    now = request.app["clock"]()
    user = store.get_session(request.cookies.get(SESSION_COOKIE), now)
    reason = "unauthenticated"
    status = 401
    action = target = None
    # loopback_only has already checked Host and any supplied Origin. Require Origin too.
    if request.headers.get("Origin") is None:
        reason, status = "origin_required", 403
    else:
        try:
            msg = await request.json()
        except (ValueError, UnicodeError):
            msg = None
        # Never persist arbitrary client data (which might contain credentials).
        if isinstance(msg, dict):
            action = ACTION if msg.get("cmd") == ACTION else None
            target = TARGET if msg.get("target") == TARGET else None
        if user is not None:
            if (not isinstance(msg, dict) or set(msg) != set(COMMAND)
                    or msg.get("dry_run") is not True or msg != COMMAND):
                reason, status = "unsupported_command", 400
            else:
                reason = decide(user["role"])
                status = 200 if reason == "granted" else 403
    decision = "allowed" if status == 200 else "denied"
    try:
        audit_id = store.audit_command(
            timestamp=now, actor=user["ha_user_id"] if user else None,
            role=user["role"] if user else None, action=action, target=target,
            decision=decision, reason=reason, source_ip=request.remote)
    except sqlite3.Error:
        return web.json_response({"dry_run": True, "executed": False, "error": "audit_unavailable"}, status=503)
    return web.json_response({"dry_run": True, "executed": False, "decision": decision,
                              "reason": reason, "audit_id": audit_id}, status=status)
