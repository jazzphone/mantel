"""Kiosk Satellite's remote API client (mantel_server/connectors/kiosk_satellite.py; docs/phase8/KIOSK.md slice 1),
against a fake Kiosk Satellite (tests/kiosk_satellite_fakes.py). No real tablet is contacted: the fictional tablet
addresses below are mapped to the fake on loopback."""
from __future__ import annotations

import logging
import time

import aiohttp
import pytest
from aiohttp.test_utils import TestServer

from kiosk_satellite_fakes import PASSWORD, FakeKioskSatellite
from mantel_server.connectors import kiosk
from mantel_server.connectors import kiosk_satellite as KS
from mantel_server.connectors.kiosk import KioskFailed

ADDR = "192.0.2.168"          # fictional here: mapped to the fake below


@pytest.fixture
async def tablet(monkeypatch):
    fake = FakeKioskSatellite()
    server = TestServer(fake.app())
    await server.start_server()
    monkeypatch.setattr(kiosk, "route", lambda host, port: ("127.0.0.1", server.port) if host == ADDR else (host, port))
    async with aiohttp.ClientSession() as http:
        yield fake, http, server
    await server.close()


def _mantel_log(caplog) -> str:
    return "\n".join(r.getMessage() for r in caplog.records if not r.name.startswith("aiohttp.access"))


async def test_pairing_trades_the_password_for_a_ten_year_token_and_reads_the_tablet(tablet, caplog):
    fake, http, _ = tablet
    caplog.set_level(logging.DEBUG)
    got = await KS.pair(http, ADDR, PASSWORD)
    assert fake.logins == [{"ok": True, "ttl_days": 3650}]
    assert got["info"] == {"name": "Kitchen Kiosk (fake)", "model": "Fake Tablet 11", "version": "2026.10.6",
                           "os": "Android 17", "ip": "192.0.2.168", "battery": 80, "charging": True,
                           "screen_on": True, "screensaver": False, "brightness": 62,
                           "page": "http://mantel.fake.test:8100/kitchen-home/home?hk_tablet=kitchen"}
    assert got["missing"] == []
    assert abs(got["expires"] - (time.time() + 3650 * 86400)) < 120
    assert fake.valid(got["token"])
    assert PASSWORD not in _mantel_log(caplog) and got["token"] not in _mantel_log(caplog)
    # reads only: the login, the info, the command list
    assert fake.calls == [("POST", "/api/login"), ("GET", "/api/info"), ("GET", "/api/commands")]
    assert fake.commands_posted == []


async def test_a_reply_that_arrives_in_pieces_is_read_whole(tablet):
    """Pairing a real Kiosk Satellite said "it is not Kiosk Satellite's remote administration": the reads took the
    first piece of a reply that comes in several (one `read(1 MB)` returns what has arrived), so the JSON was cut
    short (the house, 2026-10-19). Every piece is read now, up to the cap."""
    fake, http, _ = tablet
    fake.chunked = True
    fake.commands = [f"command{i}" for i in range(300)] + list(fake.commands)
    got = await KS.pair(http, ADDR, PASSWORD)
    assert got["info"]["version"] == "2026.10.6" and got["missing"] == []


def test_the_client_sends_only_its_closed_list():
    """Reload and Clear Cache are the only commands: no other method posts one or changes a setting."""
    assert KS.COMMANDS == {"reload": "reload", "clear_cache": "clearWebCache"}
    for cls in (KS.KioskSatellite, KS._Http):
        names = {n for n in dir(cls) if not n.startswith("__")}
        assert not names & {"command", "run", "post", "patch", "settings", "set"}, names


async def test_reload_and_clear_cache_post_exactly_those_commands(tablet):
    fake, http, _ = tablet
    client, token = await KS.login(http, ADDR, PASSWORD)
    await client.send("reload")
    await client.send("clear_cache")
    assert fake.commands_posted == ["reload", "clearWebCache"]
    assert fake.calls[-2:] == [("POST", "/api/commands/reload"), ("POST", "/api/commands/clearWebCache")]


@pytest.mark.parametrize("verb", ["restart_app", "rebootDevice", "reload ", "evalJs", "clearWebCache", ""])
async def test_any_other_verb_is_refused_before_sending(tablet, verb):
    fake, http, _ = tablet
    client, _token = await KS.login(http, ADDR, PASSWORD)
    before = list(fake.calls)
    with pytest.raises(ValueError):
        await client.send(verb)
    assert fake.calls == before and fake.commands_posted == []


async def test_a_failed_command_and_a_refused_token_are_said_plainly(tablet, caplog):
    fake, http, _ = tablet
    client, token = await KS.login(http, ADDR, PASSWORD)
    fake.fail_commands = True
    with pytest.raises(KioskFailed) as e:
        await client.send("reload")
    assert e.value.code == "refused" and "reload failed (fake)" in e.value.message
    fake.fail_commands = False
    fake.rotate_secret()
    with pytest.raises(KioskFailed) as e:
        await client.send("clear_cache")
    assert e.value.code == "token_refused" and token not in e.value.message
    assert token not in _mantel_log(caplog) and PASSWORD not in _mantel_log(caplog)


async def test_an_app_version_without_a_needed_command_is_said(tablet):
    fake, http, _ = tablet
    fake.commands = [c for c in fake.commands if c not in ("setBrightness", "bringToFront")]
    got = await KS.pair(http, ADDR, PASSWORD)
    assert got["missing"] == ["setBrightness", "bringToFront"]


