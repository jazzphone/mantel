"""Plain ws:// to Mantel Server is allowed only on this machine and on Home
Assistant's internal App network (172.30.32.0/23): loopback, an IP literal
there, or an App hostname (local-<slug>, <8 hex>-<slug>) whose every resolved
address is there. Checked on save (linked_mode.check_url) and again right
before every connect (mantel_link.MantelLink), connecting to the checked
address with the original Host header. wss:// is allowed anywhere."""
from __future__ import annotations

import asyncio
import json
import logging
import pathlib

import aiohttp
import pytest

from custom_components.hk_frontend import linked_mode
from custom_components.hk_frontend.mantel_link import MantelLink, plain_target
from mantel_fake import TOKEN, FakeMantel


@pytest.fixture
def resolve(monkeypatch):
    names: dict[str, list[str]] = {}

    async def resolver(host, port):
        if host not in names:
            raise OSError("unknown host")
        return list(names[host])
    monkeypatch.setattr("custom_components.hk_frontend.mantel_link.system_resolver", resolver)
    return names


@pytest.mark.parametrize("url", ["http://127.0.0.1:8099", "http://[::1]:8099", "ws://172.30.32.5:8099",
                                 "http://172.30.33.255:8099", "https://anywhere.example.com",
                                 "wss://192.0.2.53:8443", "https://local-nothere:8099"])
async def test_allowed_without_resolution(url, resolve):
    assert await linked_mode.check_url(url) is None


@pytest.mark.parametrize("url", ["http://203.0.113.1:8099", "http://192.0.2.53:8099",
                                 "http://198.51.100.1:8099", "http://mantel.example.lan",
                                 "http://[fd00::1]:8099"])
async def test_refused_insecure(url, resolve):
    assert await linked_mode.check_url(url) == "mantel_url_insecure"


async def test_localhost_resolves_to_loopback(resolve):
    resolve["localhost"] = ["127.0.0.1", "::1"]
    assert await linked_mode.check_url("http://localhost:8099") is None
    resolve["localhost"] = ["198.51.100.5"]
    assert await linked_mode.check_url("http://localhost:8099") == "mantel_url_not_internal"


async def test_app_hostnames_only_by_resolution(resolve):
    resolve["local-mantel"] = ["172.30.33.1"]
    resolve["a0d7b954-mantel-server"] = ["172.30.32.9"]
    resolve["local-out"] = ["198.51.100.5"]
    resolve["mixed-ok"] = ["172.30.33.1"]
    resolve["local-mixed"] = ["172.30.33.1", "198.51.100.5"]
    resolve["local-v6"] = ["fd00::1"]
    resolve["mantel"] = ["172.30.33.1"]
    assert await linked_mode.check_url("http://local-mantel:8099") is None
    assert await linked_mode.check_url("http://a0d7b954-mantel-server:8099") is None
    assert await linked_mode.check_url("http://local-out:8099") == "mantel_url_not_internal"
    assert await linked_mode.check_url("http://local-mixed:8099") == "mantel_url_not_internal", "all addresses"
    assert await linked_mode.check_url("http://local-v6:8099") == "mantel_url_not_internal"
    assert await linked_mode.check_url("http://local-gone:8099") == "mantel_url_not_internal", "no resolution"
    # not App-shaped: refused though it resolves inside
    assert await linked_mode.check_url("http://mantel:8099") == "mantel_url_insecure"
    assert await linked_mode.check_url("http://mixed-ok:8099") == "mantel_url_insecure"
    assert await linked_mode.check_url("http://Local-Mantel:8099") is None, "host names are case-insensitive"


async def test_resolution_does_not_block_the_loop():
    async def slow(host, port):
        await asyncio.sleep(0.05)
        return ["172.30.33.1"]
    ticks = 0

    async def tick():
        nonlocal ticks
        while True:
            await asyncio.sleep(0.005)
            ticks += 1
    t = asyncio.create_task(tick())
    assert await plain_target("http://local-mantel:8099", slow) == (None, ["172.30.33.1"])
    t.cancel()
    assert ticks >= 3


class Quiet:
    def __getattr__(self, name):
        return lambda *a, **k: None


