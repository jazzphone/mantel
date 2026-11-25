"""Slices 10.2 and 10.3: the apps' sign-in and REST door (app_auth.py, app_api.py, qr.py, migration 0017).

The "app" here is this file: a P-256 key standing in for the Secure Enclave's, DPoP proofs signed with it, and
the PKCE dance an ASWebAuthenticationSession would do. Fictional people and entities only.
"""
from __future__ import annotations

import base64
import hashlib
import secrets
import shutil
import subprocess
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from mantel_server.apps import app_auth, app_crypto
from mantel_server import qr

ROOT = Path(__file__).resolve().parents[1]


class FakeApp:
    """The phone: its device key and its tokens."""

    def __init__(self, m, key=None):
        self.m = m
        self.key = key or ec.generate_private_key(ec.SECP256R1())
        self.access = self.refresh = None

    def proof(self, method, path, access=None, iat=None, jti=None, key=None):
        k = key or self.key
        claims = {"htm": method, "htu": "https://mantel.home.example" + path, "iat": iat or self.m.now[0],
                  "jti": jti or secrets.token_urlsafe(16)}
        if access:
            claims["ath"] = app_crypto.b64u(hashlib.sha256(access.encode()).digest())
        return app_crypto.es256_jwt(k, claims, {"typ": "dpop+jwt", "jwk": app_crypto.jwk_of(k.public_key())})

    def headers(self, method, path, tunnel=False, **kw):
        h = {"Authorization": f"DPoP {self.access}", "DPoP": self.proof(method, path, access=self.access, **kw)}
        if tunnel:
            h["X-Mantel-Door"] = "tunnel"
        return h

    async def call(self, method, path, body=None, tunnel=False, **kw):
        c = self.m.client
        r = await c.request(method, path, json=body, headers=self.headers(method, path, tunnel, **kw))
        return r, (await r.json() if r.content_type == "application/json" else await r.text())

    async def token(self, body, tunnel=False, proof=True):
        h = {"DPoP": self.proof("POST", "/api/app/token")} if proof else {}
        if tunnel:
            h["X-Mantel-Door"] = "tunnel"
        r = await self.m.client.post("/api/app/token", json=body, headers=h)
        got = await r.json()
        if r.status == 200:
            self.access, self.refresh = got["access_token"], got["refresh_token"]
        return r, got


def pkce():
    verifier = secrets.token_urlsafe(48)
    return verifier, app_crypto.b64u(hashlib.sha256(verifier.encode()).digest())


async def authorize(m, challenge, state="state-12345678", device="Ann's iPhone"):
    q = {"client_id": "mantel-ios", "redirect_uri": "mantel://auth", "code_challenge": challenge,
         "code_challenge_method": "S256", "state": state, "device_name": device}
    r = await m.client.get("/app/authorize", params=q, allow_redirects=False)
    return r, q


async def sign_in_app(m, username="ann", role="adult", tunnel=False):
    if role:
        await m.user(username, role)
    await m.sign_in(username)
    verifier, challenge = pkce()
    r, q = await authorize(m, challenge)
    assert r.status == 200
    page = await r.text()
    assert "Sign In to Mantel" in page and "Ann" in page or username.title() in page
    r = await m.client.post("/app/authorize", data={**q, "csrf": m.cookie("mantel_csrf"), "decision": "allow"},
                            allow_redirects=False)
    assert r.status == 302
    loc = urlsplit(r.headers["Location"])
    assert loc.scheme == "mantel" and parse_qs(loc.query)["state"] == ["state-12345678"]
    code = parse_qs(loc.query)["code"][0]
    phone = FakeApp(m)
    r, got = await phone.token({"grant_type": "authorization_code", "code": code, "code_verifier": verifier,
                                "client_id": "mantel-ios", "redirect_uri": "mantel://auth",
                                "device": {"name": "Ann's iPhone", "model": "iPhone17,1", "platform": "iOS 27.0"}},
                               tunnel=tunnel)
    assert r.status == 200, got
    return phone, got


# -- sign-in ----------------------------------------------------------------------------------------
async def test_pkce_sign_in_gives_a_device_bound_credential(mantel):
    m = mantel
    phone, got = await sign_in_app(m)
    assert got["token_type"] == "DPoP" and got["user"]["username"] == "ann" and got["expires_in"] == 900
    assert got["refresh_expires_at"] - m.now[0] == app_auth.APP_TTL
    assert got["house"]["fingerprint"] == m.app["app_auth"].fingerprint()
    m.forget_cookies()
    r, me = await phone.call("GET", "/api/app/me")
    assert r.status == 200 and me["user"]["username"] == "ann" and me["door"] == "lan" and me["commands"] is False


async def test_thirty_days_on_the_tunnel_too(mantel):
    phone, got = await sign_in_app(mantel, tunnel=True)
    assert got["refresh_expires_at"] - mantel.now[0] == 30 * 86400
    r, me = await phone.call("GET", "/api/app/me", tunnel=True)
    assert r.status == 200 and me["door"] == "tunnel"


async def test_signed_out_the_page_is_login_first_and_a_tablet_is_refused(mantel):
    m = mantel
    _, challenge = pkce()
    r, _ = await authorize(m, challenge)
    assert r.status == 302 and r.headers["Location"].startswith("/login?next=%2Fapp%2Fauthorize%3F") or \
        r.headers["Location"].startswith("/login?next=/app/authorize")
    q = {"client_id": "evil", "redirect_uri": "mantel://auth", "code_challenge": challenge,
         "code_challenge_method": "S256", "state": "state-12345678"}
    assert (await m.client.get("/app/authorize", params=q)).status == 400
    q.update(client_id="mantel-ios", redirect_uri="https://evil.example/cb")
    assert (await m.client.get("/app/authorize", params=q)).status == 400
    q.update(redirect_uri="mantel://auth", code_challenge_method="plain")
    assert (await m.client.get("/app/authorize", params=q)).status == 400


async def test_allow_needs_the_sessions_csrf_and_cancel_says_so(mantel):
    m = mantel
    await m.user("ann", "adult")
    await m.sign_in("ann")
    _, challenge = pkce()
    _, q = await authorize(m, challenge)
    r = await m.client.post("/app/authorize", data={**q, "csrf": "forged", "decision": "allow"}, allow_redirects=False)
    assert r.status == 403
    r = await m.client.post("/app/authorize", data={**q, "csrf": m.cookie("mantel_csrf"), "decision": "deny"},
                            allow_redirects=False)
    assert r.status == 302 and "error=access_denied" in r.headers["Location"]


