"""Cloudflare Access in front of the tunnel (mantel_server/cf_access.py): with --cf-access-team/--cf-access-aud,
every tunnel-door request must carry a valid Cf-Access-Jwt-Assertion (RS256 by the team's keys, the right iss and
aud, in date), refused with 403 before any session handling; the LAN and 'ha' doors are untouched, and an
installation without the settings behaves exactly as before. Also: the keys' cache (by kid, an hour, an unknown kid
fetched again at most once a minute, fail closed without keys), the settings' plumbing (flags, the compose
entrypoint's MANTEL_CF_ACCESS_*, the HA App's options), and that Cloudflare's headers can only ever make a request
the stricter tunnel door, whoever sends them.

Nothing here reaches Cloudflare: the keys are generated per run and served by a fake fetch (or a loopback server).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import importlib.util
import json
import logging
import sys
from pathlib import Path
from unittest import mock

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer, make_mocked_request
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from mantel_server import cf_access
from mantel_server.authz import resolve_door
from mantel_server.config import Config, parse_args
from https_fakes import make_mantel

ROOT = Path(__file__).resolve().parent.parent
TEAM = "fictionalteam.cloudflareaccess.com"
ISS = f"https://{TEAM}"
AUD = "a" * 64
OTHER_AUD = "b" * 64
NOW = 1_000_000.0                       # make_mantel's clock
TUNNEL = {"X-Test-Peer": "203.0.113.7", "Cf-Connecting-Ip": "203.0.113.7", "Cf-Ray": "8f0000000000-AMS"}

KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
KEY2 = rsa.generate_private_key(public_exponent=65537, key_size=2048)
STRANGER = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def jwk(key, kid: str) -> dict:
    n = key.public_key().public_numbers()
    return {"kid": kid, "kty": "RSA", "alg": "RS256", "use": "sig", "e": b64u(n.e.to_bytes(3, "big")),
            "n": b64u(n.n.to_bytes((n.n.bit_length() + 7) // 8, "big"))}


def certs(*pairs) -> dict:
    """What https://<team>.cloudflareaccess.com/cdn-cgi/access/certs answers (its extra members included)."""
    return {"keys": [jwk(k, kid) for k, kid in pairs], "public_cert": {"kid": "k1", "cert": "-----BEGIN..."},
            "public_certs": [{"kid": "k1", "cert": "-----BEGIN..."}]}


def claims(**over) -> dict:
    c = {"aud": [AUD], "email": "visitor@example.com", "sub": "7335d417-61da-459d-899c-0a01c76a2f94",
         "iss": ISS, "iat": int(NOW) - 10, "nbf": int(NOW) - 10, "exp": int(NOW) + 3600, "type": "app",
         "identity_nonce": "fictional", "country": "NL"}
    c.update(over)
    return {k: v for k, v in c.items() if v is not None}


def token(key=KEY, kid="k1", alg="RS256", header=None, **over) -> str:
    head = {"alg": alg, "kid": kid, **(header or {})}
    signing = b64u(json.dumps(head).encode()) + "." + b64u(json.dumps(claims(**over)).encode())
    if alg == "RS256":
        sig = key.sign(signing.encode(), padding.PKCS1v15(), hashes.SHA256())
    elif alg == "HS256":     # the classic confusion: the RSA public key used as an HMAC secret
        pem = KEY.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        sig = hmac.new(pem, signing.encode(), hashlib.sha256).digest()
    else:
        sig = b""
    return signing + "." + b64u(sig)


class FakeCerts:
    """The team's certs endpoint: counts fetches; `doc` may be swapped (rotation) or an exception (outage)."""

    def __init__(self, doc) -> None:
        self.doc, self.urls = doc, []

    async def __call__(self, url):
        self.urls.append(url)
        if isinstance(self.doc, Exception):
            raise self.doc
        return self.doc


def verifier(doc=None, now=None):
    clock = now if now is not None else [NOW]
    fetch = FakeCerts(doc if doc is not None else certs((KEY, "k1")))
    return cf_access.AccessVerifier("fictionalteam", [AUD], fetch, lambda: clock[0]), fetch, clock


