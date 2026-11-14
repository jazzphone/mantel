"""AirPlay Groups on Mantel's Connections screen (features/airplay_groups.py, connections.py kind ``airplay_groups``): an
address only, tested by reading the status page's /status.json; its summary on the row, its alerts, and the link to its
own page (and the HomePod Timer Reader's). A fake status page on this machine; the fictional house only."""
import json
import time
from types import SimpleNamespace as NS

from aiohttp import web
from aiohttp.test_utils import TestServer

from mantel_server import connections as C
from mantel_server.alerts import sources
from mantel_server.features import airplay_groups as F
from test_alerts_sources import FakeCenter
from test_connections import envs, owner  # noqa: F401 -- the fixture
from test_hk_core_airplay_groups import page, speaker


class FakePage:
    """ma-airplay-groups' status page. ``password`` counts any call to its password box: Mantel must never make one."""

    def __init__(self) -> None:
        self.body: object = page()
        self.status = 200
        self.password = 0
        self.server: TestServer | None = None

    async def start(self) -> str:
        app = web.Application()

        async def status(_r):
            return web.json_response(self.body, status=self.status)

        async def password(_r):
            self.password += 1
            return web.json_response({"ok": False})
        app.router.add_get("/status.json", status)
        app.router.add_route("*", "/password", password)
        self.server = TestServer(app)
        await self.server.start_server()
        return str(self.server.make_url("")).rstrip("/")

    async def close(self) -> None:
        await self.server.close()


async def fake_page(envs):  # noqa: F811
    fake = FakePage()
    url = await fake.start()
    envs.fakes.append(fake)
    return fake, url


# ---- the connection
async def test_it_is_a_connection_of_its_own_with_no_token(envs):  # noqa: F811
    assert "airplay_groups" in C.KINDS and C.LABEL["airplay_groups"] == "AirPlay Groups"
    assert C.clean_url("airplay_groups", "http://192.0.2.10:54398/") == "http://192.0.2.10:54398"
    env = await envs()
    await owner(env)
    status, body = await env.call("GET", "/api/connections")
    ag = body["connections"]["airplay_groups"]
    assert status == 200 and ag["state"] == "not_set_up" and ag["token"] is False and "dashboard" not in ag
    assert ag["live"] == {"connected": False, "state": "off", "error": None, "last_ok": None, "version": None, "summary": None}
    assert body["connections"]["homepod"]["token"] is True


async def test_test_reads_the_page_and_says_plainly_when_it_is_not_there(envs):  # noqa: F811
    fake, url = await fake_page(envs)
    env = await envs()
    await owner(env)
    status, body = await env.call("POST", "/api/connections/airplay_groups/test", {"url": url + "/"})
    assert status == 200 and body["method"] == "address" and body["result"]["version"] == "0.2.15"
    assert body["result"]["summary"]["speakers"] == 3 and body["result"]["summary"]["addon"]["on"] is True
    fake.body = {"homepods": []}                                    # something else answers there
    status, body = await env.call("POST", "/api/connections/airplay_groups/test", {"url": url})
    assert status == 422 and body["error"] == "not_airplay_groups" and "54398" in body["message"]
    fake.status = 404
    status, body = await env.call("POST", "/api/connections/airplay_groups/test", {"url": url})
    assert status == 422 and body["error"] == "not_airplay_groups"
    await fake.close()
    status, body = await env.call("POST", "/api/connections/airplay_groups/test", {"url": url})
    assert status == 422 and body["error"] == "unreachable" and "AirPlay Groups" in body["message"]
    assert not (env.cfg.connections_dir / "airplay_groups.connection").exists()
    assert fake.password == 0


async def test_only_an_owner_changes_it(envs):  # noqa: F811
    _, url = await fake_page(envs)
    env = await envs()
    await env.user("boss", "admin")
    await env.sign_in("boss")
    status, _ = await env.call("POST", "/api/connections/airplay_groups", {"url": url})
    assert status == 403
    status, body = await env.call("GET", "/api/connections")
    assert status == 200 and body["can_edit"] is False


async def test_save_shows_the_summary_and_links_to_its_page(envs):  # noqa: F811
    fake, url = await fake_page(envs)
    env = await envs()
    await owner(env)
    status, body = await env.call("POST", "/api/connections/airplay_groups", {"url": url})
    assert status == 200, body
    saved = body["connection"]
    assert saved["source"] == "mantel" and saved["saved"]["method"] == "address" and saved["saved"]["user"] is None
    assert saved["dashboard"] == url + "/"
    rows = env.app["audit"].rows(kind="config")
    assert [r for r in rows if r["action"] == "connection.airplay_groups.saved"]
    host = env.app["airplay_groups"]
    await host.look()                                              # (the poller's look, now)
    _, body = await env.call("GET", "/api/connections")
    live = body["connections"]["airplay_groups"]["live"]
    assert live["connected"] is True and live["state"] == "ok" and live["version"] == "0.2.15"
    assert live["summary"]["speakers"] == 3 and live["summary"]["locked_out"] == []
    # disconnected: Mantel forgets the address, and the page's summary with it
    status, body = await env.call("DELETE", "/api/connections/airplay_groups")
    assert status == 200 and body["connection"]["state"] == "not_set_up" and "dashboard" not in body["connection"]
    assert host.state() == "off" and host.summary is None
    assert [r for r in env.app["audit"].rows(kind="config") if r["action"] == "connection.airplay_groups.disconnected"]
    assert fake.password == 0


