"""Every route declares its guard (Rules.md rule 7).

A REST handler says who may call it, from which door, how fresh their sign-in must be, whether a wall tablet's
session may call it, and what it writes to the audit log::

    @guard(who="owner", door="home", fresh="never", audit="service_account.create")
    async def api_create(request): ...

The decorator runs the checks before the handler and stores its spec on the handler (``handler.__guard__``), where
``tests/test_route_guards.py`` finds it: every route Mantel serves has one, or is on that test's short list of
routes with their own check (the app's DPoP routes, ``/linked/*``, sign-in, the media proxy, static files), and
every guard on a method that changes something names its audit action or says why it writes none.

The checks are the ones the routes made by hand before, kept where they were:

``who``
    ``signed_in``  any session (a person, a wall tablet, or a person at a tablet): the session middleware's own
                   check (``auth.require_session``), so the roles inside the handler decide the rest;
    ``person``     a person (``accounts.require_user``);
    ``manager``    an Owner or Admin (``accounts.require_manager``'s rule);
    ``owner``      an Owner.
``device_ok``
    False (the default): a session at a wall tablet is refused, even an Owner's: a forgotten sign-in on the
    kitchen tablet must not manage the house (People-and-Roles.md). True: the tablet's own session, or a person at
    it, may call it. ``signed_in`` implies True.
``door``
    ``any``; ``home``: the LAN door, or HA's sidebar when it has the home rules (``authz.home_door``: the HA App
    has no LAN door); ``lan``: the LAN door only.
``fresh``
    ``never``; ``away``: a fresh factor unless on the LAN door or a trusted HA sidebar (``connections.edit_rule``,
    Owner routes only); ``always``: a fresh factor within the step-up window (``accounts.require_fresh``);
    ``add_factor``: what adding a sign-in method asks (``accounts.require_fresh_to_add_factor``: HA's trusted
    sidebar counts as fresh).
``audit``
    The action name (or names) the handler writes with :func:`audit.config`, before its change. A guard on POST,
    PUT, PATCH or DELETE that writes nothing says why instead (``no_audit="..."``).
``first``
    A check of the request itself (a passkey's origin, a connection's kind) made before the fresh factor is asked
    for, so a page that could never do this is told so first.

A refusal is 403 with a JSON ``error``: ``forbidden`` (a tablet, or not a manager), ``user_required`` (``person``
with no person), ``owner_only``, ``home_door_only``, ``lan_only``, ``step_up_required``; CSRF as the session
middleware checks it. The handler reads the checked identity with :func:`ident`.
"""
from __future__ import annotations

import functools
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from aiohttp import web

WHO = ("signed_in", "person", "manager", "owner")
DOORS = ("any", "home", "lan")
FRESH = ("never", "away", "always", "add_factor")
UNSAFE = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_KEY = "mantel.guard.ident"

Handler = Callable[[web.Request], Awaitable[web.StreamResponse]]


@dataclass(frozen=True)
class Guard:
    who: str
    door: str = "any"
    fresh: str = "never"
    device_ok: bool = False
    audit: tuple[str, ...] = ()
    no_audit: str | None = None
    first: Callable[[web.Request], Any] | None = field(default=None, compare=False, repr=False)

    def __post_init__(self) -> None:
        if self.who not in WHO or self.door not in DOORS or self.fresh not in FRESH:
            raise ValueError(f"bad guard {self}")
        if self.fresh == "away" and self.who != "owner":
            raise ValueError("fresh='away' is the Owner's rule (connections.edit_rule)")
        if self.who == "signed_in" and not self.device_ok:
            raise ValueError("who='signed_in' takes any session: device_ok=True")
        if self.audit and self.no_audit:
            raise ValueError("a guard names its audit action or why it has none, not both")


def _refuse(code: str) -> web.HTTPForbidden:
    return web.HTTPForbidden(text=f'{{"error":"{code}"}}', content_type="application/json",
                             headers={"Cache-Control": "no-store"})


def check(request: web.Request, spec: Guard):
    """Run ``spec``'s checks for ``request``; the identity, or a 401/403 raised."""
    from . import sessions
    from .accounts import MANAGERS, require_fresh, require_fresh_to_add_factor, require_user
    ident = sessions.identity(request)
    if spec.who == "signed_in" and spec.door == "any" and spec.fresh == "never" and spec.first is None:
        # nothing beyond the session middleware's own check (auth.require_session: every route that is not public
        # needs a session; test_route_guards checks no guarded route is public), so a module's routes in a bare
        # test app, with its own stand-in for the roles, still answer
        return ident
    if not ident.authenticated:
        raise web.HTTPUnauthorized(text="sign in at /login")
    if ident.device is not None and not spec.device_ok:
        raise _refuse("forbidden")
    if spec.who != "signed_in":
        if spec.who == "person":
            require_user(request)
        elif ident.user is None:
            raise _refuse("forbidden")
        elif spec.who == "manager" and ident.user.role not in MANAGERS:
            raise _refuse("forbidden")
        elif spec.who == "owner" and ident.user.role != "owner":
            raise _refuse("owner_only")
    if spec.door == "lan" and ident.door != "lan":
        raise _refuse("lan_only")
    if spec.door == "home":
        authz = request.app.get("authz")
        if not (ident.door == "lan" or (authz is not None and authz.home_door(ident))):
            raise _refuse("home_door_only")
    if spec.first is not None:
        spec.first(request)         # the request's own check (its origin, its kind), before asking for a fresh factor
    if spec.fresh == "away":
        from .connections import edit_rule
        if edit_rule(request, ident) != "ok":
            raise _refuse("step_up_required")
    elif spec.fresh == "always":
        require_fresh(request, ident)
    elif spec.fresh == "add_factor":
        require_fresh_to_add_factor(request, ident)
    if request.method in UNSAFE and request.path.startswith("/api/"):
        sessions.check_csrf(request, ident)       # as the session middleware does, for an app without it
    return ident


def guard(who: str, *, door: str = "any", fresh: str = "never", device_ok: bool | None = None,
          audit: str | tuple[str, ...] | None = None, no_audit: str | None = None,
          first: Callable[[web.Request], Any] | None = None) -> Callable[[Handler], Handler]:
    """Declare and enforce a route's guard (module notes). ``audit`` may name several actions (a handler that
    writes one row per thing it changes) or a prefix ending in ``.`` (``user_files.upload.``: one per kind).
    ``first(request)`` checks the request itself before the fresh factor is asked for (a page that can never do
    this, such as a passkey from an address that cannot hold one, is told so first); it raises to refuse."""
    spec = Guard(who, door, fresh, who == "signed_in" if device_ok is None else device_ok,
                 (audit,) if isinstance(audit, str) else tuple(audit or ()), no_audit, first)

    def wrap(handler: Handler) -> Handler:
        @functools.wraps(handler)
        async def guarded(request: web.Request) -> web.StreamResponse:
            request[_KEY] = check(request, spec)
            return await handler(request)

        guarded.__guard__ = spec
        return guarded

    return wrap


def ident(request: web.Request):
    """The identity the route's guard checked. A handler reached without its guard fails closed."""
    got = request.get(_KEY)
    if got is None:
        raise RuntimeError("guards.ident: this handler was called without its guard")
    return got


def spec_of(handler: Any) -> Guard | None:
    return getattr(handler, "__guard__", None)