# -- the token ------------------------------------------------------------------------------------
async def test_a_valid_assertion_passes_and_its_claims_come_back():
    v, fetch, _ = verifier()
    got = await v.verify(token())
    assert got["email"] == "visitor@example.com" and got["aud"] == [AUD]
    assert fetch.urls == [f"{ISS}/cdn-cgi/access/certs"]
    assert (await v.verify(token(aud=AUD)))["aud"] == AUD          # aud as a plain string too


@pytest.mark.parametrize("bad, reason", [
    (lambda: token(aud=[OTHER_AUD]), "wrong aud"),
    (lambda: token(aud=None), "wrong aud"),
    (lambda: token(aud=[[AUD]]), "wrong aud"),
    (lambda: token(iss="https://otherteam.cloudflareaccess.com"), "wrong iss"),
    (lambda: token(iss=ISS + "/"), "wrong iss"),
    (lambda: token(exp=int(NOW) - 61), "expired"),
    (lambda: token(exp=None), "no exp"),
    (lambda: token(exp="9999999999"), "no exp"),
    (lambda: token(exp=True), "no exp"),
    (lambda: token(nbf=int(NOW) + 120), "nbf in the future"),
    (lambda: token(iat=int(NOW) + 120), "iat in the future"),
    (lambda: token(key=STRANGER), "bad signature"),                     # same kid, someone else's key
    (lambda: token(alg="none"), "alg 'none'"),
    (lambda: token(alg="HS256"), "alg 'HS256'"),
    (lambda: token(alg="RS512"), "alg 'RS512'"),
    (lambda: token(header={"crit": ["exp"]}), "crit"),
    (lambda: token(kid=""), "no kid"),
    (lambda: token(kid="nobody"), "unknown kid"),
    (lambda: token() + ".x", "malformed"),
    (lambda: "not-a-jwt", "malformed"),
    (lambda: token().replace("-", "+").replace("_", "/") + "+/", "malformed"),
    (lambda: token() + "=", "malformed"),
    (lambda: b64u(b"[1]") + "." + token().split(".", 1)[1], "malformed"),
    (lambda: "a" * (cf_access.MAX_TOKEN + 1), "malformed"),
])
async def test_what_is_refused(bad, reason):
    v, _, _ = verifier()
    with pytest.raises(cf_access.AccessError) as err:
        await v.verify(bad())
    assert err.value.code == "access_invalid" and err.value.reason == reason and err.value.status == 403


async def test_the_clock_has_a_small_leeway():
    v, _, _ = verifier()
    await v.verify(token(exp=int(NOW) - 30, nbf=int(NOW) + 30, iat=int(NOW) + 30))


async def test_a_tampered_claim_breaks_the_signature():
    v, _, _ = verifier()
    head, _, sig = token().split(".")
    forged = b64u(json.dumps(claims(email="owner@example.com")).encode())
    with pytest.raises(cf_access.AccessError, match="bad signature"):
        await v.verify(f"{head}.{forged}.{sig}")


async def test_no_assertion_is_access_required():
    v, fetch, _ = verifier()
    for missing in (None, "", "   "):
        with pytest.raises(cf_access.AccessError) as err:
            await v.verify(missing)
        assert err.value.code == "access_required"
    assert fetch.urls == []                  # nothing is fetched for a request that carries nothing


async def test_alg_is_refused_before_any_key_is_fetched():
    v, fetch, _ = verifier()
    for alg in ("none", "HS256"):
        with pytest.raises(cf_access.AccessError):
            await v.verify(token(alg=alg))
    assert fetch.urls == []


# -- the keys -------------------------------------------------------------------------------------
async def test_keys_are_cached_by_kid_for_an_hour():
    v, fetch, clock = verifier()
    for _ in range(5):
        await v.verify(token())
    assert len(fetch.urls) == 1
    clock[0] += cf_access.KEYS_TTL - 1
    await v.verify(token(exp=int(clock[0]) + 60))
    assert len(fetch.urls) == 1
    clock[0] += 2                            # past the hour: read again
    await v.verify(token(exp=int(clock[0]) + 60))
    assert len(fetch.urls) == 2


