"""A screen as a Home Assistant Webpage dashboard (ha_dashboards.py; docs/phase3/HA-SIDEBAR-SCREENS.md step 3).

Against a fake HA WebSocket that answers lovelace/dashboards/* and lovelace/config* the way HA 2026.9 does and
records every frame. Pinned: HA is the only record (a rename or removal in HA shows); create/update/remove with the
iframe strategy at Mantel's own address; the url_path rule; the states in words (direct access off, HA not
connected, not an HA admin); Owner/Admin only; audited first; and what the connection may never send.
"""
from __future__ import annotations

import json

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from conftest import Mantel  # noqa: F401  (the fixture's type)
from mantel_server.ha import ha_dashboards as HD
from mantel_server import settings_store
from mantel_server.config import Config

BASE = "https://mantel.example.com/"
API = "/api/admin/ha-dashboards"


class FakeHa:
    """Home Assistant's WebSocket API, as far as this module uses it."""

    def __init__(self) -> None:
        self.is_admin = True
        self.dashboards: dict[str, dict] = {"map": {"id": "map", "url_path": "map", "title": "Map", "icon": "mdi:map",
                                                     "require_admin": False, "show_in_sidebar": True, "mode": "storage"}}
        self.configs: dict[str, dict] = {"map": {"strategy": {"type": "map"}}}
        self.panels = {"lovelace": {}, "config": {}, "mantel-taken": {}}
        self.frames: list[dict] = []
        self.fail_save = False
        self.token = "fictional-ha-token"

    def answer(self, f: dict):
        t = f["type"]
        if t == "auth/current_user":
            return {"id": "u1", "name": "Supervisor" if self.is_admin else "Kiosk", "is_admin": self.is_admin}
        if t == "get_config":
            return {"internal_url": "http://ha.home.example:8123", "external_url": "https://ha.example.com"}
        if t == "get_panels":
            return self.panels
        if t == "lovelace/dashboards/list":
            return list(self.dashboards.values())
        if t == "lovelace/config":
            if f["url_path"] not in self.configs:
                raise KeyError("config_not_found")
            return self.configs[f["url_path"]]
        if not self.is_admin:
            raise KeyError("unauthorized")
        if t == "lovelace/dashboards/create":
            did = f["url_path"].replace("-", "_")
            self.dashboards[did] = {"id": did, "mode": "storage", **{k: f[k] for k in f if k not in ("id", "type")}}
            return self.dashboards[did]
        if t == "lovelace/dashboards/update":
            self.dashboards[f["dashboard_id"]].update({k: f[k] for k in f if k not in ("id", "type", "dashboard_id")})
            return self.dashboards[f["dashboard_id"]]
        if t == "lovelace/dashboards/delete":
            d = self.dashboards.pop(f["dashboard_id"])
            self.configs.pop(d["url_path"], None)
            return None
        if t == "lovelace/config/save":
            if self.fail_save:
                raise KeyError("save_failed")
            self.configs[f["url_path"]] = f["config"]
            return None
        raise KeyError("unknown_command")

    async def ws(self, request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        await ws.send_json({"type": "auth_required"})
        auth = await ws.receive_json()
        if auth.get("access_token") != self.token:
            await ws.send_json({"type": "auth_invalid"})
            await ws.close()
            return ws
        await ws.send_json({"type": "auth_ok", "ha_version": "2026.9.4"})
        async for m in ws:
            f = json.loads(m.data)
            self.frames.append(f)
            try:
                await ws.send_json({"id": f["id"], "type": "result", "success": True, "result": self.answer(f)})
            except KeyError as exc:
                await ws.send_json({"id": f["id"], "type": "result", "success": False,
                                    "error": {"code": exc.args[0], "message": exc.args[0]}})
        return ws

    def ours(self, screen: str) -> list[dict]:
        return [d for d in self.dashboards.values()
                if self.configs.get(d["url_path"]) == {"strategy": {"type": "iframe", "url": BASE + screen + "/home"}}]


@pytest.fixture
async def ha(mantel):
    fake = FakeHa()
    app = web.Application()
    app.router.add_get("/api/websocket", fake.ws)
    server = TestServer(app)
    await server.start_server()
    cfg = mantel.app["cfg"]
    cfg.public_url = BASE
    cfg.ha_ws_url = str(server.make_url("/api/websocket")).replace("http", "ws", 1)
    mantel.app["connections"].ha_token = lambda: fake.token
    mantel.app["settings"].store.write([("board", "dashboard-loft", {"title": "Loft"}),
                                        ("board", "dashboard-kitchen", {"title": "Kitchen"})],
                                       actor=settings_store.Actor(label="test"))
    yield fake
    await server.close()


async def owner(m, name="olive", role="owner"):
    await m.user(name, role)
    await m.sign_in(name)


async def put(m, screen, body):
    return await m.client.put(f"/api/admin/screens/{screen}/ha-dashboard", json=body, headers=m.headers())


def audits(m, action):
    rows = m.app["store"].db.execute("SELECT action, target, actor FROM action_audit WHERE action = ?", (action,)).fetchall()
    return [json.loads(r[1]) for r in rows]


# -- the rules, without a server ----------------------------------------------------------------------
def test_direct_base_only_with_direct_access():
    assert HD.direct_base(Config(public_url="https://mantel.example.com")) == BASE
    assert HD.direct_base(Config()) == ""                                              # the loopback prototype
    assert HD.direct_base(Config(public_url="https://ingress.invalid/", ingress=True)) == ""   # Ingress-only App
    assert HD.direct_base(Config(public_url="https://m.example.com/", ingress=True)) == ""    # no direct port
    assert HD.direct_base(Config(public_url="https://m.example.com/", ingress=True, direct_port=8100)) == "https://m.example.com/"


def test_url_path_is_mantel_dash_the_screen_and_never_taken():
    assert HD.url_path_for("dashboard-loft", set()) == "mantel-loft"
    assert HD.url_path_for("dashboard-loft", {"mantel-loft"}) == "mantel-loft-2"
    assert HD.url_path_for("dashboard-loft", {"mantel-loft", "mantel-loft-2"}) == "mantel-loft-3"
    assert HD.url_path_for("Kitchen_Tablet-Main", set()) == "mantel-kitchen-tablet-main"   # HA's url_slug


def test_only_an_iframe_of_mantels_address_and_a_screen_is_ours():
    def cfg(url, t="iframe"):
        return {"strategy": {"type": t, "url": url}}
    assert HD.screen_of(cfg(BASE + "dashboard-loft/home"), BASE) == "dashboard-loft"
    assert HD.screen_of(cfg(BASE + "dashboard-loft/0?x=1"), BASE) == "dashboard-loft"
    assert HD.screen_of(cfg("https://other.example.com/dashboard-loft/home"), BASE) is None
    assert HD.screen_of(cfg(BASE + "api/home"), BASE) is None                # not a screen key
    assert HD.screen_of(cfg(BASE + "dashboard-loft/home", "map"), BASE) is None
    assert HD.screen_of({"views": [], **cfg(BASE + "dashboard-loft/home")}, BASE) is None
    assert HD.screen_of(cfg(BASE + "dashboard-loft/home"), "") is None


@pytest.mark.parametrize("frame", [
    {"type": "call_service", "domain": "light", "service": "turn_on"},
    {"type": "config/auth/list"},
    {"type": "frontend/set_system_data", "key": "core", "value": {}},
    {"type": "lovelace/dashboards/list", "extra": 1},
    {"type": "lovelace/dashboards/create", "url_path": "dashboard-loft", "title": "x"},     # HK-in-HA's names
    {"type": "lovelace/dashboards/create", "url_path": "lovelace", "title": "x"},
    {"type": "lovelace/dashboards/update", "dashboard_id": "map", "title": "x"},           # not ours
    {"type": "lovelace/dashboards/delete", "dashboard_id": "map"},
    {"type": "lovelace/dashboards/update", "dashboard_id": "mantel_loft", "url_path": "x"},
    {"type": "lovelace/config/save", "url_path": "map", "config": {"strategy": {"type": "iframe", "url": BASE + "dashboard-loft/home"}}},
    {"type": "lovelace/config/save", "url_path": "mantel-loft", "config": {"strategy": {"type": "iframe", "url": "https://evil.example/"}}},
    {"type": "lovelace/config/save", "url_path": "mantel-loft", "config": {"views": [{"cards": []}]}},
])
def test_the_connection_sends_nothing_else(frame):
    with pytest.raises(HD.Blocked):
        HD.check_frame({"id": 1, **frame}, BASE, ours={"mantel_loft"}, created={"mantel-loft"})


def test_what_it_may_send():
    for f in ({"type": "lovelace/dashboards/create", "url_path": "mantel-loft", "title": "Loft", "icon": "mdi:fireplace",
               "show_in_sidebar": True, "require_admin": False},
              {"type": "lovelace/config/save", "url_path": "mantel-loft",
               "config": {"strategy": {"type": "iframe", "url": BASE + "dashboard-loft/home"}}},
              {"type": "lovelace/dashboards/update", "dashboard_id": "mantel_loft", "title": "Upstairs"},
              {"type": "lovelace/dashboards/delete", "dashboard_id": "mantel_loft"}):
        HD.check_frame({"id": 1, **f}, BASE, ours={"mantel_loft"}, created={"mantel-loft"})


# -- the REST routes, against a fake HA ----------------------------------------------------------------
async def test_add_rename_in_ha_update_and_remove(mantel, ha):
    m = mantel
    await owner(m)
    got = await (await m.get(API)).json()
    assert got["state"] == "ok" and got["base"] == BASE and got["dashboards"] == []
    assert got["ha_url"] == "https://ha.example.com"                    # HA's external URL (no ha_sign_in_url)
    assert {a["kind"] for a in got["ha_addresses"]} == {"internal", "external"}
    assert {s["path"]: s["url"] for s in got["screens"]}["dashboard-loft"] == BASE + "dashboard-loft/home"
    assert "taken" not in got

    r = await put(m, "dashboard-loft", {"on": True})
    assert r.status == 200
    d = ha.dashboards["mantel_loft"]
    assert d["url_path"] == "mantel-loft" and d["title"] == "Loft" and d["icon"] == HD.DEFAULT_ICON
    assert d["show_in_sidebar"] is True and d["require_admin"] is False
    assert ha.configs["mantel-loft"] == {"strategy": {"type": "iframe", "url": BASE + "dashboard-loft/home"}}
    out = await r.json()
    assert [(x["url_path"], x["screen"]) for x in out["dashboards"]] == [("mantel-loft", "dashboard-loft")]
    assert audits(m, "ha_dashboard.add") == [{"screen": "dashboard-loft", "url_path": "mantel-loft", "title": "Loft",
                                             "require_admin": False}]

    # renamed in HA: Mantel shows HA's name (HA is the record)
    ha.dashboards["mantel_loft"]["title"] = "Upstairs"
    got = await (await m.get(API)).json()
    assert got["dashboards"][0]["title"] == "Upstairs"

    # on again: nothing new, one dashboard
    assert (await put(m, "dashboard-loft", {"on": True})).status == 200
    assert len(ha.ours("dashboard-loft")) == 1

    r = await put(m, "dashboard-loft", {"on": True, "title": "Loft Wall", "icon": "mdi:tablet", "require_admin": True})
    assert r.status == 200
    assert {k: ha.dashboards["mantel_loft"][k] for k in ("title", "icon", "require_admin")} == \
        {"title": "Loft Wall", "icon": "mdi:tablet", "require_admin": True}
    assert audits(m, "ha_dashboard.update")[-1] == {"screen": "dashboard-loft", "url_path": "mantel-loft",
                                                    "title": "Loft Wall", "icon": "mdi:tablet", "require_admin": True}

    r = await put(m, "dashboard-loft", {"on": False})
    assert r.status == 200 and (await r.json())["dashboards"] == []
    assert "mantel_loft" not in ha.dashboards and "map" in ha.dashboards
    assert audits(m, "ha_dashboard.remove") == [{"screen": "dashboard-loft", "url_path": "mantel-loft"}]
    sent = {f["type"] for f in ha.frames}
    assert sent <= set(HD.ALLOWED)


async def test_one_made_by_hand_in_ha_counts_and_a_taken_name_gets_a_number(mantel, ha):
    m = mantel
    await owner(m)
    ha.dashboards["by_hand"] = {"id": "by_hand", "url_path": "by-hand", "title": "Kitchen", "mode": "storage",
                                "require_admin": False, "show_in_sidebar": False}
    ha.configs["by-hand"] = {"strategy": {"type": "iframe", "url": BASE + "dashboard-kitchen/home"}}
    got = await (await m.get(API)).json()
    assert [(x["url_path"], x["screen"], x["show_in_sidebar"]) for x in got["dashboards"]] == [("by-hand", "dashboard-kitchen", False)]
    ha.panels["mantel-loft"] = {}                                       # a panel of that name already
    assert (await put(m, "dashboard-loft", {"on": True})).status == 200
    assert "mantel_loft_2" in ha.dashboards
    assert (await put(m, "dashboard-kitchen", {"on": False})).status == 200
    assert "by_hand" not in ha.dashboards                               # off removes it, whoever made it


async def test_a_failed_config_save_leaves_no_half_dashboard(mantel, ha):
    m = mantel
    await owner(m)
    ha.fail_save = True
    r = await put(m, "dashboard-loft", {"on": True})
    assert r.status == 502 and (await r.json())["error"] == "ha_refused"
    assert set(ha.dashboards) == {"map"}


async def test_the_states_in_words(mantel, ha):
    m = mantel
    await owner(m)
    ha.is_admin = False
    got = await (await m.get(API)).json()
    assert got["state"] == "not_ha_admin"
    assert "Settings → Dashboards → Add Dashboard → Webpage" in got["message"] and BASE + "dashboard-" in got["message"]
    r = await put(m, "dashboard-loft", {"on": True})
    assert r.status == 403 and (await r.json())["error"] == "not_ha_admin"
    assert set(ha.dashboards) == {"map"} and not audits(m, "ha_dashboard.add")

    ha.is_admin = True
    m.app["connections"].ha_token = lambda: "revoked"                  # HA refuses Mantel's credential
    got = await (await m.get(API)).json()
    assert got["state"] == "ha_not_connected" and "Connections" in got["message"]
    assert (await put(m, "dashboard-loft", {"on": True})).status == 503

    m.app["connections"].ha_token = lambda: ""
    assert (await (await m.get(API)).json())["state"] == "ha_not_connected"

    m.app["cfg"].public_url = ""
    got = await (await m.get(API)).json()
    assert got["state"] == "direct_access_off" and "direct access" in got["message"]
    r = await put(m, "dashboard-loft", {"on": True})
    assert r.status == 409 and (await r.json())["error"] == "direct_access_off"


async def test_owner_and_admin_only_csrf_and_known_screens(mantel, ha):
    m = mantel
    await owner(m, "ann", "adult")
    assert (await m.get(API)).status == 403
    assert (await put(m, "dashboard-loft", {"on": True})).status == 403
    await owner(m, "adam", "admin")
    assert (await m.get(API)).status == 200
    r = await m.client.put("/api/admin/screens/dashboard-loft/ha-dashboard", json={"on": True})   # no CSRF token
    assert r.status == 403
    assert (await put(m, "dashboard-nope", {"on": True})).status == 404
    assert (await put(m, "dashboard-loft", {"on": "yes"})).status == 400
    assert (await put(m, "dashboard-loft", {"on": True, "icon": "<b>"})).status == 400
    assert (await put(m, "dashboard-loft", {"on": True, "title": "x" * 61})).status == 400
    assert set(ha.dashboards) == {"map"}
    assert (await put(m, "dashboard-loft", {"on": True})).status == 200


async def test_no_audit_row_no_change(mantel, ha):
    m = mantel
    await owner(m)

    def broken(event):
        raise RuntimeError("disk full")
    m.app["audit"].config_event = broken
    r = await put(m, "dashboard-loft", {"on": True})
    assert r.status == 503 and (await r.json())["error"] == "audit_unavailable"
    assert set(ha.dashboards) == {"map"}


async def test_the_https_page_gets_the_frame_ancestors(mantel):
    m = mantel
    await owner(m)
    m.app["cfg"].frame_ancestors = ("https://ha.example.com", "'self'")
    got = await (await m.get("/api/admin/proxy-check/summary")).json()
    assert got["frame_ancestors"] == ["https://ha.example.com"] and got["frame_option"] == "--frame-ancestors"
    m.app["cfg"].ha_managed_by_app = True
    assert (await (await m.get("/api/admin/proxy-check/summary")).json())["frame_option"] == "ha_frame_origins"


async def test_turned_on_inside_ha_by_an_owner_that_address_may_show_mantel(mantel, ha):
    """Show in Home Assistant, turned on in HA's sidebar opened at an address nobody listed, made a white page (the house,
    2026-10-19): the page sends the address it is shown in, and for an Owner that address is approved (audited)."""
    m = mantel
    await owner(m, "ada", "admin")
    r = await put(m, "dashboard-loft", {"on": True, "frame_origin": "https://ha.lan.example"})
    assert r.status == 200 and (await r.json())["frame_approved"] is None          # an Admin cannot approve frames
    m.forget_cookies()
    await owner(m)
    r = await put(m, "dashboard-kitchen", {"on": True, "frame_origin": "https://ha.lan.example/"})
    body = await r.json()
    assert r.status == 200 and body["frame_approved"] == "https://ha.lan.example"
    assert "https://ha.lan.example" in body["frame_ancestors"]
    assert "https://ha.lan.example" in (await m.get("/login")).headers["Content-Security-Policy"]
    assert (await put(m, "dashboard-loft", {"on": True, "frame_origin": 7})).status == 400
