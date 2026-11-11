"""Phase 18, Part A: one route table (route_table.py), built from each handler's ``@guard`` or ``@open_route``.

The app is built under every combination of the options that add routes (tools/route_table.py COMBOS) and the
rules R1-R12 applied; the generated docs/development/Routes.md and tests/fixtures/route_table.lock.json must be
fresh (``tools/route_table.py --write``).
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _tool():
    spec = importlib.util.spec_from_file_location("route_table_tool", ROOT / "tools/route_table.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules.setdefault("route_table_tool", mod)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def rendered():
    return _tool().render()


def test_the_lock_and_routes_md_are_fresh(rendered):
    lock_text, doc_text, _ = rendered
    tool = _tool()
    assert tool.LOCK.read_text() == lock_text, "stale lock: run tools/route_table.py --write"
    assert tool.DOC.read_text() == doc_text, "stale Routes.md: run tools/route_table.py --write"


def test_every_combination_of_options_builds_a_table_that_holds(rendered):
    _, _, found = rendered
    gaps = sorted({p for ps in found.values() for p in ps})
    assert not gaps, "the route table refuses:\n" + "\n".join(gaps)


def test_the_union_has_every_route_any_combination_adds(rendered):
    lock_text, _, _ = rendered
    table = json.loads(lock_text)
    assert len(table) >= 290
    for key in ("GET /ingress/bootstrap", "DELETE /api/connect/pairings/{id}", "GET /healthz"):
        assert key in table, key


def test_a_sample_path_fills_each_parameter_as_its_pattern_asks():
    from mantel_server.route_table import sample_path
    assert sample_path("/api/users/{id}", r"/api/users/(?P<id>[^{}/]+)") == "/api/users/sample"
    assert sample_path("/{seg}/{view}", r"/(?P<seg>[A-Za-z0-9_]+-[A-Za-z0-9_-]*)/(?P<view>[A-Za-z0-9_-]+)") == "/a-b/sample"
    assert sample_path("/api/photos/{photo}/{size}",
                       r"/api/photos/(?P<photo>[0-9a-f]{32})/(?P<size>original|screen|mid|thumb|mask)") \
        == f"/api/photos/{'0' * 32}/thumb"
    assert sample_path("/hk/{path}", r"/hk/(?P<path>.+)") == "/hk/sample"


# -- the start refuses (decision 2) -----------------------------------------------------------------------------------
def _build(tmp_path):
    from mantel_server.config import Config
    from mantel_server.server import build_app
    from mantel_server.store import Store
    cfg = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", port=0)
    store = Store(cfg.data_dir / "mantel.db")
    try:
        return build_app(cfg, "unused-fictional-token", store=store, connect_ha=False, clock=lambda: 1_000_000.0)
    finally:
        store.db.close()


def _refused(tmp_path, rule: str, route: str):
    from mantel_server.route_table import RouteTableError
    with pytest.raises(RouteTableError) as got:
        _build(tmp_path)
    lines = [p for p in got.value.problems if p.startswith(rule) and route in p]
    assert lines, got.value.problems


def test_mantel_does_not_start_with_an_undeclared_route(tmp_path, monkeypatch):
    from mantel_server import server

    async def undeclared(request):
        return None
    monkeypatch.setattr(server, "api_hk_cards", undeclared)
    _refused(tmp_path, "R1", "GET /api/hk-cards")


def test_mantel_does_not_start_with_a_read_that_says_nothing_of_what_it_shows(tmp_path, monkeypatch):
    from mantel_server.identity import guards
    from mantel_server import server

    @guards.guard("signed_in")
    async def says_nothing(request):
        return None
    monkeypatch.setattr(server, "api_hk_cards", says_nothing)
    _refused(tmp_path, "R4", "GET /api/hk-cards")


def test_mantel_does_not_start_with_a_stream_that_says_it_is_none(tmp_path, monkeypatch):
    from aiohttp import web
    from mantel_server.identity import guards
    from mantel_server import server

    @guards.guard("signed_in", reads="none", why="a test's route")
    async def streams(request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        return ws
    monkeypatch.setattr(server, "api_hk_cards", streams)
    _refused(tmp_path, "R5", "GET /api/hk-cards")


def test_mantel_does_not_start_with_a_write_tool_that_names_no_route(tmp_path, monkeypatch):
    from mantel_server import route_table
    from mantel_server.mcp.tools import Tool, all_tools

    async def handler(caller, args):
        return {}
    loose = Tool("loose_write", "A loose write", "a test's tool", {}, handler, needs="settings", write=True)
    monkeypatch.setattr(route_table, "all_tools", lambda: [*all_tools(), loose])
    _refused(tmp_path, "R9", "loose_write")


def test_a_tool_looser_than_its_route_stops_the_start(tmp_path, monkeypatch):
    from mantel_server import route_table
    from mantel_server.mcp.tools import Tool, all_tools

    async def handler(caller, args):
        return {}
    loose = Tool("loose_owner", "A loose write", "a test's tool", {}, handler, needs="settings", write=True,
                 like="POST /api/settings/import")            # the Owner's: a manager's tool is looser
    monkeypatch.setattr(route_table, "all_tools", lambda: [*all_tools(), loose])
    _refused(tmp_path, "R10", "loose_owner")