async def test_an_unknown_kid_is_fetched_again_at_once_but_rate_limited():
    v, fetch, clock = verifier()
    await v.verify(token())
    clock[0] += cf_access.REFETCH_EVERY + 1
    fetch.doc = certs((KEY, "k1"), (KEY2, "k2"))          # Cloudflare rotated: a new key
    assert (await v.verify(token(key=KEY2, kid="k2", exp=int(clock[0]) + 60)))["sub"]
    assert len(fetch.urls) == 2
    # a flood of made-up kids right after: no fetch for each (one a minute at most)
    for i in range(20):
        with pytest.raises(cf_access.AccessError, match="unknown kid"):
            await v.verify(token(kid=f"made-up-{i}", exp=int(clock[0]) + 60))
    assert len(fetch.urls) == 2
    clock[0] += cf_access.REFETCH_EVERY + 1
    with pytest.raises(cf_access.AccessError, match="unknown kid"):
        await v.verify(token(kid="made-up-again", exp=int(clock[0]) + 60))
    assert len(fetch.urls) == 3
    await v.verify(token(exp=int(clock[0]) + 60))         # the known kids still work, from the cache


async def test_without_keys_it_fails_closed():
    v, fetch, clock = verifier(doc=OSError("Cloudflare is unreachable"))
    with pytest.raises(cf_access.AccessError) as err:
        await v.verify(token())
    assert err.value.code == "access_unavailable" and err.value.status == 503
    with pytest.raises(cf_access.AccessError, match="no signing keys"):
        await v.verify(token())
    assert len(fetch.urls) == 1                           # not fetched again within the minute
    fetch.doc = {"keys": [{"kid": "k1", "kty": "EC", "crv": "P-256", "x": "AA", "y": "AA"}]}   # nothing usable
    clock[0] += cf_access.REFETCH_EVERY + 1
    with pytest.raises(cf_access.AccessError, match="no signing keys"):
        await v.verify(token())
    fetch.doc = certs((KEY, "k1"))
    clock[0] += cf_access.REFETCH_EVERY + 1
    await v.verify(token(exp=int(clock[0]) + 60))


async def test_held_keys_outlive_a_short_outage_but_not_a_long_one():
    v, fetch, clock = verifier()
    await v.verify(token())
    fetch.doc = OSError("down")
    clock[0] += cf_access.KEYS_TTL + 1                    # due for a refresh, which fails: the old keys still count
    await v.verify(token(exp=int(clock[0]) + 60))
    assert len(fetch.urls) == 2
    clock[0] = NOW + cf_access.MAX_STALE + 1              # a day without Cloudflare: closed
    with pytest.raises(cf_access.AccessError) as err:
        await v.verify(token(exp=int(clock[0]) + 60))
    assert err.value.code == "access_unavailable"


def test_jwks_parsing_keeps_only_usable_rs256_keys():
    small = rsa.generate_private_key(public_exponent=65537, key_size=1024)
    doc = certs((KEY, "good"), (small, "small"))
    doc["keys"] += [{**jwk(KEY, "es"), "alg": "ES256"}, {**jwk(KEY, "enc"), "use": "enc"},
                    {**jwk(KEY, "private"), "d": "AA"}, {**jwk(KEY, "")}, "junk", {"kid": "x", "kty": "RSA"}]
    assert set(cf_access.keys_of_jwks(doc)) == {"good"}
    assert cf_access.keys_of_jwks(["not", "a", "doc"]) == {} and cf_access.keys_of_jwks({"keys": "x"}) == {}


async def test_the_real_fetch_uses_the_apps_session():
    """http_fetch against a loopback server standing in for the certs endpoint (never Cloudflare)."""
    import aiohttp
    served = certs((KEY, "k1"))

    async def certs_page(request):
        return web.json_response(served) if request.path == "/cdn-cgi/access/certs" else web.Response(status=404)

    fake = web.Application()
    fake.router.add_get("/{tail:.*}", certs_page)
    server = TestServer(fake)
    await server.start_server()
    app = web.Application()
    app["http"] = aiohttp.ClientSession()
    try:
        fetch = cf_access.http_fetch(app)
        assert await fetch(str(server.make_url("/cdn-cgi/access/certs"))) == served
        with pytest.raises(OSError, match="404"):
            await fetch(str(server.make_url("/elsewhere")))
    finally:
        await app["http"].close()
        await server.close()


