"""Features on by default (mantel_server/features/auto.py, docs/phase16/FEATURES-ON-BY-DEFAULT.md): Music, Clean
Areas, Energy and Live TV turn on by themselves, once, when the house has what they need, after two looks 2 minutes
apart; a person's choice is final; nothing is sent to the house. A FICTIONAL house, a fake clock, a fake Energy read
and a fake tuner fetch; no network."""
import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from mantel_server.storage import audit
from mantel_server import features as F
from mantel_server.features import auto as A
from mantel_server.settings_store import Actor
from test_features import FakeProxy, build

GRID = {"energy_sources": [{"type": "grid", "flow_from": [{"stat_energy_from": "sensor.grid_in"}]}],
        "device_consumption": []}
TUNER = "192.168.40.20"
LINEUP = json.dumps([{"GuideNumber": "4.1", "GuideName": "KFIC", "URL": "http://x/auto/v4.1"}]).encode()
HDHR = {"id": "dev_tuner", "name": "HDHomeRun", "manufacturer": "SiliconDust", "identifiers": [["hdhomerun", "1A2B3C4D"]],
        "configuration_url": f"http://{TUNER}/", "area_id": None}


class Clock:
    def __init__(self):
        self.t = 5000.0

    def __call__(self):
        return self.t


class FakeMa:
    def __init__(self, on=True):
        self.connected = asyncio.Event()
        if on:
            self.connected.set()


class Fetch:
    def __init__(self, body=LINEUP):
        self.body, self.urls = body, []

    async def __call__(self, url):
        self.urls.append(url)
        if isinstance(self.body, Exception):
            raise self.body
        return self.body


class Alerts:
    def __init__(self):
        self.raised = []
        self.center = SimpleNamespace(raise_=lambda kind, key="", facts=None: self.raised.append((kind, key, facts)))


async def rig(tmp_path, monkeypatch, *, settings=None, prefs=GRID, ma=True, ready=True, fetch=None, serves="none",
              devices=()):
    clock = Clock()
    fetch = fetch or Fetch()
    app, store, now, fake, host = await build(tmp_path, monkeypatch, commands=True, settings=settings,
                                              hooks={"monotonic": clock, "fetch": fetch})
    hub = app["hub"]
    if devices:
        from test_features import AREAS, DEVICES, ENTITIES
        hub.registry.load(AREAS, DEVICES + list(devices), ENTITIES)
    hub.readproxy = FakeProxy(prefs)
    if ready:
        hub.ha.connected.set()
    if ma is not None:
        app["ma"] = FakeMa(ma)
    alerts = Alerts()
    app["alerts"] = alerts
    if serves is not None:
        host.auto._tv_serves = lambda: serves
    await host.reload()
    return SimpleNamespace(app=app, host=host, auto=host.auto, clock=clock, fake=fake, fetch=fetch, alerts=alerts,
                           proxy=hub.readproxy, store=app["settings"].store)


async def two_looks(r, gap=A.TWO_LOOKS_S):
    await r.auto.look()
    r.clock.t += gap
    await r.auto.look()


def versions(r):
    return [h["version"] for h in r.store.history("house", F.FEATURES_DOC)]


def write(r, body, actor="owner1"):
    r.store.write([("house", F.FEATURES_DOC, F.check_settings(body))], actor=Actor(user_id=actor, role="owner"))


def no_command(r):
    assert r.fake.sent == [] and r.fake.frames == [], "the runner sent something to the house"
    assert list(r.host.caller.log) == []
    rows = r.app["audit"].rows()
    assert not [x for x in rows if x.get("decision") == "would"]
    assert all(x.get("kind") == "config" for x in rows if str(x.get("action", "")).startswith("features.")), rows


# -- two looks ---------------------------------------------------------------------------------------------
async def test_not_before_two_looks_2_minutes_apart(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch)
    await r.auto.look()
    assert not any(r.host.on(p) for p in ("music", "clean_areas", "energy"))
    assert set(r.auto.first) == {"music", "clean_areas", "energy"}
    r.clock.t += 60
    await r.auto.look()
    assert not r.host.on("music"), "a minute is not two"
    r.clock.t += 60
    await r.auto.look()
    assert r.host.on("music") and r.host.on("clean_areas") and r.host.on("energy")
    assert not r.host.on("live_tv") and not r.host.on("notifications") and not r.host.on("alarm_pin")
    no_command(r)


