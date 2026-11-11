"""Pairing codes for Mantel Link (mantel_server/linked_pairing.py; docs/phase9/MANTEL-LINK.md 9.4): an Owner's one-time
code, held in memory only, traded once at /linked/pair for a `linked` Service credential, both sides proving they
know it; wrong tries counted and the code burned; the LAN door only, never a browser; audited, never a secret."""
import json
import secrets

from mantel_server.linked import linked_pairing as LP
from mantel_connect import protocol as CP
from test_features import Linked, make_env  # noqa: F401


def body_for(code: str, name: str = "Home Assistant - Mantel Link", wrong: bool = False):
    raw = CP.normalize_code(code)
    nonce = secrets.token_hex(16)
    key = LP.code_key(raw if not wrong else "X" * 20)
    return {"v": 1, "code_id": raw[:5], "nonce": nonce, "name": name,
            "proof": LP.client_proof(key, raw[:5], nonce, name)}, LP.code_key(raw), nonce


async def pair(env, body, **headers):
    env.m.client.session.headers.pop("Origin", None)
    try:
        return await env.m.client.post("/linked/pair", json=body, headers=headers)
    finally:
        env.m.client.session.headers["Origin"] = env.m.origin


async def test_an_owner_s_code_is_traded_once_for_a_linked_credential(make_env):
    env = await make_env()
    await env.login("adult1", "adult")
    assert (await env.m.client.post("/api/linked/pair", headers=env.m.headers())).status == 403
    await env.login("owner1", "owner")
    r = await env.m.client.post("/api/linked/pair", headers=env.m.headers())
    got = await r.json()
    assert r.status == 200 and r.headers["Cache-Control"] == "no-store" and CP.normalize_code(got["code"])
    pend = await (await env.m.get("/api/linked/pair")).json()
    assert pend["pending"]["expires"] == got["expires"] and "code" not in repr(pend).lower().replace("code_", "")
    body, key, nonce = body_for(got["code"])
    r = await pair(env, body)
    out = await r.json()
    assert r.status == 200, out
    inst = env.app["linked"].instance
    assert out["instance"] == inst and out["proof"] == LP.server_proof(key, body["code_id"], nonce, inst, out["token"])
    acct = env.app["service_accounts"].verify(out["token"], "linked")
    assert acct is not None and acct.name == "Home Assistant - Mantel Link"
    # spent: the same exchange again is refused
    assert (await pair(env, body)).status == 403
    assert (await (await env.m.get("/api/linked/pair")).json())["pending"] is None
    # the credential opens the link, as Mantel Link
    lk = Linked(env)
    lk.token = out["token"]
    env.m.client.session.headers.pop("Origin", None)
    ws = await env.m.client.ws_connect("/linked/ws", headers={"Authorization": f"Bearer {out['token']}",
                                                                "X-Mantel-Link": "domain=mantel; protocol=2"})
    env.m.client.session.headers["Origin"] = env.m.origin
    hello = await ws.receive_json(timeout=5)
    assert hello["protocol"] == 2 and hello["instance"] == inst
    await ws.close()
    rows = env.audit(kind="config")
    actions = [r["action"] for r in rows]
    assert "linked.pair_start" in actions and "linked.pair_ok" in actions
    assert got["code"] not in repr(rows) and out["token"] not in repr(rows)


async def test_wrong_tries_burn_the_code_and_the_doors_hold(make_env):
    env = await make_env()
    await env.login("owner1", "owner")
    code = (await (await env.m.client.post("/api/linked/pair", headers=env.m.headers())).json())["code"]
    good, _k, _n = body_for(code)
    # a browser, the tunnel, nonsense
    assert (await env.m.client.post("/linked/pair", json=good)).status == 403, "an Origin: never a browser"
    assert (await pair(env, good, **{"X-Mantel-Door": "tunnel"})).status == 403
    assert (await pair(env, {"v": 1, "code_id": "nope"})).status == 400
    for i in range(LP.MAX_WRONG):
        bad, _k, _n = body_for(code, wrong=True)
        assert (await pair(env, bad)).status == 403, i
    assert (await pair(env, good)).status == 403, "burned after five wrong proofs"
    fails = [json.loads(r["target"]) for r in env.audit(kind="config") if r["action"] == "linked.pair_failed"]
    assert [f["wrong"] for f in fails] == [1, 2, 3, 4, 5] and fails[-1]["burned"] is True


