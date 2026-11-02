"""Rules.md rule 7: every route declares its guard (guards.py).

The whole app is built (with the HA App's Ingress routes and Mantel Connect's, so every route Mantel can serve is
here) and its router walked. Each route either has a ``@guard`` (``handler.__guard__``) or is on the short list
below with the reason it checks its caller its own way. Every guard on a method that changes something names the
audit action it writes, or says why it writes none.
"""
from __future__ import annotations

from mantel_server.guards import UNSAFE, Guard

SIGN_IN = "signing in or setting up the first Owner: no session yet (rate limited, origin-checked)"
APP = "the iPhone app's own routes: a DPoP-bound app credential (app_auth.app_route), not a session"
STATIC = "a static file or page shell any session (or the sign-in page) loads; the data behind it is guarded"
LINKED = "linked mode's endpoint: the linked HK Frontend's Service credential (linked.py), not a session"
PROXY = "the media proxy: its own authorize() (media_proxy.py) checks the session and the service's grant"
PUBLIC = "public on purpose: health and build checks, which the container and the HA App probe signed out"
MCP = "an assistant's endpoint: its own bearer credential (mcp/auth.py: a personal key or a signed-in token), not a session"
MCP_OAUTH = "an assistant's sign-in (mcp/oauth.py): OAuth metadata, registration, a code or refresh token; the consent page asks for the person's own session and CSRF token"

ALLOW = {
    "/api/auth/password": SIGN_IN, "/api/auth/totp/verify": SIGN_IN, "/api/auth/passkey/options": SIGN_IN,
    "/api/auth/passkey/verify": SIGN_IN, "/api/bootstrap": SIGN_IN, "/login": SIGN_IN, "/login/ha": SIGN_IN,
    "/auth/callback": SIGN_IN, "/logout": SIGN_IN, "/ingress/bootstrap": SIGN_IN,
    "/api/bootstrap/restore": "First start's Restore From a Backup: the one-time setup code, checked before the upload "
                              "is read, and only while no Owner exists (backup.api_first_start_restore)",
    "/auth/connection/callback": "Connect to Home Assistant's OAuth return: its signed single-use state, made by an "
                                 "Owner's guarded /api/connections/ha/oauth/start",
    "/app/authorize": "the app's sign-in page: the person signs in there (app_auth.py)",
    "/app/web-session": "the app's web view: a single-use code from its DPoP-bound /api/app/web-session",
    "/api/app/token": APP, "/api/app/hello": APP, "/api/app/web-session": APP, "/api/app/sign-out": APP,
    "/api/app/me": APP, "/api/app/push/register": APP, "/api/app/snap": APP, "/api/app/art": APP,
    "/api/app/summary": APP, "/api/app/favorites": APP, "/api/app/entities": APP, "/api/app/command": APP,
    "/api/app/music": APP, "/api/app/music/command": APP, "/api/app/music/volume": APP,
    "/api/app/music/focus": APP, "/api/app/music/queue": APP, "/api/app/music/queue/play": APP,
    "/api/app/music/library": APP, "/api/app/music/image": APP,
    "/linked/ws": LINKED, "/linked/pair": "linked pairing: the one-time code an Owner started (linked_pairing.py)",
    "/ma": PROXY, "/ma/{tail}": PROXY, "/go2rtc": PROXY, "/go2rtc/{tail}": PROXY,
    "/healthz": PUBLIC, "/api/version": PUBLIC, "/api/proxy-check/basics": PUBLIC,
    "/login/{name}": STATIC, "/webauthn.js": STATIC, "/admin": STATIC, "/admin/{name}": STATIC,
    "/proxy-check/{name}": STATIC, "/manifest.webmanifest": STATIC, "/sw.js": STATIC,
    "/apple-touch-icon.png": STATIC, "/app/art/{name}": STATIC, "/hk/{path}": STATIC, "/web/{path}": STATIC,
    "/static/mdi/{name}": STATIC, "/docs": STATIC, "/docs/": STATIC, "/docs/images/{name}": STATIC,
    "/docs/{page}": STATIC,
    "/mcp": MCP, "/mcp/preview/{code}": "a screen preview: its one-time code (mcp/preview.py) starts a read-only session",
    "/.well-known/oauth-protected-resource": MCP_OAUTH, "/.well-known/oauth-protected-resource/mcp": MCP_OAUTH,
    "/.well-known/oauth-authorization-server": MCP_OAUTH, "/mcp/oauth/register": MCP_OAUTH,
    "/mcp/oauth/authorize": MCP_OAUTH, "/mcp/oauth/token": MCP_OAUTH, "/mcp/oauth/revoke": MCP_OAUTH,
}


