"""The HA App's direct access (decision 26; mantel_server/direct.py, direct_tls.py; docs/phase3/HA-APP.md "Direct
access"): the App options for the three access modes, the Ingress-only gate per mode, who is believed on the direct
port (never Ingress headers; the home's proxy only with the door key; the built-in HTTPS port by the peer's
address), Mantel's own sign-in and wall tablets there, and the built-in HTTPS certificate (a fictional ACME server
and Cloudflare, acme_fakes.py).

The server tests run Mantel's real two-listener server (direct.serve) on two loopback ports: the Ingress port
(cfg.port) and the direct port (cfg.direct_port), the way the App runs them on 8099 and 8100. Every peer is
127.0.0.1, so "the Ingress proxy" or "the home's proxy" is 127.0.0.1 where a test needs it to be.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import socket
import ssl
import stat
import sys
from pathlib import Path
from types import SimpleNamespace

import aiohttp
import pytest
from aiohttp.test_utils import TestServer

from mantel_server import direct, direct_tls, ingress

sys.path.insert(0, str(Path(__file__).resolve().parent))
from acme_fakes import FakeAcme, FakeCloudflare, FakeDuckDns  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
NAME = "mantel.home.example"
PUBLIC = f"https://{NAME}/"
OWNER_HA = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
PAGE = {"Sec-Fetch-Dest": "document", "Accept": "text/html"}
CF_TOKEN = "fictional-cloudflare-token-1234567890"


def _entrypoint():
    import importlib.util
    spec = importlib.util.spec_from_file_location("mantel_entrypoint_direct", ROOT / "packaging/docker/entrypoint.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _plan(tmp_path, options: dict, ep=None, **env):
    ep = ep or _entrypoint()
    path = tmp_path / "options.json"
    path.write_text(json.dumps(options))
    base = {"SUPERVISOR_TOKEN": "fictional-supervisor-credential", "MANTEL_APP_MA_TOKEN_FILE": str(tmp_path / "ma"),
            "MANTEL_APP_CF_TOKEN_FILE": str(tmp_path / "cf"), **env}
    return ep, ep.plan([], base, options_path=path, token_file=tmp_path / "t")


# -- the App's options, per mode ------------------------------------------------------------------------------
def test_ingress_mode_is_the_default_and_listens_on_no_direct_port(tmp_path):
    from mantel_server.config import parse_args
    _, (args, _) = _plan(tmp_path, {})
    cfg = parse_args(args)
    assert cfg.ingress and cfg.ingress_only and cfg.direct_port == 0 and cfg.direct_tls == ""
    assert cfg.public_url == "https://ingress.invalid/" and cfg.trusted_proxies == () and cfg.proxy_kind == ""
    _, (args, _) = _plan(tmp_path, {"access": "ingress", "public_url": PUBLIC, "trusted_proxies": "192.0.2.7"})
    cfg = parse_args(args)
    assert cfg.direct_port == 0 and cfg.trusted_proxies == ()            # the other options do nothing here


def test_proxy_mode_publishes_the_direct_port_with_the_door_key_rules(tmp_path):
    from mantel_server.config import parse_args
    _, (args, _) = _plan(tmp_path, {"access": "proxy", "public_url": "https://Mantel.Home.Example",
                                    "trusted_proxies": "192.0.2.7, 2001:db8::7",
                                    "ha_sign_in_url": "http://homeassistant.local:8123/"})
    cfg = parse_args(args)
    assert cfg.direct_port == 8100 and cfg.port == 8099 and cfg.direct_tls == ""
    assert cfg.public_url == PUBLIC and cfg.direct_hosts == (NAME,) and cfg.webauthn_rp_id == NAME
    assert cfg.trusted_proxies == ("192.0.2.7", "2001:db8::7") and cfg.proxy_kind == "own"
    assert cfg.ha_browser_url == "http://homeassistant.local:8123" and cfg.ha_oauth_url == "http://homeassistant:8123"
    assert cfg.ingress_only and "*" in cfg.allowed_hosts                 # the sidebar's port is unchanged
    assert cfg.ha_url == "http://supervisor/core"                       # HA's automatic connection stays
    _, (args, _) = _plan(tmp_path, {"access": "proxy", "public_url": "https://mantel.home.example:8443",
                                    "trusted_proxies": "192.0.2.7"})
    cfg = parse_args(args)
    assert cfg.public_url == "https://mantel.home.example:8443/" and set(cfg.direct_hosts) == {NAME + ":8443", NAME}
    assert cfg.ha_browser_url == ""                                     # no sign-in address: Mantel's own sign-in only


def test_home_assistants_addresses_may_frame_the_direct_address(tmp_path):
    """A Webpage dashboard in HA's sidebar shows a Mantel screen. The old ha_frame_origins option is handed to Mantel
    as first-start values (--ha-frame-origin, copied once into Mantel Settings' approved addresses:
    test_server_settings), normalised to origins; the sign-in address frames Mantel from Mantel Settings now, so
    neither is a start-up frame-ancestor."""
    from mantel_server.config import parse_args
    base = {"access": "proxy", "public_url": PUBLIC, "trusted_proxies": "192.0.2.7"}
    assert parse_args(_plan(tmp_path, base)[1][0]).frame_ancestors == ()
    _, (args, _) = _plan(tmp_path, {**base, "ha_sign_in_url": "https://HA.home.example/",
                                    "ha_frame_origins": "http://homeassistant.local:8123, https://ha.home.example,"
                                                        " https://ha-away.example.net/"})
    cfg = parse_args(args)
    assert cfg.frame_ancestors == () and cfg.ha_browser_url == "https://HA.home.example"
    assert cfg.ha_frame_origins == ("http://homeassistant.local:8123", "https://ha.home.example",
                                    "https://ha-away.example.net")
    _, (args, _) = _plan(tmp_path, {"access": "https", "public_url": PUBLIC, "cloudflare_token": CF_TOKEN,
                                    "ha_frame_origins": "https://ha.home.example:8443"})
    assert parse_args(args).ha_frame_origins == ("https://ha.home.example:8443",)
    # the sidebar alone (ingress): HA's own page frames Mantel through Ingress, nothing to add
    _, (args, _) = _plan(tmp_path, {"ha_sign_in_url": "https://ha.home.example", "ha_frame_origins": "https://x.example"})
    assert parse_args(args).frame_ancestors == () and parse_args(args).ha_frame_origins == ()


@pytest.mark.parametrize("origins", ["ha.home.example", "https://ha.home.example/lovelace", "*",
                                     "https://*.home.example", "javascript:alert(1)", "https://user@ha.home.example",
                                     "https://ha.home.example;script-src", "https://ha.home.example:99999",
                                     "https://[2001:db8::1]:8123", "ftp://ha.home.example"])
def test_bad_frame_origins_stop_the_app_with_a_reason(tmp_path, origins):
    ep = _entrypoint()
    with pytest.raises(ep.ConfigError, match="ha_frame_origins"):
        _plan(tmp_path, {"access": "proxy", "public_url": PUBLIC, "trusted_proxies": "192.0.2.7",
                         "ha_frame_origins": origins}, ep)


@pytest.mark.parametrize("options, words", [
    ({"access": "proxy", "trusted_proxies": "192.0.2.7"}, "public_url"),
    ({"access": "proxy", "public_url": "http://mantel.home.example", "trusted_proxies": "192.0.2.7"}, "public_url"),
    ({"access": "proxy", "public_url": "https://192.0.2.9", "trusted_proxies": "192.0.2.7"}, "not an IP"),
    ({"access": "proxy", "public_url": "https://mantel.home.example/x", "trusted_proxies": "192.0.2.7"}, "public_url"),
    ({"access": "proxy", "public_url": PUBLIC}, "trusted_proxies"),
    ({"access": "proxy", "public_url": PUBLIC, "trusted_proxies": "npm"}, "IP addresses"),
    ({"access": "proxy", "public_url": PUBLIC, "trusted_proxies": "192.0.2.7", "ha_sign_in_url": "homeassistant"},
     "ha_sign_in_url"),
    ({"access": "https", "public_url": PUBLIC}, "cloudflare_token"),
    ({"access": "everything"}, "access"),
    ({"access": "https", "public_url": PUBLIC, "cloudflare_token": "t", "acme_email": "not an address"}, "acme_email"),
])
def test_bad_direct_options_stop_the_app_with_a_reason(tmp_path, options, words):
    ep = _entrypoint()
    with pytest.raises(ep.ConfigError, match=words):
        _plan(tmp_path, options, ep)


def test_https_mode_moves_the_cloudflare_token_into_a_private_file_never_an_argument(tmp_path):
    from mantel_server.config import parse_args
    _, (args, env) = _plan(tmp_path, {"access": "https", "public_url": PUBLIC, "cloudflare_token": CF_TOKEN,
                                      "acme_email": "owner@home.example"})
    cfg = parse_args(args)
    assert cfg.direct_port == 8100 and cfg.direct_tls == "acme" and cfg.trusted_proxies == () and cfg.proxy_kind == ""
    assert cfg.acme_dns_token_file == tmp_path / "cf" and cfg.acme_email == "owner@home.example"
    assert cfg.acme_directory == "" and cfg.tls_dir == Path("/data/tls")
    assert (tmp_path / "cf").read_text() == CF_TOKEN and stat.S_IMODE(os.stat(tmp_path / "cf").st_mode) == 0o600
    assert CF_TOKEN not in " ".join(args) and CF_TOKEN not in " ".join(env.values())
    _, (args, _) = _plan(tmp_path, {"access": "https", "public_url": PUBLIC, "cloudflare_token": CF_TOKEN,
                                    "acme_staging": True})
    assert parse_args(args).acme_directory == direct_tls.LETSENCRYPT_STAGING
    # proxy mode never writes the Cloudflare token, even when the option still holds one
    (tmp_path / "cf").unlink()
    _plan(tmp_path, {"access": "proxy", "public_url": PUBLIC, "trusted_proxies": "192.0.2.7", "cloudflare_token": CF_TOKEN})
    assert not (tmp_path / "cf").exists()


def test_the_entrypoint_hands_the_cloudflare_token_to_the_server_user():
    text = (ROOT / "packaging/docker/entrypoint.py").read_text()
    assert "(APP_TOKEN_FILE, APP_MA_TOKEN_FILE, APP_CF_TOKEN_FILE, APP_DUCKDNS_TOKEN_FILE)" in text


def test_server_flags_guard_direct_access():
    from mantel_server.config import parse_args
    ok = ["--ingress", "--listen", "0.0.0.0", "--public-url", PUBLIC, "--allow-host", "*", "--direct-port", "8100"]
    assert parse_args(ok).direct_port == 8100
    for bad in (["--direct-port", "8100"],                                                  # not the App
                ["--ingress", "--listen", "0.0.0.0", "--public-url", PUBLIC, "--direct-port", "8765"],   # same port
                ["--ingress", "--direct-port", "8100"],                                     # no public URL
                ok + ["--direct-tls", "acme"],                                              # no token file
                ["--direct-tls", "acme"], ["--direct-host", "x"],                          # without a direct port
                ok + ["--ha-browser-url", "homeassistant.local"], ok + ["--ha-oauth-url", "http://h:8123/x"]):
        with pytest.raises(SystemExit):
            parse_args(bad)


def test_the_app_config_publishes_one_opt_in_port_and_defaults_to_the_sidebar():
    sys.path.insert(0, str(ROOT / "tools"))
    import package_check as pc
    path = ROOT / "packaging/ha-app/config.yaml"
    doc = pc.parse_yaml(path.read_text())
    # direct access (8100) and the Intercom's listener for Music Assistant (8101): both unpublished until the Owner maps them
    assert doc["ports"] == {"8100/tcp": "null", "8101/tcp": "null"}
    assert set(doc["ports_description"]) == {"8100/tcp", "8101/tcp"}
    assert doc["options"]["access"] == "ingress" and doc["schema"]["access"] == "list(ingress|proxy|https)"
    assert doc["schema"]["cloudflare_token"] == "password?" and doc["options"]["cloudflare_token"] == ""
    # every option has a default, except the ones moved to Mantel Settings (kept in the schema for one release so a
    # value set there survives the update to be copied: server_settings.py)
    moved = {"commands_enabled", "default_screen", "session_hours", "ha_door_rules", "ma_url", "ma_token",
             "ha_sign_in_url", "ha_frame_origins"}
    assert doc["ingress"] is True and doc["ingress_port"] == 8099 and set(doc["options"]) == set(doc["schema"]) - moved
    assert all(doc["schema"][k].endswith("?") for k in moved)
    assert pc.check_ha_app(path) == []
    all_translations = pc.parse_yaml((ROOT / "packaging/ha-app/translations/en.yaml").read_text())
    translations = all_translations["configuration"]
    assert set(translations) == set(doc["schema"])
    assert set(all_translations["network"]) == {"8100/tcp", "8101/tcp"}


def test_the_package_check_refuses_a_published_or_second_port(tmp_path):
    sys.path.insert(0, str(ROOT / "tools"))
    import package_check as pc
    good = (ROOT / "packaging/ha-app/config.yaml").read_text()
    p = tmp_path / "config.yaml"
    for bad, words in ((good.replace("8100/tcp: null", "8100/tcp: 8100", 1), "unpublished"),
                       (good.replace("8101/tcp: null", "8101/tcp: 8101", 1), "unpublished"),
                       (good.replace("  8100/tcp: null", "  8100/tcp: null\n  8443/tcp: null"), "only ports"),
                       (good.replace("  8101/tcp: null\n", "", 1), "8101/tcp must be declared"),
                       (good.replace("access: ingress", "access: proxy"), "default to ingress"),
                       (good.replace('cloudflare_token: "password?"', 'cloudflare_token: "str?"'), "password")):
        p.write_text(bad)
        assert any(words in m for m in pc.check_ha_app(p)), words


# -- the two-listener server -------------------------------------------------------------------------------------
def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Running:
    def __init__(self, app, cfg, store, task, stop, http):
        self.app, self.cfg, self.store, self.task, self.stop, self.http = app, cfg, store, task, stop, http

    def url(self, which: str, path: str) -> str:
        port = self.cfg.port if which == "ingress" else self.cfg.direct_port
        scheme = "https" if which == "direct" and self.cfg.direct_tls else "http"
        return f"{scheme}://127.0.0.1:{port}{path}"

    async def get(self, which: str, path: str, host: str = NAME, **headers):
        h = {"Host": host, **headers}
        return await self.http.get(self.url(which, path), headers=h, allow_redirects=False,
                                   ssl=False if self.url(which, path).startswith("https") else None)


async def _start(tmp_path, monkeypatch, *, mode="proxy", ingress_peers=("172.30.32.2",), trusted=("127.0.0.1",),
                 browser_url="http://homeassistant.local:8123", tablets=None, cert_pending=False, lan_networks=(),
                 public=(), frames=()):
    from mantel_server.config import Config
    from mantel_server.ha_client import HaClient
    from mantel_server.readproxy import ReadProxy
    from mantel_server.server import build_app
    from mantel_server.store import Store

    async def forbidden(*args, **kwargs):
        pytest.fail("direct-access tests attempted upstream access")

    async def no_acme(self):
        return direct_tls.CHECK_EVERY

    monkeypatch.setattr(HaClient, "run", forbidden)
    monkeypatch.setattr(ReadProxy, "request", forbidden)
    monkeypatch.setattr(direct_tls.CertManager, "check", no_acme)   # the ACME client is tested on its own below
    web_dir = tmp_path / "web"
    (web_dir / "hk").mkdir(parents=True)
    for page in ("home.html", "settings.html"):
        (web_dir / page).write_text((ROOT / "web" / page).read_text())
    tls = mode == "https"
    cfg = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", host="127.0.0.1", port=_free_port(),
                 web=web_dir, hk_frontend=web_dir / "hk", hk_files=tmp_path / "none", fixtures=tmp_path / "none",
                 ingress=True, ingress_peers=tuple(ingress_peers), ingress_only=True, ha_door_rules="trusted",
                 ha_url="http://supervisor/core", ha_ws_url="ws://supervisor/core/websocket", ha_managed_by_app=True,
                 public_url=PUBLIC, allowed_hosts=(NAME, "*"), webauthn_rp_id=NAME,
                 direct_port=_free_port() if mode != "ingress" else 0, direct_hosts=(NAME,),
                 direct_tls="acme" if tls else "", acme_dns_token_file=tmp_path / "cf" if tls else None,
                 trusted_proxies=tuple(trusted) if mode == "proxy" else (), proxy_kind="own" if mode == "proxy" else "",
                 lan_networks=tuple(lan_networks), ha_browser_url=browser_url, ha_oauth_url="http://homeassistant:8123",
                 frame_ancestors=tuple(frames))
    store = Store(cfg.data_dir / "mantel.db")
    app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False)
    if tls:
        # as if Let's Encrypt's certificate had arrived (the placeholder still on the port); the pending
        # state has its own test
        app["direct_tls"].pending = cert_pending

    async def probe(request):
        from mantel_server import proxy_trust, sessions
        return aiohttp.web.json_response({"door": sessions.door_of(request), "ingress": ingress.is_ingress(request),
                                          "direct": direct.is_direct(request), "trusted": proxy_trust.is_trusted(request),
                                          "client": sessions.client_ip(request), "https": proxy_trust.is_https(request)})
    app.router.add_get("/test/probe", probe)
    app.setdefault("public_paths", set()).update({"/test/probe", *public})
    if tablets is not None:
        app["features"] = SimpleNamespace(tablets=tablets)
    stop = asyncio.Event()
    if mode == "ingress":
        runner = aiohttp.web.AppRunner(app)
        await runner.setup()
        await aiohttp.web.TCPSite(runner, cfg.host, cfg.port).start()

        async def wait_ingress():
            await stop.wait()
            await runner.cleanup()
        task = asyncio.create_task(wait_ingress())
    else:
        task = asyncio.create_task(direct.serve(app, cfg, stop))
    for _ in range(100):
        try:
            with socket.create_connection(("127.0.0.1", cfg.direct_port or cfg.port), timeout=0.2):
                break
        except OSError:
            await asyncio.sleep(0.02)
    http = aiohttp.ClientSession(cookie_jar=aiohttp.DummyCookieJar())
    return Running(app, cfg, store, task, stop, http)


@pytest.fixture
async def started(tmp_path, monkeypatch):
    made = []

    async def factory(**kw):
        r = await _start(tmp_path / f"s{len(made)}", monkeypatch, **kw)
        made.append(r)
        return r
    yield factory
    for r in made:
        await r.http.close()
        r.stop.set()
        await r.task


def _ha_headers(ha_user=OWNER_HA):
    return {"X-Ingress-Path": "/api/hassio_ingress/Fict1onal-Ingress_Token", ingress.USER_ID: ha_user,
            ingress.USER_NAME: "fictional", ingress.USER_DISPLAY: "Fictional Owner"}


async def test_ingress_mode_keeps_refusing_everyone_but_the_sidebar(started):
    r = await started(mode="ingress")
    resp = await r.get("ingress", "/login", **PAGE)
    assert resp.status == 403 and "sidebar only" in await resp.text()
    assert (await r.get("ingress", "/healthz")).status == 200


@pytest.mark.parametrize("mode", ["proxy", "https"])
async def test_the_gate_lets_exactly_the_direct_port_through(started, mode):
    r = await started(mode=mode)
    resp = await r.get("ingress", "/login", **PAGE)                 # not Ingress on the Ingress port: still refused
    assert resp.status == 403 and "sidebar only" in await resp.text()
    resp = await r.get("direct", "/login", **PAGE)                  # Mantel's own sign-in on the direct port
    assert resp.status == 200 and "<html" in (await resp.text()).lower()
    resp = await r.get("direct", "/dashboard-kitchen/home", **PAGE)   # a direct screen link: sign in first
    assert resp.status == 302 and resp.headers["Location"].startswith("/login")
    assert "dashboard-kitchen" in resp.headers["Location"]


@pytest.mark.parametrize("mode", ["proxy", "https"])
async def test_the_direct_port_answers_only_to_mantels_own_name(started, mode):
    r = await started(mode=mode)
    assert (await r.get("direct", "/login", host="attacker.example", **PAGE)).status == 403
    assert (await r.get("direct", "/login", host="127.0.0.1", **PAGE)).status == 403
    assert (await r.get("direct", "/login", host=NAME.upper(), **PAGE)).status == 200


@pytest.mark.parametrize("mode", ["proxy", "https"])
async def test_ingress_headers_are_never_believed_on_the_direct_port(started, mode, caplog):
    # 127.0.0.1 IS the Ingress proxy here: on the Ingress port its headers sign the Owner in; on the direct
    # port the same peer and headers are no one
    r = await started(mode=mode, ingress_peers=("127.0.0.1",))
    r.store.link(OWNER_HA, "owner", "Fictional Owner")
    ingress._warned.clear()                                       # the warning is rate-limited per peer
    resp = await r.get("ingress", "/dashboard-kitchen/home", **_ha_headers(), **PAGE)
    assert resp.status == 200
    with caplog.at_level(logging.WARNING):
        resp = await r.get("direct", "/dashboard-kitchen/home", **_ha_headers(), **PAGE)
    assert resp.status == 302 and resp.headers["Location"].startswith("/login")
    probe = await (await r.get("direct", "/test/probe", **_ha_headers())).json()
    assert probe["ingress"] is False and probe["direct"] is True
    assert "ignored HA identity headers" in caplog.text


async def test_proxy_mode_believes_the_lan_door_only_with_the_door_key(started):
    r = await started(mode="proxy")
    key = r.app["door_key"].value()
    lan = {"X-Mantel-Door": "lan", "X-Forwarded-For": "192.0.2.44", "X-Forwarded-Proto": "https"}
    got = await (await r.get("direct", "/test/probe", **lan, **{"X-Mantel-Door-Key": key})).json()
    assert got == {"door": "lan", "ingress": False, "direct": True, "trusted": True, "client": "192.0.2.44",
                   "https": True}
    assert (await (await r.get("direct", "/test/probe", **lan)).json())["door"] == "tunnel"           # no key
    wrong = {**lan, "X-Mantel-Door-Key": "not-the-key"}
    assert (await (await r.get("direct", "/test/probe", **wrong)).json())["door"] == "tunnel"
    assert (await (await r.get("direct", "/test/probe", **{"X-Mantel-Door-Key": key})).json())["door"] == "tunnel"
    tunnel = {"X-Mantel-Door": "tunnel", "X-Mantel-Door-Key": key}
    assert (await (await r.get("direct", "/test/probe", **tunnel)).json())["door"] == "tunnel"


async def test_proxy_mode_without_the_proxy_is_the_tunnel_door(started):
    # a device that reaches the direct port without going through the trusted proxy (here: the proxy is
    # someone else) gets the tunnel rules, its forwarding headers dropped, even with the right key
    r = await started(mode="proxy", trusted=("192.0.2.7",))
    key = r.app["door_key"].value()
    got = await (await r.get("direct", "/test/probe", **{"X-Mantel-Door": "lan", "X-Mantel-Door-Key": key,
                                                         "X-Forwarded-For": "192.0.2.44"})).json()
    assert got["door"] == "tunnel" and got["trusted"] is False and got["client"] == "127.0.0.1"


async def test_the_listed_proxy_without_the_key_is_not_trusted_for_any_header(started):
    # M2: on the App's direct port the proxy's address alone proves nothing (Docker may show everyone as
    # 172.30.32.1): without the key, X-Forwarded-For/-Proto/-Host are dropped and the door is the tunnel
    r = await started(mode="proxy")
    fwd = {"X-Forwarded-For": "192.0.2.44", "X-Forwarded-Proto": "https", "X-Forwarded-Host": "evil.example"}
    got = await (await r.get("direct", "/test/probe", **fwd, **{"X-Mantel-Door": "lan"})).json()
    assert got["trusted"] is False and got["client"] == "127.0.0.1" and got["https"] is False and got["door"] == "tunnel"
    got = await (await r.get("direct", "/test/probe", **fwd, **{"X-Mantel-Door-Key": "guess"})).json()
    assert got["trusted"] is False and got["client"] == "127.0.0.1"
    got = await (await r.get("direct", "/test/probe", **fwd, **{"X-Mantel-Door-Key": r.app["door_key"].value()})).json()
    assert got["trusted"] is True and got["client"] == "192.0.2.44" and got["https"] is True


def test_the_entrypoint_warns_when_the_proxy_is_a_relay_address(tmp_path, capsys):
    from mantel_server.config import parse_args
    for relay in ("172.30.32.1", "172.17.0.1"):
        _, (args, _) = _plan(tmp_path, {"access": "proxy", "public_url": PUBLIC, "trusted_proxies": relay})
        assert parse_args(args).trusted_proxies == (relay,)
        assert "WARNING trusted_proxies holds " + relay in capsys.readouterr().err
    _plan(tmp_path, {"access": "proxy", "public_url": PUBLIC, "trusted_proxies": "192.0.2.7"})
    assert "WARNING" not in capsys.readouterr().err


async def test_the_proxy_check_flags_a_relay_address_and_names_the_app_option(started, monkeypatch):
    from mantel_server import proxy_check
    from mantel_server import guards
    monkeypatch.setattr(guards, "check", lambda request, spec: None)      # the report, without an Owner's session
    r = await started(mode="proxy", trusted=("127.0.0.1", "172.30.32.1"), public=("/api/admin/proxy-check",))
    rep = await (await r.get("direct", "/api/admin/proxy-check", **{"X-Mantel-Door": "lan",
                                                                    "X-Mantel-Door-Key": r.app["door_key"].value()})).json()
    ids = {c["id"]: c for c in rep["checks"]}
    assert ids["trusted_proxy_relay"]["ok"] is False and "172.30.32.1" in ids["trusted_proxy_relay"]["detail"]
    assert ids["door_key"]["ok"] is True
    # the advice names the App's option in the App, the .env variable in the containers
    assert "the App's option trusted_proxies to 192.0.2.7" in proxy_check._set_proxy(r.cfg, "192.0.2.7")
    assert "MANTEL_TRUSTED_PROXY=192.0.2.7" in proxy_check._set_proxy(SimpleNamespace(), "192.0.2.7")
    assert "the App's option trusted_proxies" in Path(proxy_check.__file__).read_text()
    # the key the proxy sends wrongly is reported as wrong (not missing), so the fix is clear
    rep = await (await r.get("direct", "/api/admin/proxy-check", **{"X-Mantel-Door": "lan", "X-Mantel-Door-Key": "x"})).json()
    assert {c["id"]: c for c in rep["checks"]}["door_key"]["title"] == "Your proxy sends the wrong door key"


async def test_a_keyed_lan_door_for_an_internet_client_is_the_tunnel(started):
    # M3: the proxy host is reachable from outside (no access list): its lan claim for a global client fails closed
    r = await started(mode="proxy")
    key = r.app["door_key"].value()
    for client, door in (("8.8.8.8", "tunnel"), ("2606:4700::1111", "tunnel"), ("192.168.20.9", "lan"),
                         ("fd00::9", "lan")):
        got = await (await r.get("direct", "/test/probe", **{"X-Mantel-Door": "lan", "X-Mantel-Door-Key": key,
                                                             "X-Forwarded-For": client})).json()
        assert got["door"] == door, client


async def test_the_trusted_proxy_counts_only_on_the_direct_port(started):
    # /healthz is hidden from the trusted proxy (proxy_trust.HIDDEN_BEHIND_PROXY): on the direct port the
    # proxy gets 404, while the same peer on the Ingress port is not "the proxy" (the watchdog's 200)
    r = await started(mode="proxy")
    key = {"X-Mantel-Door-Key": r.app["door_key"].value()}
    assert (await r.get("direct", "/healthz", **key)).status == 404
    assert (await r.get("ingress", "/healthz", **key)).status == 200


async def test_builtin_https_serves_tls_and_decides_the_door_by_the_peer(started, tmp_path):
    r = await started(mode="https")
    got = await (await r.get("direct", "/test/probe", **{"X-Forwarded-For": "203.0.113.9"})).json()
    assert got["door"] == "lan" and got["https"] is True and got["trusted"] is False and got["client"] == "127.0.0.1"
    got = await (await r.get("direct", "/test/probe", **{"X-Mantel-Door": "tunnel"})).json()
    assert got["door"] == "tunnel"                                            # a stricter claim is honoured
    # the certificate on the port is the manager's (the placeholder until Let's Encrypt's arrives)
    ctx = ssl.create_default_context()
    ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE
    reader, writer = await asyncio.open_connection("127.0.0.1", r.cfg.direct_port, ssl=ctx, server_hostname=NAME)
    der = writer.get_extra_info("ssl_object").getpeercert(binary_form=True)
    writer.close()
    from cryptography import x509
    cert = x509.load_der_x509_certificate(der)
    assert direct_tls.PLACEHOLDER_ISSUER in cert.issuer.rfc4514_string()
    assert NAME in cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.DNSName)
    assert stat.S_IMODE(os.stat(r.cfg.tls_dir).st_mode) == 0o700
    assert stat.S_IMODE(os.stat(r.cfg.tls_dir / "placeholder.pem").st_mode) == 0o600


def test_the_https_door_is_lan_only_for_the_homes_networks():
    def req(peer, nets=()):
        return SimpleNamespace(remote=peer, app={"cfg": SimpleNamespace(lan_networks=nets)})
    assert direct.https_door(req("192.168.1.20")) == "lan" and direct.https_door(req("10.0.0.5")) == "lan"
    assert direct.https_door(req("fd00::5")) == "lan" and direct.https_door(req("::ffff:192.168.1.20")) == "lan"
    # HA's hassio network (other Apps, HA Core, Docker's relays and hairpin: all 172.30.32.1) and Docker's
    # bridge never count, even when a home network listed covers them
    for relay in ("172.30.32.1", "172.30.33.7", "fd0c:ac1e:2100::1", "172.17.0.1", "::ffff:172.30.32.1"):
        assert direct.https_door(req(relay)) == "tunnel", relay
        assert direct.https_door(req(relay, ("172.16.0.0/12", "fd00::/8"))) == "tunnel", relay
    assert direct.https_door(req("100.64.0.9")) == "tunnel"               # carrier-grade NAT is not the home
    assert direct.https_door(req("8.8.8.8")) == "tunnel" and direct.https_door(req("2606:4700::1111")) == "tunnel"
    assert direct.https_door(req(None)) == "tunnel" and direct.https_door(req("nonsense")) == "tunnel"
    # an explicit list replaces the private ranges
    home = ("192.168.20.0/24",)
    assert direct.https_door(req("192.168.20.9", home)) == "lan" and direct.https_door(req("192.168.1.20", home)) == "tunnel"
    assert direct.https_door(req("10.0.0.5", home)) == "tunnel"


def test_lan_networks_is_an_option_of_the_https_mode(tmp_path):
    from mantel_server.config import parse_args
    base = {"access": "https", "public_url": PUBLIC, "cloudflare_token": CF_TOKEN}
    _, (args, _) = _plan(tmp_path, {**base, "lan_networks": "192.168.20.0/24, fd12:3456::/64"})
    assert parse_args(args).lan_networks == ("192.168.20.0/24", "fd12:3456::/64")
    _, (args, _) = _plan(tmp_path, base)
    assert parse_args(args).lan_networks == ()                           # empty: direct.DEFAULT_LAN_NETWORKS
    ep = _entrypoint()
    with pytest.raises(ep.ConfigError, match="lan_networks"):
        _plan(tmp_path, {**base, "lan_networks": "home"}, ep)
    ok = ["--ingress", "--listen", "0.0.0.0", "--public-url", PUBLIC, "--direct-port", "8100"]
    for bad in (ok + ["--lan-network", "nonsense"], ["--lan-network", "192.168.20.0/24"],
                ok + ["--direct-tls", "acme", "--acme-dns-token-file", "/x", "--acme-directory", "http://acme.example/d"]):
        with pytest.raises(SystemExit):
            parse_args(bad)


async def test_builtin_https_hassio_peers_get_the_tunnel_door(started):
    # the test client is 127.0.0.1 (lan by default: the container itself); a home list without loopback
    # makes the same peer the tunnel door
    r = await started(mode="https", lan_networks=("192.168.20.0/24",))
    assert (await (await r.get("direct", "/test/probe")).json())["door"] == "tunnel"


async def test_while_the_certificate_is_pending_nobody_signs_in_there(started):
    r = await started(mode="https", cert_pending=True)
    for path in ("/login", "/login/ha", "/dashboard-kitchen/home", "/test/probe"):
        resp = await r.get("direct", path, **PAGE)
        assert resp.status == 503 and "certificate" in (await resp.text()), path
    resp = await r.http.post(r.url("direct", "/api/auth/password"), json={"username": "x", "password": "y"},
                             headers={"Host": NAME, "Origin": PUBLIC.rstrip("/")}, ssl=False)
    assert resp.status == 503
    assert (await r.get("direct", "/healthz")).status == 200
    assert (await r.get("ingress", "/healthz")).status == 200            # the sidebar is not affected
    r.app["direct_tls"].pending = False
    assert (await r.get("direct", "/login", **PAGE)).status == 200


async def test_sign_in_with_home_assistant_goes_to_has_address_for_browsers(started):
    r = await started(mode="proxy")
    resp = await r.get("direct", "/login/ha", **PAGE)
    assert resp.status == 302
    from urllib.parse import parse_qs, urlsplit
    loc = urlsplit(resp.headers["Location"])
    assert (loc.scheme, loc.netloc, loc.path) == ("http", "homeassistant.local:8123", "/auth/authorize")
    q = parse_qs(loc.query)
    assert q["client_id"] == [PUBLIC] and q["redirect_uri"] == [PUBLIC + "auth/callback"]
    assert r.app["oauth"].ha_url == "http://homeassistant:8123"          # the code exchange: HA's internal address


async def test_with_no_sign_in_address_set_it_goes_to_home_assistants_own_url(started):
    """Nothing set in Mantel Settings: Sign in with Home Assistant goes to HA's own External URL (HA → Settings →
    System → Network), read from HA, with the code exchanged on HA's internal address as before."""
    r = await started(mode="proxy", browser_url="")
    r.app["frame_origins"].learn({"internal_url": "http://homeassistant.local:8123", "external_url": "https://ha.home.example"})
    resp = await r.get("direct", "/login/ha", **PAGE)
    assert resp.status == 302 and resp.headers["Location"].startswith("https://ha.home.example/auth/authorize?")
    assert r.app["oauth"].ha_url == "http://homeassistant:8123"