async def test_a_code_expires_and_one_at_a_time(make_env):
    env = await make_env()
    p = env.app["linked_pairing"]
    first = p.start("o1")["code"]
    second = p.start("o1")["code"]
    b1, _k, _n = body_for(first)
    try:
        p.pair(b1, "192.0.2.9")
        raise AssertionError("an older code still worked")
    except LP.PairError as exc:
        assert exc.code == "invalid_code"
    b2, _k, _n = body_for(second)
    p._code["expires"] = 0
    try:
        p.pair(b2, "192.0.2.9")
        raise AssertionError("an expired code still worked")
    except LP.PairError as exc:
        assert exc.code == "invalid_code"


# -- protocol v2 (T2): the address Mantel Link used is in both proofs ---------------------------------------
def body_v2(code: str, address, name: str = "Home Assistant - Mantel Link"):
    raw = CP.normalize_code(code)
    nonce = secrets.token_hex(16)
    key = LP.code_key(raw)
    return {"v": 2, "code_id": raw[:5], "nonce": nonce, "name": name, "address": address,
            "proof": LP.client_proof(key, raw[:5], nonce, name, address)}, key, nonce


def here(env) -> str:
    return LP.normalize_address(str(env.m.client.make_url("")))


async def _code(env) -> str:
    await env.login("owner1", "owner")
    return (await (await env.m.client.post("/api/linked/pair", headers=env.m.headers())).json())["code"]


def test_addresses_are_normalised_one_way():
    n = LP.normalize_address
    assert n("https://Mantel.Example.com") == "https://mantel.example.com:443"
    assert n("https://mantel.example.com/") == "https://mantel.example.com:443"
    assert n("https://mantel.example.com:443/linked/pair?x=1") == "https://mantel.example.com:443"
    assert n("HTTP://mantel.lan") == "http://mantel.lan:80"
    assert n("http://mantel.lan:80") == "http://mantel.lan:80"
    assert n("http://local-mantel:8099") == "http://local-mantel:8099"
    assert n("wss://mantel.example.com:8443/linked/ws") == "https://mantel.example.com:8443"
    assert n("http://[FD00::1]:8099/") == "http://[fd00::1]:8099"
    assert n("https://[::1]") == "https://[::1]:443"
    assert n("https://mantel.example.com.") == "https://mantel.example.com:443"
    for bad in ("", "mantel.example.com", "ftp://mantel.example.com", "https://", "https://m:99999", None, 7):
        assert n(bad) is None, bad


def test_mantel_s_own_addresses():
    from types import SimpleNamespace
    cfg = SimpleNamespace(public_url="https://Mantel.Example.com/", allowed_hosts=("mantel.lan", "*"),
                          direct_hosts=("mantel.example.com:8443", "mantel.example.com"))
    got = LP.own_addresses(cfg, "mantel.lan", app_url="http://local-mantel:8099",
                           announce_url="https://mantel.example.com:8443")
    assert "https://mantel.example.com:443" in got                 # public_url
    assert "http://local-mantel:8099" in got                       # the App's hostname
    assert "https://mantel.example.com:8443" in got                # the announcement (and the direct listener)
    assert {"https://mantel.lan:443", "http://mantel.lan:80"} <= got  # the Host it came in on, a name Mantel has
    # the Host it came in on counts only when it is one of Mantel's names: "*" never widens it
    assert not any("evil" in a for a in LP.own_addresses(cfg, "evil.lan:443"))
    assert LP.own_addresses(None, "127.0.0.1:8099") >= {"http://127.0.0.1:8099", "https://127.0.0.1:8099"}
    assert "http://[::1]:8099" in LP.own_addresses(None, "[::1]:8099")
    assert LP.own_addresses(None, None) == set()


async def test_v2_pairs_at_mantel_s_own_address_and_the_proof_names_it(make_env):
    env = await make_env()
    code = await _code(env)
    body, key, nonce = body_v2(code, here(env))
    r = await pair(env, body)
    out = await r.json()
    assert r.status == 200, out
    inst = env.app["linked"].instance
    assert out["v"] == 2 and out["address"] == here(env)
    assert out["proof"] == LP.server_proof(key, body["code_id"], nonce, inst, out["token"], here(env))
    assert out["proof"] != LP.server_proof(key, body["code_id"], nonce, inst, out["token"]), "v1's proof differs"
    assert env.app["service_accounts"].verify(out["token"], "linked") is not None