async def test_a_need_that_goes_away_between_the_looks_does_nothing(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch)
    await r.auto.look()
    r.app["ma"].connected.clear()
    r.proxy.prefs = None                     # an unreadable answer is "can't tell", which starts over too
    r.clock.t += A.TWO_LOOKS_S
    await r.auto.look()
    assert not r.host.on("music") and not r.host.on("energy") and r.host.on("clean_areas")
    r.app["ma"].connected.set()
    r.clock.t += 1
    await r.auto.look()
    assert not r.host.on("music"), "seen again: the 2 minutes start over"


async def test_an_unready_house_decides_nothing(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch, ready=False, ma=None)
    await two_looks(r)
    assert not any(r.host.on(p) for p in F.AUTO_PIECES)
    assert r.proxy.asked == [], "no Energy read before Home Assistant is connected"
    assert r.auto.first == {}


async def test_a_house_with_nothing_writes_nothing(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch, prefs={}, ma=None)
    r.app["hub"].registry.load([], [], [])
    before = versions(r)
    await two_looks(r)
    assert versions(r) == before and r.host.settings["auto"]["decided"] == {}
    assert r.alerts.raised == [] and r.app["audit"].rows(action="features.auto_on") == []


# -- once ----------------------------------------------------------------------------------------------------
async def test_on_once_with_the_marker_the_history_and_the_audit(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch)
    await two_looks(r)
    d = r.host.settings["auto"]["decided"]
    assert set(d) == {"music", "clean_areas", "energy"} and all(m["by"] == "auto" for m in d.values())
    assert d["music"]["why"] == "Music Assistant is connected."
    hist = [h for h in r.store.history("house", F.FEATURES_DOC) if h["actor"] == A.ACTOR]
    assert {h["message"] for h in hist} == {"Music on: Music Assistant is connected.",
                                            "Clean Areas on: A vacuum has a map of the house’s rooms.",
                                            "Energy on: Home Assistant’s Energy settings have a grid meter."}
    rows = r.app["audit"].rows(action="features.auto_on")
    assert len(rows) == 3 and all(x["actor"] is None for x in rows)
    before = versions(r)
    await two_looks(r)
    assert versions(r) == before, "a second look writes nothing"
    # a restart: a new runner over the same store
    r.host.auto = r.auto = A.AutoFeatures(r.host)
    r.auto._tv_serves = lambda: "none"
    await two_looks(r)
    assert versions(r) == before


async def test_on_after_a_turn_off_by_a_person_stays_off(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch)
    await two_looks(r)
    body = r.host.owner_decided(r.host.settings, {**r.host.settings, "music": {"enabled": False}})
    write(r, body)
    await r.host.reload()
    assert r.host.settings["auto"]["decided"]["music"]["by"] == "owner"
    await two_looks(r)
    assert not r.host.on("music")


async def test_the_written_settings_pass_the_check_and_change_only_enabled_and_auto(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch)
    before = json.loads(json.dumps(r.host.settings))
    await two_looks(r)
    after = r.host.settings
    assert F.check_settings(after) == after
    for p in after:
        if p == "auto":
            continue
        diff = {k for k in after[p] if after[p][k] != before[p][k]}
        assert diff <= {"enabled"}, (p, diff)


async def test_the_alert_is_raised_once_per_piece(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch)
    await two_looks(r)
    await two_looks(r)
    assert sorted(k for k, *_ in r.alerts.raised) == ["feature.enabled"] * 3
    assert {key for _, key, _ in r.alerts.raised} == {"music", "clean_areas", "energy"}
    facts = {key: f for _, key, f in r.alerts.raised}
    assert facts["energy"] == {"name": "Energy", "why": "Home Assistant’s Energy settings have a grid meter."}


def test_the_alert_kind():
    from mantel_server.alerts import catalog
    k = catalog.kind("feature.enabled")
    assert k is not None and k.level == "info" and k.group == "mantel" and k.once and k.default
    assert k.page == "features"
    title, body = k.words({"name": "Music", "why": "Music Assistant is connected."})
    assert title == "Mantel turned on Music"
    assert body == "Music Assistant is connected. Turn it off in Mantel Settings → Advanced → Features."


# -- a person's choice -----------------------------------------------------------------------------------------
async def test_a_persons_remove_before_the_need_was_met_holds(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch, ma=False)
    settings = r.host.owner_decided(r.host.settings, json.loads(json.dumps(r.host.settings)), piece="music")
    write(r, settings)
    await r.host.reload()
    r.app["ma"].connected.set()
    await two_looks(r)
    assert not r.host.on("music") and r.host.on("energy")