async def test_the_code_needs_its_verifier_once_and_a_proof(mantel):
    m = mantel
    await m.user("ann", "adult")
    await m.sign_in("ann")
    verifier, challenge = pkce()
    _, q = await authorize(m, challenge)
    r = await m.client.post("/app/authorize", data={**q, "csrf": m.cookie("mantel_csrf"), "decision": "allow"},
                            allow_redirects=False)
    code = parse_qs(urlsplit(r.headers["Location"]).query)["code"][0]
    phone = FakeApp(m)
    base = {"grant_type": "authorization_code", "code": code, "client_id": "mantel-ios", "redirect_uri": "mantel://auth"}
    r, got = await phone.token({**base, "code_verifier": verifier}, proof=False)
    assert r.status == 401 and got["error"] == "invalid_dpop_proof"
    r, got = await phone.token({**base, "code_verifier": pkce()[0]})        # the wrong verifier: the code is spent
    assert r.status == 400 and got["error"] == "invalid_grant"
    r, got = await phone.token({**base, "code_verifier": verifier})
    assert r.status == 400 and got["error"] == "invalid_grant"


async def test_a_code_runs_out_after_a_minute(mantel):
    m = mantel
    await m.user("ann", "adult")
    await m.sign_in("ann")
    verifier, challenge = pkce()
    _, q = await authorize(m, challenge)
    r = await m.client.post("/app/authorize", data={**q, "csrf": m.cookie("mantel_csrf"), "decision": "allow"},
                            allow_redirects=False)
    code = parse_qs(urlsplit(r.headers["Location"]).query)["code"][0]
    m.now[0] += 61
    r, got = await FakeApp(m).token({"grant_type": "authorization_code", "code": code, "code_verifier": verifier,
                                     "client_id": "mantel-ios", "redirect_uri": "mantel://auth"})
    assert r.status == 400


# -- the binding ------------------------------------------------------------------------------------
async def test_a_copied_token_is_useless_without_the_device_key(mantel):
    m = mantel
    phone, _ = await sign_in_app(m)
    m.forget_cookies()
    thief = FakeApp(m)
    thief.access = phone.access
    r, got = await thief.call("GET", "/api/app/me")
    assert r.status == 401 and "dpop_key" in r.headers["WWW-Authenticate"]
    r = await m.client.get("/api/app/me", headers={"Authorization": f"DPoP {phone.access}"})
    assert r.status == 401                                                    # no proof at all
    r = await m.client.get("/api/app/me", headers={"Authorization": f"Bearer {phone.access}"})
    assert r.status == 401
    # as a browser cookie it is no one
    m.set_cookies(mantel_session=phone.access)
    assert (await m.client.get("/api/session")).status == 401


async def test_proofs_are_fresh_single_use_and_for_this_request(mantel):
    m = mantel
    phone, _ = await sign_in_app(m)
    m.forget_cookies()
    jti = secrets.token_urlsafe(16)
    assert (await phone.call("GET", "/api/app/me", jti=jti))[0].status == 200
    assert (await phone.call("GET", "/api/app/me", jti=jti))[0].status == 401          # replayed
    assert (await phone.call("GET", "/api/app/me", iat=m.now[0] - 600))[0].status == 401   # stale
    h = phone.headers("GET", "/api/app/summary")                                      # a proof for another path
    assert (await m.client.get("/api/app/me", headers=h)).status == 401
    h = phone.headers("POST", "/api/app/me")                                          # another method
    assert (await m.client.get("/api/app/me", headers=h)).status == 401


async def test_refresh_rotates_with_the_device_key_and_reuse_ends_it(mantel):
    m = mantel
    phone, _ = await sign_in_app(m)
    m.forget_cookies()
    old = phone.refresh
    thief = FakeApp(m)
    r, got = await thief.token({"grant_type": "refresh_token", "refresh_token": old})
    assert r.status == 401                                                     # another key
    r, got = await phone.token({"grant_type": "refresh_token", "refresh_token": old})
    assert r.status == 200 and phone.refresh != old
    assert (await phone.call("GET", "/api/app/me"))[0].status == 200
    m.now[0] += 120
    r, got = await phone.token({"grant_type": "refresh_token", "refresh_token": old})   # the old one again: theft
    assert r.status == 400 and got["reason"] == "reuse"
    assert (await phone.call("GET", "/api/app/me"))[0].status == 401


async def test_the_refresh_cookie_path_never_rotates_an_apps_family(mantel):
    m = mantel
    phone, _ = await sign_in_app(m)
    m.forget_cookies()
    m.set_cookies(mantel_refresh=phone.refresh)
    assert (await m.client.get("/api/session")).status == 401
    m.forget_cookies()
    r, _ = await phone.token({"grant_type": "refresh_token", "refresh_token": phone.refresh})
    assert r.status == 200                                                     # not burned


# -- the house --------------------------------------------------------------------------------------
async def test_hello_proves_the_houses_key(mantel):
    m = mantel
    nonce = secrets.token_urlsafe(24)
    got = await (await m.client.get("/api/app/hello", params={"nonce": nonce})).json()
    key = app_crypto.public_from_raw(app_crypto.unb64u(got["key"]))
    assert app_crypto.fingerprint(key) == got["fingerprint"]
    assert app_crypto.es256_verify(key, app_auth.hello_message(nonce, got["fingerprint"]), app_crypto.unb64u(got["signature"]))
    assert (m.app["cfg"].data_dir / "keys" / app_auth.IDENTITY_FILE).is_file()   # a key file, not the database
    assert (await m.client.get("/api/app/hello", params={"nonce": "x"})).status == 400


