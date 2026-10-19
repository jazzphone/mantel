"""Wall tablets through the HA App (decision 21; docs/phase3/HA-APP.md "Wall tablets through the App").

Each wall tablet is its own HA user (trusted_networks in Kiosk Satellite). An Owner links such an HA user to
a Mantel device (wall_tablet, its room); through Ingress it is then that device, no user, door 'ha', with the
LAN door's tablet rules on a home-rules sidebar (trusted/lan) and refused with tunnel rules. A person's PIN at
it is decided person ∩ device; its page opens on its own HK screen and asks HA to hide its chrome; per-tablet
ownership and the screens' frames see the right tablet. Fictional people, rooms and ids only.

Like tests/test_ingress.py, the aiohttp test client (127.0.0.1) plays the Supervisor's Ingress proxy.
"""
from __future__ import annotations

import json

import aiohttp
import pytest
from aiohttp.test_utils import TestClient, TestServer
from argon2 import PasswordHasher

import gateway_fakes as GF
from mantel_server import features as F
from mantel_server import ingress, sessions
from test_ingress import ADULT_HA, OWNER_HA, PAGE, PREFIX, ROOT, STRANGER_HA, App, FakeDirectory

TABLET_HA = "7ab1e7ab1e7ab1e7ab1e7ab1e7ab1e7a"
TABLET_NAME = "Fictional Kitchen Tablet"
CHILD_HA = "c41dc41dc41dc41dc41dc41dc41dc41d"
ADULT_PIN, CHILD_PIN = "2580", "7913"
HA_ORIGIN = "http://ha.example:8123"


def directory():
    d = FakeDirectory()
    d.list = d.list + [
        {"id": TABLET_HA, "name": TABLET_NAME, "username": "kitchen", "group_ids": ["system-users"],
         "is_active": True, "system_generated": False},
        {"id": CHILD_HA, "name": "Fictional Child", "username": "child", "group_ids": ["system-users"],
         "is_active": True, "system_generated": False}]
    return d


async def make(tmp_path, monkeypatch, *, rules="trusted", commands=False, core_peers=()):
    from mantel_server.config import Config
    from mantel_server.ha_client import HaClient
    from mantel_server.readproxy import ReadProxy
    from mantel_server.server import build_app
    from mantel_server.store import Store

    async def forbidden(*args, **kwargs):
        pytest.fail("ingress tablet tests attempted upstream access")

    monkeypatch.setattr(HaClient, "run", forbidden)
    monkeypatch.setattr(HaClient, "_send", forbidden)
    monkeypatch.setattr(ReadProxy, "request", forbidden)
    web_dir = tmp_path / "web"
    (web_dir / "hk").mkdir(parents=True)
    (web_dir / "home.html").write_text((ROOT / "web/home.html").read_text())
    (web_dir / "hk-settings.html").write_text((ROOT / "web/hk-settings.html").read_text())
    cfg = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", port=0, web=web_dir,
                 hk_frontend=web_dir / "hk", hk_files=tmp_path / "none", fixtures=tmp_path / "none",
                 ingress=True, ingress_peers=("127.0.0.1",), ha_door_rules=rules, commands_enabled=commands,
                 ha_core_peers=tuple(core_peers))
    store = Store(cfg.data_dir / "mantel.db")
    now = [1_000_000.0]
    app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False, clock=lambda: now[0])
    app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    app["ha_directory"] = directory()
    hub = app["hub"]
    hub.registry.load(GF.HOUSE_AREAS, [], GF.HOUSE_ENTITIES)
    hub.store.apply_event({"a": {k: dict(v) for k, v in GF.STATES.items()}})
    fake = None
    if commands:
        fake = GF.FakeCommander(app["gateway"].writes)
        app["gateway"].commander = fake
    client = TestClient(TestServer(app), cookie_jar=aiohttp.DummyCookieJar())
    await client.start_server()
    m = App(app, client, store, now)
    m.fake = fake
    return m


@pytest.fixture
async def mk(tmp_path, monkeypatch):
    made = []

    async def factory(**kw):
        a = await make(tmp_path / f"m{len(made)}", monkeypatch, **kw)
        made.append(a)
        return a
    yield factory
    for a in made:
        await a.client.close()
        a.store.db.close()


