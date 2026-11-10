"""tools/release_house.py: it refuses without a passed full run that speaks for HEAD, puts the notes where house releases go,
keeps the token private, and updates the App the way the Supervisor wants (against a fictional Home Assistant)."""
from __future__ import annotations

import argparse
import datetime
import importlib.util
import inspect
import json
import re
import shlex
import subprocess
import sys
import types
from pathlib import Path

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("release_house", ROOT / "tools/release_house.py")
rh = importlib.util.module_from_spec(spec)
sys.modules["release_house"] = rh
spec.loader.exec_module(rh)


@pytest.fixture(autouse=True)
def _no_tablets(monkeypatch, request):
    """No test reaches the house's tablets: refresh_kiosks is stubbed, except in its own tests (which stub the house)."""
    if "refresh_kiosks" not in request.node.name and "kiosk_buttons" not in request.node.name:
        monkeypatch.setattr(rh, "refresh_kiosks", lambda dry=False, settle=0: [])


TODAY = datetime.date(2026, 10, 27)


def test_the_publishers_skip_their_suites_only_when_the_full_run_ran_them():
    passed = {"steps": {"hk-frontend-py": "passed", "hk-frontend-js": "passed", "main-suite": "passed"}}
    assert rh.publish_tests(passed, "hk-frontend") == rh.publish_tests(passed, "mantel-link") == ["--no-tests"]
    skipped = {"steps": {**passed["steps"], "hk-frontend-js": "skipped"}}
    assert rh.publish_tests(skipped, "hk-frontend") == [], "a skip is never a pass"
    no_venv = {"steps": {**passed["steps"], "hk-frontend-py": "skipped"}}
    assert rh.publish_tests(no_venv, "mantel-link") == [], "test_mantel_link skips without the HA venv"
    carried = {"steps": {**passed["steps"], "hk-frontend-py": "unchanged"}}
    assert rh.publish_tests(carried, "hk-frontend") == ["--no-tests"], "an unchanged suite passed on the same inputs"


def test_mantel_link_goes_to_the_house_with_the_hk_core_it_imports(tmp_path):
    # (its own folder has no hk_core/: a copy of it left the house's old one in place, 2026-11-01)
    built = rh.house_build("mantel-link", str(tmp_path), "no-such-word-anywhere", ["--no-tests"])
    assert (built / "manifest.json").is_file() and (built / "hk_core/link/mantel_link.py").is_file()
    assert not (built / "tests").exists()


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


def test_commits_name_their_files_and_never_take_everything():
    # `commit -a` would take the never-committed local file (LOCAL_ONLY) too: the commit hook refuses it
    source = (ROOT / "tools/release_house.py").read_text()
    assert not re.search(r'"commit",\s*"-q?a', source)
    assert source.count("commit_only(") >= 4


# ---- --github-release: tag v<version> and a GitHub release of a component, only when asked

def _ls_remote(monkeypatch, out: str, code: int = 0):
    real = rh.subprocess.run

    def fake(cmd, *a, **kw):
        if cmd[:2] == ["git", "ls-remote"]:
            return rh.subprocess.CompletedProcess(cmd, code, out, "no route" if code else "")
        return real(cmd, *a, **kw)
    monkeypatch.setattr(rh.subprocess, "run", fake)


def _manifest_version(product):
    return json.loads((ROOT / rh.COMPONENTS[product]["dir"] / "manifest.json").read_text())["version"]


@pytest.mark.parametrize("product", ["hk-frontend", "mantel-link"])
def test_a_github_release_needs_the_versions_notes_and_a_free_tag(monkeypatch, product):
    _ls_remote(monkeypatch, "")
    rh.check_github_release(product, _manifest_version(product))               # the notes are in the changelog
    monkeypatch.setattr(rh, "unreleased", lambda changelog: "")                 # (whatever Unreleased says today)
    with pytest.raises(rh.Refused, match="no GitHub release: CHANGELOG.md has no section '## 99.0.0'"):
        rh.check_github_release(product, "99.0.0")
    version = _manifest_version(product)
    _ls_remote(monkeypatch, f"abc\trefs/tags/v{version}\n")
    with pytest.raises(rh.Refused, match=f"has the tag v{version} already"):
        rh.check_github_release(product, version)
    _ls_remote(monkeypatch, "", code=128)
    with pytest.raises(rh.Refused, match="cannot ask"):
        rh.check_github_release(product, version)


def test_the_github_release_is_opt_in_and_not_for_mantel_itself(capsys):
    source = (ROOT / "tools/release_house.py").read_text()
    assert 'ap.add_argument("--github-release", action="store_true"' in source, "a flag, default off"
    params = inspect.signature(rh.release_component).parameters
    assert list(params) == ["product", "version", "dry", "github_release", "from_origin"]
    assert params["github_release"].default is False and params["from_origin"].default is False
    assert source.count('"--release"') == 1 and '*(["--release"] if github_release else [])' in source
    assert rh.main(["mantel", "0.1.99", "--github-release"]) == 2
    assert "--github-release is for hk-frontend and mantel-link" in capsys.readouterr().err



# ---- Mantel's own releases are tagged v<version> once the house runs them (the LXC's `update` follows the tags)

def test_a_mantel_release_needs_a_free_tag(monkeypatch):
    local: list[str] = []
    monkeypatch.setattr(rh, "git", lambda *a: "\n".join(local) if a[:2] == ("tag", "-l") else "")
    _ls_remote(monkeypatch, "")
    rh.check_tag_free("0.1.99")
    _ls_remote(monkeypatch, "abc\trefs/tags/v0.1.99\n")
    with pytest.raises(rh.Refused, match="origin has the tag v0.1.99 already"):
        rh.check_tag_free("0.1.99")
    _ls_remote(monkeypatch, "", code=128)
    with pytest.raises(rh.Refused, match="cannot ask origin"):
        rh.check_tag_free("0.1.99")
    local.append("v0.1.99")
    with pytest.raises(rh.Refused, match="exists here already"):
        rh.check_tag_free("0.1.99")


def test_the_tag_is_annotated_on_the_release_commit_and_pushed_alone(monkeypatch):
    calls = []
    monkeypatch.setattr(rh, "git", lambda *a: calls.append(a) or "")
    assert rh.tag_release("0.1.99", "abc123") == "v0.1.99"
    assert calls == [("tag", "-a", "v0.1.99", "-m", "Mantel 0.1.99", "abc123"),
                     ("push", "-q", "--no-verify", "origin", "refs/tags/v0.1.99")]


def _ha_app_body() -> str:
    """The --ha-app release (the house's way before the LXC): its source, up to the LXC section that follows it."""
    source = (ROOT / "tools/release_house.py").read_text()
    return source[source.index("def release_mantel_ha_app"):source.index("class Lxc")]


def test_the_ha_app_release_is_tagged_only_after_the_house_runs_it():
    body = _ha_app_body()
    assert body.index("check_tag_free(version)") < body.index("set_version(version)"), "refused before anything changes"
    assert body.index("asyncio.run(go())") < body.index("tag_release(version, commit)")


# ---- publishing: the release workflow from the tag, then the GitHub Release (unless --no-publish)

def test_the_release_notes_are_the_versions_changelog_section(tmp_path):
    log = tmp_path / "CHANGELOG.md"
    log.write_text("# Changelog\n\n## Unreleased\n\n## 0.1.99 - 2026-11-01\n\n- **A:** one.\n- **B:** two.\n\n"
                   "## 0.1.98 - 2026-10-31\n\n- older\n")
    assert rh.changelog_section(log, "0.1.99") == "- **A:** one.\n- **B:** two.\n"
    assert rh.changelog_section(log, "0.1.98") == "- older\n"
    with pytest.raises(rh.Refused, match="no section '## 0.1.97'"):
        rh.changelog_section(log, "0.1.97")


class _Watch:
    def __init__(self, code):
        self.returncode = code


def _publishing(monkeypatch, watch_code: int, listed: str = '[{"databaseId": 7, "url": "https://example.com/run/7"}]'):
    calls = []

    def fake_run(*cmd, **kw):
        calls.append(cmd)
        return listed if cmd[:3] == ("gh", "run", "list") else ""
    monkeypatch.setattr(rh, "run", fake_run)
    monkeypatch.setattr(rh.time, "sleep", lambda s: None)
    monkeypatch.setattr(rh.subprocess, "run", lambda cmd, **kw: calls.append(tuple(cmd)) or _Watch(watch_code))
    return calls


def test_publishing_runs_the_workflow_from_the_tag_then_makes_the_release(monkeypatch):
    calls = _publishing(monkeypatch, 0)
    lines = rh.publish_release("0.1.99", "- notes\n")
    assert calls[0] == ("gh", "workflow", "run", "release.yml", "--ref", "v0.1.99", "-f", "publish=true")
    assert calls[1][:3] == ("gh", "run", "list") and "--branch" in calls[1] and "v0.1.99" in calls[1]
    assert calls[2] == ("gh", "run", "watch", "7", "--exit-status", "--interval", "30")
    assert calls[3][:4] == ("gh", "release", "create", "v0.1.99") and "--verify-tag" in calls[3]
    assert "GitHub Release `v0.1.99`" in lines[0]


def test_a_failed_workflow_makes_no_release(monkeypatch):
    calls = _publishing(monkeypatch, 1)
    with pytest.raises(rh.Refused, match="the release workflow failed"):
        rh.publish_release("0.1.99", "- notes\n")
    assert not any(c[:3] == ("gh", "release", "create") for c in calls)


def test_a_workflow_that_never_starts_is_refused(monkeypatch):
    calls = _publishing(monkeypatch, 0, listed="[]")
    with pytest.raises(rh.Refused, match="did not start"):
        rh.publish_release("0.1.99", "- notes\n", wait_s=0.01)
    assert not any(c[:3] == ("gh", "release", "create") for c in calls)


def test_the_ha_app_release_publishes_after_the_tag_and_can_leave_it_out():
    source = (ROOT / "tools/release_house.py").read_text()
    body = _ha_app_body()
    assert body.index("tag_release(version, commit)") < body.index("publish_release(version")
    assert 'ap.add_argument("--no-publish", action="store_true"' in source
    assert "publish=not args.no_publish" in source


# =====================================================================================================================
# Phase 15: the house is an LXC, and the release goes house first (docs/phase15/FASTER-RELEASES.md). Everything below
# runs against fakes: `gh` (rh.run), `git` (rh.git), the LXC (the Lxc runner) and the clock. An invented address range
# (192.0.2.x, RFC 5737) and key path stand in for the owner's, which never appear in the repository.

COMMIT = "1234567890abcdef1234567890abcdef12345678"           # the release commit
OLD = "abcdef0123456789abcdef0123456789abcdef01"              # what the LXC ran before
ADDRESS, KEY = "root@192.0.2.7", "/Users/someone/.ssh/k"
HEALTH = {"status": "ok", "build": "build-121", "upstream": {"home_assistant": {"connected": True, "connected_for_s": 42.0}}}
SERVICES = [{"Service": "mantel-server", "State": "running", "Health": "healthy"},
            {"Service": "caddy", "State": "running", "Health": "healthy"},
            {"Service": "go2rtc", "State": "running", "Health": ""}]