async def test_addresses_owner_sets_them(mantel):
    m = mantel
    await m.user("boss", "owner")
    await m.sign_in("boss")
    r = await m.client.put("/api/app/addresses", json={"local": "https://mantel.home.example", "remote": "https://m.example.com/",
                                                        "name": "The Example House"}, headers=m.headers())
    got = await r.json()
    assert r.status == 200 and got["addresses"] == {"local": "https://mantel.home.example", "remote": "https://m.example.com"}
    r = await m.client.put("/api/app/addresses", json={"remote": "http://plain.example"}, headers=m.headers())
    assert r.status == 400
    await m.user("ann", "adult")
    m.forget_cookies()
    await m.sign_in("ann")
    r = await m.client.put("/api/app/addresses", json={"remote": None}, headers=m.headers())
    assert r.status == 403


async def test_pairing_code_works_once_on_the_home_network(mantel):
    m = mantel
    await m.user("ann", "adult")
    await m.sign_in("ann")
    r = await m.post("/api/app/pairing")
    got = await r.json()
    assert r.status == 201 and got["link"].startswith("mantel://pair?") and got["qr_svg"].startswith("<svg")
    q = parse_qs(urlsplit(got["link"]).query)
    assert q["fp"] == [m.app["app_auth"].fingerprint()] and q["l"] == [m.origin]
    phone = FakeApp(m)
    body = {"grant_type": "pairing_code", "code": q["c"][0], "client_id": "mantel-ios", "device": {"name": "iPad"}}
    r, tok = await phone.token(body, tunnel=True)
    assert r.status == 403 and tok["error"] == "lan_only"
    r = await m.post("/api/app/pairing")
    code = parse_qs(urlsplit((await r.json())["link"]).query)["c"][0]
    r, tok = await phone.token({**body, "code": code})
    assert r.status == 200 and tok["user"]["username"] == "ann"
    r, tok = await FakeApp(m).token({**body, "code": code})
    assert r.status == 400                                                     # single use


# -- the web view -----------------------------------------------------------------------------------
async def test_the_web_view_gets_its_own_session_by_a_one_time_code(mantel):
    m = mantel
    phone, _ = await sign_in_app(m)
    m.forget_cookies()
    r, got = await phone.call("POST", "/api/app/web-session", {"next": "/settings"})
    assert r.status == 200 and got["url"].startswith("/app/web-session?code=")
    r = await m.client.get(got["url"], allow_redirects=False)
    assert r.status == 302 and r.headers["Location"] == "/settings"
    s = await (await m.client.get("/api/session")).json()
    assert s["user"]["username"] == "ann"
    assert s["session_id"] != phone.m.app["sessions"].from_access(phone.access, m.now[0])["id"]   # not the app's own
    m.forget_cookies()
    assert (await m.client.get(got["url"], allow_redirects=False)).status == 400   # single use
    r, got = await phone.call("POST", "/api/app/web-session", {"next": "https://evil.example/"})
    r = await m.client.get(got["url"], allow_redirects=False)
    assert r.headers["Location"] == "/home"                                     # only a same-origin landing


# -- Me → Apps --------------------------------------------------------------------------------------
async def test_apps_are_listed_and_revoked(mantel):
    m = mantel
    phone, tok = await sign_in_app(m)
    got = await (await m.get("/api/app/devices")).json()
    assert [a["name"] for a in got["apps"]] == ["Ann's iPhone"] and got["apps"][0]["model"] == "iPhone17,1"
    assert (await m.get("/api/app/devices?all=1")).status == 403
    await m.user("bob", "adult")
    m.forget_cookies()
    await m.sign_in("bob")
    assert (await m.client.delete(f"/api/app/devices/{tok['credential_id']}", headers=m.headers())).status == 404
    await m.user("boss", "owner")
    m.forget_cookies()
    await m.sign_in("boss")
    all_apps = await (await m.get("/api/app/devices?all=1")).json()
    assert [a["user_name"] for a in all_apps["apps"]] == ["Ann"]
    assert (await m.client.delete(f"/api/app/devices/{tok['credential_id']}", headers=m.headers())).status == 200
    m.forget_cookies()
    assert (await phone.call("GET", "/api/app/me"))[0].status == 401


async def test_the_app_signs_itself_out(mantel):
    m = mantel
    phone, _ = await sign_in_app(m)
    m.forget_cookies()
    assert (await phone.call("POST", "/api/app/sign-out"))[0].status == 200
    assert (await phone.call("GET", "/api/app/me"))[0].status == 401


# -- the REST door (10.3) -----------------------------------------------------------------------------
STATES = {
    "binary_sensor.back_door": {"s": "off", "a": {"friendly_name": "Back Door"}, "lc": 1.0, "lu": 1.0},
    "light.kitchen": {"s": "on", "a": {"friendly_name": "Kitchen", "brightness": 200}, "lc": 1.0, "lu": 1.0},
    "lock.front_door": {"s": "locked", "a": {"friendly_name": "Front Door"}, "lc": 1.0, "lu": 1.0},
    "media_player.loft": {"s": "playing", "a": {"friendly_name": "Loft", "media_title": "So What",
                                                "media_artist": "Miles Davis", "volume_level": 0.3}, "lc": 1.0, "lu": 1.0},
}