async def test_the_history_backstop(tmp_path, monkeypatch):
    """A house from before the marker: a person turned Energy off; Clean Areas was never touched."""
    on = F.check_settings({"energy": {"enabled": True}})
    on.pop("auto")
    r = await rig(tmp_path, monkeypatch, settings=None)
    r.store.write([("house", F.FEATURES_DOC, on)], actor=Actor(user_id="owner1", role="owner"))
    off = {**on, "energy": {**on["energy"], "enabled": False}}
    r.store.write([("house", F.FEATURES_DOC, off)], actor=Actor(user_id="owner1", role="owner"))
    await r.host.reload()
    await two_looks(r)
    assert not r.host.on("energy") and r.host.on("clean_areas")
    assert r.host.settings["auto"]["decided"]["energy"]["by"] == "owner"
    assert r.app["audit"].rows(action="features.auto_decided")


async def test_mantels_own_history_is_not_a_person(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch)
    on = F.check_settings({"energy": {"enabled": True}})
    r.store.write([("house", F.FEATURES_DOC, on)], actor=Actor(label=A.ACTOR))
    r.store.write([("house", F.FEATURES_DOC, {**on, "energy": {"enabled": False, "options": {}}})],
                  actor=Actor(label=A.ACTOR))
    await r.host.reload()
    assert "energy" not in r.auto.person_turned_off()


async def test_an_import_and_a_restore_set_no_marker(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch)
    on = F.check_settings({"energy": {"enabled": True}})
    r.store.write([("house", F.FEATURES_DOC, on)], actor=Actor(user_id="owner1", role="owner"), action="import")
    first = versions(r)[0]
    r.store.write([("house", F.FEATURES_DOC, F.check_settings({}))], actor=Actor(user_id="owner1", role="owner"),
                  action="import")
    r.store.restore("house", F.FEATURES_DOC, first, actor=Actor(user_id="owner1", role="owner"))
    r.store.write([("house", F.FEATURES_DOC, F.check_settings({}))], actor=Actor(user_id="owner1", role="owner"),
                  action="restore")
    await r.host.reload()
    assert r.host.settings["auto"]["decided"] == {} and r.auto.person_turned_off() == set()


async def test_the_switch_off_does_nothing_and_sets_no_marker(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch, settings={"auto": {"enabled": False}})
    before = versions(r)
    await two_looks(r)
    assert not any(r.host.on(p) for p in F.AUTO_PIECES) and versions(r) == before
    assert r.host.settings["auto"]["decided"] == {} and r.proxy.asked == []


async def test_turning_the_switch_on_looks_at_once(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch, settings={"auto": {"enabled": False}})
    r.auto.settings_changed()
    write(r, {**r.host.settings, "auto": {"enabled": True, "decided": {}}})
    await r.host.reload()
    assert r.auto._pending is not None
    r.auto.stop()


# -- audit first, and the race ----------------------------------------------------------------------------------
async def test_no_audit_no_change(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch)
    before = versions(r)

    def refuse(*a, **k):
        raise audit.Unavailable()
    monkeypatch.setattr(audit, "config", refuse)
    await two_looks(r)
    assert versions(r) == before and not r.host.on("music") and r.alerts.raised == []


async def test_a_persons_save_wins_the_race_and_the_next_look_decides_again(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch)
    await r.auto.look()
    r.clock.t += A.TWO_LOOKS_S
    real = audit.config

    def person_saves_meanwhile(request, ident, action, detail, **kw):
        real(request, ident, action, detail, **kw)
        if action == "features.auto_on" and detail["piece"] == "music":
            # a person's save lands between Mantel's read and its write (nothing changes their choice)
            cur = r.store.body("house", F.FEATURES_DOC)
            r.store.write([("house", F.FEATURES_DOC, {**F.check_settings(cur), "sleep": {"enabled": True}})],
                          actor=Actor(user_id="owner1", role="owner"))
    monkeypatch.setattr(audit, "config", person_saves_meanwhile)
    await r.auto.look()
    await r.host.reload()                    # (the person's save reloads the features through the settings feed)
    assert not r.host.on("music"), "refused: conflict"
    assert r.host.on("sleep")
    monkeypatch.setattr(audit, "config", real)
    await two_looks(r)
    assert r.host.on("music")


# -- no command, for every piece -------------------------------------------------------------------------------
async def test_no_command_for_any_piece_live_tv_included(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch, serves="mantel", devices=[HDHR])
    await two_looks(r)
    assert all(r.host.on(p) for p in F.AUTO_PIECES)
    no_command(r)


