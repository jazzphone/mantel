"""Mantel's own settings that were start-up options (server_settings.py): copied once from the option, then the
stored value wins; changed in Mantel Settings by an Owner, audited, applied at once; Allow Control of the House
builds or removes the command path live, needs a fresh factor to turn on, and the read-only kill switch holds it
off; the old ha_frame_origins and Music Assistant options move into what Settings already had, once."""
import pytest
from aiohttp.test_utils import TestClient, TestServer
from argon2 import PasswordHasher

from conftest import Mantel
from mantel_server import server_settings as SS


@pytest.fixture
async def make(tmp_path, monkeypatch):
    """build(**cfg) -> a started Mantel on one database and secrets folder shared by every build in the test."""
    from mantel_server.config import Config
    from mantel_server.ha.ha_client import HaClient
    from mantel_server.ha.readproxy import ReadProxy
    from mantel_server.server import build_app
    from mantel_server.storage.store import Store

    async def forbidden(*args, **kwargs):
        pytest.fail("server settings tests attempted upstream access")

    monkeypatch.setattr(HaClient, "run", forbidden)
    monkeypatch.setattr(HaClient, "_send", forbidden)
    monkeypatch.setattr(ReadProxy, "request", forbidden)
    opened = []

    async def build(**over):
        cfg = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", port=0, **over)
        store = Store(cfg.data_dir / "mantel.db")
        now = [1_000_000.0]
        app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False, clock=lambda: now[0])
        app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
        client = TestClient(TestServer(app))
        await client.start_server()
        origin = str(client.make_url("")).rstrip("/")
        client.session.headers["Origin"] = origin
        opened.append((client, store))
        return Mantel(app, client, store, now, origin)

    yield build
    for client, store in opened:
        if not client.session.closed:
            await client.close()
        store.db.close()


async def owner(m, name="avery"):
    await m.user(name, "owner")
    await m.sign_in(name)


async def put(m, key, value, tunnel=False):
    r = await m.client.put(SS.API, json={"key": key, "value": value}, headers=m.headers(tunnel=tunnel))
    return r.status, await r.json()


async def test_each_option_is_copied_once_then_the_stored_value_wins(make):
    m = await make(commands_enabled=True, default_screen="dashboard-den", session_hours=48.0, ha_door_rules="lan",
                   ha_browser_url="https://ha.home.example")
    ss = m.app["server_settings"]
    assert {k: ss.get(k) for k in SS.KEYS} == {"commands_enabled": True, "default_screen": "dashboard-den",
                                              "session_hours": 48.0, "ha_door_rules": "lan",
                                              "ha_sign_in_url": "https://ha.home.example"}
    assert all(ss.row(k)["source"] == "start-up" for k in SS.KEYS)
    assert m.app["gateway"] is not None and m.app["sessions"].ttl["tunnel"] == 48 * 3600
    await m.client.close()
    # the next start has no such options (or other ones): what is stored stays, and is what runs
    again = await make()
    cfg = again.app["cfg"]
    assert cfg.commands_enabled is True and cfg.default_screen == "dashboard-den" and cfg.session_hours == 48.0
    assert cfg.ha_door_rules == "lan" and cfg.ha_browser_url == "https://ha.home.example"
    assert again.app["gateway"] is not None, "control stays allowed although the start-up option is gone"
    await again.client.close()


async def test_a_fresh_install_starts_read_only_with_the_defaults(make):
    m = await make()
    ss = m.app["server_settings"]
    assert ss.get("commands_enabled") is False and m.app["gateway"] is None
    assert ss.get("default_screen") == "" and ss.seeded == [], "nothing set: nothing to say in the log"
    await m.client.close()


async def test_the_kill_switch_holds_the_house_read_only(make):
    m = await make(commands_enabled=True, read_only=True)
    assert m.app["server_settings"].get("commands_enabled") is True, "what was asked for is kept"
    assert m.app["cfg"].commands_enabled is False and m.app["gateway"] is None
    await owner(m)
    got = await (await m.get(SS.API)).json()
    assert got["read_only_forced"] is True and got["commands_on"] is False
    st, body = await put(m, "commands_enabled", True)
    assert st == 409 and body["error"] == "read_only_forced"
    await m.client.close()


async def test_only_an_owner_changes_them_and_every_change_is_audited(make):
    m = await make()
    await m.user("sam", "admin")
    await m.sign_in("sam")
    got = await (await m.get(SS.API)).json()
    assert got["can_edit"] is False and "settings" in got, "an Admin sees them"
    assert (await put(m, "session_hours", 24))[0] == 403
    await m.user("kid", "child")
    await m.sign_in("kid")
    assert (await m.get(SS.API)).status == 403
    await owner(m)
    st, body = await put(m, "session_hours", 24)
    assert st == 200 and body["settings"]["session_hours"] == {"value": 24.0, "source": "settings", "updated": m.now[0]}
    assert m.app["sessions"].ttl["tunnel"] == 24 * 3600, "new sign-ins from away get it at once"
    rows = [r for r in m.app["audit"].rows() if r["action"] == "server_setting.session_hours"]
    assert len(rows) == 1
    await m.client.close()


@pytest.mark.parametrize("key, bad", [("session_hours", 0), ("session_hours", 721), ("session_hours", "12"),
                                      ("ha_door_rules", "open"), ("commands_enabled", "yes"),
                                      ("default_screen", "../etc"), ("default_screen", "dashboard-nowhere"),
                                      ("ha_sign_in_url", "ha.home.example"), ("ha_sign_in_url", "https://ha.example/lovelace"),
                                      ("ha_sign_in_url", "javascript:alert(1)"), ("nope", 1)])