async def test_favorites_and_summary_show_only_what_one_may_see(mantel):
    m = mantel
    m.app["hub"].store.states.update(STATES)
    phone, _ = await sign_in_app(m)                                   # an Adult sees the whole house
    m.forget_cookies()
    r, got = await phone.call("PUT", "/api/app/favorites", {"favorites": ["light.kitchen", "lock.front_door"]})
    assert r.status == 200
    r, got = await phone.call("PUT", "/api/app/favorites", {"favorites": ["automation.secret"]})
    assert r.status == 400
    r, got = await phone.call("PUT", "/api/app/favorites", {"favorites": ["light.kitchen"] * 2})
    assert r.status == 400
    me = (await phone.call("GET", "/api/app/me"))[1]["user"]["id"]
    m.app["user_data"].set(f"u:{me}", "hk_music_focus", {"key": "media_player.loft"})
    r, s = await phone.call("GET", "/api/app/summary")
    assert r.status == 200
    assert [f["entity_id"] for f in s["favorites"]] == ["light.kitchen", "lock.front_door"]
    assert s["favorites"][0]["attributes"]["brightness"] == 200 and s["favorites"][0]["name"] == "Kitchen"
    assert s["now_playing"]["attributes"]["media_title"] == "So What" and "group" not in s["now_playing"]
    # a group: its rooms, itself first, for Volume Up / Down (2026-11-05)
    m.app["hub"].store.states["media_player.loft"]["a"]["group_members"] = ["media_player.loft", "media_player.den", 7]
    r, s = await phone.call("GET", "/api/app/summary")
    assert s["now_playing"]["group"] == ["media_player.loft", "media_player.den"]
    del m.app["hub"].store.states["media_player.loft"]["a"]["group_members"]
    r, got = await phone.call("GET", "/api/app/favorites")
    assert got["favorites"] == ["light.kitchen", "lock.front_door"]
    # a Child with no rooms granted: the same favorites show nothing, and nothing to choose from
    kid, _ = await sign_in_app(m, "kid", "child")
    m.forget_cookies()
    await kid.call("PUT", "/api/app/favorites", {"favorites": ["light.kitchen", "lock.front_door"]})
    r, s = await kid.call("GET", "/api/app/summary")
    assert s["favorites"] == [] and s["now_playing"] is None
    r, got = await kid.call("GET", "/api/app/entities")
    assert "lock.front_door" not in [e["entity_id"] for e in got["entities"]]
    r, got = await phone.call("GET", "/api/app/entities", )
    assert {"light.kitchen", "lock.front_door"} <= {e["entity_id"] for e in got["entities"]}
    reading = [e["domain"] in ("sensor", "binary_sensor", "camera") for e in got["entities"]]
    assert any(reading) and reading == sorted(reading)      # what one switches before the readings (the cap's 500)


async def test_a_widget_chooses_from_a_kind_never_a_devices_settings(mantel):
    """/api/app/entities: never what Home Assistant files as a device's settings or health, or hides; ``domains``
    keeps the kinds a widget's Type asks for (2026-11-24, the owner: everything by room, a way to narrow it)."""
    m = mantel
    st = m.app["hub"].store.states
    st.update(STATES)
    st.update({e: {"s": "on", "a": {"friendly_name": n}, "lc": 1.0, "lu": 1.0} for e, n in (
        ("button.plug_restart", "Plug Restart"), ("sensor.plug_signal", "Plug Signal"), ("light.stray", "Stray"),
        ("switch.fountain", "Fountain"))})
    m.app["hub"].registry.entries.update({"button.plug_restart": {"entity_category": "config"},
                                          "sensor.plug_signal": {"entity_category": "diagnostic"},
                                          "light.stray": {"hidden_by": "user"}})
    phone, _ = await sign_in_app(m)
    m.forget_cookies()
    r, got = await phone.call("GET", "/api/app/entities")
    ids = {e["entity_id"] for e in got["entities"]}
    assert {"light.kitchen", "switch.fountain"} <= ids
    assert not ids & {"button.plug_restart", "sensor.plug_signal", "light.stray"}
    # each with the glyph the screens draw for it (hk_core.glyphs)
    assert {e["entity_id"]: e["glyph"] for e in got["entities"]}["lock.front_door"] == "hk:lock"
    r, got = await phone.call("GET", "/api/app/entities?domains=light,switch,nonsense")
    assert {e["domain"] for e in got["entities"]} == {"light", "switch"}
    r, got = await phone.call("GET", "/api/app/entities?domains=nonsense")      # nothing it knows: every kind
    assert "lock.front_door" in {e["entity_id"] for e in got["entities"]}


async def test_the_power_and_energy_widgets_read_the_energy_plan(mantel, monkeypatch):
    """/api/app/energy: the Power page's readings now and today's energy and cost so far (from local midnight), from
    the Energy feature's plan; 409 energy_off while the feature is off."""
    m = mantel
    st = m.app["hub"].store.states
    st.update(STATES)
    st.update({"sensor.house_power": {"s": "1520", "a": {"unit_of_measurement": "W"}, "lc": 1.0, "lu": 1.0},
               "sensor.solar_power": {"s": "unavailable", "a": {"unit_of_measurement": "W"}, "lc": 1.0, "lu": 1.0},
               "sensor.wall_charge": {"s": "82", "a": {"unit_of_measurement": "%"}, "lc": 1.0, "lu": 1.0}})
    host = m.app["features"]
    phone, _ = await sign_in_app(m)
    m.forget_cookies()
    monkeypatch.setattr(host, "on", lambda k: False)
    r, got = await phone.call("GET", "/api/app/energy")
    assert r.status == 409 and got["error"] == "energy_off"
    monkeypatch.setattr(host, "on", lambda k: k == "energy")
    host.energy_cache = {"total": {"stat": "sensor.grid_energy", "cost": "sensor.grid_cost"},
                         "power": {"home": "sensor.house_power", "solar": "sensor.solar_power",
                                   "grid": "sensor.house_power", "battery": {"level": "sensor.wall_charge"}}}
    asked = []

    class Proxy:
        async def request(self, msg):
            asked.append(msg)
            if msg["type"] == "energy/get_prefs":
                return {"energy_sources": []}
            return {"sensor.grid_energy": [{"start": 1795496400000.0, "change": 1.5},
                                           {"start": "2026-11-24T06:00:00+00:00", "change": 2.25}],
                    "sensor.grid_cost": [{"change": 0.504}]}

        async def close(self):
            pass
    monkeypatch.setattr(m.app["hub"], "readproxy", Proxy(), raising=False)
    r, got = await phone.call("GET", "/api/app/energy")
    assert r.status == 200
    # the solar reads no number and the grid is the house's own meter again: neither shown twice or as nothing
    assert [(p["key"], p["value"], p["unit"]) for p in got["power"]] == [("home", 1520.0, "W"), ("battery", 82.0, "%")]
    assert got["today"] == {"energy": 3.75, "unit": "kWh", "cost": 0.5,      # today's hours, the bars (ms or an ISO time)
                            "hours": [[1795496400.0, 1.5], [1795500000.0, 2.25]]}
    assert asked[0]["type"] == "recorder/statistics_during_period" and asked[0]["types"] == ["change"]
    assert asked[0]["statistic_ids"] == ["sensor.grid_energy", "sensor.grid_cost"]
    # ?rings=1: today's Energy Rings, from Home Assistant's Energy settings and the last days' statistics
    r, got = await phone.call("GET", "/api/app/energy?rings=1")
    # (the cost rows carry no hour: no ring for it)
    assert [x["key"] for x in got["rings"]] == ["energy"] and asked[-2]["type"] == "energy/get_prefs"
    assert asked[-1]["statistic_ids"] == ["sensor.grid_energy", "sensor.grid_cost"]
    # ?devices=1: what each device uses now, biggest first (CarPlay's Using Now): one row per power sensor, kW as
    # thousands of W, nothing for a device reading zero or no number
    st.update({"sensor.oven_power": {"s": "2.1", "a": {"unit_of_measurement": "kW"}, "lc": 1.0, "lu": 1.0},
               "sensor.tv_power": {"s": "140", "a": {"unit_of_measurement": "W"}, "lc": 1.0, "lu": 1.0},
               "sensor.idle_power": {"s": "0", "a": {"unit_of_measurement": "W"}, "lc": 1.0, "lu": 1.0}})
    host.energy_cache["devices"] = {
        "sensor.tv_power": {"key": "tv", "name": "TV", "power": "sensor.tv_power", "parent": None},
        "sensor.tv_energy": {"key": "tv", "name": "TV", "power": "sensor.tv_power", "parent": None},
        "sensor.oven_power": {"key": "oven", "name": "Oven", "power": "sensor.oven_power", "parent": "kitchen"},
        "sensor.idle_power": {"key": "idle", "name": "Idle", "power": "sensor.idle_power", "parent": None}}
    r, got = await phone.call("GET", "/api/app/energy?devices=1")
    assert [(d["name"], d["value"], d["unit"], d["parent"]) for d in got["devices"]] == [
        ("Oven", 2.1, "kW", "kitchen"), ("TV", 140.0, "W", None)]
    r, got = await phone.call("GET", "/api/app/energy")
    assert "devices" not in got