class FakeLxc:
    """A fictional LXC: answers the commands release_house.Lxc sends from a little state, and records them."""

    def __init__(self, events: list[str] | None = None, *, version="0.1.120", passes_ref=True, dirty="", pin=None,
                 services=None, revision=None, health_code="200", health=None, log="", echo="", update_status=0,
                 plain_update_status=0, releasepin=None, pin_status=0):
        self.events = events if events is not None else []
        self.commands: list[str] = []
        self.head, self.version, self.passes_ref, self.dirty, self.pin = OLD, version, passes_ref, dirty, pin
        self.services = SERVICES if services is None else services
        self.revision, self.health_code, self.health = revision, health_code, HEALTH if health is None else health
        self.log, self.echo, self.update_status, self.plain_update_status = log, echo, update_status, plain_update_status
        self.patches: list[str] = []
        self.releasepin, self.pin_status = releasepin, pin_status      # what the fallback remembers; a failed read

    def __call__(self, command: str, timeout: float) -> tuple[int, str]:
        self.commands.append(command)
        self.events.append("lxc " + command)
        if command.startswith("MANTEL_UPDATE_REF="):
            if self.update_status:
                return self.update_status, f"update failed {self.echo}"
            if self.passes_ref:
                self.head = command.split("=")[1].split()[0]
            return 0, f"updated {self.echo}"
        if command == "update":                                    # the fallback: the pin names the commit
            if self.plain_update_status:
                return self.plain_update_status, f"update failed {self.echo}"
            if self.pin and re.fullmatch(r"[0-9a-f]{40}", self.pin):
                self.head = self.pin
            return 0, "updated"
        if "rev-parse HEAD && " in command:
            return 0, f'{self.head}\nname: Mantel\nversion: "{self.version}"\n'
        if command.endswith("rev-parse HEAD"):
            return 0, self.head + "\n"
        if "config --get mantel.ref" in command:
            if self.pin_status:
                return self.pin_status, "ssh: connection dropped"
            return (0, self.pin + "\n") if self.pin else (1, "")
        if "config --get mantel.releasepin" in command:
            return (0, self.releasepin + "\n") if self.releasepin else (1, "")
        if "config mantel.releasepin" in command:
            self.releasepin = shlex.split(command)[-1]
            return 0, ""
        if "config --unset mantel.releasepin" in command:
            self.releasepin = None
            return 0, ""
        if "config mantel.ref" in command:
            self.pin = shlex.split(command)[-1]
            return 0, ""
        if "status --porcelain" in command:
            return 0, self.dirty
        if "diff --binary HEAD >" in command:
            self.patches.append(command)
            if "reset -q --hard" in command:
                self.dirty = ""
            return 0, ""
        if "docker compose ps --format json" in command:
            return 0, "\n".join(json.dumps(s) for s in self.services) + "\n"
        if "org.opencontainers.image.revision" in command:
            return 0, (self.head if self.revision is None else self.revision) + "\n"
        if "docker exec mantel-server" in command:
            if self.health_code is None:                       # the container is down: docker exec prints nothing
                return 1, ""
            return 0, f"{self.health_code}\n{json.dumps(self.health)}\n"
        if "StartedAt" in command:
            return 0, "2026-11-03T10:00:00Z\n"
        if "docker compose logs" in command:
            return 0, self.log
        raise AssertionError(f"the fake LXC was sent something unexpected: {command}")