# -- the settings ---------------------------------------------------------------------------------
def test_team_names_and_aud_tags():
    for raw in ("fictionalteam", "FictionalTeam.cloudflareaccess.com", "https://fictionalteam.cloudflareaccess.com/"):
        assert cf_access.normalize_team(raw) == TEAM
    for bad in ("", "evil.example.com", "team.cloudflareaccess.com.evil.example", "-team", "a b",
                "https://evil.example/fictionalteam.cloudflareaccess.com", "team/x"):
        with pytest.raises(ValueError):
            cf_access.normalize_team(bad)
    assert cf_access.parse_auds([f"{AUD}, {OTHER_AUD}", AUD]) == (AUD, OTHER_AUD)
    for bad in (["short"], ["a" * 64 + "!"]):
        with pytest.raises(ValueError):
            cf_access.parse_auds(bad)


def test_the_flags():
    cfg = parse_args(["--cf-access-team", "fictionalteam", "--cf-access-aud", AUD, "--cf-access-aud", OTHER_AUD])
    assert cfg.cf_access_team == TEAM and cfg.cf_access_aud == (AUD, OTHER_AUD)
    cfg = parse_args(["--cf-access-team", TEAM, "--cf-access-aud", f"{AUD},{OTHER_AUD}"])
    assert cfg.cf_access_aud == (AUD, OTHER_AUD)
    assert parse_args([]).cf_access_team == "" and parse_args([]).cf_access_aud == ()
    for bad in (["--cf-access-team", "fictionalteam"], ["--cf-access-aud", AUD],
                ["--cf-access-team", "evil.example.com", "--cf-access-aud", AUD],
                ["--cf-access-team", "fictionalteam", "--cf-access-aud", "nope"]):
        with pytest.raises(SystemExit):
            parse_args(bad)