async def test_the_laundry_widget_reads_each_machine_and_its_held_done(mantel, monkeypatch):
    """/api/app/laundry: each machine the person may view by what says it runs, its state, when it ends, and Done held."""
    m = mantel
    st = m.app["hub"].store.states
    now = float(m.app["clock"]())
    st.update({"sensor.washer_status": {"s": "run", "a": {}, "lc": 1.0, "lu": 1.0},
               "sensor.washer_left": {"s": "84", "a": {"unit_of_measurement": "min"}, "lc": 1.0, "lu": 1.0},
               "sensor.washer_progress": {"s": "40", "a": {}, "lc": 1.0, "lu": 1.0},
               "sensor.dryer_power": {"s": "2", "a": {"unit_of_measurement": "W"}, "lc": 1.0, "lu": 1.0}})
    host = m.app["laundry"]
    base = {"area": None, "watts": 10, "phase": None, "door": None, "remote": None, "leak": None, "running": None}
    monkeypatch.setattr(host, "machines", [
        dict(base, id="washer", name="Washer", kind="washer", status="sensor.washer_status", time="sensor.washer_left",
             progress="sensor.washer_progress", power=None),
        dict(base, id="dryer", name="Dryer", kind="dryer", status=None, time=None, progress=None, power="sensor.dryer_power")])
    monkeypatch.setattr(host, "latches", {"dryer": {"since": now - 600, "words": "Done"}})
    phone, _ = await sign_in_app(m)
    m.forget_cookies()
    r, got = await phone.call("GET", "/api/app/laundry")
    assert r.status == 200
    w, d = got["machines"]
    assert w["state"] == "running" and abs(w["ends"] - (now + 84 * 60)) < 2 and w["progress"] == 40 and w["done_since"] is None
    assert d["state"] == "done" and d["ends"] is None and d["done_since"] == now - 600


async def test_the_live_tv_widget_reads_the_channels_live_tv_lists(mantel, monkeypatch):
    """/api/app/tv: Live TV's own channel list (its rule decides who sees which), each with its logo and what is on."""
    m = mantel
    m.app["hub"].store.states["sensor.tv_nbc_now"] = {"s": "The News", "lc": 1.0, "lu": 1.0, "a": {
        "logo": "https://img.example/nbc.png", "start": "2026-11-24T18:00:00+00:00", "end": "2026-11-24T18:30:00+00:00"}}

    class Live:
        async def channel_list(self, ctx, msg):
            assert msg == {"type": "hk_tv/channels"} and ctx.identity is not None
            return {"configured": True, "channels": [{"number": "4.1", "name": "NBC", "camera": "camera.tv_nbc",
                                                      "now": "sensor.tv_nbc_now"}]}
    monkeypatch.setitem(m.app, "live_tv", Live())
    phone, _ = await sign_in_app(m)
    m.forget_cookies()
    r, got = await phone.call("GET", "/api/app/tv")
    assert r.status == 200 and got["configured"]
    c = got["channels"][0]
    assert (c["number"], c["name"], c["title"], c["logo"]) == ("4.1", "NBC", "The News", "https://img.example/nbc.png")


async def test_the_widgets_read_chosen_states_and_the_timers_only_as_one_may_see(mantel):
    """/api/app/states: the HomeView widgets made for one thing (an accessory, a thermostat, the doors and locks, the
    timers) read just those states, the Summary's way: view on each, the order asked."""
    m = mantel
    m.app["hub"].store.states.update(STATES)
    m.app["hub"].store.states.update({
        "timer.pasta": {"s": "active", "a": {"friendly_name": "Pasta", "duration": "0:10:00",
                                             "finishes_at": "2026-11-23T20:30:00+00:00"}, "lc": 1.0, "lu": 1.0},
        "timer.tea": {"s": "active", "a": {"friendly_name": "Tea", "finishes_at": "2026-11-23T20:05:00+00:00"},
                      "lc": 1.0, "lu": 1.0},
        "timer.done": {"s": "idle", "a": {"friendly_name": "Done"}, "lc": 1.0, "lu": 1.0}})
    phone, _ = await sign_in_app(m)
    m.forget_cookies()
    r, got = await phone.call("GET", "/api/app/states?ids=lock.front_door,light.kitchen,light.nowhere")
    assert r.status == 200 and [e["entity_id"] for e in got["states"]] == ["lock.front_door", "light.kitchen"]
    assert got["states"][1]["attributes"]["brightness"] == 200
    r, got = await phone.call("GET", "/api/app/states?domain=timer")
    assert [e["entity_id"] for e in got["states"]] == ["timer.tea", "timer.pasta"]          # soonest first, idle left out
    assert got["states"][1]["attributes"]["finishes_at"] == "2026-11-23T20:30:00+00:00"
    for bad in ("", "?ids=", "?ids=" + ",".join(f"light.l{i}" for i in range(30)), "?ids=Light.X", "?domain=lock",
                "?ids=light.kitchen&domain=timer"):
        r, _ = await phone.call("GET", "/api/app/states" + bad)
        assert r.status == 400, bad
    kid, _ = await sign_in_app(m, "kid", "child")                     # a Child with no rooms granted: nothing
    m.forget_cookies()
    r, got = await kid.call("GET", "/api/app/states?ids=lock.front_door,light.kitchen")
    assert r.status == 200 and got["states"] == []
    r, got = await kid.call("GET", "/api/app/states?domain=timer")
    assert got["states"] == []
    assert (await m.client.get("/api/app/states?ids=light.kitchen")).status == 401


