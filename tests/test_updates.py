"""Phase 14's update check (alerts/updates.py; docs/phase14/SYSTEM-ALERTS.md "The update check"): the version compare,
what counts as a release, one alert per new version (also across a restart), cleared when installed catches up, a
failed check that says so and raises nothing, the switch that stops every call, and the routes' roles and audit.
GitHub is a fake transport; nothing here leaves the machine."""
from __future__ import annotations

import asyncio
import json
import shutil
import subprocess

import pytest
from js_modules import copy_shim

from conftest import Mantel  # noqa: F401  (the fixture's type)
from mantel_server import about
from mantel_server.alerts import updates as U
from mantel_server.alerts.center import ChannelError

MANTEL, LINK, HKF = "jazzphone/mantel", "jazzphone/mantel-link", "jazzphone/hk-frontend"


def release(tag, **more):
    return {"tag_name": tag, "draft": False, "prerelease": False, "published_at": "2026-11-02T10:00:00Z",
            "html_url": f"https://github.com/jazzphone/mantel/releases/tag/{tag}", **more}


class Github:
    """api.github.com: what each repo's latest release answers, and every call made."""

    def __init__(self):
        self.answers: dict[str, tuple[int, object] | Exception] = {}
        self.calls: list[tuple[str, str, dict]] = []

    async def __call__(self, method, url, headers, body):
        self.calls.append((method, url, headers))
        repo = url.split("/repos/")[1].rsplit("/releases/latest", 1)[0]
        got = self.answers.get(repo, (404, {}))
        if isinstance(got, Exception):
            raise got
        status, data = got
        return status, {}, json.dumps(data).encode()

    def repos(self):
        return [u.split("/repos/")[1].rsplit("/releases/latest", 1)[0] for _m, u, _h in self.calls]


class Env:
    def __init__(self, m, monkeypatch, installed="0.1.100"):
        self.m = m
        self.alerts = m.app["alerts"]
        self.gh = Github()
        self.alerts.transport = self.gh
        self.u = self.alerts.updates
        self.raised: list[tuple] = []
        self.cleared: list[tuple] = []
        center = self.alerts.center
        monkeypatch.setattr(center, "raise_", lambda kind, key="", facts=None: self.raised.append((kind, key, facts)))
        monkeypatch.setattr(center, "clear", lambda kind, key="", facts=None: self.cleared.append((kind, key, facts)))
        self.versions = {"mantel": installed, "link": None, "hk_frontend": None}
        monkeypatch.setattr(self.u, "installed_of", lambda key: self.versions[key])

    async def check(self):
        self.m.now[0] += 100                      # past the gap between two calls to GitHub
        return await self.u.check()


@pytest.fixture
def env(mantel, monkeypatch):
    return Env(mantel, monkeypatch)


# -- the compare ----------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("a, b, want", [
    ("0.1.115", "0.1.99", True), ("0.1.99", "0.1.115", False), ("0.1.115", "0.1.115", False),
    ("1.0.0", "0.9.9", True), ("1.2", "1.2.0", False), ("1.2.1", "1.2", True),
    ("1.0.0", "1.0.0-rc1", True), ("1.0.0-rc1", "1.0.0", False),        # a part that isn't a number is lower
    ("v0.2.0", "0.1.9", True), ("", "0.1.0", False), (None, "0.1.0", False), ("0.1.0", None, False),
])
def test_newer_compares_numbers_not_text(a, b, want):
    assert U.newer(a, b) is want


# -- what counts as a release ---------------------------------------------------------------------------------------
async def test_the_call_is_plain_and_the_tag_loses_its_v(env):
    env.gh.answers[MANTEL] = (200, release("v0.1.115"))
    assert await env.check() is True
    [(method, url, headers)] = env.gh.calls                 # only Mantel is installed: one call
    assert (method, url) == ("GET", "https://api.github.com/repos/jazzphone/mantel/releases/latest")
    assert headers == {"User-Agent": "Mantel", "Accept": "application/vnd.github+json"}
    [p] = [p for p in env.u.public()["products"] if p["id"] == "mantel"]
    assert p["latest"] == "0.1.115" and p["installed"] == "0.1.100" and p["newer"] is True
    assert p["url"].endswith("/v0.1.115") and p["date"] and p["how"]