def owner_user(m):
    row = ingress.linked_user(m.store.db, OWNER_HA)
    return sessions.User(id=row["id"], name=row["name"], role=row["role"], kind=row["kind"])


def tablet_headers(m, **extra):
    return m.ha(TABLET_HA, display=TABLET_NAME, **extra)


async def owner_page(m):
    m.store.link(OWNER_HA, "owner", "Fictional Owner")
    r = await m.page()
    assert r.status == 200
    return {"Origin": str(m.client.make_url("")).rstrip("/")}


async def link_by_form(m, origin, **form):
    data = {"csrf": m.jar["mantel_csrf"], "ha_user_id": TABLET_HA, "action": "tablet", "device_id": "",
            "room": "kitchen", **form}
    return await m.request("POST", "/ingress/people", {**m.ha(), **origin}, data=data)


def tablet_get(m, path, **extra):
    """A request from the tablet's kiosk browser: no Mantel cookies of the Owner's."""
    return m.client.get(path, headers={**tablet_headers(m), **extra}, allow_redirects=False)


async def test_a_wall_tablet_cannot_open_hk_settings(mk):
    m = await mk()
    origin = await owner_page(m)
    assert (await link_by_form(m, origin)).status == 303
    r = await tablet_get(m, "/hk-settings", **PAGE)
    assert r.status == 403 and "Only an Owner or an Admin" in await r.text()
    assert (await m.request("GET", "/hk-settings", {**m.ha(), **PAGE})).status == 200


# -- linking ----------------------------------------------------------------------------------------------
async def test_an_owner_links_a_tablets_ha_user_as_a_device_and_it_is_that_device(mk):
    m = await mk()
    origin = await owner_page(m)
    page = await m.request("GET", "/ingress/people", {**m.ha(), **PAGE})
    text = await page.text()
    assert "Link as a wall tablet" in text and TABLET_NAME in text and "Kitchen" in text
    r = await link_by_form(m, origin)
    assert r.status == 303 and r.headers["Location"] == PREFIX + "/ingress/people"
    row = ingress.tablet_link(m.store.db, TABLET_HA)
    assert (row["name"], row["role"], row["room"], row["own_device"]) == (TABLET_NAME, "wall_tablet", "kitchen", 1)
    # through Ingress, that HA user is now the device: no user, door 'ha', its room
    s = await (await tablet_get(m, "/api/session")).json()
    assert s["user"] is None and s["door"] == "ha" and s["session_id"] is None
    assert s["device"] == {"id": row["id"], "name": TABLET_NAME, "role": "wall_tablet", "room": "kitchen",
                           "ha_user_id": TABLET_HA}
    assert s["csrf"] == row["csrf"]
    # /api/me reads as the HA user, as HK in HA saw it (HK finds its tablet by the Tablet User's name)
    me = await (await tablet_get(m, "/api/me")).json()
    assert me == {"ha_user_id": TABLET_HA, "name": TABLET_NAME, "role": "wall_tablet"}
    # no Mantel session is made for a tablet (the HA user Ingress names is the credential)
    owner_id = ingress.linked_user(m.store.db, OWNER_HA)["id"]
    assert {r[0] for r in m.store.db.execute("SELECT user_id FROM sessions")} == {owner_id}
    # its page gets its CSRF cookie at the prefix, and the kiosk mark
    p = await tablet_get(m, "/dashboard-kitchen/home", **PAGE)
    assert p.status == 200 and ingress.KIOSK_META in await p.text()
    assert any(c.startswith(f"mantel_csrf={row['csrf']}") and f"Path={PREFIX}/" in c
               for c in p.headers.getall("Set-Cookie"))
    rows = [r for r in m.app["audit"].rows(kind="config") if r["action"] == "ingress.link_tablet"]
    assert len(rows) == 1
    detail = json.loads(rows[0]["target"])
    assert detail["ha_user_id"] == TABLET_HA and detail["room"] == "kitchen" and detail["new_device"] is True


