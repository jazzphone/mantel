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
# A1-A6 fill the table in (warn mode: build_app logs what is missing); A7 turns the start-up refusal on
ENFORCED = False


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
    if gaps and not ENFORCED:
        pytest.xfail(f"{len(gaps)} gaps while the table is filled in (warn mode):\n" + "\n".join(gaps))
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