@pytest.mark.parametrize("flag", ["draft", "prerelease"])
async def test_drafts_and_prereleases_are_ignored(env, flag):
    env.gh.answers[MANTEL] = (200, release("v0.2.0", **{flag: True}))
    await env.check()
    assert env.raised == []
    assert env.u.public()["products"][0]["latest"] is None


async def test_a_tag_that_is_not_a_version_and_a_repo_without_releases_say_nothing(env):
    env.gh.answers[MANTEL] = (200, release("nightly"))
    await env.check()
    assert env.raised == [] and env.u.public()["error"] is None
    env.gh.answers[MANTEL] = (404, {"message": "Not Found"})
    await env.check()
    assert env.raised == [] and env.u.public()["error"] is None


async def test_a_link_to_somewhere_else_is_not_offered(env):
    env.gh.answers[MANTEL] = (200, release("v0.2.0", html_url="https://evil.example/notes"))
    await env.check()
    assert env.u.public()["products"][0]["url"] is None


# -- the alert ------------------------------------------------------------------------------------------------------
async def test_one_alert_per_new_version_also_across_a_restart(env):
    env.gh.answers[MANTEL] = (200, release("v0.1.115"))
    await env.check()
    [(kind, key, facts)] = env.raised
    assert (kind, key) == ("update.mantel", "") and facts["version"] == "0.1.115" and facts["how"] == env.u.how("mantel")
    await env.check()
    assert len(env.raised) == 1, "a second daily check of the same version is quiet"
    restarted = U.Updates(env.alerts)                        # a restart: the center forgot, the database didn't
    restarted.installed_of = env.u.installed_of
    await restarted.check()
    restarted.evaluate()
    assert len(env.raised) == 1, "and so is the first check after a restart"
    env.gh.answers[MANTEL] = (200, release("v0.1.116"))
    await env.check()
    assert [f["version"] for _k, _key, f in env.raised] == ["0.1.115", "0.1.116"]


async def test_cleared_when_installed_catches_up(env):
    env.gh.answers[MANTEL] = (200, release("v0.1.115"))
    await env.check()
    assert env.cleared == []
    env.versions["mantel"] = "0.1.115"
    await env.check()
    assert env.cleared == [("update.mantel", "", {"version": "0.1.115"})]
    assert env.u.public()["products"][0]["newer"] is False
    await env.check()
    assert len(env.cleared) == 1 and len(env.raised) == 1


async def test_an_older_or_equal_release_raises_nothing(env):
    for tag in ("v0.1.100", "v0.1.99"):
        env.gh.answers[MANTEL] = (200, release(tag))
        await env.check()
    assert env.raised == [] and env.cleared == []


async def test_link_and_hk_frontend_are_compared_only_when_installed(env):
    env.gh.answers[LINK] = (200, release("v0.1.11"))
    env.gh.answers[HKF] = (200, release("v1.36.0"))
    await env.check()
    assert env.gh.repos() == [MANTEL], "no version told: no call, no alert"
    assert [p["installed"] for p in env.u.public()["products"]] == ["0.1.100", None, None]
    env.versions.update(link="0.1.10", hk_frontend="1.35.0")
    await env.check()
    assert {k for k, _key, _f in env.raised} == {"update.link", "update.hk_frontend"}
    assert {p["how"] for p in env.u.public()["products"][1:]} == {"Update it in HACS."}