def tool(name: str):
    """tools/<name>.py from the real repository (rh._load follows rh.ROOT, which the tests point at a temporary tree)."""
    spec = importlib.util.spec_from_file_location(f"test_tool_{name}", ROOT / f"tools/{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


REAL_CHECK_TAG_FREE = rh.check_tag_free


def lxc_with(fake, **kw) -> rh.Lxc:
    return rh.Lxc(ADDRESS, KEY, runner=fake, settle=kw.pop("settle", 0), every=kw.pop("every", 0), **kw)


@pytest.fixture
def clock(monkeypatch):
    """A clock that only moves when the code sleeps, so waits and deadlines take no time."""
    now = [0.0]
    monkeypatch.setattr(rh, "time", types.SimpleNamespace(monotonic=lambda: now[0], sleep=lambda s: None))
    monkeypatch.setattr(rh, "sleep", lambda s: now.__setitem__(0, now[0] + s))
    return now


# ---- Lxc: update, the pin, hand changes

def test_update_names_the_commit_in_the_environment_and_checks_where_the_lxc_ended_up():
    fake = FakeLxc()
    lxc_with(fake).update(COMMIT)
    assert fake.commands[0] == f"MANTEL_UPDATE_REF={COMMIT} update"
    assert fake.head == COMMIT
    assert not any("config" in c for c in fake.commands), "no pin is left or even made when the variable works"


def test_update_falls_back_to_a_pin_when_the_variable_did_not_move_it_and_puts_the_old_pin_back():
    fake = FakeLxc(passes_ref=False, pin="v0.1.100")
    lxc_with(fake).update(COMMIT)
    writes = [shlex.split(c)[3:] for c in fake.commands if " config " in c and "--get" not in c]
    assert writes == [["config", "mantel.releasepin", f"{COMMIT} v0.1.100"],       # remembered first, for a repair
                      ["config", "mantel.ref", COMMIT],
                      ["config", "mantel.ref", "v0.1.100"],
                      ["config", "--unset", "mantel.releasepin"]]
    pinned = next(c for c in fake.commands if c.endswith(f"mantel.ref {COMMIT}"))
    restored = next(c for c in fake.commands if c.endswith("mantel.ref v0.1.100"))
    assert fake.commands.index(pinned) < fake.commands.index("update") < fake.commands.index(restored)
    assert fake.head == COMMIT and fake.pin == "v0.1.100" and fake.releasepin is None


def test_the_fallback_restores_latest_when_there_was_no_pin():
    fake = FakeLxc(passes_ref=False)
    lxc_with(fake).update(COMMIT)
    assert fake.pin == "latest" and fake.releasepin is None


def test_the_fallback_restores_the_pin_when_its_update_fails_or_raises():
    fake = FakeLxc(passes_ref=False, plain_update_status=1)
    with pytest.raises(rh.Refused, match="did not move it"):
        lxc_with(fake).update(COMMIT)
    assert fake.pin == "latest" and fake.releasepin is None
    assert fake.commands[-1].endswith("rev-parse HEAD"), "it looked where the LXC ended up"

    class Dies(FakeLxc):
        def __call__(self, command, timeout):
            if command == "update":
                self.commands.append(command)
                raise KeyboardInterrupt
            return super().__call__(command, timeout)

    fake = Dies(passes_ref=False, pin="v0.1.100")
    with pytest.raises(KeyboardInterrupt):
        lxc_with(fake).update(COMMIT)
    assert fake.pin == "v0.1.100" and fake.releasepin is None, "even an interrupt puts the old pin back"


def test_the_pin_is_read_as_latest_when_unset_and_refused_when_the_answer_is_not_one():
    assert lxc_with(FakeLxc()).pin() == "latest"
    assert lxc_with(FakeLxc(pin="v0.1.100")).pin() == "v0.1.100"
    assert lxc_with(FakeLxc(pin="feature/x_1.2")).pin() == "feature/x_1.2"
    for bad in ("two words", "a;reboot", "$(reboot)", "x'y"):
        with pytest.raises(rh.Refused, match="cannot read the LXC's mantel.ref"):
            lxc_with(FakeLxc(pin=bad)).pin()
    with pytest.raises(rh.Refused, match=r"cannot read the LXC's mantel.ref \(255\)"):
        lxc_with(FakeLxc(pin_status=255)).pin()


def test_a_pin_that_cannot_be_read_stops_the_fallback_before_it_writes_anything():
    fake = FakeLxc(passes_ref=False)

    def drops_after_the_first_update(command, timeout):
        result = fake(command, timeout)
        if command.startswith("MANTEL_UPDATE_REF"):
            fake.pin_status = 255
        return result
    with pytest.raises(rh.Refused, match="cannot read"):
        lxc_with(drops_after_the_first_update).update(COMMIT)
    assert not any(" config " in c and "--get" not in c for c in fake.commands), "nothing was pinned"


def test_a_failed_update_says_it_went_back_and_a_non_commit_is_refused_before_anything_is_sent():
    fake = FakeLxc(update_status=1)
    with pytest.raises(rh.Refused, match="went back to what ran before"):
        lxc_with(fake).update(COMMIT)
    assert len(fake.commands) == 1
    fake = FakeLxc()
    for bad in ("v0.1.121", COMMIT[:12], "latest", COMMIT.upper(), COMMIT + "0", "", "$(reboot)"):
        with pytest.raises(rh.Refused, match="not a commit"):
            lxc_with(fake).update(bad)
    assert fake.commands == []


def test_repair_pin_undoes_only_a_pin_this_tool_set():
    fake = FakeLxc(pin=OLD, releasepin=f"{OLD} v0.1.100")
    said = lxc_with(fake).repair_pin()
    assert fake.pin == "v0.1.100" and fake.releasepin is None
    assert said and OLD[:9] in said and OLD not in said and "back to v0.1.100" in said
    fake = FakeLxc(pin=OLD, releasepin=f"{OLD} latest")
    assert "back to latest" in lxc_with(fake).repair_pin() and fake.pin == "latest"


def test_repair_pin_leaves_a_pin_the_owner_set_alone():
    # a 40-hex pin with no record that this tool made it: the owner's choice
    fake = FakeLxc(pin=OLD)
    assert lxc_with(fake).repair_pin() is None
    assert fake.pin == OLD and not any(" config " in c and "--get" not in c for c in fake.commands)
    # the record is stale: the owner has pinned something else since
    fake = FakeLxc(pin="v0.1.50", releasepin=f"{OLD} latest")
    assert lxc_with(fake).repair_pin()
    assert fake.pin == "v0.1.50" and fake.releasepin is None, "the record goes, the owner's pin stays"
    for pin in ("latest", "v0.1.100", None):
        fake = FakeLxc(pin=pin)
        assert lxc_with(fake).repair_pin() is None and fake.pin == pin
    fake = FakeLxc(pin=OLD, releasepin="not a commit")
    assert lxc_with(fake).repair_pin() is None and fake.pin == OLD


def test_previous_reads_the_version_and_commit_the_lxc_runs():
    fake = FakeLxc(version="0.1.120")
    assert lxc_with(fake).previous() == ("0.1.120", OLD)
    fake.version = "#"
    assert lxc_with(fake).previous()[0] == "?", "no readable version line"


def test_hand_changes_on_the_lxc_refuse_and_name_their_files():
    fake = FakeLxc(dirty=" M packaging/compose/go2rtc/go2rtc.yaml\n M packaging/compose/compose.yaml\n")
    with pytest.raises(rh.Refused, match="hand changes in packaging/compose/go2rtc/go2rtc.yaml, packaging/compose/compose.yaml") as e:
        lxc_with(fake).clean()
    assert "--save-and-revert-hand-changes" in str(e.value)
    assert fake.patches == [] and fake.dirty, "nothing was reverted"
    assert lxc_with(FakeLxc()).clean() == []


def test_save_and_revert_writes_the_patch_before_it_reverts(capsys):
    fake = FakeLxc(dirty=" M packaging/compose/go2rtc/go2rtc.yaml\n")
    files = lxc_with(fake).clean(save_and_revert=True)
    assert files == ["packaging/compose/go2rtc/go2rtc.yaml"]
    (command,) = fake.patches
    assert re.search(r"diff --binary HEAD > /root/mantel-hand-changes-\d{8}-\d{6}\.patch && test -s ", command)
    assert command.index("diff --binary HEAD >") < command.index("reset -q --hard"), "saved, then reverted, as one command"
    assert fake.dirty == ""
    out = capsys.readouterr().out
    assert "saved to /root/mantel-hand-changes-" in out and "192.0.2" not in out


def test_a_dry_run_reverts_nothing(capsys):
    fake = FakeLxc(dirty=" M packaging/compose/compose.yaml\n")
    assert lxc_with(fake).clean(save_and_revert=True, dry=True) == ["packaging/compose/compose.yaml"]
    assert fake.patches == [] and fake.dirty
    assert all("status --porcelain" in c for c in fake.commands), "it only looked"
    assert "would save the LXC's hand changes" in capsys.readouterr().out


# ---- Lxc: health and log

def test_health_problems_reads_one_json_object_per_line_as_docker_compose_prints_them():
    fake = FakeLxc(revision=COMMIT)
    problems, health = lxc_with(fake).health_problems(COMMIT)
    assert problems == [] and health["build"] == "build-121"
    assert any(c.endswith("docker compose ps --format json") and "packaging/compose" in c for c in fake.commands)


def test_health_problems_also_reads_the_array_older_docker_compose_prints():
    class Array(FakeLxc):
        def __call__(self, command, timeout):
            if "compose ps" in command:
                return 0, json.dumps(SERVICES) + "\n"
            return super().__call__(command, timeout)

    assert lxc_with(Array(revision=COMMIT)).health_problems(COMMIT)[0] == []


def test_health_problems_names_every_way_it_can_be_wrong():
    ok = {"Service": "mantel-server", "State": "running", "Health": "healthy"}

    def problems(**kw):
        return lxc_with(FakeLxc(revision=kw.pop("revision", COMMIT), **kw)).health_problems(COMMIT)[0]

    assert problems(services=[{**ok, "Health": "unhealthy"}]) == ["mantel-server unhealthy"]
    assert problems(services=[{**ok, "Health": "starting"}]) == ["mantel-server starting"]
    assert problems(services=[ok, {"Service": "caddy", "State": "restarting", "Health": ""}]) == ["caddy restarting"]
    assert problems(services=[]) == ["no service is running"]
    assert problems(revision=OLD, services=[ok]) == [f"mantel-server runs revision {OLD[:9]}, not {COMMIT[:9]}"]
    assert problems(revision="", services=[ok]) == [f"mantel-server runs revision ?, not {COMMIT[:9]}"]
    assert problems(health_code="503", services=[ok]) == ["/healthz?strict=1 answered 503"]
    assert problems(health_code=None, services=[ok]) == ["/healthz?strict=1 answered nothing"]
    down = {"upstream": {"home_assistant": {"connected": False}}}
    assert problems(health=down, services=[ok]) == ["Home Assistant is not connected"]
    assert problems(health={}, services=[ok]) == ["Home Assistant is not connected"]


def test_health_problems_runs_the_strict_check_inside_the_container():
    fake = FakeLxc(revision=COMMIT)
    lxc_with(fake).health_problems(COMMIT)
    (command,) = [c for c in fake.commands if c.startswith("docker exec mantel-server python -c")]
    assert "127.0.0.1:8765/healthz?strict=1" in command, "Caddy doesn't forward /healthz from outside"


def test_healthy_tries_again_until_it_is_or_the_deadline_passes(clock):
    class Slow(FakeLxc):
        calls = 0

        def __call__(self, command, timeout):
            if "compose ps" in command:
                Slow.calls += 1
                state = "running" if Slow.calls >= 3 else "restarting"
                return 0, json.dumps({"Service": "mantel-server", "State": state, "Health": "healthy"}) + "\n"
            return super().__call__(command, timeout)

    fake = Slow(revision=COMMIT)
    assert lxc_with(fake, every=10).healthy(COMMIT, timeout=180)["build"] == "build-121"
    assert Slow.calls == 3 and clock[0] == 20, "two waits of 10 s"

    fake = FakeLxc(revision=OLD)
    with pytest.raises(rh.Refused, match=r"not healthy after 25 s: mantel-server runs revision abcdef012") as e:
        lxc_with(fake, every=10).healthy(COMMIT, timeout=25)
    assert "192.0.2" not in str(e.value)
    assert sum("compose ps" in c for c in fake.commands) > 1, "it tried more than once"

    fake = FakeLxc(revision=OLD)
    with pytest.raises(rh.Refused, match="not healthy after 0 s"):
        lxc_with(fake).healthy(COMMIT, timeout=0)
    assert sum("compose ps" in c for c in fake.commands) == 1


def test_log_problems_are_errors_from_mantel_and_warnings_from_the_others(clock):
    log = ("mantel-server  | INFO started\n"
           "mantel-server  | Traceback (most recent call last):\n"
           "mantel-server  | ERROR mantel.hub: boom\n"
           "caddy          | 2026/11/03 ERROR tls: handshake\n"
           "go2rtc         | ERROR streams: no source\n"
           "announce       | Traceback (most recent call last):\n"
           "caddy          | INFO fine\n")
    fake = FakeLxc(log=log)
    errors, warnings = lxc_with(fake, settle=20).log_problems()
    assert errors == ["mantel-server  | Traceback (most recent call last):", "mantel-server  | ERROR mantel.hub: boom"]
    assert warnings == ["caddy          | 2026/11/03 ERROR tls: handshake", "go2rtc         | ERROR streams: no source",
                        "announce       | Traceback (most recent call last):"]
    assert clock[0] == 20, "it waited for the first moments' log"
    assert any("--since" in c and "2026-11-03T10:00:00Z" in c for c in fake.commands), "since mantel-server started"
    assert lxc_with(FakeLxc(log="mantel-server  | INFO ok\n")).log_problems() == ([], [])


def test_ssh_is_batch_mode_with_a_checked_host_key_and_a_timeout_is_a_status(monkeypatch):
    seen = {}

    def fake_run(cmd, **kw):
        seen.update(cmd=cmd, **kw)
        return subprocess.CompletedProcess(cmd, 0, "out\n", "err\n")

    monkeypatch.setattr(rh.subprocess, "run", fake_run)
    code, out = rh.Lxc(ADDRESS, KEY)._ssh("echo hi", 30)
    cmd = seen["cmd"]
    assert (code, out) == (0, "out\nerr\n") and cmd[0] == "ssh" and cmd[-2:] == [ADDRESS, "echo hi"]
    assert cmd[cmd.index("-i") + 1] == KEY
    assert "BatchMode=yes" in cmd and "StrictHostKeyChecking=yes" in cmd and seen["timeout"] == 30

    def times_out(cmd, **kw):
        raise subprocess.TimeoutExpired(cmd, 30)
    monkeypatch.setattr(rh.subprocess, "run", times_out)
    code, out = rh.Lxc(ADDRESS, KEY)._ssh("echo hi", 30)
    assert code == 124 and "192.0.2" not in out


def test_the_settings_name_the_lxc_and_its_key_and_are_refused_when_missing():
    with pytest.raises(rh.Refused, match="no LXC to release to"):
        rh.Lxc.from_settings({"ha_url": "http://192.0.2.9:8123"})
    lxc = rh.Lxc.from_settings({"lxc_ssh": ADDRESS, "lxc_key": KEY}, runner=FakeLxc())
    assert (lxc.target, lxc.key) == (ADDRESS, KEY)


def test_no_address_and_no_key_path_leaves_the_lxc_class(clock):
    echo = f"ssh: connect to host 192.0.2.7 port 22: refused ({ADDRESS}, key {KEY})"

    def leaky(command, timeout):
        return 255, echo

    lxc = rh.Lxc(ADDRESS, KEY, runner=leaky)
    for call in (lxc.clean, lambda: lxc.update(COMMIT), lambda: lxc.healthy(COMMIT, timeout=0), lxc.head,
                 lambda: lxc.log_problems()):
        with pytest.raises(rh.Refused) as e:
            call()
        text = str(e.value)
        assert "192.0.2.7" not in text and KEY not in text and "someone" not in text, text
        assert "the LXC" in text or "<key>" in text or "not healthy" in text
    assert lxc.scrub(echo) == "ssh: connect to host the LXC port 22: refused (the LXC, key <key>)"


# ---- the notes: "## Unreleased"

def test_the_notes_are_the_unreleased_section(tmp_path):
    log = tmp_path / "CHANGELOG.md"
    log.write_text("# Changelog\n\n## Unreleased\n\n- a\n- b\n\n## 0.1.1 - 2026-10-01\n\n- old\n")
    assert rh.unreleased(log) == "- a\n- b"
    log.write_text("# Changelog\n\n## Unreleased\n\n## 0.1.1 - 2026-10-01\n\n- old\n")
    assert rh.unreleased(log) == ""
    log.write_text("# Changelog\n\n## 0.1.1 - 2026-10-01\n\n- old\n")
    assert rh.unreleased(log) == ""
    log.write_text("# Changelog\n\n## Unreleased\n\n- only\n")
    assert rh.unreleased(log) == "- only", "the last section runs to the end"


def test_notes_given_on_the_command_line_go_into_unreleased_after_what_is_there(tmp_path):
    log = tmp_path / "CHANGELOG.md"
    log.write_text("# Changelog\n\n## Unreleased\n\n## 0.1.1 - 2026-10-01\n\n- old\n")
    rh.add_to_unreleased(log, "- First.\n")
    assert rh.unreleased(log) == "- First."
    rh.add_to_unreleased(log, "- Second.\n")
    assert rh.unreleased(log) == "- First.\n\n- Second."
    text = log.read_text()
    assert text.index("## Unreleased") < text.index("- Second.") < text.index("## 0.1.1 - 2026-10-01") < text.index("- old")
    assert "## 0.1.1 - 2026-10-01\n\n- old\n" in text
    log.write_text("# Changelog\n\n## 0.1.1 - 2026-10-01\n\n- old\n")
    with pytest.raises(rh.Refused, match='no "## Unreleased" section'):
        rh.add_to_unreleased(log, "- x")


def test_a_components_unreleased_is_named_with_a_new_empty_one_above(tmp_path):
    log = tmp_path / "CHANGELOG.md"
    log.write_text("# Changelog\n\n## Unreleased\n\n- Fixed a thing.\n\n## 1.0.0 - 2026-10-01\n\n- old\n")
    rh.name_section(log, "1.0.1", TODAY)
    assert log.read_text() == ("# Changelog\n\n## Unreleased\n\n## 1.0.1 - 2026-10-27\n\n- Fixed a thing.\n\n"
                               "## 1.0.0 - 2026-10-01\n\n- old\n")
    assert rh.unreleased(log) == "" and rh.changelog_has(log, "1.0.1") and rh.changelog_has(log, "1.0.0")
    before = log.read_text()
    with pytest.raises(rh.Refused, match="has a 1.0.1 section already"):
        rh.name_section(log, "1.0.1", TODAY)
    log.write_text("# Changelog\n\n## 1.0.0 - 2026-10-01\n\n- old\n")
    with pytest.raises(rh.Refused, match='no "## Unreleased" section'):
        rh.name_section(log, "1.0.1", TODAY)
    assert log.read_text() == "# Changelog\n\n## 1.0.0 - 2026-10-01\n\n- old\n"
    assert before != log.read_text()
    assert not rh.changelog_has(log, "1.0.10") and rh.changelog_has(log, "1.0.0")


# ---- what the release needs to be ready

def make_tree(root: Path, version: str = "0.1.120", changelog: str | None = None) -> None:
    """The files a Mantel release reads and bumps, at `version` (a stand-in for the repository)."""
    for name in ("packaging/ha-app/config.yaml", "packaging/connect-app/config.yaml"):
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        (root / name).write_text(f'name: Mantel\nversion: "{version}"\nslug: mantel\n')
    (root / "pyproject.toml").write_text(f'[project]\nname = "mantel"\nversion = "{version}"\n')
    (root / "CHANGELOG.md").write_text(changelog if changelog is not None else (
        f"# Changelog\n\n## Unreleased\n\n- Tablets reconnect after sleep.\n\n## {version} - 2026-11-03\n\n- older\n"))


def test_retry_needs_head_at_the_version_with_its_section(tmp_path, monkeypatch):
    monkeypatch.setattr(rh, "ROOT", tmp_path)
    monkeypatch.setattr(rh, "_load", tool)
    make_tree(tmp_path, "0.1.121", "# Changelog\n\n## Unreleased\n\n## 0.1.121 - 2026-11-03\n\n- notes\n")
    assert rh.release_ready("0.1.121", True, "") == "retry"
    with pytest.raises(rh.Refused, match=r"--retry needs HEAD at 0.1.122 .*it says 0.1.121"):
        rh.release_ready("0.1.122", True, "")
    make_tree(tmp_path, "0.1.121", "# Changelog\n\n## Unreleased\n\n- notes\n")
    with pytest.raises(rh.Refused, match="--retry needs HEAD at 0.1.121"):
        rh.release_ready("0.1.121", True, ""), "a bumped version with no section of its own"


def test_a_version_already_at_head_refuses_without_retry_and_an_empty_unreleased_refuses(tmp_path, monkeypatch):
    monkeypatch.setattr(rh, "ROOT", tmp_path)
    monkeypatch.setattr(rh, "_load", tool)
    make_tree(tmp_path, "0.1.121", "# Changelog\n\n## Unreleased\n\n## 0.1.121 - 2026-11-03\n\n- notes\n")
    with pytest.raises(rh.Refused, match=r"HEAD says 0.1.121 already: that is a retry \(--retry\)"):
        rh.release_ready("0.1.121", False, "")
    make_tree(tmp_path, "0.1.120", "# Changelog\n\n## Unreleased\n\n## 0.1.120 - 2026-11-03\n\n- notes\n")
    with pytest.raises(rh.Refused, match='nothing to say: CHANGELOG.md\'s "## Unreleased" is empty'):
        rh.release_ready("0.1.121", False, "")
    with pytest.raises(rh.Refused, match="nothing to say"):
        rh.release_ready("0.1.121", False, "  \n")
    assert rh.release_ready("0.1.121", False, "- from --notes") == "bump"
    make_tree(tmp_path, "0.1.120")                       # an Unreleased with bullets
    assert rh.release_ready("0.1.121", False, "") == "bump"


def _origin(monkeypatch, branches: str = "", in_progress: str = "[]"):
    calls = []

    def fake_run(*cmd, **kw):
        calls.append(cmd)
        if cmd[:3] == ("git", "ls-remote", "--heads"):
            return branches
        if cmd[:3] == ("gh", "run", "list"):
            return in_progress
        raise AssertionError(cmd)
    monkeypatch.setattr(rh, "run", fake_run)
    return calls


def test_another_release_on_origin_or_running_refuses_and_the_versions_own_branch_does_not(monkeypatch):
    _origin(monkeypatch)
    assert rh.other_release_in_progress("0.1.121") is None
    _origin(monkeypatch, f"{OLD}\trefs/heads/release/0.1.121\n")
    assert rh.other_release_in_progress("0.1.121") is None, "this version's own branch (a retry) is fine"
    _origin(monkeypatch, f"{OLD}\trefs/heads/release/0.1.120\n{OLD}\trefs/heads/release/0.1.121\n")
    assert "origin has release/0.1.120" in rh.other_release_in_progress("0.1.121")
    _origin(monkeypatch, f"{OLD}\trefs/heads/release/0.1.1210\n")
    assert "release/0.1.1210" in rh.other_release_in_progress("0.1.121"), "a longer version is another one"
    _origin(monkeypatch, "", '[{"databaseId": 5, "url": "https://example.com/run/5"}]')
    assert rh.other_release_in_progress("0.1.121") == "a release workflow is running (https://example.com/run/5)"


# ---- the release, house first

class FakeGh:
    """release.yml's runs: the images run (101) and the promote run (102), as `gh run view --json` shows them."""

    def __init__(self):
        self.head_sha, self.hide_sha_first = COMMIT, False
        self.failed_image = None                    # the name of an image job that fails
        self.suite = ["success"]                    # the main suite's conclusion on each attempt
        self.attempt = 0
        self.pending = 0                            # views that show the run still going
        self.after_rerun = 0
        self.promote = "success"
        self.views = 0

    def view(self, run_id: str) -> dict:
        url = f"https://example.com/runs/{run_id}"
        if run_id == "102":
            return {"status": "completed", "conclusion": self.promote, "url": url, "headSha": COMMIT, "jobs": []}
        self.views += 1
        names = [f"App image {i}" for i in range(4)] + [f"Docker image {i}" for i in range(6)] + \
                [f"Docker manifest {i}" for i in range(3)]
        jobs = [{"name": n, "status": "completed", "conclusion": "failure" if n == self.failed_image else "success"}
                for n in names]
        suite = self.suite[min(self.attempt, len(self.suite) - 1)]
        jobs.append({"name": "The main suite", "status": "completed", "conclusion": suite})
        view = {"url": url, "jobs": jobs, "status": "completed",
                "conclusion": "success" if suite == "success" and not self.failed_image else "failure"}
        if not (self.hide_sha_first and self.views == 1):
            view["headSha"] = self.head_sha
        if self.pending > 0 or self.after_rerun > 0:
            self.pending, self.after_rerun = max(0, self.pending - 1), max(0, self.after_rerun - 1)
            view["status"] = "in_progress"
            view["jobs"] = [{**j, "status": "in_progress", "conclusion": None} for j in jobs]
        return view

    def rerun(self) -> None:
        self.attempt += 1
        self.after_rerun = 1


class Harness:
    """release_mantel with its world replaced: gh (rh.run), git (rh.git), the LXC, the clock and the repository's
    files (a temporary tree standing in for ROOT). `events` is everything it did, in order."""

    def __init__(self, monkeypatch, tmp_path, clock, version="0.1.120"):
        self.events: list[str] = []
        self.tmp, self.clock = tmp_path, clock
        self.gh, self.fake = FakeGh(), FakeLxc(self.events, version=version)
        self.release_notes: list[str] = []
        self.preflights: list[bool] = []
        self.local_tags: list[str] = []
        make_tree(tmp_path, version)
        bump, check_version = tool("bump_version"), tool("check_version")

        def load(name):
            if name == "bump_version":          # (the real one, on the temporary tree)
                return types.SimpleNamespace(set_version=lambda v: bump.set_version(v, tmp_path),
                                             name_unreleased=lambda v: bump.name_unreleased(v, tmp_path, TODAY))
            assert name == "check_version", name
            return check_version

        def fake_run(*cmd, **kw):
            self.events.append("run " + " ".join(cmd))
            if cmd[:3] == ("gh", "workflow", "run"):
                return f"created https://example.com/org/repo/actions/runs/{102 if 'stage=promote' in cmd else 101}\n"
            if cmd[:3] == ("gh", "run", "view"):
                return json.dumps(self.gh.view(cmd[3]))
            if cmd[:3] == ("gh", "run", "rerun"):
                self.gh.rerun()
                return ""
            if cmd[:3] in (("gh", "run", "list"), ):
                return "[]"
            if cmd[:3] == ("git", "ls-remote", "--heads"):
                return ""
            if cmd[:3] == ("gh", "release", "create"):
                self.release_notes.append(Path(cmd[cmd.index("--notes-file") + 1]).read_text())
            return ""

        def fake_git(*args):
            self.events.append("git " + " ".join(args)[:140].replace("\n", " "))
            if args[:2] == ("tag", "-l"):
                return "\n".join(self.local_tags)
            return COMMIT if args[:2] == ("rev-parse", "HEAD") else ""

        real_suite = rh.suite_passed

        def suite(run_id):
            self.events.append("suite " + run_id)
            return real_suite(run_id)

        def preflight(from_origin=False):
            self.preflights.append(from_origin)
            return COMMIT, {}

        monkeypatch.setattr(rh, "ROOT", tmp_path)
        monkeypatch.setattr(rh, "run", fake_run)
        monkeypatch.setattr(rh, "git", fake_git)
        monkeypatch.setattr(rh, "_load", load)
        monkeypatch.setattr(rh, "preflight", preflight)
        monkeypatch.setattr(rh, "check_tag_free", lambda v: self.events.append(f"check_tag_free {v}"))
        monkeypatch.setattr(rh, "recheck", lambda: self.events.append("recheck"))
        monkeypatch.setattr(rh, "private_regex", lambda: "words")
        monkeypatch.setattr(rh, "suite_passed", suite)

    def lxc(self) -> rh.Lxc:
        return rh.Lxc(ADDRESS, KEY, runner=self.fake, settle=20, every=10)

    def release(self, version="0.1.121", notes="", dry=False, **kw) -> list[str]:
        return rh.release_mantel(version, notes, dry, lxc=kw.pop("lxc", None) or self.lxc(), **kw)

    def at(self, text: str, start: int = 0) -> int:
        for i in range(start, len(self.events)):
            if text in self.events[i]:
                return i
        raise AssertionError(f"{text!r} not among the events:\n" + "\n".join(self.events))

    def has(self, text: str) -> bool:
        return any(text in e for e in self.events)


@pytest.fixture
def harness(monkeypatch, tmp_path, clock):
    return Harness(monkeypatch, tmp_path, clock)


def test_the_house_first_release_in_order_with_the_tag_only_after_health_and_the_suite(harness, capsys):
    harness.gh.pending = 2                                     # the images are still building at first
    lines = harness.release("0.1.121")
    at = harness.at
    order = [at("git commit -q -m Release 0.1.121 to the house"), at("recheck"),
             at("git push -q --no-verify origin HEAD:refs/heads/main"),
             at(f"git push -q --no-verify origin {COMMIT}:refs/heads/release/0.1.121"),
             at("run gh workflow run release.yml --ref release/0.1.121 -f stage=images -f publish=true"),
             at("run gh run view 101"),
             at(f"lxc MANTEL_UPDATE_REF={COMMIT} update"),
             at("lxc cd /opt/mantel/packaging/compose && docker compose ps"),
             at("lxc cd /opt/mantel/packaging/compose && docker compose logs"),
             at("suite 101"),
             at("git tag -a v0.1.121 -m Mantel 0.1.121"),
             at("git push -q --no-verify origin refs/tags/v0.1.121"),
             at("run gh workflow run release.yml --ref v0.1.121 -f stage=promote -f images_run=101 -f publish=true"),
             at("run gh release create v0.1.121 --title Mantel 0.1.121"),
             at("run git push -q --no-verify origin --delete refs/heads/release/0.1.121")]
    assert order == sorted(order) and len(set(order)) == len(order), "\n".join(harness.events)
    # the tag after the house is healthy AND the suite passed; the house after the images; nothing sent after a tag it needs
    assert at("git tag -a") > at("suite 101") > at("docker compose logs") > at("docker compose ps")
    assert harness.preflights == [False]
    # the bump on the temporary tree: the version everywhere, the notes named, a new empty Unreleased above
    assert 'version = "0.1.121"' in (harness.tmp / "pyproject.toml").read_text()
    assert 'version: "0.1.121"' in (harness.tmp / "packaging/ha-app/config.yaml").read_text()
    changelog = harness.tmp / "CHANGELOG.md"
    assert rh.unreleased(changelog) == ""
    assert "## Unreleased\n\n## 0.1.121 - 2026-" in changelog.read_text()
    assert "Tablets reconnect after sleep." in rh.changelog_section(changelog, "0.1.121")
    # the GitHub Release carries the section and the footer
    (notes,) = harness.release_notes
    assert "Tablets reconnect after sleep." in notes and "**Install or update:**" in notes and "tagged `0.1.121`" in notes
    # the record lines
    text = "\n".join(lines)
    assert f"Mantel 0.1.121, release commit `{COMMIT[:7]}`, tagged `v0.1.121`; the LXC 0.1.120 -> 0.1.121" in text
    assert "Images run 101 (stage=images), promote run 102, GitHub Release `v0.1.121`." in text
    assert "Strict health 200, all services healthy" in text and "Home Assistant connected for 42 s" in text
    assert "Linux suite passed." in text
    times = next(ln for ln in lines if ln.startswith("Times: "))
    assert "images built and pushed 15 s" in times and "the LXC updated and healthy 20 s" in times
    assert "preflight 0 s" in times and "tagged 0 s" in times and re.search(r"\d+\.\d minutes in all", times)
    # the old pin check ran, the working LXC was not touched by anything but the update
    assert not any("config mantel.ref" in c and "--get" not in c for c in harness.fake.commands)
    assert ADDRESS not in capsys.readouterr().out


def test_a_retried_release_skips_the_bump_and_the_push_to_main(monkeypatch, tmp_path, clock):
    h = Harness(monkeypatch, tmp_path, clock, version="0.1.121")
    (tmp_path / "CHANGELOG.md").write_text("# Changelog\n\n## Unreleased\n\n## 0.1.121 - 2026-11-03\n\n- Notes.\n")
    h.release("0.1.121", retry=True, from_origin=True)
    assert not h.has("git commit") and not h.has("HEAD:refs/heads/main") and not h.has("recheck")
    assert h.has(f"{COMMIT}:refs/heads/release/0.1.121") and h.has("git tag -a v0.1.121")
    assert h.preflights == [True], "--from-origin reaches preflight"


def test_the_notes_option_goes_into_unreleased_beside_what_is_there(harness):
    harness.release("0.1.121", notes="- From the option.\n")
    section = rh.changelog_section(harness.tmp / "CHANGELOG.md", "0.1.121")
    assert section.index("Tablets reconnect after sleep.") < section.index("From the option.")


def test_an_image_job_that_fails_stops_before_the_house_and_the_tag(harness):
    harness.gh.failed_image = "Docker image 3"
    with pytest.raises(rh.Refused, match="the images: Docker image 3 failed"):
        harness.release()
    assert harness.has("stage=images") and not harness.has("update") and not harness.has("docker")
    assert not any("config mantel.ref" in c and "--get" not in c for c in harness.fake.commands), "the house is untouched"
    assert not harness.has("git tag") and not harness.has("stage=promote") and not harness.has("release create")
    assert not harness.has("--delete"), "the branch stays for the retry"
    assert harness.has("HEAD:refs/heads/main"), "the release commit is on main, untagged"


@pytest.mark.parametrize("fails", ["a service", "the revision", "the strict health", "home assistant"])
def test_a_house_that_is_not_healthy_gets_no_tag_no_promote_and_no_release(harness, fails):
    bad = {"a service": dict(services=[{"Service": "mantel-server", "State": "restarting", "Health": ""}]),
           "the revision": dict(revision=OLD), "the strict health": dict(health_code="503"),
           "home assistant": dict(health={"upstream": {"home_assistant": {"connected": False}}})}[fails]
    for k, v in bad.items():
        setattr(harness.fake, k, v)
    with pytest.raises(rh.Refused, match="Mantel on the LXC is not healthy after 180 s") as e:
        harness.release()
    assert harness.has("MANTEL_UPDATE_REF"), "the house was updated"
    assert f"The LXC stays on {COMMIT[:9]} (0.1.121, untagged)" in str(e.value)
    assert f"MANTEL_UPDATE_REF={OLD} update" in str(e.value), "and how to go back"
    assert not harness.has("suite") and not harness.has("git tag")
    assert not harness.has("stage=promote") and not harness.has("release create") and not harness.has("--delete")


def test_errors_in_mantels_log_stop_the_release_but_other_services_only_warn(harness, capsys):
    harness.fake.log = "go2rtc  | ERROR no source\nmantel-server  | INFO ok\n"
    lines = harness.release()
    assert "warning (not Mantel's own log): go2rtc  | ERROR no source" in capsys.readouterr().out
    assert "(1 warnings from the other services)" in "\n".join(lines)


def test_an_error_in_mantels_own_log_means_no_tag(harness):
    harness.fake.log = "mantel-server  | ERROR mantel.hub: boom\n"
    with pytest.raises(rh.Refused, match="log on the LXC has errors.*no tag") as e:
        harness.release()
    assert f"The LXC stays on {COMMIT[:9]}" in str(e.value) and f"MANTEL_UPDATE_REF={OLD} update" in str(e.value)
    assert not harness.has("git tag") and not harness.has("suite") and not harness.has("stage=promote")


def test_an_update_that_fails_on_the_lxc_stops_there(harness):
    harness.fake.update_status = 1
    with pytest.raises(rh.Refused, match="went back to what ran before"):
        harness.release()
    assert not harness.has("docker compose") and not harness.has("git tag")


def test_a_suite_that_fails_is_rerun_once_and_may_pass_then(harness):
    harness.gh.suite = ["failure", "success"]
    lines = harness.release()
    assert sum(e.startswith("run gh run rerun 101 --failed") for e in harness.events) == 1
    assert harness.at("run gh run rerun") < harness.at("git tag -a")
    assert "Linux suite passed when run again (it failed once)." in "\n".join(lines)


def test_a_suite_that_fails_twice_leaves_the_house_running_it_untagged(harness):
    harness.gh.suite = ["failure", "failure"]
    with pytest.raises(rh.Refused, match=r"failed twice: the house runs 0.1.121, untagged.*--retry") as e:
        harness.release()
    assert sum(ev.startswith("run gh run rerun") for ev in harness.events) == 1, "once, not forever"
    assert harness.has(f"MANTEL_UPDATE_REF={COMMIT}"), "the house runs it"
    assert not harness.has("git tag") and not harness.has("stage=promote") and not harness.has("release create")
    assert "The main suite" in str(e.value)


def test_a_failed_promote_leaves_the_tag_and_says_how_to_run_it_again(harness):
    harness.gh.promote = "failure"
    with pytest.raises(rh.Refused, match="promote failed") as e:
        harness.release()
    assert ("gh workflow run release.yml --ref v0.1.121 -f stage=promote -f images_run=101 -f publish=true"
            in str(e.value))
    assert "is tagged and on the house" in str(e.value)
    assert harness.has("git tag -a v0.1.121") and not harness.has("release create")
    assert harness.has("--delete"), "once tagged, the branch goes even when promote fails (it would block the next)"


@pytest.mark.parametrize("hidden_first", [False, True])
def test_images_built_from_another_commit_stop_before_the_house(harness, hidden_first):
    harness.gh.head_sha = "f" * 40                  # main moved, or the branch did
    harness.gh.hide_sha_first = hidden_first        # (the first view may not carry the sha yet; the second does)
    with pytest.raises(rh.Refused, match=r"the images run (101 builds|built) fffffffff, not 123456789: stopped before the house"):
        harness.release()
    assert not harness.has("MANTEL_UPDATE_REF") and not harness.has("update") and not harness.has("git tag")


def test_hand_changes_on_the_lxc_stop_the_release_before_anything_is_pushed(harness):
    harness.fake.dirty = " M packaging/compose/go2rtc/go2rtc.yaml\n"
    with pytest.raises(rh.Refused, match="hand changes in packaging/compose/go2rtc/go2rtc.yaml"):
        harness.release()
    assert not harness.has("git push") and not harness.has("git commit") and not harness.has("gh workflow")
    assert harness.fake.patches == []


def test_save_and_revert_saves_the_patch_first_and_the_record_says_so(harness):
    harness.fake.dirty = " M packaging/compose/go2rtc/go2rtc.yaml\n"
    lines = harness.release(save_and_revert=True)
    assert harness.at("reset -q --hard") < harness.at("git push"), "reverted before anything is pushed"
    assert harness.at("diff --binary HEAD > /root/mantel-hand-changes-") < harness.at("MANTEL_UPDATE_REF")
    assert "Hand changes on the LXC saved and reverted first: packaging/compose/go2rtc/go2rtc.yaml." in lines


def test_a_dry_run_looks_at_the_lxc_and_changes_nothing(harness, capsys):
    harness.fake.dirty = " M packaging/compose/go2rtc/go2rtc.yaml\n"
    harness.fake.pin, harness.fake.releasepin = OLD, f"{OLD} latest"
    assert harness.release(dry=True, save_and_revert=True) == []
    assert not harness.has("git push") and not harness.has("git commit") and not harness.has("gh workflow")
    assert not harness.has("git tag") and not harness.has("update")
    assert harness.fake.patches == [] and harness.fake.pin == OLD and harness.fake.releasepin, "no revert, no pin repair"
    assert "dry run: would bump to 0.1.121" in capsys.readouterr().out
    assert 'version = "0.1.120"' in (harness.tmp / "pyproject.toml").read_text()


def test_a_left_over_pin_this_tool_set_is_repaired_before_a_release(harness, capsys):
    harness.fake.pin, harness.fake.releasepin = OLD, f"{OLD} latest"
    harness.release()
    assert "was left pinned to abcdef012" in capsys.readouterr().out
    assert harness.fake.pin == "latest" and harness.fake.releasepin is None
    assert harness.at("config --unset mantel.releasepin") < harness.at("MANTEL_UPDATE_REF")


def test_a_pin_the_owner_set_survives_a_release(harness):
    harness.fake.pin = OLD
    harness.release()
    assert harness.fake.pin == OLD


def test_a_tag_that_exists_refuses_before_anything_changes(monkeypatch, tmp_path, clock):
    h = Harness(monkeypatch, tmp_path, clock)
    monkeypatch.setattr(rh, "check_tag_free", REAL_CHECK_TAG_FREE)
    _ls_remote(monkeypatch, f"{OLD}\trefs/tags/v0.1.121\n")
    with pytest.raises(rh.Refused, match="origin has the tag v0.1.121 already"):
        h.release()
    h.local_tags.append("v0.1.121")
    _ls_remote(monkeypatch, "")
    with pytest.raises(rh.Refused, match="exists here already"):
        h.release()
    assert not h.has("lxc") and not h.has("git push") and not h.has("gh ") and not h.has("git commit")


def test_nobody_sees_the_address_or_the_key_in_what_a_release_prints_or_records(harness, capsys):
    harness.fake.echo = f"on {ADDRESS} 192.0.2.7 via {KEY}"
    harness.fake.log = f"caddy  | ERROR dial 192.0.2.7 ({ADDRESS}) key {KEY}\n"
    harness.fake.dirty = " M packaging/compose/compose.yaml\n"
    lines = harness.release(save_and_revert=True)
    seen = capsys.readouterr().out + "\n".join(lines)
    for secret in ("192.0.2.7", ADDRESS, KEY, "someone"):
        assert secret not in seen
    assert "the LXC" in seen
    # and when it fails on the LXC
    harness.fake.update_status = 1
    harness.fake.dirty = ""
    with pytest.raises(rh.Refused) as e:
        harness.release("0.1.122", notes="- x")
    assert "192.0.2.7" not in str(e.value) and KEY not in str(e.value) and "the LXC" in str(e.value)


# ---- the release workflow, from here: dispatch, waits, the suite

def _gh(monkeypatch, handler):
    calls = []

    def fake_run(*cmd, **kw):
        calls.append(cmd)
        return handler(cmd)
    monkeypatch.setattr(rh, "run", fake_run)
    return calls


def test_dispatch_returns_the_run_id_gh_prints_or_finds_the_new_run(monkeypatch, clock):
    calls = _gh(monkeypatch, lambda cmd: "created https://example.com/org/repo/actions/runs/4711\n")
    assert rh.dispatch("release/0.1.121", "stage=images", "publish=true") == "4711"
    assert calls == [("gh", "workflow", "run", "release.yml", "--ref", "release/0.1.121",
                      "-f", "stage=images", "-f", "publish=true")]

    now = datetime.datetime.now(datetime.timezone.utc)

    def listing(cmd):
        if cmd[:3] == ("gh", "workflow", "run"):
            return "Created workflow_dispatch event\n"            # (no run URL in the output)
        old, new = now - datetime.timedelta(hours=1), now + datetime.timedelta(seconds=1)
        return json.dumps([{"databaseId": 7, "createdAt": old.isoformat().replace("+00:00", "Z")},
                           {"databaseId": 8, "createdAt": new.isoformat().replace("+00:00", "Z")}])
    calls = _gh(monkeypatch, listing)
    assert rh.dispatch("v0.1.121", "stage=promote") == "8", "the run created after the dispatch, not an older one"
    assert clock[0] == 5 and calls[1][:3] == ("gh", "run", "list") and "v0.1.121" in calls[1]

    _gh(monkeypatch, lambda cmd: "[]" if cmd[:3] == ("gh", "run", "list") else "")
    with pytest.raises(rh.Refused, match="release workflow from release/0.1.121 did not start"):
        rh.dispatch("release/0.1.121", "stage=images", wait_s=30)


def _jobs(**by_prefix):
    """Jobs named like the workflow's: {"App image ": ["success"]*4, ...} -> gh's jobs list."""
    return [{"name": f"{prefix}{i}", "status": "completed" if c else "in_progress", "conclusion": c}
            for prefix, conclusions in by_prefix.items() for i, c in enumerate(conclusions)]


def _views(monkeypatch, views: list[dict]):
    seen = []

    def view(run_id):
        seen.append(run_id)
        return views[min(len(seen) - 1, len(views) - 1)]
    monkeypatch.setattr(rh, "run_view", view)
    return seen


def test_wait_jobs_returns_when_the_jobs_it_wants_are_done_not_the_whole_run(monkeypatch, clock):
    wanted = {"App image ": 2, "Docker manifest ": 1}
    done = _jobs(**{"App image ": ["success", "success"], "Docker manifest ": ["success"]})
    going = [{"name": "The main suite", "status": "in_progress", "conclusion": None}]
    seen = _views(monkeypatch, [{"status": "in_progress", "jobs": done[:1]},
                                {"status": "in_progress", "jobs": [*done, *going]}])
    view = rh.wait_jobs("9", wanted, "the images", every=15)
    assert len(seen) == 2 and clock[0] == 15 and view["status"] == "in_progress"


def test_wait_jobs_refuses_a_failed_or_cancelled_job_and_a_run_that_ended_without_them(monkeypatch, clock):
    wanted = {"Docker image ": 2}
    for bad in ("failure", "cancelled", "timed_out"):
        _views(monkeypatch, [{"status": "in_progress", "url": "https://example.com/r",
                              "jobs": _jobs(**{"Docker image ": ["success", bad]})}])
        with pytest.raises(rh.Refused, match=r"the images: Docker image 1 failed \(https://example.com/r\)"):
            rh.wait_jobs("9", wanted, "the images")
    _views(monkeypatch, [{"status": "in_progress", "jobs": _jobs(**{"Docker image ": ["success", "skipped"]})}])
    assert rh.wait_jobs("9", wanted, "the images")["status"] == "in_progress", "a skipped job is not a failure"
    _views(monkeypatch, [{"status": "completed", "conclusion": "cancelled", "jobs": _jobs(**{"Docker image ": ["success"]})}])
    with pytest.raises(rh.Refused, match=r"the run ended \(cancelled\) without them"):
        rh.wait_jobs("9", wanted, "the images")
    _views(monkeypatch, [{"status": "in_progress", "jobs": _jobs(**{"Docker image ": ["success", None]})}])
    with pytest.raises(rh.Refused, match="not done after 2 minutes"):
        rh.wait_jobs("9", wanted, "the images", minutes=2, every=30)
    assert clock[0] >= 120


def test_wait_run_waits_for_the_whole_run(monkeypatch, clock):
    seen = _views(monkeypatch, [{"status": "queued"}, {"status": "in_progress"}, {"status": "completed", "conclusion": "success"}])
    assert rh.wait_run("9", every=15)["conclusion"] == "success" and len(seen) == 3 and clock[0] == 30
    _views(monkeypatch, [{"status": "in_progress", "url": "https://example.com/r"}])
    with pytest.raises(rh.Refused, match="https://example.com/r not done after 1 minutes"):
        rh.wait_run("9", minutes=1, every=15)


def test_the_suite_gets_one_rerun_and_a_timeout_is_not_a_flake(monkeypatch, clock):
    suite = _jobs(**{"The main suite": ["success"]})
    _views(monkeypatch, [{"status": "completed", "jobs": suite}])
    assert rh.suite_passed("9") == (True, "passed")

    failed = _jobs(**{"The main suite": ["failure"]})
    calls = _gh(monkeypatch, lambda cmd: "")
    _views(monkeypatch, [{"status": "completed", "jobs": failed},          # the first look
                         {"status": "completed", "jobs": failed},          # still the old result right after the rerun
                         {"status": "in_progress", "jobs": suite},         # GitHub started it again
                         {"status": "completed", "jobs": suite}])
    assert rh.suite_passed("9") == (True, "passed when run again (it failed once)")
    assert calls == [("gh", "run", "rerun", "9", "--failed")]

    calls = _gh(monkeypatch, lambda cmd: "")
    _views(monkeypatch, [{"status": "completed", "jobs": failed}, {"status": "in_progress", "jobs": failed},
                         {"status": "completed", "jobs": failed}])
    ok, why = rh.suite_passed("9")
    assert not ok and "The main suite0 failed" in why and len(calls) == 1

    calls = _gh(monkeypatch, lambda cmd: "")
    _views(monkeypatch, [{"status": "completed", "conclusion": "cancelled", "jobs": []}])
    with pytest.raises(rh.Refused, match="without them"):
        rh.suite_passed("9")
    assert calls == [], "a run that never had the suite is no flake: no rerun"


# ---- plan: what changed since each product's last release (a temporary git repository)

GIT_ENV = ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false",
           "-c", "tag.gpgsign=false", "-c", "core.hooksPath=/dev/null"]