async def test_the_sensor_widget_reads_a_days_graph_only_with_history_on_it(mantel):
    """/api/app/history: a reading's last hours averaged into at most HISTORY_POINTS points, through Home Assistant's
    history with ``history`` on the reading (not just view); a word for a state answers no points."""
    from mantel_server.apps import app_api as A
    m = mantel
    m.app["hub"].store.states.update({
        "sensor.living_room_temperature": {"s": "70.5", "a": {"friendly_name": "Living Room", "unit_of_measurement": "°F"},
                                           "lc": 1.0, "lu": 1.0},
        "sensor.washer": {"s": "Rinse", "a": {"friendly_name": "Washer"}, "lc": 1.0, "lu": 1.0}})
    now = m.now[0]

    class History:
        def __init__(self):
            self.asked = []

        async def close(self):
            pass

        async def request(self, msg, *, server_read=False):
            self.asked.append(msg)
            eid = msg["entity_ids"][0]
            if eid == "sensor.washer":
                return {eid: [{"s": "Wash", "lu": now - 600}, {"s": "Rinse", "lu": now - 60}]}
            return {eid: [{"s": "68", "a": {}, "lu": now - 30 * 3600},             # from before the window: its start
                          {"s": "69", "lu": now - 3600}, {"s": "71", "lu": now - 3500},
                          {"s": "unavailable", "lu": now - 100}, {"s": "70.5", "lu": now - 10}]}
    m.app["hub"].readproxy = ha = History()
    phone, _ = await sign_in_app(m)
    m.forget_cookies()
    r, got = await phone.call("GET", "/api/app/history?id=sensor.living_room_temperature")
    assert r.status == 200 and got["unit"] == "°F" and got["hours"] == 24
    assert [p[1] for p in got["points"]] == [68.0, 70.0, 70.5]       # the hour before now: 69 and 71 averaged
    assert got["points"][0][0] < got["points"][1][0] < got["points"][2][0] <= now
    asked = ha.asked[-1]
    assert asked["entity_ids"] == ["sensor.living_room_temperature"] and asked["minimal_response"] is True
    r, got = await phone.call("GET", "/api/app/history?id=sensor.washer&hours=2")
    assert r.status == 200 and got["points"] == []
    for bad in ("", "?id=light.kitchen", "?id=sensor.x&hours=0", "?id=sensor.x&hours=500", "?id=Sensor.X",
                "?id=sensor.x&hours=a"):
        r, _ = await phone.call("GET", "/api/app/history" + bad)
        assert r.status == 400, bad
    kid, _ = await sign_in_app(m, "kid", "child")
    m.forget_cookies()
    before = len(ha.asked)
    r, _ = await kid.call("GET", "/api/app/history?id=sensor.living_room_temperature")
    assert r.status == 403 and len(ha.asked) == before               # never asked Home Assistant
    assert (await m.client.get("/api/app/history?id=sensor.living_room_temperature")).status == 401
    assert len(A.history_points([{"s": str(i), "lu": now - i} for i in range(5000)], now - 86400, now)) <= A.HISTORY_POINTS


async def test_commands_are_off_unless_the_operator_turned_them_on(mantel):
    m = mantel
    phone, _ = await sign_in_app(m)
    m.forget_cookies()
    r, got = await phone.call("POST", "/api/app/command", {"domain": "light", "service": "turn_off",
                                                            "entity_id": "light.kitchen"})
    assert r.status == 503 and got["error"] == "commands_disabled"


class StubGateway:
    def __init__(self, answer):
        self.answer, self.seen = answer, []

    async def handle(self, principal, msg, send):
        self.seen.append((principal, msg))
        await send({"id": msg["id"], **self.answer})


async def test_a_command_goes_through_the_gateway_as_that_person(mantel, monkeypatch):
    m = mantel
    phone, _ = await sign_in_app(m)
    m.forget_cookies()
    gw = StubGateway({"type": "command_result", "result": None, "audit_id": 7})
    monkeypatch.setitem(m.app._state, "gateway", gw)
    body = {"domain": "light", "service": "turn_off", "entity_id": "light.kitchen"}
    r, got = await phone.call("POST", "/api/app/command", body, tunnel=True)
    assert r.status == 200 and got["audit_id"] == 7
    principal, msg = gw.seen[0]
    assert principal.user.username == "ann" and principal.door == "tunnel" and principal.subject.door == "tunnel"
    assert msg == {"type": "command", "id": 1, "kind": "service", "domain": "light", "service": "turn_off",
                   "target": {"entity_id": "light.kitchen"}, "data": {}}
    gw.answer = {"type": "command_result", "error": {"code": "forbidden", "reason": "no_grant"}, "audit_id": 8}
    r, got = await phone.call("POST", "/api/app/command", body)
    assert r.status == 403 and got == {"error": "forbidden", "reason": "no_grant", "audit_id": 8}
    r, got = await phone.call("POST", "/api/app/command", {**body, "target": {"area_id": "all"}})
    assert r.status == 400                                                    # one entity, nothing else