async def test_a_person_ha_user_is_unaffected_and_never_marked_kiosk(mk):
    m = await mk()
    origin = await owner_page(m)
    m.store.link(ADULT_HA, "adult", "Fictional Adult")
    assert (await link_by_form(m, origin)).status == 303
    s = await (await m.request("GET", "/api/session", m.ha())).json()
    assert s["user"]["role"] == "owner" and s["device"] is None and s["door"] == "ha"
    adult = await m.client.get("/api/session", headers=m.ha(ADULT_HA, display="Fictional Adult"))
    body = await adult.json()
    assert body["user"]["role"] == "adult" and body["device"] is None
    page = await m.request("GET", "/dashboard-kitchen/home", {**m.ha(), **PAGE})
    assert ingress.KIOSK_META not in await page.text()
    # and a person's / opens the default screen, not a tablet's
    r = await m.request("GET", "/", {**m.ha(), **PAGE})
    assert r.headers["Location"] == PREFIX + "/home"


async def test_an_unlinked_tablet_user_gets_nothing_and_unlinking_ends_it(mk):
    m = await mk()
    origin = await owner_page(m)
    r = await tablet_get(m, "/api/session")
    assert r.status == 401 and (await r.json())["error"] == "not_linked"
    assert (await tablet_get(m, "/api/me")).status == 401
    p = await tablet_get(m, "/dashboard-kitchen/home", **PAGE)
    assert p.status == 403 and "Not linked yet" in await p.text()
    assert (await link_by_form(m, origin)).status == 303
    device_id = ingress.tablet_link(m.store.db, TABLET_HA)["id"]
    assert (await tablet_get(m, "/api/me")).status == 200
    r = await m.request("POST", "/ingress/people", {**m.ha(), **origin},
                        data={"csrf": m.jar["mantel_csrf"], "ha_user_id": TABLET_HA, "action": "unlink"})
    assert r.status == 303 and ingress.tablet_link(m.store.db, TABLET_HA) is None
    assert (await tablet_get(m, "/api/me")).status == 401
    # the device made for the link is revoked; the unlink is audited
    assert m.app["devices"].get(device_id)["revoked_reason"] == "tablet_unlinked"
    assert [r["action"] for r in m.app["audit"].rows(kind="config")].count("ingress.unlink_tablet") == 1


async def test_only_an_owner_links_tablets(mk):
    m = await mk()
    m.store.link(OWNER_HA, "owner")
    m.store.link(ADULT_HA, "admin", "Fictional Admin")
    await m.request("GET", "/x-y/home", {**m.ha(ADULT_HA), **PAGE})
    origin = {"Origin": str(m.client.make_url("")).rstrip("/")}
    page = await (await m.request("GET", "/ingress/people", {**m.ha(ADULT_HA), **PAGE})).text()
    assert "Link as a wall tablet" not in page
    r = await m.request("POST", "/ingress/people", {**m.ha(ADULT_HA), **origin},
                        data={"csrf": m.jar["mantel_csrf"], "ha_user_id": TABLET_HA, "action": "tablet", "room": "kitchen"})
    assert r.status == 403 and ingress.tablet_link(m.store.db, TABLET_HA) is None


async def test_linking_moves_a_person_link_and_keeps_the_last_owner(mk):
    m = await mk()
    await owner_page(m)
    m.store.link(TABLET_HA, "adult", TABLET_NAME)        # linked by mistake as a person at first
    owner = owner_user(m)
    got = ingress.link_tablet(m.app, TABLET_HA, owner, room="kitchen", ha_name=TABLET_NAME)
    assert got["new_device"] and m.store.get_link(TABLET_HA) is None
    with pytest.raises(ingress.TabletLinkError) as exc:
        ingress.link_tablet(m.app, OWNER_HA, owner, room="kitchen")
    assert exc.value.code == "last_owner" and m.store.get_link(OWNER_HA)["role"] == "owner"
    with pytest.raises(ingress.TabletLinkError) as exc:
        ingress.link_tablet(m.app, STRANGER_HA, owner, room="the_moon")          # not one of HA's areas
    assert exc.value.code == "unknown_room"
    # an existing (LAN-enrolled) wall-tablet device can be linked; it is not revoked on unlink
    dev_id, _, _ = m.app["devices"].enroll("Porch tablet", "wall_tablet", "porch", owner.id)
    ingress.link_tablet(m.app, STRANGER_HA, owner, device_id=dev_id)
    with pytest.raises(ingress.TabletLinkError) as exc:
        ingress.link_tablet(m.app, CHILD_HA, owner, device_id=dev_id)
    assert exc.value.code == "device_taken"
    assert ingress.unlink_tablet(m.app, STRANGER_HA, owner)
    assert m.app["devices"].get(dev_id)["revoked"] is None