async def test_in_home_assistants_frame_sign_in_goes_to_the_address_the_dashboard_is_on(started):
    """A Webpage dashboard opened at HA's home address while ha_sign_in_url names another: HA's sign-in page
    refuses frames from other origins (X-Frame-Options: SAMEORIGIN), so login.js names the frame's top origin
    (`via`) and Mantel uses it, but only when it is one of HA's own addresses (frame-ancestors)."""
    from urllib.parse import quote, urlsplit
    r = await started(mode="proxy", frames=("http://homeassistant.local:8123", "https://ha-home.example"))
    resp = await r.get("direct", "/login/ha?next=/dashboard-loft/home&via=" + quote("https://ha-home.example"), **PAGE)
    loc = urlsplit(resp.headers["Location"])
    assert resp.status == 302 and (loc.scheme, loc.netloc, loc.path) == ("https", "ha-home.example", "/auth/authorize")
    assert r.app["oauth"].ha_url == "http://homeassistant:8123"          # the code still goes to HA's own address
    for bad in ("https://evil.example", "https://ha-home.example.evil.example", "javascript:alert(1)", "'self'"):
        resp = await r.get("direct", "/login/ha?via=" + quote(bad), **PAGE)
        assert urlsplit(resp.headers["Location"]).netloc == "homeassistant.local:8123", bad


