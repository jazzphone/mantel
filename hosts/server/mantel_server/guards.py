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
    Owner routes, and a manager's where an Admin may change it too: the cameras' setup); ``always``: a fresh factor within the step-up window (``accounts.require_fresh``);
    ``add_factor``: what adding a sign-in method asks (``accounts.require_fresh_to_add_factor``: HA's trusted
    sidebar counts as fresh).
``audit``
    The action name (or names) the handler writes with :func:`audit.config`, before its change. A guard on POST,
    PUT, PATCH or DELETE that writes nothing says why instead (``no_audit="..."``).
``first``
    A check of the request itself (a passkey's origin, a connection's kind) made before the fresh factor is asked
    for, so a page that could never do this is told so first.
``reads`` (phase 18, the route table)
    What a read may show, required on every GET and on a change that answers with house data: ``view`` (each
    entity, camera, speaker or photo in the answer passes ``authz`` for this person), ``feature:<name>`` (the RBAC
    feature grant), ``self`` (only the caller's own records), ``admin`` (settings no entity keys; never with
    ``signed_in``), ``none`` (carries no house data; ``why=`` says so).
``stream``
    ``none`` (the default: a whole answer), ``bounded:<cap>`` (capped in bytes or seconds, the cap stated), or
    ``live:<kind>`` (in ``live.py``'s registry, rechecked, closed on revocation; ``live.KINDS`` names the kinds).
``preview``
    True when a read-only screen preview (``mcp/preview.py``) may fetch it; ``"<parameter>=<regex>"`` when only
    some values of a path parameter (a photo's screen sizes, not its original). Only a GET; never ``reads="admin"``.
``sample``
    A path that reaches this route, for the table's checks, when its parameters need more than a word.

A route that is not called with a session (sign-in, the app's DPoP routes, Mantel Link, an assistant's ``/mcp`` and
its OAuth, the media proxy, static files, health) says so with :func:`open_route` instead: its ``kind`` and why.
``route_table.py`` builds one table from both at start and refuses to start when a route has neither
(docs/development/Routes.md is that table).

A refusal is 403 with a JSON ``error``: ``forbidden`` (a tablet, or not a manager), ``user_required`` (``person``
with no person), ``owner_only``, ``home_door_only``, ``lan_only``, ``step_up_required``; CSRF as the session
middleware checks it. The handler reads the checked identity with :func:`ident`.
"""
from __future__ import annotations

import functools
import re
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from aiohttp import web

WHO = ("signed_in", "person", "manager", "owner")
READS = ("view", "self", "admin", "none")          # and "feature:<name>"
# an own-check route's kind (open_route): what checks its caller instead of a session
OPEN_KINDS = ("sign_in", "app_dpop", "link_credential", "one_time_code", "proxy", "mcp_bearer", "oauth", "static",
              "public")
# the kinds whose answer never carries house data: a GET of one reads "none" unless it says otherwise
OPEN_READS_NONE = frozenset({"sign_in", "oauth", "static", "public"})
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
    reads: str | None = None
    why: str | None = None
    stream: str = "none"
    preview: bool | str = False
    sample: str | None = None

    def __post_init__(self) -> None:
        if self.who not in WHO or self.door not in DOORS or self.fresh not in FRESH:
            raise ValueError(f"bad guard {self}")
        _check_columns(self)
        if self.who == "signed_in" and self.reads == "admin":
            raise ValueError("reads='admin' is settings no entity keys: never for any session (who='signed_in')")
        if self.fresh == "away" and self.who not in ("owner", "manager"):
            raise ValueError("fresh='away' is the Owner's or a manager's rule (connections.edit_rule)")
        if self.who == "signed_in" and not self.device_ok:
            raise ValueError("who='signed_in' takes any session: device_ok=True")
        if self.audit and self.no_audit:
            raise ValueError("a guard names its audit action or why it has none, not both")


def _check_columns(spec: Any) -> None:
    """The columns a session route and an own-check route share (route_table.py, rules R2, R4, R6)."""
    reads = spec.reads
    if reads is not None and reads not in READS and not (reads.startswith("feature:") and len(reads) > 8):
        raise ValueError(f"reads={reads!r}: view, self, admin, none or feature:<name>")
    if reads == "none" and not (spec.why and spec.why.strip()):
        raise ValueError("reads='none' says why the answer carries no house data (why=...)")
    stream = spec.stream
    if not (stream == "none" or (stream.startswith(("bounded:", "live:")) and stream.split(":", 1)[1].strip())):
        raise ValueError(f"stream={stream!r}: none, bounded:<cap> or live:<kind>")
    if spec.preview and reads == "admin":
        raise ValueError("a screen preview never reads settings (preview with reads='admin')")
    if isinstance(spec.preview, str) and not re.fullmatch(r"[a-z_]+=.+", spec.preview):
        raise ValueError("preview: True, or '<parameter>=<regex>' (only the values a screen draws)")


@dataclass(frozen=True)
class OpenRoute:
    """A route not called with a session: its own check (``kind``) and why (Rules.md rule 7)."""
    kind: str
    why: str
    reads: str | None = None
    stream: str = "none"
    preview: bool = False
    sample: str | None = None

    def __post_init__(self) -> None:
        if self.kind not in OPEN_KINDS:
            raise ValueError(f"open_route kind {self.kind!r}: one of {OPEN_KINDS}")
        if not (self.why and self.why.strip()):
            raise ValueError("an own-check route says why (why=...)")
        if self.reads is None and self.kind in OPEN_READS_NONE:
            object.__setattr__(self, "reads", "none")
        _check_columns(self)


def open_route(kind: str, *, why: str, reads: str | None = None, stream: str = "none", preview: bool = False,
               sample: str | None = None) -> Callable[[Handler], Handler]:
    """Declare a route that checks its caller its own way (module notes): it runs nothing, it only says so, where
    route_table.py finds it (``handler.__open__``)."""
    spec = OpenRoute(kind, why, reads, stream, preview, sample)

    def mark(handler: Handler) -> Handler:
        handler.__open__ = spec  # type: ignore[attr-defined]
        return handler

    return mark


# the reasons shared by a kind's routes (``open_route(kind, why=...)``); a route with its own reason says it
WHY_SIGN_IN = "signing in or setting up the first Owner: no session yet (rate limited, origin-checked)"
WHY_APP = "the iPhone app's own routes: a DPoP-bound app credential (app_auth.app_route), not a session"
WHY_STATIC = "a static file or page shell any session (or the sign-in page) loads; the data behind it is guarded"
WHY_LINKED = "linked mode's endpoint: the linked HK Frontend's Service credential (linked.py), not a session"
WHY_PROXY = "the media proxy: its own authorize() (media_proxy.py) checks the session and the service's grant"
WHY_PUBLIC = "public on purpose: health and build checks, which the container and the HA App probe signed out"
WHY_MCP = ("an assistant's endpoint: its own bearer credential (mcp/auth.py: a personal key or a signed-in token), "
           "not a session")
WHY_MCP_OAUTH = ("an assistant's sign-in (mcp/oauth.py): OAuth metadata, registration, a code or refresh token; the "
                 "consent page asks for the person's own session and CSRF token")


def _refuse(code: str) -> web.HTTPForbidden:
    return web.HTTPForbidden(text=f'{{"error":"{code}"}}', content_type="application/json",
                             headers={"Cache-Control": "no-store"})


def check(request: web.Request, spec: Guard) -> Any:
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
    if getattr(ident, "read_only", False) and request.method in UNSAFE:
        raise _refuse("read_only")                  # a screen preview an assistant opened (mcp/preview.py)
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
        if edit_rule(request, ident, admins=spec.who == "manager") != "ok":
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
          first: Callable[[web.Request], Any] | None = None, reads: str | None = None, why: str | None = None,
          stream: str = "none", preview: bool | str = False, sample: str | None = None) -> Callable[[Handler], Handler]:
    """Declare and enforce a route's guard (module notes). ``audit`` may name several actions (a handler that
    writes one row per thing it changes) or a prefix ending in ``.`` (``user_files.upload.``: one per kind).
    ``first(request)`` checks the request itself before the fresh factor is asked for (a page that can never do
    this, such as a passkey from an address that cannot hold one, is told so first); it raises to refuse."""
    spec = Guard(who, door, fresh, who == "signed_in" if device_ok is None else device_ok,
                 (audit,) if isinstance(audit, str) else tuple(audit or ()), no_audit, first, reads, why, stream,
                 preview, sample)

    def wrap(handler: Handler) -> Handler:
        @functools.wraps(handler)
        async def guarded(request: web.Request) -> web.StreamResponse:
            request[_KEY] = check(request, spec)
            return await handler(request)

        guarded.__guard__ = spec  # type: ignore[attr-defined]
        guarded.__guard_of__ = guarded  # type: ignore[attr-defined]  # wraps copies __guard__; never this
        return guarded

    return wrap


def ident(request: web.Request) -> Any:
    """The identity the route's guard checked. A handler reached without its guard fails closed."""
    got = request.get(_KEY)
    if got is None:
        raise RuntimeError("guards.ident: this handler was called without its guard")
    return got


def spec_of(handler: Any) -> Guard | None:
    return getattr(handler, "__guard__", None)


def policy_of(handler: Any) -> Guard | OpenRoute | None:
    """A route's declaration: its ``@guard`` or its ``@open_route`` (a handler with both is refused by the table)."""
    return getattr(handler, "__guard__", None) or getattr(handler, "__open__", None)