async def test_the_rest_api_links_and_unlinks_for_an_owner(mk):
    m = await mk()
    origin = await owner_page(m)
    h = {**m.ha(), **origin, "X-CSRF-Token": m.jar["mantel_csrf"]}
    r = await m.request("POST", "/api/ingress/tablets", h, json={"ha_user_id": TABLET_HA, "room": "kitchen"})
    assert r.status == 201, await r.text()
    body = await r.json()
    assert body["device"]["room"] == "kitchen" and body["device"]["ha_user_id"] == TABLET_HA
    listed = await (await m.request("GET", "/api/ingress/tablets", m.ha())).json()
    assert [t["ha_user_id"] for t in listed["tablets"]] == [TABLET_HA] and listed["allowed"] is True
    assert listed["rooms"]["kitchen"] == "Kitchen"
    # CSRF still applies
    r = await m.request("DELETE", f"/api/ingress/tablets/{TABLET_HA}", {**m.ha(), **origin})
    assert r.status == 403
    r = await m.request("DELETE", f"/api/ingress/tablets/{TABLET_HA}", h)
    assert r.status == 200 and ingress.tablet_link(m.store.db, TABLET_HA) is None
    # the tablet itself (a device) cannot link anything
    ingress.link_tablet(m.app, TABLET_HA, owner_user(m), room="kitchen")
    row = ingress.tablet_link(m.store.db, TABLET_HA)
    r = await m.client.post("/api/ingress/tablets", json={"ha_user_id": CHILD_HA},
                            headers={**tablet_headers(m), **origin, "X-CSRF-Token": row["csrf"]})
    assert r.status == 403


# -- the door's rules -------------------------------------------------------------------------------------
async def test_tunnel_rules_refuse_a_tablet_and_lan_rules_allow_it(mk):
    """Decision: a device never gets the tunnel's rules (rbac refuses devices there; tablets are LAN-only),
    so with ha_door_rules: tunnel a linked tablet is refused outright, with a page saying why."""
    m = await mk(rules="tunnel")
    await owner_page(m)
    ingress.link_tablet(m.app, TABLET_HA, owner_user(m), room="kitchen", ha_name=TABLET_NAME)
    r = await tablet_get(m, "/api/me")
    assert r.status == 401 and (await r.json())["error"] == "tablet_refused"
    p = await tablet_get(m, "/dashboard-kitchen/home", **PAGE)
    assert p.status == 403 and "ha_door_rules" in await p.text()
    people = await (await m.request("GET", "/ingress/people", {**m.ha(), **PAGE})).text()
    assert "refused on the sidebar now" in people
    m2 = await mk(rules="lan")
    await owner_page(m2)
    ingress.link_tablet(m2.app, TABLET_HA, owner_user(m2), room="kitchen")
    assert (await tablet_get(m2, "/api/me")).status == 200