async def test_a_sign_in_state_counts_once_and_callbacks_are_rate_limited(started, monkeypatch):
    from urllib.parse import parse_qs, urlsplit
    from mantel_server import auth
    from mantel_server.ha_oauth import HaOAuth, OAuthError

    async def no_exchange(self, http, code):
        raise OAuthError("fictional: HA is not here")
    monkeypatch.setattr(HaOAuth, "exchange_code", no_exchange)
    r = await started(mode="https")
    resp = await r.get("direct", "/login/ha", **PAGE)
    assert "secure" in resp.headers["Set-Cookie"].lower()                 # L6: the state cookie is Secure on https
    state = parse_qs(urlsplit(resp.headers["Location"]).query)["state"][0]
    cookie = resp.headers["Set-Cookie"].split(";", 1)[0]
    first = await r.get("direct", f"/auth/callback?code=c&state={state}", Cookie=cookie, **PAGE)
    assert first.status == 502                                            # got past the state check (HA is fake)
    replay = await r.get("direct", f"/auth/callback?code=c&state={state}", Cookie=cookie, **PAGE)
    assert replay.status == 400 and "did not start here" in await replay.text()
    for _ in range(auth.CALLBACKS_PER_WINDOW):
        await r.get("direct", "/auth/callback?code=c&state=x", **PAGE)
    assert (await r.get("direct", "/auth/callback?code=c&state=x", **PAGE)).status == 429


