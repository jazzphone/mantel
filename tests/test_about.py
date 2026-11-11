"""Mantel Settings -> About (about.py): the version, the build, how it runs and what it talks to, for anyone
signed in; nothing secret. Fictional house."""
from __future__ import annotations

import json
import time
from types import SimpleNamespace

import pytest

from conftest import Mantel  # noqa: F401  (the fixture's type)
from mantel_server.pages import about as A
from mantel_server.pages import page_health as PH
from mantel_server.connectors import Ctx


async def test_a_signed_in_person_reads_which_mantel_this_is(mantel):
    m = mantel
    await m.user("ada", "adult")
    await m.sign_in("ada")
    r = await m.get(A.PATH)
    assert r.status == 200 and r.headers["Cache-Control"] == "no-store"
    got = await r.json()
    assert got["product"] == "Mantel" and got["version"] and got["build"]
    assert got["install"] in ("Home Assistant App", "Container")
    assert set(got["home_assistant"]) == {"version", "connected"} and got["linked"] == []
    assert got["docs"] == "/docs" and isinstance(got["uptime_s"], int)
    text = json.dumps(got)
    for secret in ("token", "password", "secret", "key"):
        assert secret not in text.lower()


async def test_signed_out_is_refused(mantel):
    mantel.forget_cookies()
    assert (await mantel.get(A.PATH)).status in (401, 403)


async def test_every_signed_in_person_sees_the_page(mantel):
    m = mantel
    await m.user("cody", "child")
    await m.sign_in("cody")
    r = await m.get("/api/admin/overview")
    assert r.status == 200 and "about" in (await r.json())["sections"]


def test_the_image_says_its_version(tmp_path, monkeypatch):
    (tmp_path / "BUILD_ID").write_text("abc123\n")
    (tmp_path / A.RELEASE).write_text(json.dumps({"version": "9.9.9", "commit": "deadbee", "build": "abc123",
                                                  "staged": 1}))
    monkeypatch.setattr(A, "REPO", tmp_path)
    import mantel_server.health as H
    monkeypatch.setattr(H, "REPO", tmp_path)
    assert A.release() == {"version": "9.9.9", "commit": "deadbee", "build": "abc123", "staged": 1}


def test_a_checkout_says_the_apps_version_and_dev(tmp_path, monkeypatch):
    (tmp_path / "packaging/ha-app").mkdir(parents=True)
    (tmp_path / "packaging/ha-app/config.yaml").write_text('name: Mantel\nversion: "1.2.3"\nslug: mantel\n')
    monkeypatch.setattr(A, "REPO", tmp_path)
    got = A.release()
    assert got["version"] == "1.2.3" and got["commit"] == "dev"


def test_how_it_runs():
    App = type("C", (), {"supervisor_url": "http://supervisor", "ha_url": "http://supervisor/core"})
    Box = type("C", (), {"supervisor_url": "", "ha_url": "http://ha.home.example:8123"})
    assert A.install_kind(App()) == "Home Assistant App" and A.install_kind(Box()) == "Container"


def test_a_docker_or_lxc_image_says_its_version_too(tmp_path, monkeypatch):
    """DEP-14 (audit, third pass): the Docker and LXC images had no RELEASE.json (only the App's stager wrote one) and
    no packaging/ha-app/config.yaml to fall back on, so About showed no version. The Dockerfile's release stage
    runs tools/write_release.py: the MANTEL_VERSION build argument, or config.yaml's version when none is given."""
    import importlib.util
    from pathlib import Path

    import pytest
    root = Path(__file__).resolve().parents[1]
    spec = importlib.util.spec_from_file_location("write_release", root / "tools/write_release.py")
    wr = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(wr)
    (tmp_path / "BUILD_ID").write_text("0123456789abcdef\n")
    config = tmp_path / "config.yaml"
    config.write_text('name: Mantel\nversion: "1.2.3"\nslug: mantel\n')
    sha = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"
    # the release's own version wins; the commit is the short one the App's stager writes
    assert wr.main([str(tmp_path / "a/RELEASE.json"), "--build-id-file", str(tmp_path / "BUILD_ID"), "--version", "2.0.0",
                    "--commit", sha, "--config", str(config)]) == 0
    got = json.loads((tmp_path / "a/RELEASE.json").read_text())
    assert got == {"version": "2.0.0", "commit": "a1b2c3d", "build": "0123456789abcdef", "staged": None}
    # the same keys tools/stage_ha_app.py writes, and about.release() reads it
    monkeypatch.setattr(A, "REPO", tmp_path / "a")
    import mantel_server.health as H
    monkeypatch.setattr(H, "REPO", tmp_path / "a")
    (tmp_path / "a/BUILD_ID").write_text("0123456789abcdef\n")
    assert A.release()["version"] == "2.0.0" and A.release()["commit"] == "a1b2c3d"
    # a local build has no version argument and no commit: config.yaml says the version
    assert wr.main([str(tmp_path / "b/RELEASE.json"), "--build-id-file", str(tmp_path / "BUILD_ID"), "--version", "",
                    "--commit", "unknown", "--config", str(config)]) == 0
    got = json.loads((tmp_path / "b/RELEASE.json").read_text())
    assert got["version"] == "1.2.3" and got["commit"] == "unknown"
    # no usable version at all is an error, never an image that says nothing
    with pytest.raises(SystemExit):
        wr.main([str(tmp_path / "c/RELEASE.json"), "--build-id-file", str(tmp_path / "BUILD_ID"), "--config", str(tmp_path / "none.yaml")])
    assert not (tmp_path / "c/RELEASE.json").exists()