class Repo:
    def __init__(self, path: Path):
        self.path = path
        path.mkdir(parents=True, exist_ok=True)
        self.git("init", "-q", "-b", "main")

    def git(self, *args: str) -> str:
        r = subprocess.run(["git", *GIT_ENV, "-C", str(self.path), *args], capture_output=True, text=True, check=True)
        return r.stdout.strip()

    def write(self, name: str, text: str) -> None:
        (self.path / name).parent.mkdir(parents=True, exist_ok=True)
        (self.path / name).write_text(text)

    def commit(self, message: str, **files: str) -> str:
        for name, text in files.items():
            self.write(name.replace("__", "/").replace("_dot_", "."), text)
        self.git("add", "-A")
        self.git("commit", "-q", "-m", message)
        return self.git("rev-parse", "HEAD")


HK_MANIFEST = '{\n  "domain": "hk_frontend",\n  "requirements": [],\n  "version": "1.0.0"\n}\n'


@pytest.fixture
def repo(tmp_path, monkeypatch):
    """A repository with a release of each product at its first commit; rh.git runs there."""
    r = Repo(tmp_path / "repo")
    r.commit("first", **{
        "web__app.js": "a\n", "hosts__server__x.py": "x\n", "hk_core__link__y.py": "y\n", "docs__guide.md": "guide\n",
        "pyproject.toml": '[project]\nname = "mantel"\nversion = "0.1.1"\ndependencies = ["aiohttp"]\n',
        "packaging__ha-app__config.yaml": 'name: Mantel\nversion: "0.1.1"\n',
        "CHANGELOG.md": "# Changelog\n\n## Unreleased\n",
        "hosts__ha__custom_components__hk_frontend__manifest.json": HK_MANIFEST,
        "hosts__ha__custom_components__hk_frontend__tools__publish__root__CHANGELOG.md": "# HK\n\n## Unreleased\n",
        "hosts__ha__custom_components__mantel__manifest.json": HK_MANIFEST.replace("hk_frontend", "mantel"),
        "hosts__ha__custom_components__mantel__tools__publish__root__CHANGELOG.md": "# ML\n\n## Unreleased\n",
        "hosts__ha__custom_components__mantel__link.py": "link\n",
    })
    first = r.git("rev-parse", "HEAD")
    r.git("tag", "-a", "v0.1.1", "-m", "Mantel 0.1.1")
    r.git("tag", "-a", "hk-frontend/v1.0.0", "-m", "HK Frontend 1.0.0")
    r.git("tag", "-a", "mantel-link/v0.1.0", "-m", "Mantel Link 0.1.0")
    r.first = first
    monkeypatch.setattr(rh, "git", lambda *a: r.git(*a))
    return r