# -- Live TV ------------------------------------------------------------------------------------------------------
async def test_live_tv_an_address_from_the_registry_is_checked_once_and_saved(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch, serves="mantel", devices=[HDHR])
    await two_looks(r)
    tv = r.host.settings["live_tv"]
    assert r.host.on("live_tv") and tv["tuner"] == TUNER and tv["channels"] == [], "the whole lineup"
    assert r.fetch.urls == [f"http://{TUNER}/lineup.json"] * 2, "one read for each of the two looks"
    await two_looks(r)
    assert len(r.fetch.urls) == 2, "on: never asked again by this"
    assert r.host.settings["auto"]["decided"]["live_tv"]["why"] == f"The tuner at {TUNER} answers."


@pytest.mark.parametrize("saved", [TUNER, f"http://{TUNER}/lineup.json"])
async def test_live_tv_a_saved_address(tmp_path, monkeypatch, saved):
    """The import's (HK Frontend's) or the Owner's address: the old once-only rule for Mantel's own go2rtc."""
    r = await rig(tmp_path, monkeypatch, serves="mantel", settings={"live_tv": {"tuner": saved}})
    await two_looks(r)
    assert r.host.on("live_tv") and r.host.settings["live_tv"]["tuner"] == saved


async def test_live_tv_the_old_go2rtc_once_is_honored(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch, serves="mantel", settings={"live_tv": {"tuner": TUNER, "go2rtc_once": True}})
    await two_looks(r)
    assert not r.host.on("live_tv") and r.fetch.urls == []


@pytest.mark.parametrize("serves", ["none", "ha"])
async def test_live_tv_without_a_way_to_serve_it_or_with_hk_frontend_running_it(tmp_path, monkeypatch, serves):
    r = await rig(tmp_path, monkeypatch, serves=serves, devices=[HDHR])
    await two_looks(r)
    assert not r.host.on("live_tv") and r.fetch.urls == [], "nothing is asked of a tuner Mantel can't serve"
    assert r.auto.row("live_tv")["note"]


async def test_live_tv_a_tuner_that_doesnt_answer_has_its_note(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch, serves="mantel", devices=[HDHR], fetch=Fetch(OSError("refused")))
    await two_looks(r)
    assert not r.host.on("live_tv") and len(r.fetch.urls) == 1, "a no stands for 10 minutes"
    assert r.auto.row("live_tv") == {"auto": None, "note": f"The tuner at {TUNER} didn’t answer with its channels."}


async def test_live_tv_a_registry_address_off_the_home_network_is_never_asked(tmp_path, monkeypatch):
    far = {**HDHR, "configuration_url": "http://203.0.113.9/"}
    r = await rig(tmp_path, monkeypatch, serves="mantel", devices=[far])
    await two_looks(r)
    assert not r.host.on("live_tv") and r.fetch.urls == []
    assert "address" in r.auto.row("live_tv")["note"], "seen, but no address Mantel may use"


async def test_live_tv_through_mantel_link_read_only_is_not_met(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch, serves="link", devices=[HDHR])
    r.app["cfg"].read_only = True
    await two_looks(r)
    assert not r.host.on("live_tv") and "read-only" in r.auto.row("live_tv")["note"]


def _serves(app, added=()):
    host = SimpleNamespace(app=app, settings={"ha": {"added": list(added)}})
    return A.AutoFeatures(host)._tv_serves()


def test_tv_serves():
    link = object()
    tv_own = SimpleNamespace(go2rtc=object(), link=lambda: None)
    tv_app = SimpleNamespace(go2rtc=None, link=lambda: link)
    tv_nolink = SimpleNamespace(go2rtc=None, link=lambda: None)
    runs = SimpleNamespace(wanted=lambda: "entry")
    not_house = SimpleNamespace(wanted=lambda: None)
    assert _serves({"live_tv": tv_own}) == "mantel"
    assert _serves({"live_tv": tv_app, "linked_house": runs}) == "link"
    assert _serves({"live_tv": tv_app, "linked_house": not_house}) == "none", "Link without Mantel running the house"
    assert _serves({"live_tv": tv_nolink, "linked_house": runs}) == "none", "a Mantel Link without live_tv"
    assert _serves({"live_tv": tv_app, "linked_house": not_house}, added=["live_tv"]) == "ha"
    assert _serves({}) == "none"


