"""New ways to sign in as someone, or to widen what Mantel trusts, ask what the older ways ask (the audit's second
pass, AUTH-1..6): a fresh factor away from home, the home door for a wall tablet, the sessions a link made ending
with it, a handed-out session ending with its parent. Fictional people and HA users; no Home Assistant is contacted.
"""
from mantel_server import frame_origins as FO
from mantel_server import server_settings as SS
from mantel_server.apps.app_auth import APP_METHOD, APP_TTL, WEB_METHOD

HA_X = "c" * 32            # a fictional Home Assistant user id (the attacker's own HA account, say)


def _cookies(m, issued):
    m.forget_cookies()
    m.client.session.cookie_jar.update_cookies({"mantel_session": issued.access, "mantel_csrf": issued.csrf},
                                               response_url=m.client.make_url("/"))


async def _stale_tunnel_owner(m, name="avery"):
    """An Owner's session from away whose sign-in factor is ten minutes old (a cookie someone else holds)."""
    uid = await m.user(name, "owner")
    issued = m.app["sessions"].create(uid, "tunnel", "passkey")
    _cookies(m, issued)
    m.now[0] += 600
    return uid


async def _sign_in_with_ha(m, monkeypatch, ha_user):
    """auth.callback with HA's answers faked (no Home Assistant is contacted): the session it makes, or None."""
    from mantel_server.identity import auth
    from mantel_server.ha.ha_oauth import HaOAuth

    async def exchange(self, http, code):
        return {"access_token": "fictional-access", "refresh_token": "fictional-refresh"}

    async def current(self, http, token):
        return {"id": ha_user, "name": "Whoever holds that HA account"}

    async def revoke(self, http, token):
        return None
    monkeypatch.setattr(HaOAuth, "exchange_code", exchange)
    monkeypatch.setattr(HaOAuth, "current_user", current)
    monkeypatch.setattr(HaOAuth, "revoke", revoke)
    m.forget_cookies()
    state = "s" * 32
    auth._remember_state(m.app, state, m.now[0])
    m.client.session.cookie_jar.update_cookies(
        {auth.STATE_COOKIE: auth.make_state_cookie(m.app["state_secret"], state, m.now[0])},
        response_url=m.client.make_url("/auth/"))
    r = await m.client.get("/auth/callback", params={"code": "fictional", "state": state},
                           headers={"X-Mantel-Door": "tunnel"}, allow_redirects=False)
    got = r.cookies.get(auth.SESSION_COOKIE)
    return m.app["sessions"].from_access(got.value, door="tunnel") if got is not None else None


async def test_linking_an_ha_user_to_a_person_needs_the_fresh_factor_adding_a_sign_in_needs(mantel, monkeypatch):
    """AUTH-1: a stale Owner cookie from away linked an HA account of its holder's choosing to the Owner; that
    account's "Sign in with Home Assistant" then made a fresh Owner session."""
    m = mantel
    owner = await _stale_tunnel_owner(m)
    # the rule for every other new way to sign in as this person: refused without a fresh factor
    r = await m.post("/api/auth/totp/enroll", tunnel=True)
    assert r.status == 403 and (await r.json())["error"] == "step_up_required"
    # ... but an HA user of the holder's choosing is linked to the Owner with the same stale cookie
    r = await m.client.put("/api/people/ha", json={"ha_user": HA_X, "user_id": owner}, headers=m.headers(tunnel=True))
    linked = m.store.get_link(HA_X)
    row = await _sign_in_with_ha(m, monkeypatch, HA_X) if linked is not None else None
    assert r.status == 403 and linked is None, (
        f"AUTH-1: {r.status}; HA user {HA_X[:6]}… then signed in with Home Assistant from away as "
        f"{row and row['user_role']}, fresh factor {row and row['fresh_factor']!r} at {row and row['fresh_factor_at']}")


async def test_merging_an_ha_account_into_a_person_needs_a_fresh_factor_too(mantel):
    """AUTH-1: a merge moves the HA link to the person it merges into: the same rule."""
    m = mantel
    owner = await _stale_tunnel_owner(m)
    dup = m.store.link(HA_X, "guest", "Guest (HA)")             # an account made for an HA user by role
    r = await m.client.post(f"/api/users/{dup}/merge", json={"into": owner}, headers=m.headers(tunnel=True))
    linked = m.store.get_link(HA_X)
    assert r.status == 403 and linked["user_id"] == dup, (
        f"AUTH-1 (merge): {r.status}; the guest's HA user now signs in as {linked['role']}")