async def test_without_the_sign_in_address_the_page_says_which_option(started):
    r = await started(mode="proxy", browser_url="")
    resp = await r.get("direct", "/login/ha", **PAGE)
    text = await resp.text()
    assert resp.status == 409 and "Sign-In Address" in text and "Settings, System, Network" in text


async def test_an_enrolled_wall_tablet_opens_its_own_screen_on_the_direct_port(started):
    from mantel_server.devices import DEVICE_COOKIE
    r = await started(mode="proxy", tablets={"loft": {"room": "loft", "screen": "dashboard-loft"}})
    device_id, secret, _ = r.app["devices"].enroll("Loft tablet", "wall_tablet", "loft", None)
    key = r.app["door_key"].value()
    lan = {"X-Mantel-Door": "lan", "X-Mantel-Door-Key": key, "Cookie": f"{DEVICE_COOKIE}={secret}"}
    resp = await r.get("direct", "/home", **lan, **PAGE)
    assert resp.status == 302 and resp.headers["Location"] == "/dashboard-loft/home?hk_tablet=loft"
    resp = await r.get("direct", "/dashboard-loft/home?hk_tablet=loft", **lan, **PAGE)
    assert resp.status == 200
    # the same tablet credential without the LAN door (no key) is refused: devices are LAN only
    resp = await r.get("direct", "/home", **{"Cookie": f"{DEVICE_COOKIE}={secret}"}, **PAGE)
    assert resp.status == 302 and resp.headers["Location"].startswith("/login")