async def test_turning_live_tv_on_at_run_time_starts_its_guide(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch, serves="mantel", settings={"live_tv": {"tuner": TUNER}})
    r.host.started = True
    loops = []

    async def loop():
        loops.append(1)
    monkeypatch.setattr(r.host, "_tv_loop", loop)
    await two_looks(r)
    await asyncio.sleep(0)
    assert r.host.on("live_tv") and loops


# -- the triggers --------------------------------------------------------------------------------------------------
async def test_each_trigger_schedules_a_look_coalesced(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch)
    looks = []

    async def counted():
        looks.append(1)
    monkeypatch.setattr(r.auto, "look", counted)
    r.host.on_registry()
    r.host.on_registry()
    pending = r.auto._pending
    assert pending is not None and pending.when() - asyncio.get_running_loop().time() > A.COALESCE_S - 1
    r.auto.schedule(0)                                   # an earlier look replaces the later one
    assert r.auto._pending is not pending and pending.cancelled()
    await asyncio.sleep(0.05)
    assert looks == [1]
    r.auto.tick()                                         # every 5 minutes
    await asyncio.sleep(0.05)
    r.auto.tick()
    await asyncio.sleep(0.05)
    assert looks == [1, 1]
    r.clock.t += A.EVERY_S
    r.auto.tick()
    await asyncio.sleep(0.05)
    assert looks == [1, 1, 1]
    await r.auto.connection_changed()                   # Music Assistant already says it's connected
    await asyncio.sleep(0.05)
    assert len(looks) == 4
    r.auto.stop()


async def test_start_schedules_a_look_and_a_seen_need_its_second(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch)
    await r.host.start()
    assert r.auto._pending is not None
    await asyncio.sleep(0.05)
    assert r.auto.looks == 1 and r.auto._again is not None, "the second look is on the clock"
    assert r.auto._again.when() - asyncio.get_running_loop().time() > A.TWO_LOOKS_S - 5
    await r.host.stop()
    assert r.auto._again is None


async def test_a_look_that_finds_one_running_is_one_more_look_after_it(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch)
    async with r.auto._lock:
        await r.auto.look()
    assert r.auto.looks == 0 and r.auto._asked
    await r.auto.look()
    assert r.auto.looks == 1 and r.auto._pending is not None and not r.auto._asked
    r.auto.stop()


async def test_an_unreadable_history_decides_nothing(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch)

    def broken(*a, **k):
        raise RuntimeError("database is locked")
    monkeypatch.setattr(r.store, "history", broken)
    before = r.store.body("house", F.FEATURES_DOC)
    await two_looks(r)
    assert r.store.body("house", F.FEATURES_DOC) == before and not r.host.on("music")
    assert r.host.settings["auto"]["decided"] == {}, "no one turned anything off"


async def test_a_failing_look_starts_the_2_minutes_over(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch)
    await r.auto.look()
    assert r.auto.first

    async def broken(wanted):
        raise RuntimeError("boom")
    monkeypatch.setattr(r.auto, "facts", broken)
    r.clock.t += A.TWO_LOOKS_S
    await r.auto.look()
    assert r.auto.first == {} and r.auto._again is None


async def test_status_says_why(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch)
    await r.auto.look()
    s = r.host.status()["auto"]
    assert s["enabled"] is True and s["waiting"] == ["clean_areas", "energy", "music"]
    assert s["needs"]["music"]["met"] is True
    assert s["why_not"]["live_tv"] == "doesn't have what it needs"
    assert s["why_not"]["music"].startswith("seen once")


# -- the request itself (tv_fetch.lan_get: what the probe and a home-network tuner's lineup use) ------------------
@pytest.fixture
async def lan_server():
    from aiohttp import web
    from aiohttp.test_utils import TestServer
    seen = []

    async def lineup(request):
        seen.append(request.headers.get("Host"))
        return web.Response(body=LINEUP, content_type="application/json")

    async def moved(request):
        raise web.HTTPFound("http://169.254.169.254/latest/meta-data/")

    async def big(request):
        return web.Response(body=b"[" + b" " * 3_000_000 + b"]", content_type="application/json")
    app = web.Application()
    app.router.add_get("/lineup.json", lineup)
    app.router.add_get("/moved", moved)
    app.router.add_get("/big", big)
    srv = TestServer(app, host="127.0.0.1")
    await srv.start_server()
    yield srv, seen
    await srv.close()


