"""tools/route_probe.py: the sample path it fills in for each route's parameters (the full probe is far too slow for
the main suite: run ``tools/route_probe.py --diff <rev>`` by hand after a slice, docs/phase18/CODE-HEALTH.md)."""
import importlib.util
import re
from pathlib import Path

import pytest
from aiohttp import web

_spec = importlib.util.spec_from_file_location("route_probe", Path(__file__).resolve().parents[1] / "tools/route_probe.py")
route_probe = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(route_probe)


async def _handler(request):
    return web.Response()


def sample_of(path: str) -> str:
    resource = web.Application().router.add_get(path, _handler).resource
    sample = route_probe.sample_path(resource.get_info())
    pattern = resource.get_info().get("pattern")
    assert pattern is None or pattern.fullmatch(sample), f"{sample!r} must be a path the route matches"
    return sample


@pytest.mark.parametrize("route, expected", [
    ("/api/users/{id}/pin", "/api/users/x-sample/pin"),                                    # plain parameter
    ("/{seg:[A-Za-z0-9_]+-[A-Za-z0-9_-]*}/{view:[A-Za-z0-9_-]+}", "/x-sample/x-sample"),   # the dashboard pattern
    ("/hk/{path:.+}", "/hk/x-sample"),                                                     # the rest of the path
    ("/api/image/serve/{id:[0-9a-f]{32}}/{size:[A-Za-z0-9x]+}", "/api/image/serve/" + "0" * 32 + "/xsample"),
    ("/api/photos/{photo:[0-9a-f]{32}}/{size:original|screen|mid|thumb|mask}", "/api/photos/" + "0" * 32 + "/original"),
    ("/api/ping", "/api/ping"),                                                            # nothing to fill
])
def test_the_sample_path_matches_its_route(route, expected):
    assert sample_of(route) == expected


def test_a_regex_no_sample_fits_is_loud():
    with pytest.raises(ValueError):
        route_probe.sample_value(r"[Z]{40}")


def test_the_compare_names_what_differs():
    old = {"GET /a": {"adult@lan": [200, None]}, "_meta": {"routes": 1}}
    new = {"GET /a": {"adult@lan": [403, "forbidden"]}, "GET /b": {"adult@lan": [200, None]}, "_meta": {"routes": 2}}
    assert route_probe.compare(old, new) == ["GET /a [adult@lan]: [200, None] -> [403, 'forbidden']", "GET /b: new route"]
    assert route_probe.compare(new, new) == []
