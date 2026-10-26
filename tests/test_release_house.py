"""tools/release_house.py: it refuses without a green full run of HEAD, puts the notes where house releases go,
keeps the token private, and updates the App the way the Supervisor wants (against a fictional Home Assistant)."""
from __future__ import annotations

import datetime
import importlib.util
import json
import sys
from pathlib import Path

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("release_house", ROOT / "tools/release_house.py")
rh = importlib.util.module_from_spec(spec)
sys.modules["release_house"] = rh
spec.loader.exec_module(rh)

HEAD = "a" * 40
TODAY = datetime.date(2026, 10, 27)


def ci_record(tmp_path, **over):
    record = {"tier": "full", "ok": True, "commit": HEAD, "dirty": [], "steps": [], **over}
    path = tmp_path / "last-run.json"
    path.write_text(json.dumps(record))
    return path


def test_only_a_green_full_run_of_head_will_do(tmp_path):
    rh.ci_green(ci_record(tmp_path), HEAD)
    rh.ci_green(ci_record(tmp_path, dirty=list(rh.LOCAL_ONLY)), HEAD)     # the never-committed local file
    cases = {"tier": ("quick", "not `full`"), "commit": ("b" * 40, "not HEAD"),
             "dirty": (["web/hk/x.js"], "uncommitted"), "ok": (False, "failed")}
    for key, (value, says) in cases.items():
        with pytest.raises(rh.Refused, match=says):
            rh.ci_green(ci_record(tmp_path, **{key: value}), HEAD)
    with pytest.raises(rh.Refused, match="run `tools/ci.py full`"):
        rh.ci_green(tmp_path / "missing.json", HEAD)


def test_the_notes_go_below_unreleased_and_above_the_last_release(tmp_path):
    log = tmp_path / "CHANGELOG.md"
    log.write_text("# Changelog\n\n## Unreleased\n\nThe first public release.\n\n- a\n\n## 0.1.76 - 2026-10-26\n\n- b\n")
    rh.add_notes(log, "0.1.77", "- Tablets reconnect after sleep.\n", TODAY)
    text = log.read_text()
    assert text.index("## Unreleased") < text.index("## 0.1.77 - 2026-10-27") < text.index("## 0.1.76")
    assert "## 0.1.77 - 2026-10-27\n\n- Tablets reconnect after sleep.\n\n## 0.1.76" in text
    with pytest.raises(rh.Refused, match="already has"):
        rh.add_notes(log, "0.1.77", "- again", TODAY)


def test_a_manifest_version_changes_alone(tmp_path):
    m = tmp_path / "manifest.json"
    m.write_text('{\n  "domain": "hk_frontend",\n  "requirements": [],\n  "version": "1.11.0"\n}\n')
    rh.set_manifest_version(m, "1.12.0")
    assert json.loads(m.read_text()) == {"domain": "hk_frontend", "requirements": [], "version": "1.12.0"}


def test_the_token_file_must_be_the_owners_alone(tmp_path):
    f = tmp_path / "ha_admin_token"
    with pytest.raises(rh.Refused, match="no Home Assistant admin token"):
        rh.ha_token(f, keychain=False)
    f.write_text("fictional-token\n")
    f.chmod(0o644)
    with pytest.raises(rh.Refused, match="chmod 600") as e:
        rh.ha_token(f, keychain=False)
    assert "fictional-token" not in str(e.value)
    f.chmod(0o600)
    assert rh.ha_token(f, keychain=False) == "fictional-token"


def test_log_problems_and_the_record(tmp_path):
    log = "INFO started\nWARNING migration\nERROR mantel.hub: boom\nTraceback (most recent call last):\n"
    assert rh.log_problems(log) == ["ERROR mantel.hub: boom", "Traceback (most recent call last):"]
    rec = tmp_path / "House-releases.md"
    rh.append_record(rec, "Mantel 0.1.77", ["one", "two"], TODAY)
    rh.append_record(rec, "HK Frontend 1.12.0", ["three"], TODAY)
    text = rec.read_text()
    assert text.startswith("# House releases")
    assert "## Mantel 0.1.77 (2026-10-27)\n\n- one\n- two\n\n## HK Frontend 1.12.0 (2026-10-27)\n\n- three\n" in text


def fake_ha(build: str, log: str = "INFO started\n"):
    """A fictional Home Assistant: websocket auth, supervisor/api, the App's Ingress and its log."""
    calls = []

    async def websocket(request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        await ws.send_json({"type": "auth_required"})
        auth = await ws.receive_json()
        if auth.get("access_token") != "fictional-admin":
            await ws.send_json({"type": "auth_invalid"})
            return ws
        await ws.send_json({"type": "auth_ok"})
        async for msg in ws:
            m = json.loads(msg.data)
            calls.append((m["type"], m.get("endpoint"), m.get("method")))
            result = {"/addons/local_mantel/info": {"version": "0.1.77", "ingress_entry": "/api/hassio_ingress/tok"},
                      "/ingress/session": {"session": "sess"}}.get(m.get("endpoint"))
            await ws.send_json({"id": m["id"], "type": "result", "success": True, "result": result})
        return ws

    async def ingress(request):
        assert request.cookies.get("ingress_session") == "sess"
        if request.match_info["path"] == "api/version":
            return web.json_response({"build": build})
        return web.json_response({"status": "ok", "upstream": {"home_assistant": {"connected_for_s": 12.0}}})

    async def logs(request):
        assert request.headers["Authorization"] == "Bearer fictional-admin"
        return web.Response(text=log)

    app = web.Application()
    app.router.add_get("/api/websocket", websocket)
    app.router.add_get("/api/hassio_ingress/tok/{path:.+}", ingress)
    app.router.add_get("/api/hassio/addons/local_mantel/logs", logs)
    return app, calls


@pytest.fixture
def no_wait(monkeypatch):
    real = rh.asyncio.sleep
    monkeypatch.setattr(rh.asyncio, "sleep", lambda s: real(0))


async def test_the_app_is_updated_through_the_supervisor_and_checked(no_wait):
    app, calls = fake_ha("build-1")
    async with TestServer(app) as server:
        url = str(server.make_url("")).rstrip("/")
        async with rh.House(url, "fictional-admin") as house:
            result = await rh.update_app(house, "build-1")
    assert result["version"] == "0.1.77"
    assert [c[1:] for c in calls] == [("/store/reload", "post"), ("/store/addons/local_mantel/update", "post"),
                                      ("/addons/local_mantel/info", "get"), ("/ingress/session", "post")]


async def test_errors_in_the_log_fail_the_release(no_wait):
    app, _ = fake_ha("build-1", log="INFO up\nERROR mantel.db: no\n")
    async with TestServer(app) as server:
        async with rh.House(str(server.make_url("")).rstrip("/"), "fictional-admin") as house:
            with pytest.raises(rh.Refused, match="ERROR mantel.db"):
                await rh.update_app(house, "build-1")


async def test_a_wrong_token_is_refused():
    app, _ = fake_ha("build-1")
    async with TestServer(app) as server:
        with pytest.raises(rh.Refused, match="refused the token"):
            async with rh.House(str(server.make_url("")).rstrip("/"), "wrong"):
                pass