def test_linked_versions_are_read_from_what_mantel_link_reported():
    from types import SimpleNamespace as NS
    open_ws, shut = NS(closed=False), NS(closed=True)
    clients = [NS(domain="mantel", ws=open_ws, report={"versions": {"mantel": "0.1.10", "hk_frontend": "1.35.0"}}),
               NS(domain="mantel", ws=shut, report={"versions": {"mantel": "9.9.9"}})]
    app = {"linked": NS(registry=NS(clients=clients))}
    assert U.linked_version(app, "mantel") == "0.1.10" and U.linked_version(app, "hk_frontend") == "1.35.0"
    assert U.linked_version({}, "mantel") is None
    clients[0].report = {"hk_frontend": {"installed": True}, "versions": {"mantel": "not a version!"}}
    assert U.linked_version(app, "mantel") is None and U.linked_version(app, "hk_frontend") is None


def test_the_link_takes_versions_as_a_report_of_their_own():
    from types import SimpleNamespace as NS
    from mantel_server.linked import Linked, LinkedError
    reg = Linked.__new__(Linked)
    reg.listeners = []
    client = NS(report={})
    reg.take_report(client, {"versions": {"mantel": "0.1.11", "hk_frontend": "1.35.0"}})
    assert client.report["versions"] == {"mantel": "0.1.11", "hk_frontend": "1.35.0"}
    for bad in ({"versions": {"mantel": "<script>"}}, {"versions": {"other": "1.0"}}, {"versions": ["1.0"]}):
        with pytest.raises(LinkedError):
            reg.take_report(client, bad)


# -- a check that fails ---------------------------------------------------------------------------------------------
@pytest.mark.parametrize("answer", [ChannelError("couldn't reach api.github.com (ClientConnectorError)"),
                                    (403, {"message": "rate limit exceeded"}), (0, {}), (200, [1, 2])])
async def test_a_failed_check_raises_nothing_and_says_so(env, answer):
    env.gh.answers[MANTEL] = (200, release("v0.1.115"))
    await env.check()
    assert len(env.raised) == 1
    env.gh.answers[MANTEL] = answer
    await env.check()
    got = env.u.public()
    assert got["error"]["message"].startswith("Mantel: ") and got["error"]["at"] == env.m.now[0]
    assert len(env.raised) == 1 and env.cleared == [], "an offline house isn't an alert"
    env.gh.answers[MANTEL] = (200, release("v0.1.115"))
    await env.check()
    assert env.u.public()["error"] is None and got["products"][0]["latest"] == "0.1.115"


async def test_a_first_check_that_fails_has_no_result_and_no_alert(env):
    env.gh.answers[MANTEL] = ChannelError("couldn't reach api.github.com (TimeoutError)")
    await env.check()
    got = env.u.public()
    assert got["error"] and got["checked_at"] is None and got["products"][0]["latest"] is None and env.raised == []


# -- the switch -----------------------------------------------------------------------------------------------------
async def test_off_means_github_is_never_called(env):
    env.u.set_enabled(False)
    env.gh.answers[MANTEL] = (200, release("v0.1.115"))
    assert await env.check() is False
    env.u.first_delay, env.u.day = 0.0, 0.01
    task = asyncio.ensure_future(env.u.run())
    await asyncio.sleep(0.1)
    task.cancel()
    assert env.gh.calls == [] and env.raised == []
    assert env.u.public()["check"] is False


async def test_on_by_default_and_the_check_now_gap(env):
    assert env.u.public()["check"] is True
    env.gh.answers[MANTEL] = (200, release("v0.1.100"))
    assert await env.u.check() is True
    assert await env.u.check() is False, "asked again at once: GitHub isn't asked again"
    assert len(env.gh.calls) == 1


# -- the schedule ---------------------------------------------------------------------------------------------------
async def test_the_loop_checks_after_the_first_delay_then_every_day(env):
    env.gh.answers[MANTEL] = (200, release("v0.1.100"))
    env.u.first_delay, env.u.day, env.u.minute = 0.05, 0.05, 0.0
    env.alerts.clock = lambda: asyncio.get_running_loop().time()      # real time passes; MIN_GAP is shrunk too
    U.MIN_GAP, saved = 0.0, U.MIN_GAP
    task = asyncio.ensure_future(env.u.run())
    try:
        await asyncio.sleep(0.02)
        assert env.gh.calls == [], "nothing before the first delay"
        await asyncio.sleep(0.3)
    finally:
        U.MIN_GAP = saved
        task.cancel()
    assert len(env.gh.calls) >= 3


