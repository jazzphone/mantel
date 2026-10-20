"""Fully Kiosk Browser's REST client (mantel_server/connectors/fully.py; docs/phase8/KIOSK.md), against a fake
Fully (tests/fully_fakes.py). No real tablet is contacted."""
from __future__ import annotations

import logging

import aiohttp
import pytest
from aiohttp.test_utils import TestServer

from fully_fakes import PASSWORD, FakeFully
from mantel_server.connectors import fully
from mantel_server.connectors.fully import COMMANDS, FullyClient, KioskFailed, clean_address

MANTEL = "http://mantel.fake.test:8100"


@pytest.fixture
async def tablet():
    fake = FakeFully()
    server = TestServer(fake.app())
    await server.start_server()
    async with aiohttp.ClientSession() as http:
        # straight to the dataclass: the fake listens on loopback, which clean_address refuses (by design)
        client = FullyClient(http, "127.0.0.1", server.port, PASSWORD, frozenset({fully._origin(MANTEL)}), timeout=2.0)
        yield fake, client, server, http
    await server.close()


def _secret_free(text: str) -> None:
    assert PASSWORD not in text


def _mantel_log(caplog) -> str:
    """What Mantel logged. (The fake tablet's own access log prints each request's URL, password and all: Fully
    takes it in the query string, so anything on the way that logs URLs sees it. Mantel logs no URL.)"""
    return "\n".join(r.getMessage() for r in caplog.records if not r.name.startswith("aiohttp.access"))


# -- what is sent -----------------------------------------------------------------------------------------------
async def test_info_reads_the_tablet_and_keeps_only_what_mantel_uses(tablet):
    fake, client, *_ = tablet
    info = await client.info()
    assert info == {"id": "f0e1d2c3-fictional", "name": "Kitchen Tablet (fake)", "model": "Fake Tab 10",
                    "version": "1.57.1", "screen_on": True, "brightness": 71, "screensaver": False,
                    "page": MANTEL + "/kitchen-home/home", "foreground": "de.ozerov.fully", "battery": 88,
                    "plugged": True, "kiosk_mode": True, "ip": "192.0.2.31"}
    assert "Mac" not in str(info) and "startUrl" not in str(info)
    assert fake.calls == [{"cmd": "deviceInfo", "password": True, "type": "json"}]


async def test_each_command_is_the_one_fully_call_and_lands(tablet):
    fake, client, *_ = tablet
    await client.send("screen_off")
    assert fake.state["screenOn"] is False
    await client.send("screen_on")
    await client.send("brightness", level=40)
    assert fake.state["screenBrightness"] == 40
    await client.send("screensaver_on")
    assert fake.state["isInScreensaver"] is True
    await client.send("screensaver_off")
    await client.send("load_url", url=MANTEL + "/kitchen-photos/home?hk_tablet=kitchen")
    assert fake.state["currentPage"] == MANTEL + "/kitchen-photos/home?hk_tablet=kitchen"
    await client.send("load_start_url")
    await client.send("to_front")
    await client.send("clear_cache")
    assert fake.state["cache_cleared"] == 1
    assert fake.cmds() == ["screenOff", "screenOn", "setStringSetting", "startScreensaver", "stopScreensaver",
                           "loadUrl", "loadStartUrl", "toForeground", "clearCache"]
    assert fake.calls[2] == {"cmd": "setStringSetting", "key": "screenBrightness", "value": "40",
                             "password": True, "type": "json"}
    assert all(c["password"] is True and c["type"] == "json" for c in fake.calls)


def test_the_command_list_is_closed():
    """Nothing that runs code, changes another setting, opens another app, takes a picture or reboots."""
    sent = {cmd for cmd, _fixed in COMMANDS.values()}
    assert sent == {"screenOn", "screenOff", "setStringSetting", "startScreensaver", "stopScreensaver", "loadUrl",
                    "loadStartUrl", "toForeground", "clearCache"}
    assert COMMANDS["brightness"] == ("setStringSetting", {"key": "screenBrightness"})


@pytest.mark.parametrize("verb, args", [
    ("inject_javascript", {}), ("reboot", {}), ("getCamshot", {}), ("startApplication", {}),
    ("brightness", {}), ("brightness", {"level": 256}), ("brightness", {"level": -1}), ("brightness", {"level": 9.5}),
    ("brightness", {"level": True}), ("brightness", {"level": 40, "key": "startURL"}),
    ("screen_off", {"key": "x"}),
    ("load_url", {"url": "http://evil.example/"}), ("load_url", {"url": "javascript:alert(1)"}),
    ("load_url", {"url": "http://mantel.fake.test:8101/"}), ("load_url", {"url": "https://mantel.fake.test:8100/"}),
    ("load_url", {"url": "http://user@mantel.fake.test:8100/"}), ("load_url", {"url": MANTEL + "/a b"}),
    ("load_url", {}),
])
async def test_an_unknown_verb_or_bad_value_is_refused_before_anything_is_sent(tablet, verb, args):
    fake, client, *_ = tablet
    with pytest.raises(ValueError):
        await client.send(verb, **args)
    assert fake.calls == []


async def test_without_allowed_origins_no_page_can_be_loaded(tablet):
    fake, client, server, http = tablet
    bare = FullyClient(http, "127.0.0.1", server.port, PASSWORD)
    with pytest.raises(ValueError):
        await bare.send("load_url", url=MANTEL + "/")
    assert fake.calls == []