async def test_the_tablet_gets_the_lan_tablet_rules_and_device_credentials_stay_refused(mk):
    m = await mk()
    await owner_page(m)
    ingress.link_tablet(m.app, TABLET_HA, owner_user(m), room="kitchen", ha_name=TABLET_NAME)
    authz = m.app["authz"]
    row = ingress.tablet_link(m.store.db, TABLET_HA)
    ident = sessions.Identity(None, sessions.Device(row["id"], row["name"], "wall_tablet", "kitchen",
                                                    ha_user_id=TABLET_HA, ha_name=TABLET_NAME), "ha")
    subj = authz.subject_of(ident)
    assert subj.door == "lan" and subj.device_areas == frozenset({"kitchen"}) and subj.fresh_factor_at is None
    assert authz.ha_tablet(ident) and not authz.ha_trusted(ident)
    # its room's light: yes; another room's: no; a lock: only with a person's PIN
    assert authz.decide(subj, "control", "light.kitchen").allowed is True
    assert authz.decide(subj, "control", "light.cody").allowed is not True
    lock = authz.decide(subj, "control.sensitive", "lock.kitchen_door")
    assert lock.allowed is not True
    # a device credential (a LAN tablet's cookie) is still never accepted on the 'ha' door
    dev_id, secret, _ = m.app["devices"].enroll("LAN tablet", "wall_tablet", "porch", None)
    r = await m.client.get("/api/me", headers={**m.ha(STRANGER_HA), "Cookie": f"mantel_device={secret}"})
    assert r.status == 401


async def test_a_persons_pin_at_an_ingress_tablet_is_person_and_device(mk):
    m = await mk(commands=True)
    await owner_page(m)
    owner = owner_user(m)
    adult_id = m.store.link(ADULT_HA, "adult", "Fictional Adult")
    child_id = m.store.link(CHILD_HA, "child", "Fictional Child")
    await m.app["pins"].set_pin(adult_id, ADULT_PIN)
    await m.app["pins"].set_pin(child_id, CHILD_PIN)
    ingress.link_tablet(m.app, TABLET_HA, owner, room="kitchen", ha_name=TABLET_NAME)
    device_id = ingress.tablet_link(m.store.db, TABLET_HA)["id"]
    told = []

    async def notify_owners(*args, **kwargs):
        told.append(args)
    m.app["gateway"].notify_owners = notify_owners
    ws = await m.client.ws_connect("/ws", headers={**tablet_headers(m), "Origin": HA_ORIGIN,
                                                   "X-Forwarded-Host": "ha.example:8123"})
    caps = await GF.recv(ws)
    assert caps["type"] == "capabilities" and caps["commands"] is True
    env = GF.Env.__new__(GF.Env)
    first = await env.command(ws, **GF.service("lock", "unlock", "lock.kitchen_door"))
    assert first["type"] == "step_up_required" and first["reason"] == "person_pin_required"
    assert first["methods"] == ["pin"] and m.fake.sent == []
    child = await env.command(ws, id=2, **GF.service("lock", "unlock", "lock.kitchen_door",
                                                     step_up={"method": "pin", "pin": CHILD_PIN}))
    assert child["error"]["code"] == "forbidden" and m.fake.sent == []
    ok = await env.command(ws, id=3, **GF.service("lock", "unlock", "lock.kitchen_door",
                                                  step_up={"method": "pin", "pin": ADULT_PIN}))
    assert ok["type"] == "command_result" and m.fake.sent == ["lock.unlock"], ok
    row = m.app["audit"].rows(id=ok["audit_id"])[0]
    assert (row["actor"], row["device"], row["device_role"], row["door"], row["step_up"]) == \
        (adult_id, device_id, "wall_tablet", "ha", "pin")
    # the adult may not use the tablet for another room (person ∩ device)
    other = await env.command(ws, id=4, **GF.service("light", "turn_on", "light.cody",
                                                     step_up={"method": "pin", "pin": ADULT_PIN}))
    assert other["error"]["code"] == "forbidden"
    # a tablet in the house is not "remote access": no Owner notice
    assert told == []
    await ws.close()
    assert ADULT_PIN not in json.dumps(m.app["audit"].rows())


# -- the page, screens and ownership ------------------------------------------------------------------------
def kitchen_tablets():
    from hk_core.settings import model as SM
    return {"kitchen": SM.tablet({"name": "Kitchen", "screen": "dashboard-kitchen", "room": "kitchen",
                                  "user": TABLET_NAME}, "kitchen"),
            "loft": SM.tablet({"name": "Loft", "screen": "dashboard-loft", "room": "porch", "user": "Fictional Loft"},
                              "loft")}


