"""Which Home Assistant addresses may show Mantel in a frame (frame_origins.py): the operator's, Home Assistant's own
internal and external URL, and the ones an Owner approves in Mantel Settings, live. Nothing is specific to one house:
a Webpage dashboard opened at an HA address nobody listed was a white page (the house, 2026-10-19)."""
from __future__ import annotations

import json

import pytest

from conftest import Mantel  # noqa: F401  (the fixture's type)
from mantel_server.network.frame_origins import API, origin_of

HA_HOME = "https://ha.home.example"


@pytest.mark.parametrize("raw, want", [
    ("https://ha.home.example", "https://ha.home.example"),
    ("https://ha.home.example/", "https://ha.home.example"),
    ("HTTPS://HA.Home.Example", "https://ha.home.example"),
    ("http://192.0.2.10:8123", "http://192.0.2.10:8123"),
    ("https://ha.home.example:443", "https://ha.home.example"),
    ("http://[fd00::1]:8123", "http://[fd00::1]:8123"),
])
def test_an_address_becomes_its_origin(raw, want):
    assert origin_of(raw) == want


@pytest.mark.parametrize("raw", ["", "ha.home.example", "https://ha.home.example/lovelace", "https://*.example.com",
                                 "javascript:alert(1)", "https://a.example'; script-src *", "ftp://ha.example",
                                 "https://user:pw@ha.example", "https://ha.example?x=1", None, 42])
def test_anything_else_is_refused(raw):
    assert origin_of(raw) is None


def csp_of(r) -> str:
    return r.headers["Content-Security-Policy"]


def frames_of(r) -> str:
    return next(p for p in csp_of(r).split(";") if "frame-ancestors" in p)


async def owner(m, name="olive", role="owner"):
    await m.user(name, role)
    await m.sign_in(name)


def audits(m, action):
    rows = m.app["store"].db.execute("SELECT target FROM action_audit WHERE action = ?", (action,)).fetchall()
    return [json.loads(r[0]) for r in rows]


async def test_home_assistants_own_addresses_may_frame_mantel(mantel):
    m = mantel
    assert HA_HOME not in frames_of(await m.get("/login"))
    m.app["frame_origins"].learn({"internal_url": HA_HOME + "/", "external_url": "https://ha.away.example",
                                  "time_zone": "Europe/Paris"})
    f = frames_of(await m.get("/login"))
    assert HA_HOME in f and "https://ha.away.example" in f
    m.app["frame_origins"].learn({"internal_url": None, "external_url": "not an address"})
    assert HA_HOME not in frames_of(await m.get("/login"))         # what HA says now, not what it once said


async def test_an_owner_approves_an_address_and_it_applies_at_once(mantel):
    m = mantel
    await owner(m)
    r = await m.client.post(API, json={"origin": HA_HOME + "/"}, headers=m.headers())
    assert r.status == 200 and (await r.json())["origin"] == HA_HOME
    assert HA_HOME in frames_of(await m.get("/login"))
    assert audits(m, "frame_origin.add") == [{"origin": HA_HOME, "why": "settings"}]
    listed = (await (await m.get(API)).json())["origins"]
    assert {"origin": HA_HOME, "source": "approved"} in listed
    # the summary on HTTPS and Your Proxy shows it, with where it came from
    s = await (await m.get("/api/admin/proxy-check/summary")).json()
    assert HA_HOME in s["frame_ancestors"] and {"origin": HA_HOME, "source": "approved"} in s["frame_origins"]
    r = await m.client.delete(API, params={"origin": HA_HOME}, headers=m.headers())
    assert r.status == 200 and HA_HOME not in frames_of(await m.get("/login"))
    assert audits(m, "frame_origin.remove") == [{"origin": HA_HOME}]


async def test_only_an_owner_changes_it_and_only_plain_addresses(mantel):
    m = mantel
    await owner(m, "ada", "admin")
    assert (await m.get(API)).status == 200                                      # an Admin may read
    assert (await m.client.post(API, json={"origin": HA_HOME}, headers=m.headers())).status == 403
    m.forget_cookies()
    await owner(m)
    for bad in ("https://*.example.com", "https://ha.example/x", "nonsense"):
        assert (await m.client.post(API, json={"origin": bad}, headers=m.headers())).status == 400
    r = await m.client.post(API, json={"origin": HA_HOME})                       # no CSRF token
    assert r.status == 403
    # the operator's and HA's own are not removable here
    m.app["cfg"].frame_ancestors = ("https://ha.option.example",)
    assert (await m.client.delete(API, params={"origin": "https://ha.option.example"}, headers=m.headers())).status == 404


async def test_the_operators_none_still_wins(mantel):
    m = mantel
    await owner(m)
    assert (await m.client.post(API, json={"origin": HA_HOME}, headers=m.headers())).status == 200
    m.app["cfg"].frame_ancestors = ("'none'",)
    assert HA_HOME not in frames_of(await m.get("/login"))


async def test_a_person_gets_home_assistants_address_for_the_open_home_assistant_row(mantel):
    """GET /api/me `ha_address` (the dashboard's one Home Assistant row, opened at Mantel's own address): HA's
    external URL, else its internal one, else Mantel's own address for HA; a wall tablet gets none (Avery,
    2026-10-19: nothing to get stuck in)."""
    from mantel_server.network.frame_origins import ha_address
    m = mantel
    await owner(m)
    fallback = ha_address(m.app)
    assert fallback == origin_of(m.app["cfg"].ha_url)
    assert (await (await m.get("/api/me")).json())["ha_address"] == fallback
    m.app["frame_origins"].learn({"internal_url": HA_HOME + "/", "external_url": None})
    assert ha_address(m.app) == HA_HOME
    m.app["frame_origins"].learn({"internal_url": HA_HOME, "external_url": "https://ha.away.example/"})
    assert (await (await m.get("/api/me")).json())["ha_address"] == "https://ha.away.example"
    r = await m.post("/api/devices/enroll", {"name": "Hall tablet", "room": "hall"})
    assert r.status == 201
    me = await (await m.get("/api/me")).json()
    assert me["ha_address"] is None, "a wall tablet has no Home Assistant row"


def test_the_apps_supervisor_address_is_never_a_browsers(tmp_path):
    from types import SimpleNamespace
    from mantel_server.network.frame_origins import FrameOrigins, ha_address
    app = {"cfg": SimpleNamespace(ha_url="http://supervisor/core", ha_browser_url="", ha_managed_by_app=True)}
    app["frame_origins"] = FrameOrigins(app)
    assert ha_address(app) is None
    app["cfg"].ha_browser_url = "https://ha.home.example/"
    assert ha_address(app) == "https://ha.home.example"