async def test_bad_values_are_refused_and_nothing_changes(make, key, bad):
    m = await make()
    await owner(m)
    before = {k: m.app["server_settings"].get(k) for k in SS.KEYS}
    st, body = await put(m, key, bad)
    assert st == 400 and body["error"] == "invalid"
    assert {k: m.app["server_settings"].get(k) for k in SS.KEYS} == before
    await m.client.close()


async def test_allow_control_builds_the_command_path_live_and_needs_a_fresh_factor(make):
    m = await make()
    await owner(m)
    m.now[0] += 600                                       # signed in ten minutes ago: no longer fresh
    st, body = await put(m, "commands_enabled", True)
    assert st == 403 and body["error"] == "step_up_required", "even at home, turning control on asks again"
    assert m.app["gateway"] is None
    m.now[0] -= 600
    st, body = await put(m, "commands_enabled", True)
    assert st == 200 and body["commands_on"] is True
    gw = m.app["gateway"]
    assert gw is not None and m.app["commander"] is not None and m.app["ma_gate"] is gw
    assert m.app["talk"] is not None and m.app["cfg"].commands_enabled is True
    m.now[0] += 600                                       # turning it off needs no fresh factor at home
    st, body = await put(m, "commands_enabled", False)
    assert st == 200 and body["commands_on"] is False
    assert m.app["gateway"] is None and m.app["commander"] is None and m.app["talk"] is None
    actions = [r["action"] for r in m.app["audit"].rows()]
    assert actions.count("server_setting.commands_enabled") == 2
    await m.client.close()


async def test_a_page_socket_is_told_when_control_changes(make):
    m = await make()
    await owner(m)
    ws = await m.client.ws_connect("/ws", headers={"Origin": m.origin})
    await put(m, "commands_enabled", True)
    msg = await ws.receive()
    assert msg.type.name in ("CLOSE", "CLOSED", "CLOSING"), "the page reconnects and is told it may offer actions"
    ws2 = await m.client.ws_connect("/ws", headers={"Origin": m.origin})
    first = await ws2.receive_json(timeout=5)
    assert first["type"] == "capabilities" and first["commands"] is True
    await ws2.close()
    await m.client.close()


async def test_the_house_default_screen_must_be_one_of_mantels(make):
    from mantel_server.pages import default_screens
    from mantel_server.settings_store import Actor
    m = await make()
    await owner(m)
    m.app["settings"].store.write([("board", "dashboard-den", {"title": "Den"})], actor=Actor(label="t"))
    st, _ = await put(m, "default_screen", "dashboard-den")
    assert st == 200 and default_screens.house(m.app) == "dashboard-den"
    st, _ = await put(m, "default_screen", "")
    assert st == 200 and m.app["cfg"].default_screen == ""
    await m.client.close()


async def test_the_sign_in_address_is_has_own_unless_one_is_set(make):
    m = await make()
    await owner(m)
    assert SS.sign_in_address(m.app) == ""
    m.app["frame_origins"].learn({"internal_url": "http://homeassistant.local:8123", "external_url": "https://ha.away.example"})
    assert SS.sign_in_address(m.app) == "https://ha.away.example"
    got = await (await m.get(SS.API)).json()
    assert got["sign_in"] == {"address": "https://ha.away.example", "from": "ha_external"}
    st, body = await put(m, "ha_sign_in_url", "https://HA.Home.Example/")
    assert st == 200 and body["sign_in"] == {"address": "https://ha.home.example", "from": "settings"}
    oauth = m.app["oauth"]
    assert oauth.authorize_url("s").startswith("https://ha.home.example/auth/authorize?")
    assert "https://ha.home.example" in m.app["frame_origins"].all(), "the address set here may frame Mantel"
    st, _ = await put(m, "ha_sign_in_url", "")
    assert st == 200 and oauth.browser_address() == "https://ha.away.example"
    assert "https://ha.home.example" not in m.app["frame_origins"].all()
    await m.client.close()


async def test_the_door_rules_apply_at_once(make):
    m = await make(ha_door_rules="tunnel")
    await owner(m)
    st, _ = await put(m, "ha_door_rules", "trusted")
    assert st == 200 and m.app["cfg"].ha_door_rules == "trusted"
    await m.client.close()


async def test_ha_frame_origins_move_into_the_approved_addresses_once(make):
    m = await make(ha_frame_origins=("https://ha.home.example", "http://homeassistant.local:8123"))
    fo = m.app["frame_origins"]
    assert fo.approved() == ("https://ha.home.example", "http://homeassistant.local:8123")
    assert m.app["server_settings"].moved("frame_origins")
    await m.client.close()
    again = await make(ha_frame_origins=("https://other.example",))
    assert again.app["frame_origins"].approved() == ("https://ha.home.example", "http://homeassistant.local:8123"), \
        "copied once: a later start-up value is not read"
    await again.client.close()


async def test_music_assistants_start_up_connection_becomes_mantels_own_once(make, tmp_path, monkeypatch):
    from mantel_server.connectors import ma as ma_connector
    monkeypatch.setattr(ma_connector.MaClient, "start", lambda self: None)       # never dial the fictional MA
    token = tmp_path / "ma_token"
    token.write_text("fictional-ma-token")
    m = await make(ma_url="ws://ma.home.example:8095/ws", ma_token_file=token)
    conns = m.app["connections"]
    cur = conns.current("ma")
    assert cur.source == "mantel" and cur.url == "ws://ma.home.example:8095/ws" and cur.token == "fictional-ma-token"
    assert cur.record.by_name == "Start-up options" and m.app["server_settings"].moved("ma")
    await m.client.close()
    token.unlink()
    again = await make()
    assert again.app["connections"].current("ma").source == "mantel", "kept after the start-up option is gone"
    await again.client.close()