async def test_the_tablets_page_opens_on_its_own_screen(mk):
    m = await mk()
    await owner_page(m)
    ingress.link_tablet(m.app, TABLET_HA, owner_user(m), room="kitchen", ha_name=TABLET_NAME)
    m.app["features"].tablets = kitchen_tablets()
    for path in ("/", "/home"):
        r = await tablet_get(m, path, **PAGE)
        assert r.status == 302 and r.headers["Location"] == PREFIX + "/dashboard-kitchen/home?hk_tablet=kitchen", path
    # no HK tablet for it (no settings yet): Mantel's default screen
    m.app["features"].tablets = {}
    r = await tablet_get(m, "/", **PAGE)
    assert r.headers["Location"] == PREFIX + "/home"


async def test_screen_frames_and_feed_follow_the_linked_device(mk):
    m = await mk()
    await owner_page(m)
    ingress.link_tablet(m.app, TABLET_HA, owner_user(m), room="cody_room", ha_name=TABLET_NAME)
    host = m.app["features"]
    host.tablets = kitchen_tablets()
    req = await tablet_get(m, "/api/session")
    assert req.status == 200
    row = ingress.tablet_link(m.store.db, TABLET_HA)
    ident = sessions.Identity(None, sessions.Device(row["id"], row["name"], "wall_tablet", "cody_room",
                                                    ha_user_id=TABLET_HA, ha_name=TABLET_NAME), "ha")
    from mantel_server.authz import Principal
    principal = Principal(ident, m.app["authz"].subject_of(ident))
    # its own tablet by the Tablet User's name (even in another room than the device's); not another tablet
    assert F.may_speak_for(host, principal, "kitchen") is True
    assert F.may_speak_for(host, principal, "loft") is False
    # a feed frame naming the tablet's HA user reaches its screen, as HA's feed did
    got = []
    unsub = host.feed.subscribe(principal, got.append)
    host.feed.send({"type": "popup", "users": [TABLET_HA]})
    host.feed.send({"type": "popup", "users": [ADULT_HA]})
    unsub()
    assert got == [{"type": "popup", "users": [TABLET_HA]}]
    # a refresh keeps the HA link, and an unlink invalidates the socket's principal at the next tick
    assert m.app["authz"].refresh(principal) and principal.device.ha_user_id == TABLET_HA
    ingress.unlink_tablet(m.app, TABLET_HA, owner_user(m))
    assert m.app["authz"].refresh(principal) is False and principal.valid is False


async def test_an_owner_moves_tablet_ownership_through_a_trusted_sidebar(mk):
    m = await mk()
    origin = await owner_page(m)
    m.app["features"].tablets = kitchen_tablets()
    h = {**m.ha(), **origin, "X-CSRF-Token": m.jar["mantel_csrf"]}
    r = await m.request("PUT", "/api/linked/owners", h, json={"unit": "kitchen", "owner": "mantel"})
    assert r.status == 200, await r.text()
    assert m.app["linked_owners"].owns("kitchen") and m.app["features"].mantel_owns("kitchen")
    r = await m.request("PUT", "/api/linked/owners", h, json={"unit": "kitchen", "owner": "ha"})
    assert r.status == 200 and not m.app["linked_owners"].owns("kitchen")
    # with the sidebar on tunnel rules it stays a LAN-only change
    m2 = await mk(rules="tunnel")
    origin2 = await owner_page(m2)
    m2.app["features"].tablets = kitchen_tablets()
    r = await m2.request("PUT", "/api/linked/owners", {**m2.ha(), **origin2, "X-CSRF-Token": m2.jar["mantel_csrf"]},
                         json={"unit": "kitchen", "owner": "mantel"})
    assert r.status == 403


async def test_ha_core_reaches_only_linked_modes_endpoint_through_ingress_only(mk, tmp_path, monkeypatch):
    m = await make(tmp_path / "core", monkeypatch, core_peers=("127.0.0.1",))
    try:
        m.cfg.ingress_peers = ("172.30.32.2",)          # this client is HA Core here, not the Supervisor
        m.cfg.ingress_only = True
        # linked mode's endpoint: reached (and then wants its Service credential: 401, not the 403 wall)
        r = await m.client.get("/linked/ws", headers={"Connection": "Upgrade", "Upgrade": "websocket",
                                                       "Sec-WebSocket-Version": "13",
                                                       "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ=="})
        assert r.status == 401
        # everything else from that peer is still refused by ingress_only
        assert (await m.client.get("/api/me")).status == 403
        assert (await m.client.get("/dashboard-kitchen/home", headers=PAGE)).status == 403
        # and from a peer that is not HA Core, the endpoint is behind the wall too
        m.cfg.ha_core_peers = ("172.30.32.1",)
        r = await m.client.get("/linked/ws")
        assert r.status == 403
    finally:
        await m.client.close()
        m.store.db.close()