@pytest.fixture
async def session(socket_enabled):
    s = aiohttp.ClientSession()
    yield s
    await s.close()


async def _wait(check, n=300):
    for _ in range(n):
        if check():
            return True
        await asyncio.sleep(0.02)
    return False


async def test_connects_to_the_checked_address_with_the_original_host(session, resolve):
    fake = await FakeMantel().start()
    try:
        port = fake.server.port
        resolve["local-mantel"] = ["127.0.0.1"]
        link = MantelLink(session, f"http://local-mantel:{port}", TOKEN, Quiet(), backoff=(0.02, 0.05))
        task = asyncio.create_task(link.run())
        assert await _wait(lambda: link.connected)
        assert fake.headers[-1]["Host"] == f"local-mantel:{port}"
        await link.close()
        task.cancel()
    finally:
        await fake.close()


async def test_connect_time_recheck_refuses_when_resolution_changed(session, resolve, caplog):
    caplog.set_level(logging.DEBUG)
    fake = await FakeMantel().start()
    try:
        port = fake.server.port
        resolve["local-mantel"] = ["127.0.0.1"]
        token = "msvc_ffeeddccbbaa9988_" + "Q" * 43
        fake.token = token
        link = MantelLink(session, f"http://local-mantel:{port}", token, Quiet(), backoff=(0.02, 0.05))
        task = asyncio.create_task(link.run())
        assert await _wait(lambda: link.connected)
        # the name now points outside the range; the socket drops
        resolve["local-mantel"] = ["198.51.100.5"]
        before = fake.connects
        await fake.drop()
        assert await _wait(lambda: link.last_error == "mantel_url_not_internal" and link.attempts > 2)
        assert not link.connected
        assert fake.connects == before, "never connected to the new address"
        assert "not connecting to" in caplog.text
        assert token not in caplog.text and token not in repr(link) and token not in link.last_error
        # resolves inside again: connects again
        resolve["local-mantel"] = ["127.0.0.1"]
        assert await _wait(lambda: link.connected) and link.last_error is None
        await link.close()
        task.cancel()
    finally:
        await fake.close()


async def test_configure_refuses_a_name_outside(hass, frontend, resolve):
    from conftest import entry
    e = entry(hass)
    flows = hass.config_entries.options
    r = await flows.async_init(e.entry_id)
    r = await flows.async_configure(r["flow_id"], {"next_step_id": "linked"})
    resolve["local-mantel"] = ["198.51.100.5"]
    r = await flows.async_configure(r["flow_id"], {"enabled": True, "url": "http://local-mantel:8099",
                                                   "token": TOKEN})
    assert r["errors"] == {"url": "mantel_url_not_internal"}
    assert "mantel_link" not in e.data


def _url_default(form):
    for key in form["data_schema"].schema:
        if str(key) == "url":
            return key.default()
    raise AssertionError("no url field")


async def test_configure_offers_the_mantel_apps_address_when_it_is_there(hass, frontend, resolve):
    """Nothing saved yet: the form offers http://local-mantel:8099 when that name resolves inside HA's internal App
    network, and nothing when it does not (no Mantel App, or a name that points elsewhere)."""
    from conftest import entry
    e = entry(hass)
    flows = hass.config_entries.options
    resolve["local-mantel"] = ["172.30.33.1"]
    r = await flows.async_init(e.entry_id)
    r = await flows.async_configure(r["flow_id"], {"next_step_id": "linked"})
    assert _url_default(r) == "http://local-mantel:8099"
    resolve["local-mantel"] = ["198.51.100.5"]
    r = await flows.async_init(e.entry_id)
    r = await flows.async_configure(r["flow_id"], {"next_step_id": "linked"})
    assert _url_default(r) == ""
    del resolve["local-mantel"]
    r = await flows.async_init(e.entry_id)
    r = await flows.async_configure(r["flow_id"], {"next_step_id": "linked"})
    assert _url_default(r) == ""


def test_translations_have_the_new_key():
    en = json.loads((pathlib.Path(linked_mode.__file__).parent / "translations" / "en.json").read_text())
    assert "mantel_url_not_internal" in en["options"]["error"]