async def test_the_https_panel_names_the_mode_of_the_port_it_was_opened_on(started):
    from mantel_server import proxy_check

    def req(cfg, on_direct):
        return SimpleNamespace(app={"cfg": cfg}, get=lambda k, d=None: {"direct": on_direct}.get(k, d))
    r = await started(mode="proxy")
    assert proxy_check.mode_of(r.cfg, req(r.cfg, True)) == "own"
    assert proxy_check.mode_of(r.cfg, req(r.cfg, False)) == "ha_app" and proxy_check.mode_of(r.cfg) == "ha_app"
    https_cfg = SimpleNamespace(ingress_only=True, direct_port=8100, direct_tls="acme")
    assert proxy_check.mode_of(https_cfg, req(https_cfg, True)) == "builtin" and proxy_check.MODES["builtin"][0]


# -- built-in HTTPS: the certificate ---------------------------------------------------------------------------
class Fakes:
    def __init__(self, acme, cf, acme_server, cf_server):
        self.acme, self.cf, self.acme_server, self.cf_server = acme, cf, acme_server, cf_server


@pytest.fixture
async def fakes():
    cf = FakeCloudflare(CF_TOKEN)
    acme = FakeAcme(cf)
    cf_server, acme_server = TestServer(cf.app()), TestServer(acme.app())
    await cf_server.start_server()
    await acme_server.start_server()
    acme.base = str(acme_server.make_url("")).rstrip("/")
    yield Fakes(acme, cf, acme_server, cf_server)
    await cf_server.close()
    await acme_server.close()


