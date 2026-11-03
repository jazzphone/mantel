"""Rules.md rule 7: every route declares its guard (guards.py).

The whole app is built (with the HA App's Ingress routes and Mantel Connect's, so every route Mantel can serve is
here) and its router walked. Each route has a ``@guard`` (``handler.__guard__``) or an ``@open_route``
(``handler.__open__``: the kind of own check it makes and why, guards.py), never both. Every guard on a method that
changes something names the audit action it writes, or says why it writes none. (route_table.py applies the rest of
the rules at start; tests/test_route_table.py runs them.)
"""
from __future__ import annotations

from mantel_server.guards import UNSAFE, Guard, policy_of


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
               for m, p, h in routes if policy_of(h) is None]
    assert not missing, "routes with no @guard and no @open_route:\n" + "\n".join(missing)
    both = sorted({f"{m} {p}" for m, p, h in routes
                   if getattr(h, "__guard__", None) is not None and getattr(h, "__open__", None) is not None})
    assert not both, f"a route is guarded or declared open, not both: {both}"


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
