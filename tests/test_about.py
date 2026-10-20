"""Mantel Settings -> About (about.py): the version, the build, how it runs and what it talks to, for anyone
signed in; nothing secret. Fictional house."""
from __future__ import annotations

import json

from conftest import Mantel  # noqa: F401  (the fixture's type)
from mantel_server import about as A


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