def test_the_daily_minute_is_chosen_once_per_start(mantel):
    u = mantel.app["alerts"].updates
    assert u.first_delay == 600.0 and u.day == 86400.0 and 0 <= u.minute < 86400 and u.minute % 60 == 0


# -- the routes -----------------------------------------------------------------------------------------------------
def put(m, body):
    return m.client.put("/api/updates", json=body, headers=m.headers())


async def signed_in(m, role="owner", name="avery"):
    await m.user(name, role)
    r, _ = await m.sign_in(name)
    assert r.status == 200


async def test_an_owner_reads_and_the_page_has_its_shape(env):
    await signed_in(env.m)
    env.gh.answers[MANTEL] = (200, release("v0.1.115"))
    r = await env.m.post("/api/updates/check")
    assert r.status == 200
    got = await r.json()
    assert set(got) == {"ok", "check", "products", "checked_at", "error", "install", "can_edit", "needs_fresh"}
    assert got["check"] is True and got["can_edit"] is True and got["error"] is None
    assert got["checked_at"] == env.m.now[0] or got["checked_at"] > 0
    assert set(got["products"][0]) == {"id", "name", "installed", "latest", "date", "url", "newer", "how"}
    assert got["install"]["kind"] in ("ha_app", "lxc", "docker", "container") and got["install"]["how"]
    again = await (await env.m.get("/api/updates")).json()
    assert again["products"][0]["latest"] == "0.1.115" and again["products"][0]["newer"] is True


async def test_an_admin_reads_but_cannot_change_or_check(env):
    await signed_in(env.m, "admin", "ben")
    got = await (await env.m.get("/api/updates")).json()
    assert got["can_edit"] is False
    assert (await put(env.m, {"check": False})).status == 403
    assert (await env.m.post("/api/updates/check")).status == 403
    assert env.u.enabled() is True and env.gh.calls == []


@pytest.mark.parametrize("role", ["adult", "child", "guest"])
async def test_a_member_reads_nothing(env, role):
    await signed_in(env.m, role, "cody")
    assert (await env.m.get("/api/updates")).status == 403
    assert (await put(env.m, {"check": False})).status == 403


async def test_signed_out_and_a_wall_tablet_get_nothing(env):
    m = env.m
    m.forget_cookies()
    assert (await m.get("/api/updates")).status in (401, 403)
    await signed_in(m)
    assert (await m.post("/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen"})).status == 201
    assert (await m.get("/api/updates")).status == 403, "even an Owner's session at a wall tablet"
    assert (await put(m, {"check": False})).status == 403


async def test_the_owner_turns_the_check_off_audited_first(env):
    await signed_in(env.m)
    r = await put(env.m, {"check": False})
    assert r.status == 200 and (await r.json())["check"] is False
    rows = [x for x in env.m.app["audit"].rows() if x["action"] == "updates.settings.saved"]
    assert len(rows) == 1 and rows[0]["kind"] == "config" and json.loads(rows[0]["target"]) == {"check": False}
    r = await env.m.post("/api/updates/check")
    assert r.status == 409 and (await r.json())["error"] == "updates_off"
    assert env.gh.calls == []
    assert (await put(env.m, {"check": True})).status == 200 and env.u.enabled() is True


@pytest.mark.parametrize("body", [{}, {"check": "no"}, {"check": 0}, {"checks": False}])
async def test_a_bad_save_changes_nothing(env, body):
    await signed_in(env.m)
    assert (await put(env.m, body)).status == 400
    assert env.u.enabled() is True
    assert not [x for x in env.m.app["audit"].rows() if x["action"] == "updates.settings.saved"]


async def test_no_audit_row_no_change(env, monkeypatch):
    await signed_in(env.m)

    def broken(event):
        raise OSError("disk full")
    monkeypatch.setattr(env.m.app["audit"], "config_event", broken)
    r = await put(env.m, {"check": False})
    assert r.status == 503 and (await r.json())["error"] == "audit_unavailable"
    assert env.u.enabled() is True