async def test_a_relaying_look_alike_at_another_address_cannot_pair(make_env):
    """Home Assistant reached a look-alike at another address, which passed the exchange on to the real Mantel: the
    address in the proof is not Mantel's, so Mantel refuses (and the look-alike cannot change it without the code)."""
    env = await make_env()
    code = await _code(env)
    body, _k, _n = body_v2(code, "https://mantel-lookalike.lan:443")
    r = await pair(env, body)
    assert r.status == 403 and (await r.json())["error"]["code"] == "wrong_address"
    # rewriting the address to Mantel's own breaks the client's proof
    forged = {**body, "address": here(env)}
    r = await pair(env, forged)
    assert r.status == 403 and (await r.json())["error"]["code"] == "invalid_code"
    rows = [json.loads(r["target"]) for r in env.audit(kind="config") if r["action"] == "linked.pair_failed"]
    assert rows and rows[0].get("address") == "https://mantel-lookalike.lan:443"
    # the code is not spent by the look-alike: Home Assistant at Mantel's own address still pairs
    good, _k, _n = body_v2(code, here(env))
    assert (await pair(env, good)).status == 200


async def test_v2_needs_a_normalised_address_and_v1_still_pairs(make_env):
    env = await make_env()
    code = await _code(env)
    for bad in (None, "", "https://Mantel.lan/", "mantel.lan", 7):
        body, _k, _n = body_v2(code, "https://x.lan:443")
        body["address"] = bad
        r = await pair(env, body)
        assert r.status == 400 and (await r.json())["error"]["code"] == "malformed", bad
    assert (await pair(env, {**body_v2(code, here(env))[0], "v": 3})).status == 400, "an unknown version"
    old, key, nonce = body_for(code)                          # an older Mantel Link: v1, no address
    r = await pair(env, old)
    out = await r.json()
    assert r.status == 200 and out["v"] == 1 and "address" not in out
    assert out["proof"] == LP.server_proof(key, old["code_id"], nonce, env.app["linked"].instance, out["token"])


async def _paired_and_connected(env, as_domain="mantel"):
    r = await env.m.client.post("/api/linked/pair", headers=env.m.headers())
    got = await r.json()
    body, _key, _nonce = body_for(got["code"])
    out = await (await pair(env, body)).json()
    env.m.client.session.headers.pop("Origin", None)
    ws = await env.m.client.ws_connect("/linked/ws", headers={"Authorization": f"Bearer {out['token']}",
                                                                "X-Mantel-Link": f"domain={as_domain}; protocol=2"})
    env.m.client.session.headers["Origin"] = env.m.origin
    await ws.receive_json(timeout=5)
    return out["token"], ws


async def test_pairing_again_revokes_the_credential_mantel_link_last_connected_with(make_env):
    """2026-11-01 (audit 3, LINK-10): each pairing made a new `linked` account and none was ever revoked."""
    env = await make_env()
    await env.login("owner1", "owner")
    accounts = env.app["service_accounts"]
    first, ws1 = await _paired_and_connected(env)
    live_before = [a for a in accounts.list() if a["revoked"] is None]
    assert len(live_before) == 1
    # Mantel Link is paired again (its entry removed and set up anew, or a re-authentication)
    r = await env.m.client.post("/api/linked/pair", headers=env.m.headers())
    body, _key, _nonce = body_for((await r.json())["code"])
    out = await (await pair(env, body)).json()
    second = out["token"]
    assert accounts.verify(first, "linked") is None, "the superseded credential is revoked"
    assert accounts.verify(second, "linked") is not None
    assert [a["id"] for a in accounts.list() if a["revoked"] is None] != [a["id"] for a in live_before]
    revoked = [a for a in accounts.list() if a["revoked"] is not None]
    assert [a["id"] for a in revoked] == [live_before[0]["id"]] and revoked[0]["revoked_reason"] == "re-paired"
    rows = [r for r in env.audit(kind="config") if r["action"] == "linked.pair_ok"]
    assert json.loads(rows[-1]["target"])["revoked"] == live_before[0]["id"] and "revoked" not in rows[0]["target"]
    assert first not in repr(rows) and second not in repr(rows)
    await ws1.close()