def _manager(tmp_path, fakes, token=CF_TOKEN, clock=None, name=NAME, directory=None):
    tmp_path.mkdir(parents=True, exist_ok=True)
    (tmp_path / "cf").write_text(token + "\n")

    async def no_sleep(_):
        return None

    def visible(http):
        async def check(record, value):
            return value in fakes.cf.txt(record)
        return check
    import time
    return direct_tls.CertManager(name, tmp_path / "tls", tmp_path / "cf",
                                  directory=directory or fakes.acme.base + "/directory",
                                  email="owner@home.example", clock=clock or time.time,
                                  cloudflare_api=str(fakes.cf_server.make_url("/client/v4")), visible=visible,
                                  sleep=no_sleep, poll_every=0)


async def test_a_certificate_is_obtained_with_dns01_and_installed_on_the_live_context(tmp_path, fakes):
    mgr = _manager(tmp_path, fakes)
    assert mgr.status()["state"] == "placeholder" and mgr.needs_issuing() and mgr.pending
    fakes.acme.bad_nonce_once = True                                     # the client retries a stale nonce
    assert await mgr.check() == direct_tls.CHECK_EVERY
    assert mgr.status()["state"] == "ok" and not mgr.needs_issuing() and mgr.last_error == "" and not mgr.pending
    issued = fakes.acme.issued[-1]
    from cryptography import x509
    assert issued.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.DNSName) == [NAME]
    assert list(fakes.acme.csr_subjects[-1]) == []                       # no CN in the CSR (SAN only)
    assert direct_tls.cert_info(mgr.cert_path.read_bytes())[1] == {NAME}
    assert fakes.cf.records == {}                                        # the challenge's TXT record is gone again
    assert set(fakes.cf.seen_auth) == {f"Bearer {CF_TOKEN}"}
    for f in ("account.key", "tls.pem", "state.json"):
        assert stat.S_IMODE(os.stat(tmp_path / "tls" / f).st_mode) == 0o600
    assert not list((tmp_path / "tls").glob("*.new")) and not (tmp_path / "tls" / "pending.pem").exists()
    assert json.loads((tmp_path / "tls" / "state.json").read_text())["directory"] == fakes.acme.base + "/directory"
    assert mgr.ssl_ctx.options & getattr(ssl, "OP_NO_RENEGOTIATION", 0) == getattr(ssl, "OP_NO_RENEGOTIATION", 0)
    # a restart keeps the account and the certificate: nothing is issued again
    again = _manager(tmp_path, fakes)
    assert again.status()["state"] == "ok" and not again.needs_issuing() and not again.pending
    assert len(fakes.acme.accounts) == 1


async def test_renewal_is_due_30_days_before_expiry(tmp_path, fakes):
    import time
    now = [time.time()]
    mgr = _manager(tmp_path, fakes, clock=lambda: now[0])
    await mgr.check()
    assert not mgr.needs_issuing() and len(fakes.acme.issued) == 1
    now[0] += 61 * 86400                                                 # 90-day certificate, 29 days left
    assert mgr.needs_issuing()
    await mgr.check()
    assert len(fakes.acme.issued) == 2 and len(fakes.acme.accounts) == 1
    # another public name means a new certificate (the old one does not cover it)
    other = _manager(tmp_path, fakes, clock=lambda: now[0], name="tablets.home.example")
    assert other.needs_issuing() and other.pending


async def test_switching_between_staging_and_the_real_service_reissues(tmp_path, fakes):
    mgr = _manager(tmp_path, fakes)
    await mgr.check()
    assert not mgr.needs_issuing()
    other = _manager(tmp_path, fakes, directory=fakes.acme.base + "/directory?staging")
    assert other.pending and other.needs_issuing()                       # L2: a certificate from another directory