# -- failures, in plain words, never with the password ---------------------------------------------------------
async def test_a_wrong_password_is_said_plainly(tablet, caplog):
    fake, client, server, http = tablet
    caplog.set_level(logging.DEBUG)
    wrong = FullyClient(http, "127.0.0.1", server.port, "not-the-password")
    with pytest.raises(KioskFailed) as exc:
        await wrong.info()
    assert exc.value.code == "bad_password"
    assert "refused the Remote Admin password" in exc.value.message
    assert "not-the-password" not in exc.value.message and "not-the-password" not in _mantel_log(caplog)


@pytest.mark.parametrize("mode, code", [("html", "not_fully"), ("http500", "failed")])
async def test_something_else_answering_is_said_plainly(tablet, mode, code, caplog):
    fake, client, *_ = tablet
    caplog.set_level(logging.DEBUG)
    fake.mode = mode
    with pytest.raises(KioskFailed) as exc:
        await client.info()
    assert exc.value.code == code
    _secret_free(exc.value.message)
    _secret_free(_mantel_log(caplog))
    assert "password=" in caplog.text            # ...while the tablet's side saw it, as Fully's API requires


async def test_a_refused_command_quotes_fully_without_the_password(tablet):
    fake, client, *_ = tablet
    fake.mode = "echo"
    with pytest.raises(KioskFailed) as exc:
        await client.send("screen_on")
    assert exc.value.code == "refused"
    _secret_free(exc.value.message)
    assert "Bad value for •••" in exc.value.message


async def test_a_slow_tablet_times_out(tablet):
    fake, client, *_ = tablet
    fake.mode, fake.delay = "slow", 5
    client.timeout = 0.2
    with pytest.raises(KioskFailed) as exc:
        await client.send("screen_on")
    assert exc.value.code == "timeout"
    _secret_free(exc.value.message)


async def test_nothing_listening_is_unreachable_and_the_error_carries_no_url():
    async with aiohttp.ClientSession() as http:
        server = TestServer(FakeFully().app())
        await server.start_server()
        port = server.port
        await server.close()                            # a port with nothing on it now
        client = FullyClient(http, "127.0.0.1", port, PASSWORD, timeout=2.0)
        with pytest.raises(KioskFailed) as exc:
            await client.info()
    assert exc.value.code == "unreachable"
    # made after the except block: no aiohttp error (whose text is the URL, password included) in its chain
    assert exc.value.__cause__ is None and exc.value.__context__ is None
    _secret_free(str(exc.value))


def test_repr_never_shows_the_password():
    client = FullyClient(None, "192.0.2.31", 2323, PASSWORD)       # type: ignore[arg-type]
    _secret_free(repr(client))
    assert "192.0.2.31" in repr(client)


# -- the address, as typed on the Connections page --------------------------------------------------------------
@pytest.mark.parametrize("typed, expected", [
    ("192.0.2.31", ("192.0.2.31", 2323)), ("192.0.2.31:2323", ("192.0.2.31", 2323)),
    ("http://192.0.2.31:8080/", ("192.0.2.31", 8080)), ("10.0.0.5", ("10.0.0.5", 2323)),
    ("172.20.1.2", ("172.20.1.2", 2323)), ("kitchen-tablet", ("kitchen-tablet", 2323)),
    ("kitchen-tablet.local:2323", ("kitchen-tablet.local", 2323)), ("[fd00::31]", ("[fd00::31]", 2323)),
])
def test_addresses_on_the_home_network(typed, expected):
    assert clean_address(typed) == expected


@pytest.mark.parametrize("typed, code", [
    ("", "address_invalid"), ("https://192.0.2.31", "address_invalid"), ("192.0.2.31/remote", "address_invalid"),
    ("192.0.2.31?cmd=screenOff", "address_invalid"), ("admin:pw@192.0.2.31", "address_invalid"),
    ("192.0.2.31:99999", "address_invalid"), ("kitchen_tablet!", "address_invalid"),
    ("8.8.8.8", "address_not_home"), ("127.0.0.1", "address_not_home"), ("169.254.1.1", "address_not_home"),
    ("0.0.0.0", "address_not_home"), ("[2001:4860::8888]", "address_not_home"), (None, "address_invalid"),
])
def test_addresses_that_are_refused(typed, code):
    with pytest.raises(KioskFailed) as exc:
        clean_address(typed)
    assert exc.value.code == code


@pytest.mark.parametrize("pw, code", [("", "password_missing"), (None, "password_missing"),
                                      ("x" * 257, "password_invalid"), ("a\nb", "password_invalid")])
def test_passwords_that_are_refused(pw, code):
    with pytest.raises(KioskFailed) as exc:
        FullyClient.of(None, "192.0.2.31", pw)                      # type: ignore[arg-type]
    assert exc.value.code == code


async def test_the_connections_test_reads_the_tablet(tablet, monkeypatch):
    """What Save runs first: the typed address and password reach a Fully that answers deviceInfo."""
    fake, client, server, http = tablet
    real = fully.clean_address
    monkeypatch.setattr(fully, "clean_address",
                        lambda raw: ("127.0.0.1", server.port) if raw == "192.0.2.31" else real(raw))
    info = await fully.test(http, "192.0.2.31", PASSWORD)
    assert info["name"] == "Kitchen Tablet (fake)" and info["screen_on"] is True
    with pytest.raises(KioskFailed) as exc:
        await fully.test(http, "192.0.2.31", "wrong")
    assert exc.value.code == "bad_password"
    assert fake.cmds() == ["deviceInfo", "deviceInfo"]