async def test_a_pairing_with_no_earlier_link_revokes_nothing_and_a_credential_for_another_domain_is_left(make_env):
    env = await make_env()
    await env.login("owner1", "owner")
    accounts = env.app["service_accounts"]
    # HK Frontend's link (domain hk_frontend) is not Mantel Link's: it is never the one remembered
    hk_token, ws = await _paired_and_connected(env, as_domain="hk_frontend")
    r = await env.m.client.post("/api/linked/pair", headers=env.m.headers())
    body, _key, _nonce = body_for((await r.json())["code"])
    assert (await pair(env, body)).status == 200
    assert accounts.verify(hk_token, "linked") is not None
    assert not [a for a in accounts.list() if a["revoked"] is not None]
    await ws.close()


# -- v3: Mantel's own certificate, pinned (Mantel Link by address, on Mantel Connect's listener) -----------------------
LINK = "https://192.0.2.10:8766"
CA = "-----BEGIN CERTIFICATE-----\nfictional\n-----END CERTIFICATE-----\n"


def body_v3(code: str, address=LINK, name: str = "Home Assistant - Mantel Link"):
    raw = CP.normalize_code(code)
    nonce = secrets.token_hex(16)
    key = LP.code_key(raw)
    return {"v": 3, "code_id": raw[:5], "nonce": nonce, "name": name, "address": address,
            "proof": LP.client_proof(key, raw[:5], nonce, name, address, 3)}, key, nonce


def open_token(key: bytes, nonce: str, address: str, sealed: str) -> str:
    import base64

    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    raw = base64.urlsafe_b64decode(sealed)
    return AESGCM(LP.token_key(key, nonce)).decrypt(raw[:12], raw[12:], address.encode()).decode()


def test_mantel_s_link_address_is_one_of_its_own():
    class Cfg:
        public_url, connect_address = "https://mantel.example.com", "192.0.2.10:8766"
    assert LINK in LP.own_addresses(Cfg(), None)


async def test_v3_hands_over_the_ca_in_the_proof_and_the_credential_sealed_under_the_code(make_env):
    """The owner (2026-11-02): Mantel Link by address, with no name, DNS or proxy in between. Mantel's CA comes in
    its proof (a look-alike can't swap its own in without the code) and the credential sealed under the code (a
    look-alike in the middle can't read it); Mantel Link pins the CA from then on."""
    env = await make_env()
    code = await _code(env)
    body, key, nonce = body_v3(code)
    p = env.app["linked_pairing"]
    out = p.pair(body, "192.0.2.20", {LINK}, pinned_ca=CA, link_address=LINK)
    assert out["v"] == 3 and out["ca"] == CA and out["address"] == LINK and "token" not in out
    token = open_token(key, nonce, LINK, out["token_sealed"])
    inst = env.app["linked"].instance
    assert out["proof"] == LP.server_proof(key, body["code_id"], nonce, inst, token, LINK, CA)
    assert out["proof"] != LP.server_proof(key, body["code_id"], nonce, inst, token, LINK), "v2's proof differs"
    assert env.app["service_accounts"].verify(token, "linked") is not None


async def test_v3_elsewhere_names_the_link_address_and_spends_nothing(make_env):
    env = await make_env()
    code = await _code(env)
    body, _, _ = body_v3(code, here(env))
    r = await pair(env, body)                     # Mantel's ordinary listener: no CA to pin there
    out = await r.json()
    assert r.status == 400 and out["error"]["code"] == "pin_elsewhere", out
    assert (await (await env.m.get("/api/linked/pair")).json())["pending"] is not None, "the code is not spent"
    # a v3 proof is v3's own: the v2 label doesn't pass for it
    body2, _, _ = body_v3(code)
    body2["proof"] = LP.client_proof(LP.code_key(CP.normalize_code(code)), body2["code_id"], body2["nonce"], body2["name"],
                                     LINK)
    try:
        env.app["linked_pairing"].pair(body2, "192.0.2.20", {LINK}, pinned_ca=CA)
    except LP.PairError as exc:
        assert exc.code == "invalid_code"
    else:
        raise AssertionError("a v2-labelled proof passed for v3")


def test_mantel_link_straight_to_the_listener_is_the_lan_door_from_home_only():
    from aiohttp.test_utils import make_mocked_request

    from mantel_server.identity import authz

    def door(peer):
        req = make_mocked_request("GET", "/linked/ws", transport=type("T", (), {
            "get_extra_info": lambda self, k, d=None: (peer, 1234) if k == "peername" else d})())
        req["link_direct"] = True
        return authz.resolve_door(req)
    assert door("192.168.1.20") == "lan" and door("10.1.2.3") == "lan"
    assert door("1.1.1.1") == "tunnel" and door(None) == "tunnel"       # an internet address (not a documentation one)