def test_last_release_is_the_newest_version_tag_of_the_product(repo):
    assert rh.last_release("mantel") == ("0.1.1", repo.first)
    assert rh.last_release("hk-frontend") == ("1.0.0", repo.first)
    assert rh.last_release("mantel-link") == ("0.1.0", repo.first)
    later = repo.commit("later", **{"web__app.js": "b\n"})
    repo.git("tag", "-a", "v0.1.9", "-m", "x")
    repo.git("tag", "-a", "v0.1.10", "-m", "x", later)
    for odd in ("v0.1.11-rc1", "v1.2", "vnext", "latest"):
        repo.git("tag", odd, later)
    assert rh.last_release("mantel") == ("0.1.10", later), "version order, not alphabetical; other names ignored"
    assert rh.last_release("hk-frontend")[0] == "1.0.0", "Mantel's tags are not the components'"
    repo.git("tag", "-d", "mantel-link/v0.1.0")
    assert rh.last_release("mantel-link") == (None, None)


def test_changed_since_leaves_out_changelogs_and_version_lines(repo):
    repo.commit("release", **{
        "pyproject.toml": '[project]\nname = "mantel"\nversion = "0.1.2"\ndependencies = ["aiohttp"]\n',
        "packaging__ha-app__config.yaml": 'name: Mantel\nversion: "0.1.2"\n',
        "CHANGELOG.md": "# Changelog\n\n## Unreleased\n\n## 0.1.2 - 2026-11-03\n",
        "hosts__ha__custom_components__hk_frontend__manifest.json": HK_MANIFEST.replace("1.0.0", "1.0.1"),
        "hosts__ha__custom_components__hk_frontend__tools__publish__root__CHANGELOG.md": "# HK\n\n## 1.0.1\n",
        "hosts__ha__custom_components__mantel__manifest.json": HK_MANIFEST.replace("hk_frontend", "mantel").replace("1.0.0", "0.1.1"),
        "hosts__ha__custom_components__mantel__tools__publish__root__CHANGELOG.md": "# ML\n\n## 0.1.1\n",
        "docs__guide.md": "a new guide\n"})
    for product in rh.PRODUCTS:
        assert rh.changed_since(product, repo.first) == [], product