# -- the QR code --------------------------------------------------------------------------------------
def test_qr_sizes_and_function_patterns():
    for text, size in (("hi", 21), ("x" * 100, 41), ("x" * 300, 69)):
        m = qr.encode(text)
        assert len(m) == size and all(len(r) == size for r in m)
        assert all(m[0][i] for i in range(7)) and all(m[i][0] for i in range(7))    # a finder pattern's edge
        assert [m[6][i] for i in range(8, size - 8)] == [i % 2 == 0 for i in range(8, size - 8)]   # timing


@pytest.mark.skipif(shutil.which("swiftc") is None, reason="needs the Mac's QR reader (CoreImage)")
def test_qr_reads_back_with_the_macs_own_reader(tmp_path):
    from PIL import Image
    reader = tmp_path / "readqr.swift"
    reader.write_text('import CoreImage\nimport Foundation\nlet img = CIImage(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))!\n'
                      'let d = CIDetector(ofType: CIDetectorTypeQRCode, context: nil, options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])!\n'
                      'for f in d.features(in: img) { if let q = f as? CIQRCodeFeature { print(q.messageString ?? "") } }\n')
    exe = tmp_path / "readqr"
    if subprocess.run(["swiftc", "-O", str(reader), "-o", str(exe)], capture_output=True).returncode != 0:
        pytest.skip("swiftc could not build the reader")
    link = "mantel://pair?v=1&l=https%3A%2F%2Fmantel.home.example&fp=" + "A" * 43 + "&c=" + "b" * 43 + "&n=Example"
    m = qr.encode(link)
    s, b = 6, 4
    n = len(m) + 2 * b
    img = Image.new("L", (n * s, n * s), 255)
    for y, row in enumerate(m):
        for x, v in enumerate(row):
            if v:
                img.paste(0, ((x + b) * s, (y + b) * s, (x + b + 1) * s, (y + b + 1) * s))
    img.save(tmp_path / "qr.png")
    out = subprocess.run([str(exe), str(tmp_path / "qr.png")], capture_output=True, text=True).stdout.strip()
    assert out == link


def test_migration_0017_makes_the_tables():
    sql = (ROOT / "hosts/server/mantel_server/migrations/0017_app.sql").read_text()
    for t in ("app_credentials", "apple_links", "app_settings"):
        assert f"CREATE TABLE {t}" in sql


