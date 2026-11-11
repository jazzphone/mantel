"""The one way a settings or account change is written to the audit log (Rules.md rule 3 and rule 7).

:func:`config` writes the change's ``config`` row (the gateway's ``Audit.config_event``) **before** the change is
made: who (the person, and the device they are at), what (``action``), what changes (``detail``), and where it came
from (the door and the source address). If the row cannot be written the change is refused: the route answers 503
``audit_unavailable`` (:class:`Unavailable`, raised) and changes nothing. An app with no audit wired (a bare test
app) records nothing, as before.

``detail`` never holds a password, a hash, a token or a PIN. The Audit Log page (Settings → Audit Log) reads the
``action`` and the JSON ``detail``; their names and shapes are the ones each module wrote before this helper.

Sign-ins are deliberately not audited (accounts.py's module notes): a failed sign-in needs no account, and every row
is kept for the retention window, so anyone who can reach the sign-in page could fill the log with their own words.
"""
from __future__ import annotations

import logging
from typing import Any

from aiohttp import web

from . import dry_run

log = logging.getLogger(__name__)


class Unavailable(web.HTTPServiceUnavailable):
    """503 ``audit_unavailable``: the audit row could not be written, so nothing was changed."""

    def __init__(self) -> None:
        super().__init__(text='{"error":"audit_unavailable"}', content_type="application/json",
                         headers={"Cache-Control": "no-store"})


def event(request: web.Request | None, ident: Any, action: str, detail: Any, *, app: web.Application | None = None,
          reason: str | None = None) -> dict:
    """The row :func:`config` writes. ``ident`` is a ``sessions.Identity`` or a screen socket's ``authz.Principal``,
    or a bare person (``sessions.User``: code that is handed only the person, such as ``ingress.link_tablet``), or
    None (a change made by Mantel itself, or by a peer with no session); the source address is the request's, else
    the principal's."""
    from .identity.sessions import client_ip
    app = app if app is not None else request.app
    bare = ident is not None and not hasattr(ident, "user") and hasattr(ident, "role")
    user = ident if bare else getattr(ident, "user", None)
    device = None if bare else getattr(ident, "device", None)
    row = {"timestamp": app["clock"](), "actor": user.id if user else None, "role": user.role if user else None,
           "device": device.id if device else None, "device_role": device.role if device else None,
           "action": action, "detail": detail, "door": getattr(ident, "door", None), "via": _via(ident),
           "source_ip": client_ip(request) if request is not None else getattr(ident, "source_ip", None)}
    if reason is not None:
        row["reason"] = reason
    return row


def _via(ident: Any) -> str | None:
    """``mcp:<client>`` when an assistant acts for the person (sessions.Identity.via; a Principal's identity's)."""
    got = getattr(ident, "via", None)
    if got is None:
        got = getattr(getattr(ident, "identity", None), "via", None)
    return got if isinstance(got, str) and got else None


def config(request: web.Request | None, ident: Any, action: str, detail: Any, *,
           app: web.Application | None = None, reason: str | None = None) -> None:
    """Write ``action``'s audit row before the change. Raises :class:`Unavailable` (503 ``audit_unavailable``)
    when it cannot be written: the caller makes no change. ``app`` is for a caller with no request (a screen's
    socket passes its request, a background task its app)."""
    app = app if app is not None else request.app
    audit = app.get("audit")
    if audit is None or dry_run.active():         # a plan (dry_run.py) changes nothing: there is nothing to record
        return
    try:
        audit.config_event(event(request, ident, action, detail, app=app, reason=reason))
    except Exception:  # noqa: BLE001 -- no audit, no change
        log.exception("could not audit %s; change refused", action)
        raise Unavailable() from None