# -- Secure Connection (2026-11-02): can talking at the door work? --------------------------------------------------
def _cfg(**kw):
    base = {"supervisor_url": "", "ha_url": "http://ha.home.example:8123", "public_url": "", "direct_port": 0, "direct_tls": "",
            "connect": False}
    return type("C", (), {**base, **kw})()


def test_how_browsers_reach_mantel():
    app = {"supervisor_url": "http://supervisor", "ha_url": "http://supervisor/core"}
    assert A.access_mode(_cfg(**app)) == "ha_sidebar", "the App alone is its sidebar: Home Assistant's own scheme"
    assert A.access_mode(_cfg(**app, public_url="https://mantel.example.com/", direct_port=8765, direct_tls="acme")) == "builtin_https"
    assert A.access_mode(_cfg(**app, public_url="https://mantel.example.com/", direct_port=8765)) == "proxy", \
        "plain HTTP on the direct port is for the home's own proxy"
    assert A.access_mode(_cfg(public_url="https://mantel.example.com/")) == "proxy", "a container behind Caddy"
    assert A.access_mode(_cfg()) == "http", "the loopback prototype, or a container nobody gave a name"
    assert A.access_mode(_cfg(public_url="http://mantel.example.com/")) == "http"
    assert A.access_mode(_cfg(connect=True)) == "ha_sidebar", "Mantel Connect: reached through the sidebar"
    assert {A.access_mode(_cfg(public_url="https://x/")), A.access_mode(_cfg())} <= set(A.MODES)


async def test_about_says_how_it_is_reached_but_not_who_is_insecure(mantel):
    m = mantel
    await m.user("ada", "adult")
    await m.sign_in("ada")
    got = await (await m.get(A.PATH)).json()
    assert got["access"]["mode"] in A.MODES and set(got["access"]) == {"mode", "public_url", "at_address"}
    assert "tablets" not in got and "origin" not in json.dumps(got)


async def test_about_says_when_mantel_is_still_at_its_address(mantel):
    """Docker and the LXC start at the machine's address (mantel-setup's "try"): the same fact Set Up Mantel's Address and
    HTTPS step goes by (setup_guide.address_host), so About points to that step instead of explaining it again."""
    m = mantel
    await m.user("ada", "adult")
    await m.sign_in("ada")
    cfg = m.app["cfg"]
    assert (await (await m.get(A.PATH)).json())["access"]["at_address"] is False
    object.__setattr__(cfg, "public_url", "https://192.0.2.10/")
    assert (await (await m.get(A.PATH)).json())["access"]["at_address"] is True
    object.__setattr__(cfg, "public_url", "https://mantel.example.com/")
    assert (await (await m.get(A.PATH)).json())["access"]["at_address"] is False


async def _tablet_report(m, name, **frame):
    """An enrolled wall tablet, and what its page said; the person who enrolled it is left signed in again."""
    r = await m.post("/api/devices/enroll", {"name": name, "room": "kitchen"})
    device = (await r.json())["device"]
    m.forget_cookies()
    await m.sign_in("jo")
    PH.RING.add(Ctx(None, identity=SimpleNamespace(device=SimpleNamespace(name=name, id=device["id"]), user=None)),
                {"event": "load", "page": "home", **frame}, now=time.time())
    return device["id"]


async def test_a_manager_reads_the_tablets_that_are_not_secure(mantel):
    m = mantel
    PH.RING.reset()
    await m.user("jo", "owner")
    await m.sign_in("jo")
    await _tablet_report(m, "Kitchen Tablet", secure=False, origin="http://192.168.1.20:8080")
    await _tablet_report(m, "Hall Tablet", secure=True, origin="https://mantel.example.com")
    await _tablet_report(m, "Old Tablet")                      # a page from before the report says nothing
    r = await m.get(A.SECURE_PATH)
    assert r.status == 200 and r.headers["Cache-Control"] == "no-store"
    got = await r.json()
    assert set(got) == {"now", "tablets"}
    [row] = got["tablets"]
    assert row["name"] == "Kitchen Tablet" and row["origin"] == "http://192.168.1.20:8080" and row["last_seen"] > 0
    PH.RING.reset()


