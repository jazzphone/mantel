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
from acme_fakes import FakeAcme, FakeCloudflare  # noqa: E402

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
    assert "(APP_TOKEN_FILE, APP_MA_TOKEN_FILE, APP_CF_TOKEN_FILE)" in text


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
    assert doc["ports"] == {"8100/tcp": "null"} and set(doc["ports_description"]) == {"8100/tcp"}
    assert doc["options"]["access"] == "ingress" and doc["schema"]["access"] == "list(ingress|proxy|https)"
    assert doc["schema"]["cloudflare_token"] == "password?" and doc["options"]["cloudflare_token"] == ""
    assert doc["ingress"] is True and doc["ingress_port"] == 8099 and set(doc["options"]) == set(doc["schema"])
    assert pc.check_ha_app(path) == []
    translations = pc.parse_yaml((ROOT / "packaging/ha-app/translations/en.yaml").read_text())["configuration"]
    assert set(translations) == set(doc["options"])


def test_the_package_check_refuses_a_published_or_second_port(tmp_path):
    sys.path.insert(0, str(ROOT / "tools"))
    import package_check as pc
    good = (ROOT / "packaging/ha-app/config.yaml").read_text()
    p = tmp_path / "config.yaml"
    for bad, words in ((good.replace("8100/tcp: null", "8100/tcp: 8100", 1), "unpublished"),
                       (good.replace("  8100/tcp: null", "  8100/tcp: null\n  8443/tcp: null"), "only port"),
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
                 browser_url="http://homeassistant.local:8123", tablets=None):
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
    for page in ("home.html", "hk-settings.html"):
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
                 ha_browser_url=browser_url, ha_oauth_url="http://homeassistant:8123" if browser_url else "")
    store = Store(cfg.data_dir / "mantel.db")
    app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False)

    async def probe(request):
        from mantel_server import proxy_trust, sessions
        return aiohttp.web.json_response({"door": sessions.door_of(request), "ingress": ingress.is_ingress(request),
                                          "direct": direct.is_direct(request), "trusted": proxy_trust.is_trusted(request),
                                          "client": sessions.client_ip(request), "https": proxy_trust.is_https(request)})
    app.router.add_get("/test/probe", probe)
    app.setdefault("public_paths", set()).add("/test/probe")
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


async def test_the_trusted_proxy_counts_only_on_the_direct_port(started):
    # /healthz is hidden from the trusted proxy (proxy_trust.HIDDEN_BEHIND_PROXY): on the direct port the
    # proxy gets 404, while the same peer on the Ingress port is not "the proxy" (the watchdog's 200)
    r = await started(mode="proxy")
    assert (await r.get("direct", "/healthz")).status == 404
    assert (await r.get("ingress", "/healthz")).status == 200


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
    assert stat.S_IMODE(os.stat(r.cfg.tls_dir / "cert.key").st_mode) == 0o600


def test_the_https_door_is_lan_only_for_home_addresses():
    def req(peer):
        return SimpleNamespace(remote=peer)
    assert direct.https_door(req("192.168.1.20")) == "lan" and direct.https_door(req("10.0.0.5")) == "lan"
    assert direct.https_door(req("172.30.32.1")) == "lan" and direct.https_door(req("fd00::5")) == "lan"
    assert direct.https_door(req("100.64.0.9")) == "tunnel"               # carrier-grade NAT is not the home
    assert direct.https_door(req("8.8.8.8")) == "tunnel" and direct.https_door(req("2606:4700::1111")) == "tunnel"
    assert direct.https_door(req(None)) == "tunnel" and direct.https_door(req("nonsense")) == "tunnel"


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


async def test_without_the_sign_in_address_the_page_says_which_option(started):
    r = await started(mode="proxy", browser_url="")
    resp = await r.get("direct", "/login/ha", **PAGE)
    assert resp.status == 409 and "Home Assistant address for sign-in" in await resp.text()


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


def _manager(tmp_path, fakes, token=CF_TOKEN, clock=None, name=NAME):
    tmp_path.mkdir(parents=True, exist_ok=True)
    (tmp_path / "cf").write_text(token + "\n")

    async def no_sleep(_):
        return None

    def visible(http):
        async def check(record, value):
            return value in fakes.cf.txt(record)
        return check
    import time
    return direct_tls.CertManager(name, tmp_path / "tls", tmp_path / "cf", directory=fakes.acme.base + "/directory",
                                  email="owner@home.example", clock=clock or time.time,
                                  cloudflare_api=str(fakes.cf_server.make_url("/client/v4")), visible=visible,
                                  sleep=no_sleep, poll_every=0)


async def test_a_certificate_is_obtained_with_dns01_and_installed_on_the_live_context(tmp_path, fakes):
    mgr = _manager(tmp_path, fakes)
    assert mgr.status()["state"] == "placeholder" and mgr.needs_issuing()
    fakes.acme.bad_nonce_once = True                                     # the client retries a stale nonce
    assert await mgr.check() == direct_tls.CHECK_EVERY
    assert mgr.status()["state"] == "ok" and not mgr.needs_issuing() and mgr.last_error == ""
    issued = fakes.acme.issued[-1]
    from cryptography import x509
    assert issued.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.DNSName) == [NAME]
    assert direct_tls.cert_info(mgr.cert_path.read_bytes())[1] == {NAME}
    assert fakes.cf.records == {}                                        # the challenge's TXT record is gone again
    assert set(fakes.cf.seen_auth) == {f"Bearer {CF_TOKEN}"}
    for f in ("account.key", "cert.key", "cert.pem"):
        assert stat.S_IMODE(os.stat(tmp_path / "tls" / f).st_mode) == 0o600
    # a restart keeps the account and the certificate: nothing is issued again
    again = _manager(tmp_path, fakes)
    assert again.status()["state"] == "ok" and not again.needs_issuing()
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
    assert other.needs_issuing()


async def test_a_failed_attempt_is_logged_without_the_token_and_retried_later(tmp_path, fakes, caplog):
    fakes.acme.fail_validation = True
    mgr = _manager(tmp_path, fakes)
    with caplog.at_level(logging.DEBUG):
        waits = [await mgr.check() for _ in range(5)]
    assert waits == [3600, 3 * 3600, 12 * 3600, 24 * 3600, 24 * 3600]
    assert "validation failed" in mgr.last_error and mgr.status()["state"] == "placeholder"
    assert fakes.cf.records == {}                                        # cleaned up after a failure too
    bad = _manager(tmp_path / "b", fakes, token="wrong-fictional-token")
    with caplog.at_level(logging.DEBUG):
        assert await bad.check() == 3600
    assert "Cloudflare answered 403" in bad.last_error
    assert CF_TOKEN not in caplog.text and "wrong-fictional-token" not in caplog.text
    empty = _manager(tmp_path / "e", fakes, token="")
    await empty.check()
    assert "token is empty" in empty.last_error


async def test_a_name_outside_the_tokens_zones_says_so(tmp_path, fakes):
    mgr = _manager(tmp_path, fakes, name="mantel.elsewhere.example")
    await mgr.check()
    assert "no Cloudflare zone" in mgr.last_error


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