def _app(tmp_path):
    from mantel_server.config import Config
    from mantel_server.server import build_app
    from mantel_server.store import Store
    cfg = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", port=0, ingress=True, ingress_peers=(),
                 connect=True, connect_port=0, connect_listen="127.0.0.1")
    store = Store(cfg.data_dir / "mantel.db")
    return build_app(cfg, "unused-fictional-token", store=store, connect_ha=False, clock=lambda: 1_000_000.0), store


def _routes(app):
    for route in app.router.routes():
        if route.method == "HEAD":
            continue
        info = route.resource.get_info() if route.resource is not None else {}
        path = info.get("path") or info.get("formatter") or info.get("prefix")
        yield route.method, path, route.handler


def test_every_route_declares_its_guard_or_why_not(tmp_path):
    app, store = _app(tmp_path)
    try:
        routes = list(_routes(app))
    finally:
        store.db.close()
    assert len(routes) > 230, "every route Mantel can serve is built here"
    missing = [f"{m} {p} ({getattr(h, '__module__', '?')}.{getattr(h, '__qualname__', h)})"
               for m, p, h in routes if getattr(h, "__guard__", None) is None and p not in ALLOW]
    assert not missing, "routes with no @guard and no reason:\n" + "\n".join(missing)
    guarded_and_listed = sorted({p for _, p, h in routes if getattr(h, "__guard__", None) is not None and p in ALLOW})
    assert not guarded_and_listed, f"guarded, so off the list: {guarded_and_listed}"
    stale = sorted(set(ALLOW) - {p for _, p, _ in routes})
    assert not stale, f"no such route any more: {stale}"


def test_no_guarded_route_is_public(tmp_path):
    """A guard leans on the session middleware for 'a session at all' (guards.check, who='signed_in'): a guarded
    route on the middleware's open list would answer anyone."""
    from mantel_server import auth
    app, store = _app(tmp_path)
    try:
        routes = list(_routes(app))
        public = set(auth.PUBLIC_PATHS) | set(app.get("public_paths", ()))
    finally:
        store.db.close()
    open_and_guarded = sorted({p for _, p, h in routes if getattr(h, "__guard__", None) is not None and p in public})
    assert not open_and_guarded, open_and_guarded


def test_every_guard_on_a_change_names_its_audit_or_why_not(tmp_path):
    app, store = _app(tmp_path)
    try:
        routes = list(_routes(app))
    finally:
        store.db.close()
    silent = []
    for method, path, handler in routes:
        spec: Guard | None = getattr(handler, "__guard__", None)
        if spec is None:
            continue
        if method in UNSAFE or method == "*":
            if not spec.audit and not (spec.no_audit and spec.no_audit.strip()):
                silent.append(f"{method} {path}")
    assert not silent, "changes with no audit action and no reason:\n" + "\n".join(silent)


def test_a_guard_spec_refuses_a_contradiction():
    import pytest
    for bad in ({"who": "admin"}, {"who": "owner", "door": "tunnel"}, {"who": "person", "fresh": "away"},
                {"who": "signed_in", "device_ok": False}, {"who": "owner", "audit": ("x",), "no_audit": "why"}):
        with pytest.raises(ValueError):
            Guard(**bad)
    Guard("manager", fresh="away", audit="camera.rtsp.add")      # the cameras' setup: an Admin changes it too (2026-11-02)