def test_every_route_declares_its_guard():
    assert U.api_get.__guard__.who == "manager"
    put_g, check_g = U.api_put.__guard__, U.api_check.__guard__
    assert (put_g.who, put_g.fresh, put_g.audit) == ("owner", "away", ("updates.settings.saved",))
    assert (check_g.who, check_g.fresh) == ("owner", "away") and check_g.no_audit


# -- how to update this install -------------------------------------------------------------------------------------
@pytest.mark.parametrize("kind, mark, kind_out, how", [
    ("Home Assistant App", "", "ha_app", U.HOW_APP), ("Container", "lxc", "lxc", U.HOW_LXC),
    ("Container", "docker", "docker", U.HOW_DOCKER), ("Container", "", "container", U.HOW_BOTH),
    ("Container", "nonsense", "container", U.HOW_BOTH)])
def test_how_to_update_this_install(mantel, monkeypatch, kind, mark, kind_out, how):
    monkeypatch.setattr(about, "install_kind", lambda cfg: kind)
    monkeypatch.setenv("MANTEL_INSTALL", mark)
    assert mantel.app["alerts"].updates.install() == {"kind": kind_out, "how": how}


# -- Mantel Settings -> About (web/shim/settings/about.js), drawn in node with the recording kit stub -------------------
SCRIPT = r"""
import { readFileSync } from 'node:fs';
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, cookie: '' };
const plain = (o) => (o == null ? o : typeof o === 'object' ? (o._text !== undefined ? o._text : JSON.stringify(o)) : o);
const row = (kind) => (o) => ({ kind, label: o.label, sub: plain(o.sub), value: o.value, valueCls: o.valueCls, on: o.on, disabled: o.disabled, fk: o.fk, onClick: undefined });
window.hkSettingsKit = {
  group: (o, rows) => ({ kind: 'group', header: o.header || null, footer: plain(o.footer), rows: rows.filter(Boolean) }),
  info: row('info'), nav: row('nav'), button: row('button'), toggle: row('toggle'), h: (tag, attrs) => ({ _text: (attrs && attrs.text) || '' }),
};
const reads = JSON.parse(readFileSync(process.argv[3], 'utf8'));
globalThis.fetch = async (u) => {
  const path = String(u);
  if (!(path in reads)) throw new Error('unexpected ' + path);
  return { ok: true, status: 200, json: async () => reads[path] };
};
globalThis.location = { origin: 'https://m.example', hostname: 'm.example', hash: '', search: '', pathname: '/settings' };
const m = await import(process.argv[2]);
const tick = () => new Promise((r) => setTimeout(r, 0));
const panel = { render() {}, status() {}, go() {}, shadowRoot: null };
const out = {};
for (const [name, me] of Object.entries(JSON.parse(process.argv[4]))) {
  m._reset(me);
  let kids = [];
  for (let i = 0; i < 3; i++) {
    const c = { kids: [], appendChild(k) { this.kids.push(k); return k; } };
    m.host.page(['mantel', 'about'], panel).body(c);
    kids = c.kids;
    await tick(); await tick();
  }
  out[name] = kids;
}
process.stdout.write(JSON.stringify(out));
"""


def overview(role, sections):
    return {"user": {"id": "u1", "name": role, "username": role, "role": role, "kind": "mantel", "totp": False, "passkeys": 0},
            "door": "lan", "csrf": "x", "now": 0, "at_tablet": False, "sections": sections, "roles": [], "device_roles": [],
            "actions": [], "resource_kinds": [], "features": [], "service_scopes": [], "connect_port": None, "ha_set_up": True}


def about_page_reads(updates):
    return {"/api/about": {"product": "Mantel", "version": "0.1.100", "commit": "dev", "build": "x", "staged": None,
                           "install": "Container", "started": 1000, "uptime_s": 5, "python": "3.13",
                           "home_assistant": {"version": "2026.10", "connected": True},
                           "music_assistant": {"version": None, "configured": False}, "linked": [], "commands": False,
                           "docs": "/docs", "access": {"mode": "proxy", "public_url": "https://m.example/"}},
            "/api/updates": updates}