def test_changed_since_counts_the_products_own_inputs_only(repo):
    repo.commit("a server file", **{"hosts__server__x.py": "x2\n"})
    assert rh.changed_since("mantel", repo.first) == ["hosts/server/x.py"]
    assert rh.changed_since("hk-frontend", repo.first) == [], "HK Frontend isn't built from hosts/server"
    assert rh.changed_since("mantel-link", repo.first) == []
    repo.commit("a web file", **{"web__app.js": "a2\n"})
    assert rh.changed_since("mantel", repo.first) == ["hosts/server/x.py", "web/app.js"]
    assert rh.changed_since("hk-frontend", repo.first) == ["web/app.js"]
    repo.commit("a Mantel Link file", **{"hosts__ha__custom_components__mantel__link.py": "link2\n"})
    assert rh.changed_since("mantel-link", repo.first) == ["hosts/ha/custom_components/mantel/link.py"]
    assert "hosts/ha/custom_components/mantel/link.py" in rh.changed_since("hk-frontend", repo.first), "hosts/ha/ is HK's"
    assert "hosts/ha/custom_components/mantel/link.py" not in rh.changed_since("mantel", repo.first)
    assert rh.changed_since("mantel", repo.first, head=repo.first) == []
    repo.commit("docs only", **{"docs__guide.md": "more\n"})
    assert not any(f.startswith("docs/") for p in rh.PRODUCTS for f in rh.changed_since(p, repo.first))