async def test_the_connect_listener_s_real_certificate_passes_mantel_link_s_pinned_check(tmp_path):
    """What Home Assistant does (hk_core's mantel_link.pinned_tls, Python's strict X.509 checks): a handshake with
    Mantel Connect's real listener certificate, trusting Mantel's CA alone, for the listener's name."""
    import asyncio
    import ssl

    from hk_core.link.mantel_link import LINK_SERVER_NAME, pinned_context
    from mantel_server.network.connect_pairing import Pki

    pki = Pki(tmp_path / "connect")
    pki.ensure()

    async def serve(reader, writer):
        writer.write(b"ok")
        await writer.drain()
        writer.close()
    server = await asyncio.start_server(serve, "127.0.0.1", 0, ssl=pki.ssl_context())
    port = server.sockets[0].getsockname()[1]
    try:
        reader, writer = await asyncio.open_connection("127.0.0.1", port, ssl=pinned_context(pki.ca_pem),
                                                       server_hostname=LINK_SERVER_NAME)
        assert await reader.read(2) == b"ok"
        writer.close()
        other = Pki(tmp_path / "other")
        other.ensure()
        try:
            await asyncio.open_connection("127.0.0.1", port, ssl=pinned_context(other.ca_pem),
                                          server_hostname=LINK_SERVER_NAME)
        except ssl.SSLCertVerificationError:
            pass
        else:
            raise AssertionError("another Mantel's CA was accepted")
    finally:
        server.close()
        await server.wait_closed()


async def test_mantel_link_pins_the_ca_built_off_the_event_loop(tmp_path, monkeypatch):
    """MantelLink with a pinned CA: no CA is loaded while it is made (Home Assistant 2026.11 calls that a blocking call
    in the event loop); the first connection builds the context in the executor, once, the same pinning as before
    (Mantel's CA alone, TLS 1.2 or later, the listener's name), and it reaches Mantel Connect's real listener while a
    link pinned to another Mantel's CA does not."""
    import ssl
    import threading

    import aiohttp
    from aiohttp import web

    from hk_core.link import mantel_link as ML
    from mantel_server.network.connect_pairing import Pki

    pki, other = Pki(tmp_path / "connect"), Pki(tmp_path / "other")
    pki.ensure()
    other.ensure()
    built: list[threading.Thread] = []
    real = ssl.create_default_context

    def watched(*a, **kw):
        if kw.get("cadata"):
            built.append(threading.current_thread())
        return real(*a, **kw)
    monkeypatch.setattr(ML.ssl, "create_default_context", watched)

    hits: list[str] = []

    async def ws(request):
        hits.append(request.headers.get("Authorization", ""))
        raise web.HTTPForbidden()            # the handshake got through; the credential is refused
    app = web.Application()
    app.router.add_get("/linked/ws", ws)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0, ssl_context=pki.ssl_context())
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    try:
        async with aiohttp.ClientSession() as session:
            link = ML.MantelLink(session, f"https://127.0.0.1:{port}", "t", None, ca=pki.ca_pem)
            assert built == [], "a CA loaded in the event loop"
            tls = await link.tls()
            assert built and built[0] is not threading.current_thread(), "built in the executor"
            assert await link.tls() is tls and len(built) == 1, "built once"
            assert tls["server_hostname"] == ML.LINK_SERVER_NAME == "mantel-connect"
            ctx = tls["ssl"]
            assert ctx.verify_mode == ssl.CERT_REQUIRED and ctx.check_hostname
            assert ctx.minimum_version == ssl.TLSVersion.TLSv1_2
            assert ctx.get_ca_certs() == ML.pinned_context(pki.ca_pem).get_ca_certs() and len(ctx.get_ca_certs()) == 1
            try:
                await link._connect_once()
            except aiohttp.WSServerHandshakeError as err:
                assert err.status == 403 and hits == ["Bearer t"]
            else:
                raise AssertionError("the listener answered 403")
            stranger = ML.MantelLink(session, f"https://127.0.0.1:{port}", "t", None, ca=other.ca_pem)
            try:
                await stranger._connect_once()
            except aiohttp.ClientConnectorCertificateError:
                pass
            else:
                raise AssertionError("another Mantel's CA was accepted")
            assert hits == ["Bearer t"], "nothing sent to a listener the pin refused"
            assert await ML.MantelLink(session, "http://127.0.0.1:1", "t", None).tls() == {}, "no CA, no pinning"
    finally:
        await runner.cleanup()