def _entrypoint():
    spec = importlib.util.spec_from_file_location("mantel_entrypoint_cf", ROOT / "packaging/docker/entrypoint.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["mantel_entrypoint_cf"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_the_compose_entrypoint_passes_the_settings(tmp_path):
    ep = _entrypoint()
    env = {"MANTEL_PUBLIC_URL": "https://mantel.example.com/", "MANTEL_TRUSTED_PROXY": "172.31.251.2"}
    args, _ = ep.plan([], env, options_path=tmp_path / "none")
    assert "--cf-access-team" not in args and "--cf-access-aud" not in args
    args, _ = ep.plan([], {**env, "MANTEL_CF_ACCESS_TEAM": "fictionalteam", "MANTEL_CF_ACCESS_AUD": f"{AUD}, {OTHER_AUD}"},
                      options_path=tmp_path / "none")
    i = args.index("--cf-access-team")
    assert args[i:i + 6] == ["--cf-access-team", "fictionalteam", "--cf-access-aud", AUD, "--cf-access-aud", OTHER_AUD]
    cfg = parse_args(args)
    assert cfg.cf_access_team == TEAM and cfg.cf_access_aud == (AUD, OTHER_AUD)
    for half in ({"MANTEL_CF_ACCESS_TEAM": "fictionalteam"}, {"MANTEL_CF_ACCESS_AUD": AUD}):
        with pytest.raises(ep.ConfigError, match="go together"):
            ep.plan([], {**env, **half}, options_path=tmp_path / "none")
    compose = (ROOT / "packaging/compose/compose.yaml").read_text()
    assert "MANTEL_CF_ACCESS_TEAM: ${MANTEL_CF_ACCESS_TEAM:-}" in compose
    assert "MANTEL_CF_ACCESS_AUD: ${MANTEL_CF_ACCESS_AUD:-}" in compose
    assert "#MANTEL_CF_ACCESS_TEAM=" in (ROOT / "packaging/compose/.env.example").read_text()


def test_the_ha_app_options(tmp_path):
    ep = _entrypoint()
    sys.path.insert(0, str(ROOT / "tools"))
    import package_check as pc
    doc = pc.parse_yaml((ROOT / "packaging/ha-app/config.yaml").read_text())
    assert doc["options"]["cf_access_team"] == "" and doc["schema"]["cf_access_team"] == "str?"
    assert doc["options"]["cf_access_aud"] == "" and doc["schema"]["cf_access_aud"] == "str?"
    tr = pc.parse_yaml((ROOT / "packaging/ha-app/translations/en.yaml").read_text())["configuration"]
    assert {"cf_access_team", "cf_access_aud"} <= set(tr)
    base = {"access": "https", "public_url": "https://mantel.example.com", "cloudflare_token": "fictional"}
    args = ep.app_args(base, tmp_path / "t", {})
    assert "--cf-access-team" not in args
    args = ep.app_args({**base, "cf_access_team": "fictionalteam", "cf_access_aud": AUD}, tmp_path / "t", {})
    assert args[args.index("--cf-access-team") + 1] == "fictionalteam" and args[args.index("--cf-access-aud") + 1] == AUD
    assert parse_args(args).cf_access_team == TEAM
    with pytest.raises(ep.ConfigError, match="cf_access_team and cf_access_aud"):
        ep.app_args({**base, "cf_access_aud": AUD}, tmp_path / "t", {})


# -- the server -----------------------------------------------------------------------------------
@pytest.fixture
async def gated(tmp_path, monkeypatch):
    m = await make_mantel(tmp_path, monkeypatch, cf_access_team=TEAM, cf_access_aud=(AUD,))
    fetch = FakeCerts(certs((KEY, "k1")))
    m.app["cf_access"].fetch = fetch
    m.fetch = fetch
    yield m
    await m.client.close()
    m.store.db.close()


@pytest.fixture
async def open_mantel(tmp_path, monkeypatch):
    m = await make_mantel(tmp_path, monkeypatch)
    yield m
    await m.client.close()
    m.store.db.close()


async def test_unconfigured_nothing_changes(open_mantel):
    m = open_mantel
    assert "cf_access" not in m.app
    for headers in (TUNNEL, {**TUNNEL, cf_access.HEADER: "garbage"}, {**TUNNEL, cf_access.HEADER: token(alg="none")}):
        r = await m.client.get("/api/proxy-check/basics", headers=headers)
        assert r.status == 200 and (await r.json())["door"] == "tunnel"


async def test_the_tunnel_door_needs_a_valid_assertion(gated, caplog):
    m = gated
    caplog.set_level(logging.INFO, logger="mantel.cf_access")
    r = await m.client.get("/api/proxy-check/basics", headers=TUNNEL)
    assert r.status == 403 and (await r.json())["error"] == "access_required"
    assert r.headers["Cache-Control"] == "no-store" and "Set-Cookie" not in r.headers
    bad = token(aud=[OTHER_AUD])
    for value in (bad, token(alg="none"), token(alg="HS256"), token(exp=int(NOW) - 3600), token(key=STRANGER),
                  token(iss="https://otherteam.cloudflareaccess.com"), "garbage"):
        r = await m.client.get("/api/proxy-check/basics", headers={**TUNNEL, cf_access.HEADER: value})
        assert r.status == 403 and (await r.json())["error"] == "access_invalid", value
    good = token()
    r = await m.client.get("/api/proxy-check/basics", headers={**TUNNEL, cf_access.HEADER: good})
    assert r.status == 200
    assert (await r.json())["door"] == "tunnel"            # a valid assertion never makes it the LAN door
    # a page navigation and a sign-in attempt are refused just the same, before any session code
    r = await m.client.get("/home", headers={**TUNNEL, "Accept": "text/html"}, allow_redirects=False)
    assert r.status == 403
    r = await m.client.post("/api/auth/password", json={"username": "x", "password": "y"}, headers=TUNNEL)
    assert r.status == 403 and (await r.json())["error"] == "access_required"
    # the log says why, once per reason, and never carries a token
    text = caplog.text
    assert "no assertion" in text and "wrong aud" in text and "alg 'none'" in text
    assert text.count("refused a tunnel request: no assertion") == 1
    assert good not in text and bad not in text and bad.split(".")[2] not in text
    assert len(m.fetch.urls) == 1


async def test_two_assertions_are_refused(gated):
    m = gated
    from multidict import CIMultiDict
    h = CIMultiDict(TUNNEL)
    h.add(cf_access.HEADER, token())
    h.add(cf_access.HEADER, token())
    r = await m.client.get("/api/proxy-check/basics", headers=h)
    assert r.status == 403 and (await r.json())["error"] == "access_invalid"


async def test_any_tunnel_request_counts_not_just_cloudflares(gated):
    """An internet peer with no Cloudflare header (a port opened by hand) is the tunnel door too: refused."""
    r = await gated.client.get("/api/proxy-check/basics", headers={"X-Test-Peer": "203.0.113.50"})
    assert r.status == 403 and (await r.json())["error"] == "access_required"


async def test_the_lan_door_is_untouched(gated):
    m = gated
    r = await m.client.get("/api/proxy-check/basics")                 # loopback: the LAN door, no assertion needed
    assert r.status == 200 and (await r.json())["door"] == "lan"
    r = await m.client.get("/healthz")
    assert r.status == 200
    assert m.fetch.urls == []


async def test_keys_unavailable_answers_503(gated):
    m = gated
    m.fetch.doc = OSError("down")
    r = await m.client.get("/api/proxy-check/basics", headers={**TUNNEL, cf_access.HEADER: token()})
    assert r.status == 503 and (await r.json())["error"] == "access_unavailable" and r.headers["Retry-After"] == "60"


def test_ingress_requests_are_never_asked():
    app = web.Application()
    app["cfg"] = Config(ingress=True, ingress_peers=("172.30.32.2",))
    app["door_resolver"] = resolve_door
    transport = mock.Mock()
    transport.get_extra_info.side_effect = lambda name, default=None: ("172.30.32.2", 1) if name == "peername" else default
    req = make_mocked_request("GET", "/home", headers={"Cf-Ray": "x"}, app=app, transport=transport)
    assert cf_access.applies(req) is False
    transport2 = mock.Mock()
    transport2.get_extra_info.side_effect = lambda name, default=None: ("203.0.113.7", 1) if name == "peername" else default
    assert cf_access.applies(make_mocked_request("GET", "/home", app=app, transport=transport2)) is True


# -- Cloudflare's headers only ever tighten the door ---------------------------------------------------------------
CF_HEADERS = ("Cf-Connecting-Ip", "Cf-Access-Jwt-Assertion", "Cf-Ray", "cf-connecting-ip", "CF-RAY")


def _door(peer, headers, port=None, **cfg):
    app = web.Application()
    app["cfg"] = Config(**cfg)
    transport = mock.Mock()

    def extra(name, default=None):
        if name == "peername":
            return (peer, 4321)
        if name == "sockname" and port is not None:
            return ("0.0.0.0", port)
        return default
    transport.get_extra_info.side_effect = extra
    req = make_mocked_request("GET", "/home", headers=headers, app=app, transport=transport)
    return req


@pytest.mark.parametrize("cf", CF_HEADERS)
# (fixed ids: the token is signed afresh at collection, and pytest-xdist's workers must collect the same names)
@pytest.mark.parametrize("value", ["", "198.51.100.4", token()], ids=["empty", "an-address", "a-token"])
def test_a_cloudflare_header_can_never_give_the_lan_rules(cf, value, monkeypatch):
    from mantel_server import door_key
    caddy = "172.31.251.2"
    # every way a request is otherwise the LAN door, each with a Cloudflare header added: always the tunnel
    lan_ways = [
        _door("127.0.0.1", {}),                                                       # the loopback prototype
        _door(caddy, {"X-Mantel-Door": "lan"}, trusted_proxies=(caddy,)),              # Mantel's Caddy
        _door("192.168.1.40", {}, port=8100, direct_port=8100, direct_tls="acme", ingress=True),   # built-in HTTPS
    ]
    for req in lan_ways:
        assert resolve_door(req) == "lan"
    keyed = _door(caddy, {"X-Mantel-Door": "lan"}, port=8100, trusted_proxies=(caddy,), direct_port=8100, ingress=True)
    monkeypatch.setattr(door_key, "door_allowed", lambda request: True)
    monkeypatch.setattr(door_key, "status", lambda request: "ok")
    assert resolve_door(keyed) == "lan"                                                # the home's proxy + door key
    core = _door("172.30.32.1", {})
    core["ha_core"] = True
    assert resolve_door(core) == "lan"                                                 # HA Core's linked mode
    for req in lan_ways + [keyed, core]:
        spoofed = req.clone(headers={**req.headers, cf: value})
        for k, v in req.items():
            spoofed[k] = v
        assert resolve_door(spoofed) == "tunnel", (cf, req.remote)