async def test_the_homepod_reader_links_to_its_page_too(envs):  # noqa: F811
    env = await envs()
    await owner(env)
    rec = C.Record(kind="homepod", url="http://192.0.2.10:8787", token="reader-token", method="token", since=time.time())
    await env.app["connections"].save(rec)
    _, body = await env.call("GET", "/api/connections")
    hp = body["connections"]["homepod"]
    assert hp["dashboard"] == "http://192.0.2.10:8787/" and "reader-token" not in json.dumps(body)
    assert "dashboard" not in body["connections"]["ha"] and "dashboard" not in body["connections"]["ma"]


# ---- the poller and the alerts
def host_at(url, answers, now):
    conns = NS(current=lambda kind: NS(url=url[0]) if kind == "airplay_groups" and url[0] else None)

    async def fetch(u):
        got = answers[0]
        if isinstance(got, Exception):
            raise got
        return got
    return F.AirPlayGroups({"connections": conns}, lambda: now[0], fetch=fetch)


async def test_the_poller_says_unavailable_and_keeps_the_last_summary_to_itself():
    url, answers, now = ["http://192.0.2.10:54398"], [page()], [1000.0]
    host = host_at(url, answers, now)
    assert host.state() == "starting" and host.status()["connected"] is False
    await host.look()
    assert host.state() == "ok" and host.status()["summary"]["speakers"] == 3 and host.last_ok == 1000.0
    answers[0] = F.LookFailed("the status page didn't answer")
    now[0] = 1060.0
    await host.look()
    st = host.status()
    assert st["state"] == "unavailable" and st["summary"] is None and st["error"] == "the status page didn't answer"
    assert host.down_since == 1060.0 and not host.alert_due()
    answers[0] = {"something": "else"}
    now[0] = 1060.0 + 600
    await host.look()
    assert host.down_since == 1060.0 and host.alert_due() and "not as AirPlay Groups" in host.error
    answers[0] = page()
    await host.look()
    assert host.state() == "ok" and host.down_since is None and not host.alert_due()
    url[0] = None                                                   # disconnected
    await host.look()
    assert host.state() == "off" and host.summary is None


async def test_alerts_for_a_page_gone_ten_minutes_and_a_locked_out_speaker(tmp_path):
    url, answers, now = ["http://192.0.2.10:54398"], [page()], [1000.0]
    host = host_at(url, answers, now)
    c = FakeCenter()
    w = sources.Watch({"cfg": NS(data_dir=tmp_path), "airplay_groups": host}, c, clock=lambda: now[0])
    await host.look()
    w.look()
    assert not {"airplay_groups.lost", "airplay_groups.locked"} & c.kinds()
    answers[0] = page(speakers=[speaker("Den HomePod", locked_out=True), speaker("Porch HomePod")])
    await host.look()
    w.look()
    assert c.up[("airplay_groups.locked", "")] == {"names": "Den HomePod"}
    answers[0] = F.LookFailed("the status page didn't answer")      # gone: what was locked out stays so
    await host.look()
    w.look()
    assert "airplay_groups.locked" in c.kinds() and "airplay_groups.lost" not in c.kinds()
    now[0] += 600
    w.look()
    assert "airplay_groups.lost" in c.kinds()
    answers[0] = page()
    await host.look()
    w.look()
    assert not {"airplay_groups.lost", "airplay_groups.locked"} & c.kinds()


def test_the_alerts_are_in_the_catalog():
    from mantel_server.alerts import catalog
    for kid in ("airplay_groups.lost", "airplay_groups.locked"):
        k = catalog.kind(kid)
        assert k.group == "connections" and k.clears and k.page == "connections"
    assert catalog.kind("airplay_groups.locked").words({"names": "Den HomePod"})[0] == "Den HomePod locked out of AirPlay"


def test_the_settings_page_links_to_each_dashboard_in_a_new_tab():
    from pathlib import Path
    js = (Path(__file__).resolve().parents[1] / "web/shim/settings/connections.js").read_text()
    assert "row('airplay_groups')" in js and "window.open(x.dashboard, '_blank', 'noopener')" in js
    assert "/password" not in js                                    # the page's AirPlay password box is never used