async def test_a_failed_attempt_is_logged_without_the_token_and_the_backoff_survives_a_restart(tmp_path, fakes, caplog):
    import time
    now = [time.time()]
    fakes.acme.fail_validation = True
    mgr = _manager(tmp_path, fakes, clock=lambda: now[0])
    waits = []
    with caplog.at_level(logging.DEBUG):
        for i in range(5):
            if i:
                now[0] += waits[-1]
            waits.append(await mgr.check())
    assert waits == [3600, 3 * 3600, 12 * 3600, 24 * 3600, 24 * 3600]
    assert "validation failed" in mgr.last_error and mgr.status()["state"] == "placeholder"
    assert fakes.cf.records == {}                                        # cleaned up after a failure too
    # L3: a restart inside the backoff asks Let's Encrypt nothing
    orders = len(fakes.acme.orders)
    now[0] += 60
    again = _manager(tmp_path, fakes, clock=lambda: now[0])
    assert again.failures == 5 and 0 < await again.check() < 24 * 3600 and len(fakes.acme.orders) == orders
    bad = _manager(tmp_path / "b", fakes, token="wrong-fictional-token")
    with caplog.at_level(logging.DEBUG):
        assert await bad.check() == 3600
    assert "Cloudflare answered 403" in bad.last_error
    assert CF_TOKEN not in caplog.text and "wrong-fictional-token" not in caplog.text
    empty = _manager(tmp_path / "e", fakes, token="")
    await empty.check()
    assert "token is empty" in empty.last_error


async def test_an_issued_certificate_is_kept_until_it_is_installed(tmp_path, fakes, monkeypatch):
    # L3: the bundle is on disk before it is loaded; a failure to install never asks Let's Encrypt again
    mgr = _manager(tmp_path, fakes)
    real = direct_tls.CertManager._adopt
    monkeypatch.setattr(direct_tls.CertManager, "_adopt", lambda self, b: (_ for _ in ()).throw(OSError("disk")))
    assert await mgr.check() == 3600
    assert (tmp_path / "tls" / "pending.pem").is_file() and len(fakes.acme.issued) == 1
    monkeypatch.setattr(direct_tls.CertManager, "_adopt", real)
    again = _manager(tmp_path, fakes)
    assert await again.check() == direct_tls.CHECK_EVERY
    assert len(fakes.acme.issued) == 1 and not again.pending and not (tmp_path / "tls" / "pending.pem").exists()


def _bundle(name=NAME, days=30, other_key=False):
    import datetime as dt
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID
    key, signer = ec.generate_private_key(ec.SECP256R1()), ec.generate_private_key(ec.SECP256R1())
    now = dt.datetime.now(dt.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(x509.Name([])).issuer_name(
                x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Fictional CA")]))
            .public_key((ec.generate_private_key(ec.SECP256R1()) if other_key else key).public_key())
            .serial_number(1).not_valid_before(now - dt.timedelta(days=2)).not_valid_after(now + dt.timedelta(days=days))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName(name)]), critical=False).sign(signer, hashes.SHA256()))
    return direct_tls._key_pem(key) + cert.public_bytes(serialization.Encoding.PEM)


def test_a_new_chain_is_checked_before_it_replaces_the_old_one(tmp_path, fakes):
    import time
    mgr = _manager(tmp_path, fakes)
    good = _bundle()
    assert direct_tls.check_bundle(good, NAME, time.time()) > time.time()
    for bad, words in ((_bundle(other_key=True), "not for this key"), (_bundle(name="other.home.example"), "names"),
                       (_bundle(days=-1), "expired"), (b"-----BEGIN NOTHING-----", "cannot be read")):
        with pytest.raises(direct_tls.InvalidCertificate, match=words):
            mgr._adopt(bad)
        assert mgr.pending and not mgr.cert_path.exists()
    mgr._adopt(good)
    assert not mgr.pending and mgr.cert_path.read_bytes() == good


def test_damaged_files_never_stop_the_app(tmp_path, fakes, caplog):
    # M4: whatever is in /data/tls, the manager starts (on the placeholder) and build_app goes on
    folder = tmp_path / "tls"
    folder.mkdir(parents=True)
    (folder / "tls.pem").write_bytes(b"garbage")
    (folder / "state.json").write_text("{not json")
    mgr = _manager(tmp_path, fakes)
    assert mgr.pending and mgr.needs_issuing()
    # L4: an unreadable account key is set aside and replaced, with a clear log line
    (folder / "account.key").write_bytes(b"-----BEGIN PRIVATE KEY-----\nbroken\n-----END PRIVATE KEY-----\n")
    with caplog.at_level(logging.ERROR):
        account = mgr._account()
    assert isinstance(account, direct_tls.AccountKey) and list(folder.glob("account.key.unreadable-*"))
    assert "could not be read" in caplog.text


async def test_the_client_proves_only_the_requested_name_on_the_servers_own_origin(tmp_path, fakes):
    fakes.acme.identifier_override = "attacker.home.example"
    mgr = _manager(tmp_path / "a", fakes)
    await mgr.check()
    assert "not requested" in mgr.last_error and fakes.cf.records == {}
    fakes.acme.identifier_override = ""
    fakes.acme.foreign_authz = "https://elsewhere.example/authz/1"
    mgr = _manager(tmp_path / "b", fakes)
    await mgr.check()
    assert "outside its own" in mgr.last_error


async def test_retry_after_is_honoured(tmp_path, fakes):
    slept = []

    async def record(seconds):
        slept.append(seconds)
    fakes.acme.slow_polls, fakes.acme.retry_after = 2, "3"
    mgr = _manager(tmp_path, fakes)
    mgr.sleep = record
    assert await mgr.check() == direct_tls.CHECK_EVERY
    assert slept.count(3.0) == 2
    assert direct_tls.retry_after("600", 2.0) == 60.0 and direct_tls.retry_after("soon", 2.0) == 2.0


async def test_a_txt_record_whose_answer_was_lost_is_removed_by_name(tmp_path, fakes):
    fakes.cf.fail_after_create = True
    mgr = _manager(tmp_path, fakes)
    await mgr.check()
    assert "Cloudflare answered 500" in mgr.last_error and fakes.cf.records == {}


async def test_a_name_outside_the_tokens_zones_says_so(tmp_path, fakes):
    mgr = _manager(tmp_path, fakes, name="mantel.elsewhere.example")
    await mgr.check()
    assert "no Cloudflare zone" in mgr.last_error and "Zone / Zone / Read" in mgr.last_error


# -- built-in HTTPS through Duck DNS ------------------------------------------------------------------------
DUCK_NAME = "sam-home.duckdns.org"
DUCK_TOKEN = "fictional-duckdns-token-0123456789"


@pytest.fixture
async def duck():
    dd = FakeDuckDns(DUCK_TOKEN)
    acme = FakeAcme(dd)
    dd_server, acme_server = TestServer(dd.app()), TestServer(acme.app())
    await dd_server.start_server()
    await acme_server.start_server()
    acme.base = str(acme_server.make_url("")).rstrip("/")
    yield Fakes(acme, dd, acme_server, dd_server)
    await dd_server.close()
    await acme_server.close()


def _duck_manager(tmp_path, duck, token=DUCK_TOKEN, name=DUCK_NAME, api=None):
    tmp_path.mkdir(parents=True, exist_ok=True)
    (tmp_path / "dd").write_text(token + "\n")

    async def no_sleep(_):
        return None

    def visible(http):
        async def check(record, value):
            return value in duck.cf.txt(record)
        return check
    return direct_tls.CertManager(name, tmp_path / "tls", tmp_path / "dd", directory=duck.acme.base + "/directory",
                                  dns_provider="duckdns", duckdns_api=api or str(duck.cf_server.make_url("")),
                                  visible=visible, sleep=no_sleep, poll_every=0)