def test_a_version_file_counts_when_more_than_its_version_line_changed(repo):
    repo.commit("a dependency and the version", **{
        "pyproject.toml": '[project]\nname = "mantel"\nversion = "0.1.2"\ndependencies = ["aiohttp", "yarl"]\n'})
    assert rh.changed_since("mantel", repo.first) == ["pyproject.toml"]
    repo.commit("only a version", **{"packaging__ha-app__config.yaml": 'name: Mantel\nversion: "0.1.3"\n'})
    assert rh.changed_since("mantel", repo.first) == ["pyproject.toml"], "config.yaml's version line is not a change"
    repo.commit("a manifest's requirements", **{
        "hosts__ha__custom_components__hk_frontend__manifest.json": HK_MANIFEST.replace("[]", '["x"]')})
    assert rh.changed_since("hk-frontend", repo.first) == ["hosts/ha/custom_components/hk_frontend/manifest.json",
                                                           "pyproject.toml"], "(pyproject.toml is HK Frontend's input too)"


def test_the_plan_says_per_product_what_changed_and_the_next_version(repo, capsys):
    repo.commit("a server file", **{"hosts__server__x.py": "x2\n"})
    rows = {r["product"]: r for r in rh.release_plan()}
    assert rows["mantel"] == {"product": "mantel", "version": "0.1.1", "commit": repo.first,
                              "files": ["hosts/server/x.py"], "changed": True, "next": "0.1.2"}
    assert rows["hk-frontend"]["changed"] is False and rows["hk-frontend"]["next"] == "1.0.1"
    assert rows["mantel-link"]["changed"] is False and rows["mantel-link"]["next"] == "0.1.1"
    rh.print_plan(list(rows.values()))
    out = capsys.readouterr().out.splitlines()
    assert out == [f"Mantel 0.1.1 ({repo.first[:9]}): 1 file changed (hosts/server/x.py): next 0.1.2",
                   f"HK Frontend 1.0.0 ({repo.first[:9]}): unchanged",
                   f"Mantel Link 0.1.0 ({repo.first[:9]}): unchanged"]


def test_a_product_with_no_tag_is_changed_and_says_to_backfill(repo, capsys):
    repo.git("tag", "-d", "hk-frontend/v1.0.0")
    for i in range(4):
        repo.commit(f"web {i}", **{"web__app.js": f"{i}\n"})
    rows = {r["product"]: r for r in rh.release_plan()}
    assert rows["hk-frontend"]["commit"] is None and rows["hk-frontend"]["changed"] and rows["hk-frontend"]["next"] is None
    rh.print_plan(list(rows.values()))
    out = capsys.readouterr().out
    assert "HK Frontend: no hk-frontend/v* tag here (backfill-tags)" in out
    assert "1 file changed (web/app.js): next 0.1.2" in out
    assert rh.next_version("0.1.9") == "0.1.10" and rh.next_version("1.40.0") == "1.40.1"


def test_a_long_file_list_is_cut_in_the_plan(capsys):
    row = {"product": "mantel", "version": "0.1.1", "commit": OLD, "files": [f"web/{i}.js" for i in range(5)],
           "changed": True, "next": "0.1.2"}
    rh.print_plan([row])
    assert "5 files changed (web/0.js, web/1.js, web/2.js, ...): next 0.1.2" in capsys.readouterr().out


def test_versions_take_product_equals_version_pairs_and_nothing_else():
    assert rh.parse_versions(None) == {} and rh.parse_versions("") == {}
    assert rh.parse_versions("mantel=0.1.121,hk-frontend=1.41.0") == {"mantel": "0.1.121", "hk-frontend": "1.41.0"}
    for bad in ("mantel", "mantel=", "mantel=1.2", "mantel=v1.2.3", "ha-app=1.2.3", "mantel=1.2.3.4", "mantel=1.2.3,x"):
        with pytest.raises(rh.Refused, match="--versions takes product=X.Y.Z pairs"):
            rh.parse_versions(bad)


# ---- the per-product tags

def test_a_product_tag_is_annotated_on_its_commit_and_pushed_alone(monkeypatch):
    calls = []
    monkeypatch.setattr(rh, "git", lambda *a: calls.append(a) or "")
    assert rh.tag_product("hk-frontend", "1.41.0", COMMIT) == "hk-frontend/v1.41.0"
    assert rh.tag_product("mantel-link", "0.1.13", COMMIT) == "mantel-link/v0.1.13"
    assert calls == [("tag", "-a", "hk-frontend/v1.41.0", "-m", "HK Frontend 1.41.0", COMMIT),
                     ("push", "-q", "--no-verify", "origin", "refs/tags/hk-frontend/v1.41.0"),
                     ("tag", "-a", "mantel-link/v0.1.13", "-m", "Mantel Link 0.1.13", COMMIT),
                     ("push", "-q", "--no-verify", "origin", "refs/tags/mantel-link/v0.1.13")]
    # (the LXC's `update` follows v[0-9]* only)
    assert not re.match(r"v[0-9]", rh.TAG_PREFIX["hk-frontend"]) and not re.match(r"v[0-9]", rh.TAG_PREFIX["mantel-link"])


def test_a_product_tag_must_be_free_here_and_on_origin(monkeypatch):
    local = []
    remote = [""]

    def fake_git(*a):
        return "\n".join(local) if a[:2] == ("tag", "-l") else ""
    monkeypatch.setattr(rh, "git", fake_git)
    monkeypatch.setattr(rh, "run", lambda *cmd, **kw: remote[0])
    rh.check_product_tag_free("hk-frontend", "1.41.0")
    remote[0] = f"{OLD}\trefs/tags/hk-frontend/v1.41.0\n"
    with pytest.raises(rh.Refused, match="origin has the tag hk-frontend/v1.41.0 already"):
        rh.check_product_tag_free("hk-frontend", "1.41.0")
    local.append("mantel-link/v0.1.13")
    with pytest.raises(rh.Refused, match="the tag mantel-link/v0.1.13 exists here already"):
        rh.check_product_tag_free("mantel-link", "0.1.13")


def _backfill(monkeypatch, messages: dict[str, list[str]], tagged: dict[str, str] | None = None):
    made, asked = [], []
    monkeypatch.setattr(rh, "last_release", lambda product: ((tagged or {}).get(product), None))

    def gh(*args):
        asked.append(args)
        return messages[args[1].split("/commits")[0].removeprefix("repos/")]
    monkeypatch.setattr(rh, "gh_json", gh)
    monkeypatch.setattr(rh, "git", lambda *a: "c" * 40 if a[0] == "rev-parse" else "")
    monkeypatch.setattr(rh, "tag_product", lambda product, version, commit: made.append((product, version, commit)))
    return made, asked


MESSAGES = {rh.COMPONENTS["hk-frontend"]["public"]: ["Update the Wiki", "Mantel Link 0.1.12 (from mantel f6c000b6)",
                                                     "HK Frontend 1.40.0 (from mantel d81a674d)",
                                                     "HK Frontend 1.39.0 (from mantel aaaaaaa)"],
            rh.COMPONENTS["mantel-link"]["public"]: ["Mantel Link 0.1.12 (from mantel f6c000b6)",
                                                     "Mantel Link 0.1.11 (from mantel bbbbbbb)"]}


def test_backfill_tags_the_commits_the_newest_public_releases_came_from(monkeypatch, capsys):
    made, asked = _backfill(monkeypatch, MESSAGES)
    assert rh.backfill_tags(dry=False) == ["hk-frontend/v1.40.0", "mantel-link/v0.1.12"]
    assert made == [("hk-frontend", "1.40.0", "c" * 40), ("mantel-link", "0.1.12", "c" * 40)]
    assert [a[0] for a in asked] == ["api", "api"] and "tagging hk-frontend/v1.40.0 on ccccccccc" in capsys.readouterr().out


def test_backfill_has_a_dry_run_skips_what_is_tagged_and_refuses_what_it_cannot_find(monkeypatch, capsys):
    made, _ = _backfill(monkeypatch, MESSAGES)
    assert rh.backfill_tags(dry=True) == ["hk-frontend/v1.40.0", "mantel-link/v0.1.12"] and made == []
    assert "dry run: would tag hk-frontend/v1.40.0" in capsys.readouterr().out
    made, asked = _backfill(monkeypatch, MESSAGES, tagged={"hk-frontend": "1.40.0"})
    assert rh.backfill_tags(dry=False) == ["mantel-link/v0.1.12"] and made == [("mantel-link", "0.1.12", "c" * 40)]
    assert len(asked) == 1 and "tagged already (hk-frontend/v1.40.0)" in capsys.readouterr().out
    _backfill(monkeypatch, {**MESSAGES, rh.COMPONENTS["hk-frontend"]["public"]: ["Update the Wiki", "something else"]})
    with pytest.raises(rh.Refused, match=r"no 'HK Frontend X.Y.Z \(from mantel <commit>\)' among"):
        rh.backfill_tags(dry=False)


# ---- all: every product that changed, in order

def _args(**kw) -> argparse.Namespace:
    base = dict(versions=None, notes=None, dry_run=False, from_origin=False, save_and_revert_hand_changes=False)
    return argparse.Namespace(**{**base, **kw})