async def test_a_wall_tablet_is_linked_on_the_home_door_only(mantel):
    """AUTH-2: every other way of making an HA user a wall tablet refuses off the home door; this route did not."""
    m = mantel
    owner = await _stale_tunnel_owner(m)
    dev = m.app["devices"].enroll("Kitchen", "wall_tablet", None, owner)[0]
    # enrolling a tablet is LAN-only (devices.enroll), and so is linking one on Ingress (its guard: door="home")
    r = await m.client.put(f"/api/devices/{dev}/ha-user", json={"ha_user": HA_X}, headers=m.headers(tunnel=True))
    row = m.store.db.execute("SELECT device_id FROM ha_tablet_links WHERE ha_user_id = ?", (HA_X,)).fetchone()
    assert r.status == 403 and row is None, (
        f"AUTH-2: {r.status}; HA user {HA_X[:6]}… is now the wall tablet {dev} (the LAN door's rules on the sidebar)")


async def test_unlinking_an_ha_user_ends_its_sign_in_with_home_assistant_sessions(mantel):
    """AUTH-3: unlinking ended the person's Ingress sessions only."""
    m = mantel
    await m.user("avery", "owner")
    await m.sign_in("avery")
    sam = await m.user("sam", "adult")
    r = await m.client.put("/api/people/ha", json={"ha_user": HA_X, "user_id": sam}, headers=m.headers())
    assert r.status == 200
    # what auth.callback makes when HA user X signs in with Home Assistant (method "ha", a fresh factor)
    via_ha = m.app["sessions"].create(sam, "lan", "ha")
    r = await m.client.put("/api/people/ha", json={"ha_user": HA_X, "user_id": None}, headers=m.headers())
    assert r.status == 200 and m.store.get_link(HA_X) is None
    still = m.app["sessions"].from_access(via_ha.access, door="lan")
    assert still is None, ("AUTH-3: the HA user is unlinked, but its Sign in with Home Assistant session still "
                           f"works as {still['user_name']} ({still['user_role']})")


async def test_the_apps_web_view_session_ends_with_the_app(mantel):
    """AUTH-4: the web view's session got the door's own lifetime, past its app credential's, and no list
    showed it."""
    m = mantel
    uid = await m.user("avery", "adult")
    mgr = m.app["sessions"]
    app_cred = mgr.create(uid, "tunnel", APP_METHOD, ttl=APP_TTL)
    m.now[0] += APP_TTL - 3600                     # the app opens its web view on its last day
    web_view = mgr.create(uid, "lan", WEB_METHOD, fresh=False, parent=app_cred.session_id)   # app_auth.web_session
    m.now[0] += 2 * 3600                           # the app's credential has expired
    assert mgr.get(app_cred.session_id) is None
    await m.sign_in("avery")
    shown = [s["id"] for s in (await (await m.get("/api/sessions")).json())["sessions"]]
    apps = (await (await m.get("/api/app/devices")).json()).get("apps", [])
    alive = mgr.get(web_view.session_id) is not None
    assert not alive, (f"AUTH-4: the web view's session lives on without its app (until "
                       f"{(mgr.get(web_view.session_id)['expires'] - m.now[0]) / 86400:.0f} more days); "
                       f"listed in Sessions: {web_view.session_id in shown}, apps listed: {len(apps)}")


async def test_a_frame_origin_needs_the_same_fresh_factor_as_the_sign_in_address(mantel):
    """AUTH-5: the Sign-In Address (a frame origin too) asked for a fresh factor away from home; adding the same origin
    directly did not."""
    m = mantel
    await _stale_tunnel_owner(m)
    r = await m.client.put(SS.API, json={"key": "ha_sign_in_url", "value": "https://frames.example"},
                           headers=m.headers(tunnel=True))
    assert r.status == 403 and (await r.json())["error"] == "step_up_required"
    r = await m.client.post(FO.API, json={"origin": "https://frames.example"}, headers=m.headers(tunnel=True))
    allowed = FO.ancestors(m.app)
    assert r.status == 403 and "https://frames.example" not in allowed, (
        f"AUTH-5: {r.status}; https://frames.example may now frame Mantel (frame-ancestors {allowed})")