# -- the app's notifications (10.5) -------------------------------------------------------------------
async def test_an_apps_notification_is_sealed_to_the_phone(mantel, tmp_path):
    import json as _json
    from mantel_server import apns, push
    m = mantel
    phone, tok = await sign_in_app(m)
    m.forget_cookies()
    note_key = ec.generate_private_key(ec.SECP256R1())
    body = {"token": "ab" * 32, "key": app_crypto.b64u(app_crypto.raw_public(note_key.public_key())), "env": "sandbox"}
    r, got = await phone.call("POST", "/api/app/push/register", body)
    assert r.status == 201
    sent = []

    async def transport(url, headers, data):
        sent.append((url, headers, data))
        return 200, {}
    secrets_dir = m.app["cfg"].secrets_dir
    secrets_dir.mkdir(parents=True, exist_ok=True)            # the operator's folder, where Apple's key goes
    sender = m.app["apns"]
    sender.transport = transport
    p = m.app["pusher"]
    msg = push.Message(title="Front Door", body="Opened", tag="door", important=True, entity="lock.front_door")
    assert await p.deliver(p.recipients({"type": "notification"}), msg) == {"skipped": 1}     # no key yet: nothing sent
    apple_key = ec.generate_private_key(ec.SECP256R1())
    from cryptography.hazmat.primitives import serialization
    (secrets_dir / apns.KEY_FILE).write_bytes(apple_key.private_bytes(serialization.Encoding.PEM,
                                              serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    (secrets_dir / apns.CONF_FILE).write_text(_json.dumps({"key_id": "KEY123", "team_id": "TEAM123",
                                                           "topic": "com.example.mantel"}))
    assert await p.deliver(p.recipients({"type": "notification"}), msg) == {"ok": 1}
    url, headers, data = sent[0]
    assert url == "https://api.sandbox.push.apple.com/3/device/" + "ab" * 32
    assert headers["apns-topic"] == "com.example.mantel" and headers["apns-push-type"] == "alert"
    claims = app_crypto.verify_es256_jwt(headers["authorization"][7:], apple_key.public_key())
    assert claims["iss"] == "TEAM123"
    payload = _json.loads(data)
    assert payload["aps"]["alert"] == {"title": "Mantel", "body": "New notification"}       # nothing readable to Apple
    assert payload["aps"]["interruption-level"] == "time-sensitive" and payload["aps"]["mutable-content"] == 1
    assert b"Front Door" not in data
    inner = _json.loads(app_crypto.open_sealed(payload["m"], note_key))
    assert inner["title"] == "Front Door" and inner["entity"] == "lock.front_door"
    # signing the app out removes its push target
    assert (await phone.call("POST", "/api/app/sign-out"))[0].status == 200
    assert p.targets.everyone() == []


async def test_a_notifications_snapshot_follows_the_screens_rule(mantel):
    m = mantel
    phone, _ = await sign_in_app(m)
    m.forget_cookies()
    store = m.app["features"].snaps
    sid = store.put(b"\xff\xd8fictional", "image/jpeg", "camera.doorbell")
    calls = []
    m.app["authz"].may_still = lambda p, cam: calls.append(cam) or True
    r = await m.client.get("/api/app/snap", params={"id": sid}, headers=phone.headers("GET", "/api/app/snap"))
    assert r.status == 200 and await r.read() == b"\xff\xd8fictional" and calls == ["camera.doorbell"]
    m.app["authz"].may_still = lambda p, cam: False
    assert (await phone.call("GET", "/api/app/snap?id=" + sid))[0].status == 404
    assert (await phone.call("GET", "/api/app/snap?id=" + "0" * 32))[0].status == 404


async def test_the_summary_gives_a_players_artwork_without_has_token(mantel):
    m = mantel
    m.app["hub"].store.states.update({
        "media_player.loft": {"s": "playing", "a": {"friendly_name": "Loft", "entity_picture":
                              "/api/media_player_proxy/media_player.loft?token=SECRET&cache=abc"}, "lc": 1.0, "lu": 1.0},
        "media_player.den": {"s": "playing", "a": {"friendly_name": "Den", "entity_picture": "https://cdn.example/cover.jpg"},
                             "lc": 1.0, "lu": 1.0}})
    phone, _ = await sign_in_app(m)
    m.forget_cookies()
    await phone.call("PUT", "/api/app/favorites", {"favorites": ["media_player.loft", "media_player.den"]})
    r, s = await phone.call("GET", "/api/app/summary")
    arts = {f["entity_id"]: f["art"] for f in s["favorites"]}
    assert arts["media_player.den"] == "https://cdn.example/cover.jpg"
    assert arts["media_player.loft"].startswith("/api/app/art?entity=media_player.loft&v=")
    assert "SECRET" not in str(s)                      # HA's artwork token never leaves Mantel


async def test_the_consent_page_lets_its_own_form_carry_its_origin(mantel):
    """Under Referrer-Policy no-referrer a browser POSTs with Origin: null, which Mantel refuses ("bad Origin")."""
    m = mantel
    await m.user("ann", "adult")
    await m.sign_in("ann")
    _, challenge = pkce()
    r, q = await authorize(m, challenge)
    assert r.status == 200 and r.headers["Referrer-Policy"] == "same-origin"
    # and what a no-referrer page would have sent is indeed refused
    r = await m.client.post("/app/authorize", data={**q, "csrf": m.cookie("mantel_csrf"), "decision": "allow"},
                            headers={"Origin": "null"}, allow_redirects=False)
    assert r.status == 403 and "bad Origin" in await r.text()


async def test_a_pairing_code_goes_with_the_session_that_made_it(mantel):
    """A code made before a password reset still minted a 30-day app credential after it: the reset ends the
    person's sessions, and now the codes they made too."""
    m = mantel
    await m.user("avery", "owner")
    victim = await m.user("casey", "adult")
    await m.sign_in("casey")
    link = (await (await m.post("/api/app/pairing")).json())["link"]
    code = parse_qs(urlsplit(link).query)["c"][0]
    m.forget_cookies()
    await m.sign_in("avery")
    r = await m.post(f"/api/users/{victim}/password", {"password": "brand new passphrase"})
    assert r.status == 200
    m.forget_cookies()
    r, tok = await FakeApp(m).token({"grant_type": "pairing_code", "code": code, "client_id": "mantel-ios"})
    assert r.status == 400 and tok["error"] == "invalid_grant"


async def test_the_apps_web_view_is_not_a_sign_in_made_just_now(mantel):
    """Every web view the app opened counted as a fresh sign-in for the credential's 30 days: step-up-gated
    changes from away with nothing typed. It must Confirm It Is You like any other session."""
    m = mantel
    await m.user("avery", "owner")
    victim = await m.user("casey", "adult")
    phone, _ = await sign_in_app(m, "avery", role=None)
    m.now[0] += 20 * 86400
    r, got = await phone.token({"grant_type": "refresh_token", "refresh_token": phone.refresh})
    assert r.status == 200, got
    m.forget_cookies()
    r, got = await phone.call("POST", "/api/app/web-session", {"next": "/settings"}, tunnel=True)
    r = await m.client.get(got["url"], allow_redirects=False, headers={"X-Mantel-Door": "tunnel"})
    assert r.status == 302
    s = await (await m.client.get("/api/session", headers={"X-Mantel-Door": "tunnel"})).json()
    assert s["door"] == "tunnel" and s["fresh_factor_at"] is None
    r = await m.client.post(f"/api/users/{victim}/password", json={"password": "brand new passphrase"},
                            headers={"X-Mantel-Door": "tunnel", "X-CSRF-Token": s["csrf"]})
    assert r.status == 403 and (await r.json())["error"] == "step_up_required"


async def test_each_web_view_replaces_the_apps_last_and_goes_with_the_app(mantel):
    """The app keeps its web view's cookies only while it runs: every launch's web session stayed for 30 days in
    My Sessions ("Browser on iPhone", again and again), and signing the app out left them working."""
    m = mantel
    phone, tok = await sign_in_app(m)
    mgr = m.app["sessions"]

    async def open_web_view():
        m.forget_cookies()
        r, got = await phone.call("POST", "/api/app/web-session", {"next": "/settings"})
        assert (await m.client.get(got["url"], allow_redirects=False)).status == 302
        return (await (await m.client.get("/api/session")).json())["session_id"]

    first = await open_web_view()
    second = await open_web_view()
    assert mgr.get(first) is None and mgr.get(second) is not None
    listed = (await (await m.client.get("/api/sessions")).json())["sessions"]
    assert [s["id"] for s in listed if s["method"] == "app-web"] == [second]       # only this one, as This Browser
    assert "app" not in {s["method"] for s in listed} and all("parent_id" not in s for s in listed)
    m.forget_cookies()
    await m.sign_in("ann")
    listed = (await (await m.client.get("/api/sessions")).json())["sessions"]
    assert {s["method"] for s in listed} == {"password"}                            # the app is under Mantel App
    assert (await m.client.delete(f"/api/app/devices/{tok['credential_id']}", headers=m.headers())).status == 200
    assert mgr.get(second) is None


def test_migration_0022_ends_the_web_views_it_cannot_place(tmp_path):
    import sqlite3
    from mantel_server.storage import db
    conn = sqlite3.connect(tmp_path / "m.db")
    conn.row_factory = sqlite3.Row
    found = [x for x in db.discover() if x.version < 22]
    folder = tmp_path / "mig"
    folder.mkdir()
    for x in found:
        shutil.copy(db.MIGRATIONS / f"{x.version:04d}_{x.name}.sql", folder)
    db.migrate(conn, folder)
    conn.execute("INSERT INTO users (id, name, role, kind, created, updated) VALUES ('u1', 'Ann', 'adult', 'hk', 1, 1)")
    for sid, method in (("w1", "app-web"), ("p1", "password")):
        conn.execute("INSERT INTO sessions (id, user_id, door, method, csrf, created, expires) VALUES (?, 'u1', 'lan', ?, 'c', 1, 9e12)",
                     (sid, method))
    conn.commit()
    db.migrate(conn)
    got = {r["id"]: (r["revoked"] is not None, r["revoked_reason"]) for r in conn.execute("SELECT * FROM sessions")}
    assert got == {"w1": (True, "app_web_replaced"), "p1": (False, None)}