def _row(product, changed, version="1.0.0", commit=OLD):
    return {"product": product, "version": version, "commit": commit, "files": ["web/a.js"] if changed else [],
            "changed": changed, "next": rh.next_version(version) if version else None}


def test_all_releases_the_changed_products_in_order_with_their_next_versions(monkeypatch):
    rows = [_row("mantel", True, "0.1.120"), _row("hk-frontend", True), _row("mantel-link", True, "0.1.12")]
    monkeypatch.setattr(rh, "release_plan", lambda: rows)
    monkeypatch.setattr(rh, "ha_token", lambda: "fictional-token")
    done = []
    monkeypatch.setattr(rh, "release_mantel", lambda version, notes, dry, **kw: done.append(("mantel", version, dry, kw)) or ["m"])
    monkeypatch.setattr(rh, "release_component", lambda product, version, dry, **kw: done.append((product, version, dry, kw)) or ["c"])
    recorded = []
    monkeypatch.setattr(rh, "record", lambda title, lines: recorded.append((title, lines)))
    assert rh.release_all(_args(versions="hk-frontend=1.41.0", from_origin=True, save_and_revert_hand_changes=True)) == 0
    assert [d[:2] for d in done] == [("mantel", "0.1.121"), ("hk-frontend", "1.41.0"), ("mantel-link", "0.1.13")]
    assert done[0][3] == {"from_origin": True, "save_and_revert": True}
    assert done[1][3] == {"github_release": True, "from_origin": True}, "`all` always makes the GitHub release"
    assert [t for t, _ in recorded] == ["Mantel 0.1.121", "HK Frontend 1.41.0", "Mantel Link 0.1.13"]


def test_all_leaves_out_what_did_not_change_and_a_dry_run_records_nothing(monkeypatch, capsys):
    monkeypatch.setattr(rh, "release_plan", lambda: [_row("mantel", False), _row("hk-frontend", False), _row("mantel-link", False)])
    assert rh.release_all(_args()) == 0 and "nothing changed since the last releases" in capsys.readouterr().out

    monkeypatch.setattr(rh, "release_plan", lambda: [_row("mantel", True, "0.1.120"), _row("hk-frontend", False), _row("mantel-link", False)])
    done = []
    monkeypatch.setattr(rh, "release_mantel", lambda version, notes, dry, **kw: done.append((version, dry)) or [])
    monkeypatch.setattr(rh, "release_component", lambda *a, **kw: pytest.fail("not changed"))
    monkeypatch.setattr(rh, "record", lambda *a: pytest.fail("a dry run records nothing"))
    monkeypatch.setattr(rh, "ha_token", lambda: pytest.fail("Mantel alone needs no Home Assistant token"))
    assert rh.release_all(_args(dry_run=True)) == 0 and done == [("0.1.121", True)]


def test_all_refuses_a_product_without_a_tag_and_components_without_the_token(monkeypatch):
    monkeypatch.setattr(rh, "release_plan", lambda: [_row("mantel", True, "0.1.120"), _row("hk-frontend", True, None, None)])
    with pytest.raises(rh.Refused, match="no release tag here: run `release_house.py backfill-tags` first"):
        rh.release_all(_args())
    monkeypatch.setattr(rh, "release_plan", lambda: [_row("mantel", True, "0.1.120"), _row("hk-frontend", True)])
    monkeypatch.setattr(rh, "release_mantel", lambda *a, **kw: pytest.fail("nothing is released before the token is known"))

    def no_token():
        raise rh.Refused("no Home Assistant admin token")
    monkeypatch.setattr(rh, "ha_token", no_token)
    with pytest.raises(rh.Refused, match="HK Frontend changed, and a component release restarts Home Assistant"):
        rh.release_all(_args())


# ---- main

def test_no_publish_is_only_for_the_ha_app_release(capsys):
    assert rh.main(["mantel", "0.1.99", "--no-publish"]) == 2
    assert "--no-publish is for --ha-app" in capsys.readouterr().err


def test_a_product_needs_a_version(capsys):
    for argv in (["mantel"], ["hk-frontend"], ["mantel-link", "1.2"], ["mantel", "v0.1.1"]):
        assert rh.main(argv) == 2, argv
        assert "the version is X.Y.Z" in capsys.readouterr().err


def test_main_hands_the_flags_to_the_house_first_release_and_records_it(monkeypatch, capsys):
    got, recorded = {}, []
    monkeypatch.setattr(rh, "release_mantel", lambda version, notes, dry, **kw: got.update(version=version, notes=notes, dry=dry, **kw) or ["line one"])
    monkeypatch.setattr(rh, "record", lambda title, lines: recorded.append((title, lines)))
    assert rh.main(["mantel", "0.1.121", "--retry", "--from-origin", "--save-and-revert-hand-changes"]) == 0
    assert got == {"version": "0.1.121", "notes": "", "dry": False, "retry": True, "from_origin": True, "save_and_revert": True}
    assert recorded == [("Mantel 0.1.121", ["line one"])] and "line one" in capsys.readouterr().out
    recorded.clear()
    assert rh.main(["mantel", "0.1.121", "--dry-run"]) == 0 and recorded == [], "a dry run records nothing"


def test_main_says_what_was_refused_and_exits_1(monkeypatch, capsys):
    def refuse(*a, **kw):
        raise rh.Refused("the LXC said no")
    monkeypatch.setattr(rh, "release_mantel", refuse)
    monkeypatch.setattr(rh, "record", lambda *a: pytest.fail("a refused release is not recorded"))
    assert rh.main(["mantel", "0.1.121"]) == 1
    assert "refused: the LXC said no" in capsys.readouterr().err


def test_the_ha_app_release_is_behind_its_flag_and_needs_notes(monkeypatch, tmp_path, capsys):
    assert rh.main(["mantel", "0.1.121", "--ha-app"]) == 1
    assert "needs --notes" in capsys.readouterr().err
    notes = tmp_path / "notes.md"
    notes.write_text("- A thing.\n")
    got = {}
    monkeypatch.setattr(rh, "release_mantel_ha_app", lambda version, notes, dry, publish: got.update(v=version, n=notes, p=publish) or [])
    monkeypatch.setattr(rh, "release_mantel", lambda *a, **kw: pytest.fail("--ha-app is the old flow"))
    monkeypatch.setattr(rh, "record", lambda *a: None)
    assert rh.main(["mantel", "0.1.121", "--ha-app", "--notes", str(notes), "--no-publish"]) == 0
    assert got == {"v": "0.1.121", "n": "- A thing.\n", "p": False}


def test_plan_and_backfill_need_no_version(monkeypatch, capsys):
    monkeypatch.setattr(rh, "release_plan", lambda: [_row("mantel", False, "0.1.120")])
    assert rh.main(["plan"]) == 0 and "Mantel 0.1.120" in capsys.readouterr().out
    asked = []
    monkeypatch.setattr(rh, "backfill_tags", lambda dry: asked.append(dry) or [])
    assert rh.main(["backfill-tags", "--dry-run"]) == 0 and asked == [True]


def test_run_view_asks_again_when_github_does_not_know_the_new_run_yet(monkeypatch):
    calls = []

    def gh_json(*a):
        calls.append(a)
        if len(calls) < 3:
            raise rh.Refused("gh run view failed: HTTP 404: Not Found")
        return {"status": "queued", "jobs": []}
    monkeypatch.setattr(rh, "gh_json", gh_json)
    monkeypatch.setattr(rh, "sleep", lambda s: None)
    assert rh.run_view("123") == {"status": "queued", "jobs": []} and len(calls) == 3
    calls.clear()
    monkeypatch.setattr(rh, "gh_json", lambda *a: (calls.append(a), (_ for _ in ()).throw(rh.Refused("down")))[1])
    with pytest.raises(rh.Refused, match="down"):
        rh.run_view("123", tries=3)
    assert len(calls) == 3


# ---- a component's Home Assistant restart: Mantel has to come through it (HK Frontend 1.43.0's restart left Mantel
#      0.1.123 stuck at 100 % CPU a second after it reconnected)

def _health(connected_for_s):
    return {**HEALTH, "upstream": {"home_assistant": {"connected": True, "connected_for_s": connected_for_s}}}


def test_mantel_has_to_reconnect_after_the_restart_and_stay_healthy(clock):
    fake = FakeLxc(health=_health(12.0))
    assert lxc_with(fake, every=10).follows_ha_restart(40) >= 60, "it waits the minute"
    asks = [c for c in fake.commands if "docker exec mantel-server" in c]
    assert len(asks) == 2, "reconnected since the restart, then healthy again a minute later"


def test_a_connection_from_before_the_restart_is_not_a_reconnect(clock):
    fake = FakeLxc(health=_health(5000.0))
    with pytest.raises(rh.Refused, match="did not reconnect to Home Assistant within 300 s"):
        lxc_with(fake, every=10).follows_ha_restart(40)


def test_mantel_that_stops_answering_after_it_reconnected_is_refused(clock):
    class Hangs(FakeLxc):
        asked = 0

        def __call__(self, command, timeout):
            if "docker exec mantel-server" in command:
                Hangs.asked += 1
                if Hangs.asked > 1:
                    return 124, "no answer in 30 s"
            return super().__call__(command, timeout)

    with pytest.raises(rh.Refused, match="reconnected to Home Assistant, then stopped being healthy.*restart it"):
        lxc_with(Hangs(health=_health(3.0)), every=10).follows_ha_restart(40)


def test_without_an_lxc_in_the_settings_nothing_is_checked(monkeypatch):
    monkeypatch.setattr(rh, "house_settings", lambda: {"ha_url": "https://ha.example.test"})
    assert rh.mantel_lxc() is None


def test_kiosk_buttons_are_the_kiosk_satellite_tablets_clear_cache_and_reload_page():
    """Every release ends with the tablets' cache cleared and their page reloaded (2026-11-09): found by maker, not by name."""
    devices = [{"id": "k1", "manufacturer": "kiosk_satellite"}, {"id": "k2", "manufacturer": "Kiosk_Satellite"},
               {"id": "x", "manufacturer": "Roborock"}]
    entities = [{"entity_id": "button.kitchen_kiosk_clear_cache", "device_id": "k1"},
                {"entity_id": "button.kitchen_kiosk_reload_page", "device_id": "k1"},
                {"entity_id": "button.kitchen_kiosk_restart_app", "device_id": "k1"},
                {"entity_id": "button.loft_kiosk_reload_page", "device_id": "k2"},
                {"entity_id": "button.loft_kiosk_clear_cache", "device_id": "k2", "disabled_by": "user"},
                {"entity_id": "button.vacuum_reload_page", "device_id": "x"},
                {"entity_id": "sensor.kitchen_kiosk_clear_cache", "device_id": "k1"}]
    clear, reload = rh.kiosk_buttons(devices, entities)
    assert clear == ["button.kitchen_kiosk_clear_cache"]
    assert reload == ["button.kitchen_kiosk_reload_page", "button.loft_kiosk_reload_page"]


def test_refresh_kiosks_never_fails_a_release(monkeypatch):
    monkeypatch.setattr(rh, "ha_url", lambda: (_ for _ in ()).throw(rh.Refused("no address")))
    out = rh.refresh_kiosks()
    assert len(out) == 1 and "NOT refreshed" in out[0] and "refresh-kiosks" in out[0]
    assert "would" in rh.refresh_kiosks(dry=True)[0]