async def test_lan_get_connects_to_the_checked_address_without_redirects_and_with_a_cap(lan_server):
    from aiohttp import web
    from mantel_server.features.tv_fetch import lan_get
    srv, seen = lan_server
    app = web.Application()
    host = f"127.0.0.1:{srv.port}"
    anything = lambda a: True                                      # noqa: E731 -- the test server is on loopback
    assert json.loads(await lan_get(app, host, check=anything)) == json.loads(LINEUP)
    assert seen == [host], "the name goes as the Host; the connection is to the address checked"
    with pytest.raises(ValueError, match="HTTP 302"):
        await lan_get(app, host, "/moved", check=anything)
    with pytest.raises(ValueError, match="too large"):
        await lan_get(app, host, "/big", check=anything)
    with pytest.raises(ValueError, match="home network"):
        await lan_get(app, host)                                   # loopback is never a home address
    assert seen == [host]


async def test_a_save_made_from_an_overtaken_copy_is_refused_not_written_over_mantels(tmp_path, monkeypatch):
    """A page's save reads the settings, waits (an Energy read), then writes: Mantel turning Music on meanwhile is
    not undone by it (the save carries the version it read)."""
    from mantel_server.settings_store import SettingsError
    r = await rig(tmp_path, monkeypatch)
    stale, version = json.loads(json.dumps(r.host.settings)), r.host.settings_version
    await two_looks(r)
    assert r.host.on("music")
    stale["sleep"]["enabled"] = True
    with pytest.raises(SettingsError) as err:
        r.host.write_doc(F.FEATURES_DOC, F.check_settings(stale), None, "a page's save", expect_version=version)
    assert err.value.code == "conflict"
    await r.host.reload()
    assert r.host.on("music") and r.host.settings["auto"]["decided"]["music"]["by"] == "auto"


def test_the_alerts_link_opens_advanced_features():
    from mantel_server.alerts import Alerts
    me = SimpleNamespace(app={"cfg": SimpleNamespace(public_url="https://home.example.com/")})
    assert Alerts.link(me, "features") == "https://home.example.com/settings#/mantel/features"
    js = (Path(__file__).resolve().parents[1] / "web/shim/mantel-settings.js").read_text()
    assert "if (/^mantel\\/features$/.test(path)) return 'advanced/features';" in js, \
        "Mantel Settings forwards #/mantel/features to HK's Advanced -> Features"


async def test_lan_get_passes_over_an_address_that_fails_and_uses_one_that_passes(lan_server):
    from aiohttp import web
    from mantel_server.features.tv_fetch import lan_get
    srv, seen = lan_server
    # "localhost" has ::1 and 127.0.0.1: only the IPv4 one "passes" here, and that one is connected to
    got = await lan_get(web.Application(), f"localhost:{srv.port}", check=lambda a: a == "127.0.0.1")
    assert json.loads(got) == json.loads(LINEUP)


async def test_a_typed_tuner_is_read_as_typed_and_a_found_one_through_lan_get(tmp_path, monkeypatch):
    from mantel_server.features import tv_fetch
    r = await rig(tmp_path, monkeypatch, serves="mantel", settings={"live_tv": {"enabled": True, "tuner": TUNER}})
    r.host.hooks.fetch = None
    used = []

    async def fake_lan_get(app, host, *a, **k):
        used.append(("lan_get", host))
        return LINEUP

    async def fake_http(app, url, *a, **k):
        used.append(("http", url))
        return LINEUP
    monkeypatch.setattr(tv_fetch, "lan_get", fake_lan_get)
    from mantel_server.features import host as FH
    monkeypatch.setattr(FH, "http_fetch", fake_http)
    await r.host.tv.refresh()
    assert used == [("http", f"http://{TUNER}/lineup.json")], "a person's tuner, as before"
    body = {**r.host.settings, "auto": {"enabled": True, "decided": {"live_tv": {"by": "auto", "at": "x", "why": "y"}}}}
    write(r, body)
    await r.host.reload()
    await r.host.tv.refresh()
    assert used[-1] == ("lan_get", TUNER) and r.host.tv.lineup


async def test_saves_and_mantels_turn_on_take_turns(tmp_path, monkeypatch):
    r = await rig(tmp_path, monkeypatch)
    await r.auto.look()
    r.clock.t += A.TWO_LOOKS_S
    async with r.host.features_lock:
        task = asyncio.ensure_future(r.auto.look())
        await asyncio.sleep(0.05)
        assert not r.host.on("music"), "waits for the save in progress"
    await task
    assert r.host.on("music")