def page_of(installed="0.1.100", latest="0.1.115", **more):
    return {"ok": True, "check": True, "checked_at": 5000.0, "error": None, "can_edit": True, "needs_fresh": False,
            "install": {"kind": "lxc", "how": U.HOW_LXC},
            "products": [{"id": "mantel", "name": "Mantel", "installed": installed, "latest": latest, "date": 4000.0,
                          "url": "https://github.com/jazzphone/mantel/releases/tag/v" + str(latest),
                          "newer": bool(latest) and latest != installed, "how": U.HOW_LXC},
                         {"id": "link", "name": "Mantel Link", "installed": None, "latest": None, "date": None, "url": None,
                          "newer": False, "how": U.HOW_HACS}], **more}


@pytest.fixture(scope="module")
def drawn(tmp_path_factory):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    d = tmp_path_factory.mktemp("mantel-settings-updates")
    entry = copy_shim(d)
    (d / "script.mjs").write_text(SCRIPT)
    me = {"owner": overview("owner", ["me", "about", "performance"]), "adult": overview("adult", ["me", "about"])}
    out = {}
    for name, updates in {"available": page_of(), "current": page_of(latest="0.1.100"),
                          "failed": page_of(latest=None, error={"at": 6000.0, "message": "Mantel: GitHub said 403"},
                                            checked_at=None),
                          "off": page_of(check=False, can_edit=False)}.items():
        (d / "reads.json").write_text(json.dumps(about_page_reads(updates)))
        run = subprocess.run(["node", str(d / "script.mjs"), str(entry), str(d / "reads.json"), json.dumps(me)],
                             capture_output=True, text=True, timeout=60)
        assert run.returncode == 0, run.stderr
        out[name] = json.loads(run.stdout)
    return out


def section(groups):
    return next((g for g in groups if g.get("header") == "Updates"), None)


def test_about_says_a_new_release_is_available_and_how_to_update(drawn):
    g = section(drawn["available"]["owner"])
    [row] = [r for r in g["rows"] if r["label"] == "Mantel 0.1.115 Is Available"]
    assert row["valueCls"] == "warn" and U.HOW_LXC in row["sub"] and "You have 0.1.100" in row["sub"] and "Released" in row["sub"]
    assert [r["label"] for r in g["rows"] if r["kind"] == "button"] == ["Release Notes", "Check Now"]
    assert "Mantel Link" not in json.dumps(g), "not told its version: not shown"
    switch = next(r for r in g["rows"] if r["label"] == "Check for Updates")
    assert switch["on"] is True and switch["disabled"] is False


def test_about_says_up_to_date_and_when(drawn):
    g = section(drawn["current"]["owner"])
    assert any(r["label"] == "Mantel" and r["value"] == "Up to Date" for r in g["rows"])
    assert not any(r["label"] == "Release Notes" for r in g["rows"])
    assert any(r["label"] == "Last Check" and not r.get("valueCls") for r in g["rows"])


def test_about_says_it_couldnt_check(drawn):
    g = section(drawn["failed"]["owner"])
    [row] = [r for r in g["rows"] if r["label"] == "Last Check"]
    assert row["value"].startswith("Couldn’t check (") and row["valueCls"] == "warn"
    assert not any("Available" in r["label"] for r in g["rows"])


def test_the_switch_is_read_only_for_those_who_cannot_change_it_and_off_hides_check_now(drawn):
    g = section(drawn["off"]["owner"])
    switch = next(r for r in g["rows"] if r["label"] == "Check for Updates")
    assert switch["on"] is False and switch["disabled"] is True
    assert not any(r["label"] == "Check Now" for r in g["rows"])


def test_a_member_does_not_see_the_section(drawn):
    assert section(drawn["available"]["adult"]) is None