async def test_a_wrong_password_is_said_plainly_and_kept_nowhere(tablet, caplog):
    fake, http, _ = tablet
    caplog.set_level(logging.DEBUG)
    with pytest.raises(KioskFailed) as exc:
        await KS.pair(http, ADDR, "not-the-admin-password")
    assert exc.value.code == "bad_password"
    assert "not-the-admin-password" not in exc.value.message + _mantel_log(caplog)
    assert exc.value.__cause__ is None and exc.value.__context__ is None
    assert fake.logins == [{"ok": False, "ttl_days": 3650}]


async def test_after_five_wrong_passwords_the_tablet_throttles_and_mantel_says_wait(tablet):
    fake, http, _ = tablet
    for _ in range(5):
        with pytest.raises(KioskFailed):
            await KS.login(http, ADDR, "wrong")
    with pytest.raises(KioskFailed) as exc:
        await KS.login(http, ADDR, PASSWORD)
    assert exc.value.code == "throttled" and "five minutes" in exc.value.message


async def test_a_token_the_tablet_no_longer_accepts_asks_to_pair_again(tablet):
    fake, http, _ = tablet
    got = await KS.pair(http, ADDR, PASSWORD)
    fake.rotate_secret()
    with pytest.raises(KioskFailed) as exc:
        await KS.KioskSatellite.of(http, ADDR, got["token"]).info()
    assert exc.value.code == "token_refused" and "Pair it again" in exc.value.message
    assert got["token"] not in exc.value.message


async def test_health_needs_no_token(tablet):
    fake, http, _ = tablet
    h = await KS.health(http, ADDR)
    assert h == {"name": "Kitchen Kiosk (fake)", "model": "Fake Tablet 11", "version": "2026.10.6", "screen_on": True,
                 "brightness": 62}
    assert fake.logins == [] and fake.calls == [("GET", "/api/health")]


async def test_something_else_on_the_port_is_not_kiosk_satellite(tablet):
    fake, http, _ = tablet
    fake.health_only = True
    with pytest.raises(KioskFailed) as exc:
        await KS.health(http, ADDR)
    assert exc.value.code == "not_kiosk_satellite"


async def test_fully_on_the_port_is_not_kiosk_satellite(monkeypatch):
    from fully_fakes import FakeFully
    server = TestServer(FakeFully().app())
    await server.start_server()
    monkeypatch.setattr(kiosk, "route", lambda host, port: ("127.0.0.1", server.port))
    try:
        async with aiohttp.ClientSession() as http:
            with pytest.raises(KioskFailed) as exc:
                await KS.login(http, ADDR, PASSWORD)
    finally:
        await server.close()
    assert exc.value.code == "not_kiosk_satellite"


async def test_nothing_listening_is_unreachable(monkeypatch):
    server = TestServer(FakeKioskSatellite().app())
    await server.start_server()
    port = server.port
    await server.close()
    monkeypatch.setattr(kiosk, "route", lambda host, p: ("127.0.0.1", port))
    async with aiohttp.ClientSession() as http:
        with pytest.raises(KioskFailed) as exc:
            await KS.login(http, ADDR, PASSWORD)
    assert exc.value.code == "unreachable" and "Remote Administration" in exc.value.message
    assert exc.value.__context__ is None


def test_repr_never_shows_the_token():
    c = KS.KioskSatellite(None, "192.0.2.168", 2324, "payload.signature-fictional")   # type: ignore[arg-type]
    assert "signature-fictional" not in repr(c)


def test_token_expiry_is_read_from_the_token():
    fake = FakeKioskSatellite()
    assert abs(KS.token_expires(fake.issue(10)) - (time.time() + 10 * 86400)) < 5
    assert KS.token_expires("not a token") is None
    assert KS.token_expires("e30.sig") is None                  # {} : no exp


@pytest.mark.parametrize("typed, expected", [
    ("192.0.2.168", ("192.0.2.168", 2324)), ("192.0.2.168:2400", ("192.0.2.168", 2400)),
    ("ks-kitchen-kiosk.local", ("ks-kitchen-kiosk.local", 2324)),
])
def test_the_default_port_is_kiosk_satellites(typed, expected):
    assert KS.clean_address(typed) == expected


@pytest.mark.parametrize("typed", ["8.8.8.8", "https://192.0.2.168", "192.0.2.168/api", "127.0.0.1"])
def test_addresses_off_the_home_network_are_refused(typed):
    with pytest.raises(KioskFailed):
        KS.clean_address(typed)


async def test_read_body_takes_every_piece_and_stops_past_the_cap():
    class Pieces:
        def __init__(self, parts):
            self.parts = list(parts)

        async def read(self, n):        # as aiohttp's: at most n bytes, of what has arrived
            if not self.parts:
                return b""
            part = self.parts.pop(0)
            if len(part) > n:
                self.parts.insert(0, part[n:])
                part = part[:n]
            return part
    assert await kiosk.read_body(Pieces([b'{"a":', b' 1', b"}"]), 100) == b'{"a": 1}'
    big = await kiosk.read_body(Pieces([b"x" * 60, b"y" * 60, b"z" * 60]), 100)
    assert len(big) == 101          # cap + 1: the caller sees it is too large, nothing more is read