def test_config_and_entrypoint_name_ha_core_in_app_mode(tmp_path):
    from mantel_server.config import parse_args
    from test_ingress import _entrypoint
    assert parse_args(["--ingress", "--ha-core-peer", "172.30.32.1"]).ha_core_peers == ("172.30.32.1",)
    assert parse_args(["--ingress"]).ha_core_peers == ()
    for bad in (["--ha-core-peer", "172.30.32.1"], ["--ingress", "--ha-core-peer", "core"]):
        with pytest.raises(SystemExit):
            parse_args(bad)
    ep = _entrypoint()
    options = tmp_path / "options.json"
    options.write_text("{}")
    args, _ = ep.plan([], {"SUPERVISOR_TOKEN": "fictional"}, options_path=options, token_file=tmp_path / "t")
    assert parse_args(args).ha_core_peers == ("172.30.32.1",)


def test_migration_0012_links_tablets_to_devices(tmp_path):
    from mantel_server.store import Store
    store = Store(tmp_path / "m.db")
    cols = {r[1] for r in store.db.execute("PRAGMA table_info(ha_tablet_links)")}
    assert cols == {"ha_user_id", "device_id", "ha_name", "own_device", "created", "created_by"}
    store.db.close()


# -- what a tablet may never reach --------------------------------------------------------------------------
OWNER_ADMIN_ENDPOINTS = [
    ("GET", "/admin"), ("GET", "/api/admin/overview"), ("GET", "/api/audit"), ("GET", "/api/users"),
    ("POST", "/api/users"), ("GET", "/api/devices"), ("POST", "/api/devices/enroll"), ("GET", "/api/sessions"),
    ("GET", "/api/service-accounts"), ("POST", "/api/service-accounts"), ("GET", "/api/linked/owners"),
    ("PUT", "/api/linked/owners"), ("GET", "/api/rbac/grants"), ("POST", "/api/rbac/grants"),
    ("GET", "/api/rbac/roles"), ("PUT", "/api/rbac/roles/adult"), ("GET", "/api/connections"),
    ("POST", "/api/connections/ma"), ("GET", "/api/backup"), ("POST", "/api/backup/run"),
    ("GET", "/api/ingress/tablets"), ("POST", "/api/ingress/tablets"), ("DELETE", f"/api/ingress/tablets/{TABLET_HA}"),
    ("GET", "/api/alarm/pins"), ("POST", "/api/settings/import"), ("POST", "/api/features/import"),
    ("GET", "/api/connect"), ("POST", "/api/connect/pair"), ("PUT", "/api/account/pin"),
    ("GET", "/ingress/people"),
]