async def test_a_tablet_that_was_revoked_is_not_listed(mantel):
    m = mantel
    PH.RING.reset()
    await m.user("jo", "owner")
    await m.sign_in("jo")
    device_id = await _tablet_report(m, "Hall", secure=False, origin="http://192.168.1.21")
    assert len((await (await m.get(A.SECURE_PATH)).json())["tablets"]) == 1
    m.app["devices"].revoke(device_id, "test")
    assert (await (await m.get(A.SECURE_PATH)).json())["tablets"] == []
    PH.RING.reset()


async def test_an_admin_reads_the_tablets_too(mantel):
    await mantel.user("ben", "admin")
    await mantel.sign_in("ben")
    assert (await mantel.get(A.SECURE_PATH)).status == 200


@pytest.mark.parametrize("role", ["adult", "child", "guest"])
async def test_a_member_is_refused_the_tablets(mantel, role):
    await mantel.user("cody", role)
    await mantel.sign_in("cody")
    assert (await mantel.get(A.SECURE_PATH)).status == 403
    assert (await mantel.get(A.PATH)).status == 200, "the page's own word about itself is for anyone"


async def test_signed_out_and_a_wall_tablets_session_are_refused_the_tablets(mantel):
    m = mantel
    await m.user("avery", "owner")
    await m.sign_in("avery")
    assert (await m.post("/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen"})).status == 201
    assert (await m.get(A.SECURE_PATH)).status == 403, "even an Owner's session at a wall tablet"
    m.forget_cookies()
    assert (await m.get(A.SECURE_PATH)).status in (401, 403)
    spec = A.api_about_secure.__guard__
    assert spec.who == "manager" and spec.device_ok is False


def test_the_page_health_frames_secure_flag_and_origin_are_validated():
    PH.RING.reset()

    def tablet(i):
        return Ctx(None, identity=SimpleNamespace(device=SimpleNamespace(name=f"T{i}", id=f"d{i}"), user=None))

    PH.RING.add(tablet(1), {"event": "load", "secure": False, "origin": "http://192.168.1.20:8080"}, now=1.0)
    PH.RING.add(tablet(2), {"event": "load", "secure": True, "origin": "https://mantel.example.com"}, now=1.0)
    PH.RING.add(tablet(3), {"event": "load", "secure": "no", "origin": "http://a.example"}, now=1.0)        # not a bool: nothing said
    PH.RING.add(tablet(4), {"event": "load", "secure": False, "origin": "javascript:alert(1)"}, now=1.0)   # not an address
    PH.RING.add(tablet(5), {"event": "load", "secure": False, "origin": "http://a.example/path?x=1"}, now=1.0)
    PH.RING.add(tablet(6), {"event": "load", "secure": False, "origin": "https://" + "a" * 250 + ".example"}, now=1.0)
    PH.RING.add(tablet(7), {"event": "load", "secure": False, "origin": "http://[fe80::1]:8123"}, now=1.0)
    PH.RING.add(tablet(8), {"event": "load", "secure": False, "origin": "http://a.example\n"}, now=1.0)
    PH.RING.add(tablet(9), {"event": "fps", "secure": False, "origin": "http://a.example"}, now=1.0)       # only load and beat say it
    got = {r["id"]: (r["secure"], r["origin"]) for r in PH.RING.secure_reports(now=2.0)}
    assert got == {"d1": (False, "http://192.168.1.20:8080"), "d2": (True, "https://mantel.example.com"),
                   "d4": (False, None), "d5": (False, None), "d6": (False, None), "d7": (False, "http://[fe80::1]:8123"),
                   "d8": (False, None)}
    PH.RING.reset()


def test_the_latest_report_wins_and_an_older_page_does_not_clear_it():
    PH.RING.reset()
    c = Ctx(None, identity=SimpleNamespace(device=SimpleNamespace(name="Hall", id="d1"), user=None))
    PH.RING.add(c, {"event": "load", "secure": False, "origin": "http://192.168.1.20"}, now=1.0)
    PH.RING.add(c, {"event": "beat", "up": 1}, now=61.0)                      # a beat from a page that does not say
    assert [(r["secure"], r["origin"]) for r in PH.RING.secure_reports(now=62.0)] == [(False, "http://192.168.1.20")]
    PH.RING.add(c, {"event": "beat", "secure": True, "origin": "https://mantel.example.com"}, now=121.0)
    assert [(r["secure"], r["origin"]) for r in PH.RING.secure_reports(now=122.0)] == [(True, "https://mantel.example.com")]
    assert PH.RING.secure_reports(now=121.0 + PH.KEEP + 1) == [], "a day without a word: nothing is claimed"
    PH.RING.reset()


def test_a_persons_browser_is_not_a_wall_tablet():
    PH.RING.reset()
    PH.RING.add(Ctx(None, identity=SimpleNamespace(device=None, user=SimpleNamespace(name="Avery", username="avery", id="u1"))),
                {"event": "load", "secure": False, "origin": "http://192.168.1.20"}, now=1.0)
    assert PH.RING.secure_reports(now=2.0) == []
    PH.RING.reset()