async def test_a_certificate_through_duck_dns(tmp_path, duck, caplog):
    mgr = _duck_manager(tmp_path, duck)
    with caplog.at_level(logging.DEBUG):
        assert await mgr.check() == direct_tls.CHECK_EVERY
    assert mgr.status()["state"] == "ok" and mgr.last_error == ""
    assert direct_tls.cert_info(mgr.cert_path.read_bytes())[1] == {DUCK_NAME}
    sets = [c for c in duck.cf.calls if c.get("clear") != "true"]
    clears = [c for c in duck.cf.calls if c.get("clear") == "true"]
    assert [c["domains"] for c in sets] == ["sam-home"] and len(clears) == 1
    assert duck.cf.values == {}                                          # the challenge's TXT value is cleared again
    assert all(c["token"] == DUCK_TOKEN for c in duck.cf.calls)
    assert not any(DUCK_TOKEN in r.getMessage() for r in caplog.records if r.name.startswith("mantel"))


async def test_duck_dns_failures_say_why_without_the_token(tmp_path, duck, caplog):
    with caplog.at_level(logging.DEBUG):
        bad = _duck_manager(tmp_path / "b", duck, token="wrong-fictional-token")
        assert await bad.check() == 3600
        assert "Duck DNS answered" in bad.last_error and "KO" in bad.last_error
        empty = _duck_manager(tmp_path / "e", duck, token="")
        await empty.check()
        assert "Duck DNS token is empty" in empty.last_error
        elsewhere = _duck_manager(tmp_path / "n", duck, name="mantel.home.example")
        await elsewhere.check()
        assert "duckdns.org" in elsewhere.last_error
        api = str(duck.cf_server.make_url(""))
        await duck.cf_server.close()                                     # Duck DNS unreachable
        gone = _duck_manager(tmp_path / "g", duck, api=api)
        await gone.check()
        assert "Duck DNS could not be reached" in gone.last_error
    # Mantel's own log (not the fake Duck DNS's access log, which sees the query as the real one does)
    mantel_log = "\n".join(r.getMessage() for r in caplog.records if r.name.startswith("mantel"))
    assert "built-in HTTPS: could not get a certificate" in mantel_log
    for text in (mantel_log, bad.last_error, gone.last_error):
        assert DUCK_TOKEN not in text and "wrong-fictional-token" not in text and "token=" not in text


def test_https_through_duck_dns_takes_its_own_token_and_name(tmp_path):
    from mantel_server.config import parse_args
    duck_url = f"https://{DUCK_NAME}/"
    env = {"MANTEL_APP_DUCKDNS_TOKEN_FILE": str(tmp_path / "dd")}
    _, (args, environ) = _plan(tmp_path, {"access": "https", "public_url": duck_url, "dns_provider": "duckdns",
                                          "duckdns_token": DUCK_TOKEN, "cloudflare_token": CF_TOKEN}, **env)
    cfg = parse_args(args)
    assert cfg.direct_tls == "acme" and cfg.acme_dns_provider == "duckdns" and cfg.acme_dns_token_file == tmp_path / "dd"
    assert (tmp_path / "dd").read_text() == DUCK_TOKEN and stat.S_IMODE(os.stat(tmp_path / "dd").st_mode) == 0o600
    assert not (tmp_path / "cf").exists()                                # the other provider's token stays put
    assert DUCK_TOKEN not in " ".join(args) and DUCK_TOKEN not in " ".join(environ.values())
    ep = _entrypoint()
    with pytest.raises(ep.ConfigError, match="duckdns_token"):
        _plan(tmp_path, {"access": "https", "public_url": duck_url, "dns_provider": "duckdns"}, ep, **env)
    with pytest.raises(ep.ConfigError, match="duckdns.org"):
        _plan(tmp_path, {"access": "https", "public_url": PUBLIC, "dns_provider": "duckdns",
                         "duckdns_token": DUCK_TOKEN}, ep, **env)
    with pytest.raises(ep.ConfigError, match="dns_provider"):
        _plan(tmp_path, {"access": "https", "public_url": PUBLIC, "dns_provider": "route53",
                         "cloudflare_token": CF_TOKEN}, ep, **env)
    # Cloudflare stays the default, and its token file
    _, (args, _) = _plan(tmp_path, {"access": "https", "public_url": PUBLIC, "cloudflare_token": CF_TOKEN}, **env)
    assert parse_args(args).acme_dns_provider == "cloudflare"
    # the server refuses a Duck DNS certificate for a name outside duckdns.org
    ok = ["--ingress", "--listen", "0.0.0.0", "--allow-host", "*", "--direct-port", "8100", "--direct-tls", "acme",
          "--acme-dns-token-file", str(tmp_path / "dd"), "--acme-dns-provider", "duckdns"]
    assert parse_args(ok + ["--public-url", duck_url]).acme_dns_provider == "duckdns"
    with pytest.raises(SystemExit):
        parse_args(ok + ["--public-url", PUBLIC])


def test_the_jws_and_the_dns01_value_follow_rfc_8555():
    import base64
    import hashlib
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
    from acme_fakes import b64d, jwk_key, thumbprint
    account = direct_tls.AccountKey.generate()
    assert account.thumbprint() == thumbprint(account.jwk())
    jws = account.sign({"alg": "ES256", "nonce": "n", "url": "https://acme.example/x"}, None)
    assert jws["payload"] == ""
    sig = b64d(jws["signature"])
    assert len(sig) == 64
    jwk_key(account.jwk()).verify(encode_dss_signature(int.from_bytes(sig[:32], "big"), int.from_bytes(sig[32:], "big")),
                                  f"{jws['protected']}.".encode(), ec.ECDSA(hashes.SHA256()))
    expected = base64.urlsafe_b64encode(hashlib.sha256(f"tok.{account.thumbprint()}".encode()).digest()).rstrip(b"=").decode()
    assert direct_tls.dns01_value("tok", account) == expected


def test_the_read_only_kill_switch_and_sign_in_without_the_old_option(tmp_path):
    """read_only (the App) and MANTEL_READ_ONLY (Docker) hold the house read-only whatever Mantel Settings says;
    direct access always gets Mantel's own side of Sign in with Home Assistant, the browser's address being Mantel
    Settings' or Home Assistant's own (test_server_settings)."""
    from mantel_server.config import parse_args
    ep, (args, _) = _plan(tmp_path, {"read_only": True})
    assert parse_args(args).read_only is True
    assert parse_args(_plan(tmp_path, {}, ep=ep)[1][0]).read_only is False
    _, (args, _) = _plan(tmp_path, {"access": "proxy", "public_url": PUBLIC, "trusted_proxies": "192.0.2.7"}, ep=ep)
    cfg = parse_args(args)
    assert cfg.ha_browser_url == "" and cfg.ha_oauth_url == "http://homeassistant:8123"
    docker = {"MANTEL_PUBLIC_URL": "https://mantel.example.com/", "MANTEL_TRUSTED_PROXY": "172.31.251.2"}
    for value, on in (("1", True), ("yes", True), ("0", False), ("", False)):
        argv, _ = ep.plan([], {**docker, "MANTEL_READ_ONLY": value}, options_path=tmp_path / "none.json")
        assert ("--read-only" in argv) is on