async def test_moving_a_tablet_to_another_ha_user_does_not_revoke_it(mantel):
    """AUTH-6: api_device_ha_user unlinks the tablet's current HA user BEFORE linking the new one;
    a device made for that earlier link (own_device) is revoked by the unlink, so the link then fails and the
    tablet is gone."""
    from mantel_server import ingress
    from mantel_server.identity.sessions import User
    m = mantel
    uid = await m.user("avery", "owner")
    await m.sign_in("avery")                                          # at home: the LAN door
    actor = User(id=uid, name="Avery", role="owner", kind="hk", username="avery", ha_user_id=None)
    dev = ingress.link_tablet(m.app, "a" * 32, actor, name="Kitchen")["device"]["id"]   # as the Ingress page does
    r = await m.client.put(f"/api/devices/{dev}/ha-user", json={"ha_user": "b" * 32}, headers=m.headers())
    revoked = m.store.db.execute("SELECT revoked FROM devices WHERE id = ?", (dev,)).fetchone()[0]
    assert r.status == 200 and revoked is None, f"AUTH-6: {r.status} {await r.json()}; the tablet revoked: {revoked}"


# -- the third audit pass (SRV-8): a role that signs in as an Owner or Admin asks for the fresh factor ----------
async def test_a_role_change_to_owner_or_admin_or_a_re_enabled_account_needs_the_fresh_factor(mantel):
    """SRV-8: ``PATCH /api/users/{id}`` made an HA-linked account Owner (or re-enabled it) and ``POST /api/users``
    made an Owner with a known password, with a ten-minute-old sign-in; linking the same HA user to a person asked
    for a fresh factor. One rule, ``accounts.require_fresh_to_grant``, for all of them."""
    m = mantel
    await m.user("avery", "owner")
    await m.sign_in("avery")
    ha_adult = m.store.link(HA_X, "adult", "Fictional HA Visitor")
    pat = await m.user("pat", "adult")
    off = await m.user("quinn", "guest")
    assert (await m.client.patch(f"/api/users/{off}", json={"disabled": True}, headers=m.headers())).status == 200
    m.now[0] += 600                                                # the sign-in is ten minutes old: not fresh
    h = m.headers()
    before = len(m.app["audit"].rows(kind="config"))
    for uid, body in ((ha_adult, {"role": "owner"}), (pat, {"role": "admin"}), (off, {"disabled": False})):
        r = await m.client.patch(f"/api/users/{uid}", json=body, headers=h)
        assert r.status == 403 and (await r.json())["error"] == "step_up_required", (uid, body, r.status)
    for role in ("owner", "admin"):
        r = await m.client.post("/api/users", json={"username": f"new-{role}", "name": "N", "role": role,
                                                    "password": "correct horse battery staple 99"}, headers=h)
        assert r.status == 403 and (await r.json())["error"] == "step_up_required", role
    assert m.store.get_link(HA_X)["role"] == "adult" and m.app["accounts"].find_username("new-owner") is None
    assert m.app["accounts"].get_user(pat)["role"] == "adult" and m.app["accounts"].get_user(off)["disabled"]
    assert len(m.app["audit"].rows(kind="config")) == before        # no row, no change
    # what widens nothing needs nothing more than before: a rename, a Child, a lower role
    assert (await m.client.patch(f"/api/users/{pat}", json={"name": "Pat P"}, headers=h)).status == 200
    assert (await m.client.patch(f"/api/users/{pat}", json={"role": "child"}, headers=h)).status == 200
    r = await m.client.post("/api/users", json={"username": "kid", "name": "K", "role": "child",
                                                "password": "correct horse battery staple 99"}, headers=h)
    assert r.status == 201
    # a fresh sign-in does them
    await m.sign_in("avery")
    h = m.headers()
    assert (await m.client.patch(f"/api/users/{ha_adult}", json={"role": "owner"}, headers=h)).status == 200
    assert (await m.client.patch(f"/api/users/{off}", json={"disabled": False}, headers=h)).status == 200
    r = await m.client.post("/api/users", json={"username": "new-admin", "name": "N", "role": "admin",
                                                "password": "correct horse battery staple 99"}, headers=h)
    assert r.status == 201