async def test_a_tablet_reaches_no_owner_or_admin_page(mk):
    """A linked tablet is a device with no user: every Owner/Admin page and API refuses it, even with its
    own CSRF token, and the people forms cannot relink or promote anything (its own HA user included)."""
    m = await mk()
    origin = await owner_page(m)
    ingress.link_tablet(m.app, TABLET_HA, owner_user(m), room="kitchen", ha_name=TABLET_NAME)
    row = ingress.tablet_link(m.store.db, TABLET_HA)
    h = {**tablet_headers(m), **origin, "X-CSRF-Token": row["csrf"], "Cookie": f"mantel_csrf={row['csrf']}"}
    for method, path in OWNER_ADMIN_ENDPOINTS:
        kw = {} if method in ("GET", "DELETE") else {"json": {"ha_user_id": CHILD_HA, "unit": "kitchen",
                                                              "owner": "mantel", "pin": "1234", "name": "x"}}
        r = await m.client.request(method, path, headers={**h, **(PAGE if path in ("/admin", "/ingress/people")
                                                                   else {})}, allow_redirects=False, **kw)
        assert r.status in (401, 403, 404), (method, path, r.status, await r.text())
    for form in ({"action": "link", "role": "owner", "ha_user_id": TABLET_HA},
                 {"action": "link", "role": "adult", "ha_user_id": CHILD_HA},
                 {"action": "tablet", "ha_user_id": CHILD_HA, "room": "kitchen"},
                 {"action": "unlink", "ha_user_id": TABLET_HA}):
        r = await m.client.post("/ingress/people", data={"csrf": row["csrf"], **form}, headers=h, allow_redirects=False)
        assert r.status == 403, (form, r.status)
    for path in ("/ingress/import-settings", "/ingress/import-features"):
        r = await m.client.post(path, data={"csrf": row["csrf"]}, headers=h, allow_redirects=False)
        assert r.status == 403, path
    # nothing changed: still the same tablet, no new person link, no grant
    assert ingress.tablet_link(m.store.db, TABLET_HA)["id"] == row["id"]
    assert m.store.get_link(TABLET_HA) is None and m.store.get_link(CHILD_HA) is None
    assert not m.app["linked_owners"].owns("kitchen")


async def test_an_unlinked_ha_user_gets_only_the_refusal_with_the_panel_open_to_all(mk):
    """panel_admin: false lets every HA user open the panel; an unlinked one (admin in HA or not) still
    gets "Not linked yet" and a 401 for every API, and cannot become Owner once one exists."""
    m = await mk()
    origin = await owner_page(m)
    for who in (CHILD_HA, STRANGER_HA):
        h = m.ha(who, display="Fictional Nobody")
        p = await m.client.get("/dashboard-kitchen/home", headers={**h, **PAGE}, allow_redirects=False)
        assert p.status == 403 and "Not linked yet" in await p.text()
        for path in ("/api/session", "/api/me", "/api/entities", "/api/audit", "/api/ingress/tablets"):
            r = await m.client.get(path, headers=h)
            assert r.status == 401 and (await r.json())["error"] == "not_linked", path
        r = await m.client.get("/ws", headers={**h, **origin})
        assert r.status == 401
        r = await m.client.post("/ingress/bootstrap", headers={**h, **origin}, data={"confirm": "1"},
                                allow_redirects=False)
        assert r.status in (400, 403, 410)          # no valid confirmation of theirs: nothing happens
        assert ingress.linked_user(m.store.db, who) is None


async def test_revoking_the_device_ends_the_tablet_at_once(mk):
    m = await mk()
    await owner_page(m)
    ingress.link_tablet(m.app, TABLET_HA, owner_user(m), room="kitchen", ha_name=TABLET_NAME)
    row = ingress.tablet_link(m.store.db, TABLET_HA)
    assert (await tablet_get(m, "/api/me")).status == 200
    ident = sessions.Identity(None, sessions.Device(row["id"], row["name"], "wall_tablet", "kitchen",
                                                    ha_user_id=TABLET_HA, ha_name=TABLET_NAME), "ha")
    from mantel_server.authz import Principal
    principal = Principal(ident, m.app["authz"].subject_of(ident))
    m.app["devices"].revoke(row["id"], "fictional_test")
    r = await tablet_get(m, "/api/me")
    assert r.status == 401 and (await r.json())["error"] == "tablet_refused"
    p = await tablet_get(m, "/dashboard-kitchen/home", **PAGE)
    assert p.status == 403 and "revoked" in await p.text()
    assert m.app["authz"].refresh(principal) is False and principal.valid is False


def test_package_check_pins_panel_admin_false(tmp_path):
    import sys
    sys.path.insert(0, str(ROOT / "tools"))
    import package_check as pc
    src = (ROOT / "packaging/ha-app/config.yaml").read_text()
    assert "panel_admin: false" in src
    for bad in ("panel_admin: true", ""):
        cfg = tmp_path / "config.yaml"
        cfg.write_text(src.replace("panel_admin: false", bad))
        assert any("panel_admin" in p for p in pc.check_ha_app(cfg)), bad
