"""Mantel Link against a REAL Home Assistant (docs/phase9/MANTEL-LINK.md): the scratch HA's Mantel Link
(custom_components/mantel) linked to Mantel in-process.

Phase ``alone`` (slice 9.2), a Home Assistant WITHOUT HK Frontend:
  1. Starts the scratch HA without HK Frontend (``testha.py up --fresh --no-hk``; Mantel Link installed,
     not set up), or ``--reuse`` one.
  2. Runs Mantel in-process on 127.0.0.1 against it, read-only (commands DISABLED), with a fictional
     wall tablet (Hall) that an Owner moves to Mantel, its ``linked`` piece on, a pop-up, and a Service
     account for HA.
  3. Adds Mantel Link through the scratch HA's own REST, as a user does in its UI (Settings, Devices &
     Services, Add, Mantel Link: the address and a pairing code the Owner made in Mantel Settings, 9.4).
     Then checks, on the real HA:
     - the tablet's four entities are live, Mantel Link's (platform ``mantel``), with Mantel's unique ids;
     - ``mantel.set_black_screen`` and the alias ``hk_frontend.set_black_screen`` both reach Mantel,
       and the black screen's ``confirmed`` handshake holds (the page's report confirms it);
     - ``mantel.show_popup`` and ``hk_frontend.show_popup`` reach Mantel's screens; an unknown pop-up is
       Mantel's validation error in HA under the name it was called by;
     - Mantel sees Mantel Link (protocol 2) and its report (no HK Frontend); an Owner hands it the
       bridge (Mantel Settings' REST, audited);
     - HA's diagnostics never show the credential.
  4. Removes Mantel Link's entry; stops the scratch HA (unless --keep-up / --reuse).

Phase ``handover`` (slice 9.3), a Home Assistant WITH HK Frontend, linked (``--phase handover``):
  1. Starts the scratch HA with HK Frontend (``testha.py up --fresh``), or ``--reuse`` one.
  2. Mantel as above, its linked entry id HK Frontend's; HK Frontend linked to it (Configure -> Linked to
     Mantel Server) mirrors the Hall tablet; Mantel Link is added and stays dormant.
  3. A sleep script (HA's own script engine, ``execute_script``) turns the Hall black through
     ``hk_frontend.set_black_screen`` and waits for the page's ``confirmed``.
  4. An Owner hands the bridge to Mantel Link (Mantel's REST, audited): the four registry entries move to
     Mantel Link (the same registry entries and entity ids, the device's area carried over); the page's
     confirm then ends the script; ``hk_frontend.set_black_screen`` still reaches the tablet; HA's history of
     the switch runs on across the move.
  5. The Owner gives the bridge back: HK Frontend takes the same entries back.
  6. Removes Mantel Link's entry and unlinks HK Frontend; stops the scratch HA (unless --keep-up / --reuse).

Phase ``zeroconf`` (slice 9.5): Mantel's real announcer (mantel_server/announce.py, run with the scratch HA's
own python-zeroconf) announces a fictional Mantel as ``_mantel._tcp`` on LOOPBACK ONLY, and the scratch HA
(``testha.py up --zeroconf-probe``: a scratch-only component browsing that one type on loopback, since HA's own
zeroconf would browse the home network) hands it to Mantel Link: "Discovered: Mantel" waits for a pairing code,
with Mantel's https address; a second announcement of the same Mantel makes no second flow. The code exchange
itself needs Mantel's real https address and is covered by the pairing tests and the alone phase.

SAFETY: refuses to run unless the HA URL is the scratch one; never reads ~/.config/mantel or touches
/Volumes/config or the house's HA. Prints no credential. Commands stay disabled throughout.
"""
from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import secrets
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "hosts/server"))
sys.path.insert(0, str(ROOT))

import aiohttp  # noqa: E402
from aiohttp.test_utils import TestServer  # noqa: E402

_spec = importlib.util.spec_from_file_location("gateway_e2e", ROOT / "tools/e2e/gateway_e2e.py")
GE = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(GE)
_spec2 = importlib.util.spec_from_file_location("linked_e2e", ROOT / "tools/e2e/linked_e2e.py")
LE = importlib.util.module_from_spec(_spec2)
_spec2.loader.exec_module(LE)
testha = GE.testha

SCRATCH_URL = GE.SCRATCH_URL
assert SCRATCH_URL == "http://127.0.0.1:8124"
TABLET = {"name": "Hall", "screen": "hk-e2e", "room": "bedroom", "app": "browser", "black_screen": "hk", "uid": "hall"}
BLACK, PHOTOS, SLEEP, INUSE = ("switch.hall_black_screen", "switch.hall_photo_screensaver",
                               "sensor.hall_sleep_screen", "binary_sensor.hall_screen_in_use")
RESULTS: list[str] = []


def say(*a):
    print("[mantel-link-e2e]", *a, flush=True)


def check(cond, what):
    if not cond:
        raise GE.Fail(what)
    say("PASS", what)
    RESULTS.append(what)


until = LE.until


class HA(LE.HA):
    """The scratch HA's own REST and WebSocket, as its admin."""

    async def add_mantel_link(self, url: str, token: str | None = None, code: str | None = None) -> dict:
        st, flow = await self.post("/api/config/config_entries/flow", {"handler": "mantel"})
        assert st == 200 and flow.get("step_id") == "user", flow
        st, done = await self.post(f"/api/config/config_entries/flow/{flow['flow_id']}",
                                   {"url": url, **({"token": token} if token else {}), **({"code": code} if code else {})})
        assert st == 200, done
        return done

    async def mantel_entry(self) -> dict | None:
        st, body = await self.get("/api/config/config_entries/entry?domain=mantel")
        return body[0] if st == 200 and body else None

    async def delete_entry(self, entry_id: str) -> None:
        async with self.http.delete(f"{SCRATCH_URL}/api/config/config_entries/entry/{entry_id}", headers=self.h) as r:
            await r.read()

    async def ws(self, **msg):
        async with self.http.ws_connect(SCRATCH_URL.replace("http", "ws") + "/api/websocket") as ws:
            await ws.receive_json()
            await ws.send_json({"type": "auth", "access_token": self.h["Authorization"].split(" ", 1)[1]})
            assert (await ws.receive_json())["type"] == "auth_ok"
            await ws.send_json({"id": 1, **msg})
            while True:
                m = await ws.receive_json()
                if m.get("id") == 1:
                    return m.get("result") if m.get("success") else {"error": m.get("error")}

    async def registry(self, eid: str) -> dict:
        return await self.ws(type="config/entity_registry/get", entity_id=eid)


def mantel_app(token: str, folder: Path, entry_id: str | None = None, port: int = 0, board: dict | None = None,
               frame_ancestors: tuple[str, ...] = ()):
    from mantel_server import features
    from mantel_server.config import Config
    from mantel_server.server import build_app
    from mantel_server.settings_store import Actor
    from mantel_server.store import Store
    cfg = Config(data_dir=folder / "data", secrets_dir=folder / "secrets", port=port, ha_url=SCRATCH_URL,
                 frame_ancestors=tuple(frame_ancestors),
                 ha_ws_url=SCRATCH_URL.replace("http", "ws") + "/api/websocket", commands_enabled=False)
    assert cfg.ha_url == SCRATCH_URL and "192.168." not in cfg.ha_url
    store = Store(cfg.data_dir / "mantel.db")
    app = build_app(cfg, token, store=store, connect_ha=True)
    app["settings"].store.write([
        ("board", "hk-e2e", dict(board or {})),
        ("tablet", "hall", dict(TABLET)),
        ("house", "popups", {"items": [{"hash": "doorbell", "name": "Doorbell"}]}),
        ("house", features.FEATURES_DOC, features.check_settings(
            {"linked": {"enabled": True, **({"entry_id": entry_id} if entry_id else {})}})),
    ], actor=Actor(label="e2e"))
    return app, store, cfg


async def run_alone(token: str) -> dict:
    out: dict = {}
    with tempfile.TemporaryDirectory(prefix="mantel-link-e2e-") as folder:
        app, store, cfg = mantel_app(token, Path(folder))
        hub = app["hub"]
        async with aiohttp.ClientSession() as http, TestServer(app, host="127.0.0.1") as server:
            ha = HA(http, token)
            base = str(server.make_url("")).rstrip("/")
            await asyncio.wait_for(hub.ha.ready.wait(), 60)
            check(not cfg.commands_enabled and app.get("gateway") is None,
                  "Mantel runs with house commands DISABLED (no gateway, no command connection)")
            st, _ = await ha.get("/api/config/config_entries/entry?domain=hk_frontend")
            check(st == 200 and not _, "the scratch HA has no HK Frontend")
            owner = GE.Browser(base, "owner")
            try:
                st, body = await owner.post("/api/bootstrap", {
                    "token": app["accounts"].issue_bootstrap_token(), "username": "e2e-owner",
                    "name": "Fictional Owner", "password": secrets.token_urlsafe(18)})
                assert st == 200, body
                st, body = await owner.post("/api/linked/owners", {"unit": "hall", "owner": "mantel"}, method="PUT")
                check(st == 200 and body["wire"]["tablets"] == ["hall"], "an Owner moves the Hall tablet to Mantel")
                try:
                    await steps_alone(app, ha, owner, base, out)
                finally:
                    e = await ha.mantel_entry()
                    if e:
                        await ha.delete_entry(e["entry_id"])
                        say("removed Mantel Link's entry from the scratch HA")
            finally:
                await owner.http.close()
            out["audit"] = [{k: r[k] for k in ("actor", "role", "kind", "action", "target", "decision")}
                            for r in app["audit"].rows()]
        store.db.close()
    return out


async def steps_alone(app, ha: HA, owner, base: str, out: dict) -> None:
    lk = app["linked"]
    instance = lk.instance
    st, made = await owner.post("/api/linked/pair", {})
    check(st == 200 and made.get("code"), "the Owner makes a pairing code (Mantel Settings, Home Assistant Link)")
    done = await ha.add_mantel_link(base, code=made["code"])
    check(done.get("type") == "create_entry", "Settings, Devices & Services, Add, Mantel Link: the address and the "
                                               "code, traded for a credential, tested and saved")
    entry = done["result"]["entry_id"]
    st, pend = await owner.post("/api/linked/pair", method="GET")
    check(pend.get("pending") is None and pend.get("paired"), "the code is spent; Mantel made the credential")
    diag = await until(lambda: _diag(ha, entry, lambda d: d.get("connected")))
    check(diag is not None and diag["instance"] == instance and diag["protocol"] == 2,
          "HA's diagnostics: linked to this Mantel (its instance id), protocol 2")
    clients = await until(lambda: asyncio.sleep(0, lk.registry.clients_of("mantel")))
    check(bool(clients) and clients[0].protocol == 2 and "bridge" in clients[0].features,
          "Mantel sees Mantel Link, speaking protocol 2")
    rep = await until(lambda: asyncio.sleep(0, clients[0].report.get("hk_frontend")))
    check(rep == {"installed": False, "loaded": False, "linked": False}, "...and its report: no HK Frontend here")
    states = await until(lambda: _all_live(ha))
    check(states is not None, "the Hall tablet's four entities are live in HA: " + ", ".join(sorted(states or {})))
    regs = {eid: await ha.registry(eid) for eid in (BLACK, PHOTOS, SLEEP, INUSE)}
    check(all(r.get("platform") == "mantel" and r.get("config_entry_id") == entry for r in regs.values()),
          "each is Mantel Link's (platform mantel, its entry)")
    check(all(r.get("unique_id") == f"{instance}_hall_{eid.split('.', 1)[1][5:]}" for eid, r in regs.items()),
          "with Mantel's unique ids (no HK Frontend ever: Mantel's instance id, the tablet, the key)")
    out["registry"] = {eid: {k: r.get(k) for k in ("unique_id", "platform")} for eid, r in regs.items()}
    # -- set_black_screen under both names, and the confirmed handshake ---------------------------------
    owner.ws = await owner.http.ws_connect(base + "/ws")
    n = 100
    for domain in ("mantel", "hk_frontend"):
        s, _ = await ha.post(f"/api/services/{domain}/set_black_screen",
                             {"entity_id": BLACK, "black": True, "brightness": 150})
        st = await ha.state(BLACK)
        check(s == 200 and st["state"] == "on" and st["attributes"].get("confirmed") is False
              and st["attributes"].get("brightness") == 150,
              f"{domain}.set_black_screen reaches Mantel: on, brightness 150, not yet confirmed when it returns")
        n += 1
        await owner.ws.send_json({"type": "screen_report", "id": n, "tablet": "hall", "black": True})
        got = await until(lambda: _attr_is(ha, BLACK, "confirmed", True))
        check(got is not None, "the page says it went black: HA sees confirmed: true")
        s, _ = await ha.post(f"/api/services/{domain}/set_black_screen", {"entity_id": BLACK, "black": False})
        st = await ha.state(BLACK)
        check(s == 200 and st["state"] == "off", f"{domain}.set_black_screen off")
    # -- pop-ups under both names -------------------------------------------------------------------------
    await owner.ws.send_json({"type": "read_subscribe", "id": 7, "msg": {"type": "hk_frontend/events/subscribe"}})
    while True:
        got = await owner.recv()
        if got.get("type") == "read_result" and got.get("id") == 7:
            break
    assert "error" not in got, got
    for domain in ("mantel", "hk_frontend"):
        s, _ = await ha.post(f"/api/services/{domain}/show_popup", {"popup": "doorbell"})
        ev = await _event(owner, "popup")
        check(s == 200 and ev is not None and ev.get("popup") == "doorbell",
              f"{domain}.show_popup reaches a Mantel screen's event feed")
    log = Path(testha.SCRATCH) / "hass.log"
    words = "Mantel refused hk_frontend.show_popup"
    seen = log.read_text(errors="replace").count(words)
    s, _ = await ha.post("/api/services/hk_frontend/show_popup", {"popup": "no-such-popup"})
    now = log.read_text(errors="replace").count(words)
    check(s >= 400 and now > seen, f"an unknown pop-up is Mantel's validation error in HA (HTTP {s}; '{words}' in HA's log)")
    await owner.ws.close()
    # -- the bridge: an Owner hands it to Mantel Link (no HK Frontend here, so nothing to wait for) ---------
    st_code, body = await owner.post("/api/linked/owners", {"unit": "bridge", "owner": "mantel"}, method="PUT")
    check(st_code == 200 and body["wire"]["bridge"] == "mantel", "an Owner hands the bridge to Mantel Link")
    rows = app["audit"].rows(kind="config")
    check(rows and rows[-1]["action"] == "linked.bridge", "the hand-over is audited (linked.bridge)")
    diag = await until(lambda: _diag(ha, entry, lambda d: d.get("owners", {}).get("bridge") == "mantel"
                                     and d.get("connected")))
    check(diag is not None and diag["state"] == "mirroring" and diag["connected"],
          "HA's diagnostics: connected, mirroring, Mantel Link holds the bridge")
    check("msvc_" not in json.dumps(diag), "no credential in HA's diagnostics")
    st = await until(lambda: _all_live(ha))
    check(st is not None, "the four entities are still live after the reload")
    check(app["audit"].rows(kind="service") == [], "no household service was called (commands disabled)")


async def _all_live(ha: HA):
    out = {}
    for eid in (BLACK, PHOTOS, SLEEP, INUSE):
        st = await ha.state(eid)
        if st is None or st["state"] in ("unavailable", "unknown"):
            return None
        out[eid] = st["state"]
    return out


async def _attr_is(ha: HA, eid: str, key: str, value):
    st = await ha.state(eid)
    return st if st is not None and st["attributes"].get(key) == value else None


async def _diag(ha: HA, entry: str, ok):
    st, body = await ha.get(f"/api/diagnostics/config_entry/{entry}")
    d = (body or {}).get("data") if st == 200 and isinstance(body, dict) else None
    return d if d is not None and ok(d) else None        # not answering while the entry reloads


async def _event(owner, kind: str, timeout: float = 15.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            m = await owner.recv(timeout)
        except asyncio.TimeoutError:
            return None
        if m.get("type") == "read_event" and m.get("id") == 7 and m["event"].get("type") == kind:
            return m["event"]
    return None


# ------------------------------------------------------------------------------------- phase: handover
async def run_handover(token: str) -> dict:
    out: dict = {}
    with tempfile.TemporaryDirectory(prefix="mantel-link-e2e-") as folder:
        async with aiohttp.ClientSession() as http:
            ha = HA(http, token)
            hk_entry = await ha.entry_id()
            app, store, cfg = mantel_app(token, Path(folder), entry_id=hk_entry)
            hub = app["hub"]
            async with TestServer(app, host="127.0.0.1") as server:
                base = str(server.make_url("")).rstrip("/")
                await asyncio.wait_for(hub.ha.ready.wait(), 60)
                check(not cfg.commands_enabled and app.get("gateway") is None,
                      "Mantel runs with house commands DISABLED (no gateway, no command connection)")
                owner = GE.Browser(base, "owner")
                try:
                    st, body = await owner.post("/api/bootstrap", {
                        "token": app["accounts"].issue_bootstrap_token(), "username": "e2e-owner",
                        "name": "Fictional Owner", "password": secrets.token_urlsafe(18)})
                    assert st == 200, body
                    st, body = await owner.post("/api/linked/owners", {"unit": "hall", "owner": "mantel"}, method="PUT")
                    check(st == 200, "an Owner moves the Hall tablet to Mantel")
                    _a, svc_hk = app["service_accounts"].create("scratch-hk-frontend", ["linked"])
                    _b, svc_ml = app["service_accounts"].create("scratch-mantel-link", ["linked"])
                    try:
                        await steps_handover(app, ha, owner, base, hk_entry, svc_hk, svc_ml, out)
                    finally:
                        e = await ha.mantel_entry()
                        if e:
                            await ha.delete_entry(e["entry_id"])
                            say("removed Mantel Link's entry from the scratch HA")
                        try:
                            await ha.configure_link(hk_entry, enabled=False)
                            say("unlinked HK Frontend in the scratch HA")
                        except Exception as exc:  # noqa: BLE001
                            say("note: could not unlink HK Frontend:", exc)
                finally:
                    await owner.http.close()
                out["audit"] = [{k: r[k] for k in ("actor", "role", "kind", "action", "target", "decision")}
                                for r in app["audit"].rows()]
            store.db.close()
    return out


async def _platforms(ha: HA) -> dict:
    return {eid: (await ha.registry(eid)) for eid in (BLACK, PHOTOS, SLEEP, INUSE)}


async def _all_on(ha: HA, platform: str):
    regs = await _platforms(ha)
    if not all(r.get("platform") == platform for r in regs.values()):
        return None
    return regs if await _all_live(ha) else None


async def steps_handover(app, ha: HA, owner, base: str, hk_entry: str, svc_hk: str, svc_ml: str, out: dict) -> None:
    lk = app["linked"]
    t0 = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(time.time() - 5)) + "+00:00"
    done = await ha.configure_link(hk_entry, enabled=True, url=base, token=svc_hk)
    check(done.get("type") == "menu", "HK Frontend: Configure -> Linked to Mantel Server saved")
    regs = await until(lambda: _all_on(ha, "hk_frontend"), timeout=60)
    check(regs is not None, "HK Frontend mirrors the Hall tablet's four entities (platform hk_frontend)")
    ids = {eid: r["id"] for eid, r in regs.items()}
    hk_client = await until(lambda: asyncio.sleep(0, lk.registry.clients_of("hk_frontend")))
    check(bool(hk_client) and "bridge" in hk_client[0].features, "HK Frontend says it can hand over (feature bridge)")
    areas = await ha.ws(type="config/area_registry/list")
    area = next((a for a in areas if a["name"] == "E2E Hall"), None) or \
        await ha.ws(type="config/area_registry/create", name="E2E Hall")
    await ha.ws(type="config/device_registry/update", device_id=regs[BLACK]["device_id"], area_id=area["area_id"])
    done = await ha.add_mantel_link(base, svc_ml)
    check(done.get("type") == "create_entry", "Mantel Link added through HA's own flow")
    ml_entry = done["result"]["entry_id"]
    diag = await until(lambda: _diag(ha, ml_entry, lambda d: d.get("connected")))
    check(diag is not None and diag["state"] == "dormant" and diag["hk_frontend"] == {
        "installed": True, "loaded": True, "linked": True}, "Mantel Link is dormant: HK Frontend holds the bridge")
    link_client = lk.registry.clients_of("mantel")
    rep = await until(lambda: asyncio.sleep(0, link_client and link_client[0].report.get("hk_frontend")))
    check(rep == {"installed": True, "loaded": True, "linked": True}, "Mantel knows HK Frontend is there and linked")
    # -- a sleep script, waiting on the page's confirm -------------------------------------------------------
    async with ha.http.ws_connect(SCRATCH_URL.replace("http", "ws") + "/api/websocket") as ws:
        await ws.receive_json()
        await ws.send_json({"type": "auth", "access_token": ha.h["Authorization"].split(" ", 1)[1]})
        assert (await ws.receive_json())["type"] == "auth_ok"
        await ws.send_json({"id": 1, "type": "subscribe_events", "event_type": "mantel_e2e_sleep_done"})
        assert (await ws.receive_json())["success"]
        await ws.send_json({"id": 2, "type": "execute_script", "sequence": [
            {"action": "hk_frontend.set_black_screen", "target": {"entity_id": BLACK},
             "data": {"black": True, "brightness": 120}},
            {"wait_template": "{{ state_attr('%s', 'confirmed') }}" % BLACK, "timeout": 120,
             "continue_on_timeout": False},
            {"event": "mantel_e2e_sleep_done"}]})
        st = await until(lambda: _state_is(ha, BLACK, ("on",)))
        check(st is not None and st["attributes"].get("confirmed") is False,
              "the sleep script turned the Hall black through hk_frontend.set_black_screen and waits for the confirm")
        # -- the hand-over ----------------------------------------------------------------------------------
        st_code, body = await owner.post("/api/linked/owners", {"unit": "bridge", "owner": "mantel"}, method="PUT")
        check(st_code == 200 and body["wire"]["bridge"] == "mantel", "an Owner hands the bridge to Mantel Link")
        check(app["audit"].rows(kind="config")[-1]["action"] == "linked.bridge", "audited (linked.bridge)")
        regs = await until(lambda: _all_on(ha, "mantel"), timeout=90)
        check(regs is not None, "the four are Mantel Link's now, live")
        check({eid: r["id"] for eid, r in regs.items()} == ids, "the same registry entries (and so the same entity ids)")
        check(all(r["config_entry_id"] == ml_entry for r in regs.values()), "on Mantel Link's entry")
        dev = await ha.ws(type="config/device_registry/list")
        mine = next((d for d in dev if d["id"] == regs[BLACK]["device_id"]), None)
        check(mine is not None and mine["area_id"] == area["area_id"] and ml_entry in mine["config_entries"],
              "on Mantel Link's own device for the Hall, in the area HK Frontend's device had")
        owner.ws = await owner.http.ws_connect(base + "/ws")
        await owner.ws.send_json({"type": "screen_report", "id": 300, "tablet": "hall", "black": True})
        got = None
        t1 = time.time()
        while time.time() - t1 < 20:
            m = await asyncio.wait_for(ws.receive_json(), 20)
            if m.get("id") == 2:
                check(m.get("success") is True, "the sleep script ran without an error")
            if m.get("id") == 1 and m.get("type") == "event":
                got = m
                break
        check(got is not None, "the page's confirm ended the sleep script's wait (it never failed across the move)")
    # -- hk_frontend.set_black_screen still reaches it (HK Frontend's, through Mantel Link) -----------------
    s, _ = await ha.post("/api/services/hk_frontend/set_black_screen", {"entity_id": BLACK, "black": False})
    st = await until(lambda: _state_is(ha, BLACK, ("off",)))
    check(s == 200 and st is not None, "hk_frontend.set_black_screen (HK Frontend's) reaches the Hall through Mantel Link")
    async def history():
        # the recorder writes every few seconds: ask until the latest change is in
        st, hist = await ha.get(f"/api/history/period/{t0}?filter_entity_id={BLACK}&minimal_response&no_attributes")
        got = [x["state"] for x in (hist[0] if st == 200 and hist else [])]
        return got if got and got[-1] == "off" and "on" in got else None
    states = await until(history, timeout=30) or []
    check(states[:1] != [] and "on" in states and states[-1] == "off",
          f"HA's history of {BLACK} runs on across the move ({' -> '.join(states)})")
    out["history"] = states
    # -- and back -----------------------------------------------------------------------------------------------
    st_code, body = await owner.post("/api/linked/owners", {"unit": "bridge", "owner": "hk_frontend"}, method="PUT")
    check(st_code == 200 and body["wire"]["bridge"] == "hk_frontend", "the Owner gives the bridge back to HK Frontend")
    regs = await until(lambda: _all_on(ha, "hk_frontend"), timeout=90)
    check(regs is not None and {eid: r["id"] for eid, r in regs.items()} == ids,
          "HK Frontend takes the same registry entries back, live")
    diag = await until(lambda: _diag(ha, ml_entry, lambda d: d.get("connected") and d.get("state") == "dormant"))
    check(diag is not None, "Mantel Link is dormant again")
    check(app["audit"].rows(kind="service") == [], "no household service was called (commands disabled)")
    await owner.ws.close()


async def _state_is(ha: HA, eid: str, states: tuple[str, ...]):
    st = await ha.state(eid)
    return st if st is not None and st["state"] in states else None


# ------------------------------------------------------------------------------------- phase: zeroconf
async def run_zeroconf(token: str) -> dict:
    import os
    import subprocess
    out: dict = {}
    instance = secrets.token_hex(16)
    with tempfile.TemporaryDirectory(prefix="mantel-link-zc-") as folder:
        from mantel_server import announce
        f = Path(folder) / "announce.json"
        announce.write(f, instance, "https://mantel.example.test:8443/")
        py = Path(testha.VENV) / "bin/python"
        env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
        env["PYTHONPATH"] = str(ROOT / "hosts/server")
        proc = subprocess.Popen([str(py), "-m", "mantel_server.announce", "--file", str(f), "--every", "1",
                                 "--interface", "127.0.0.1"], env=env, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True)
        try:
            async with aiohttp.ClientSession() as http:
                ha = HA(http, token)

                async def flow():
                    flows = await ha.ws(type="config_entries/flow/progress")
                    mine = [x for x in (flows if isinstance(flows, list) else []) if x.get("handler") == "mantel"
                            and (x.get("context") or {}).get("unique_id") == instance]
                    return mine or None
                got = await until(flow, timeout=60)
                check(got is not None and len(got) == 1, "the announcement on loopback reached the real HA: one "
                      "'Discovered: Mantel' flow, keyed by Mantel's instance id")
                fl = got[0]
                check(fl["context"].get("source") == "zeroconf" and fl.get("step_id") == "zeroconf_confirm",
                      "it waits for a pairing code (zeroconf_confirm)")
                st, form = await ha.get(f"/api/config/config_entries/flow/{fl['flow_id']}")
                check(st == 200 and (form.get("description_placeholders") or {}).get("url")
                      == "https://mantel.example.test:8443", "with Mantel's https address from the announcement")
                check([k["name"] for k in form.get("data_schema") or []] == ["code"], "asking only for the code")
                await asyncio.sleep(3)
                again = await flow()
                check(again is not None and len(again) == 1, "the same Mantel announced again: still one flow")
                async with http.delete(f"{SCRATCH_URL}/api/config/config_entries/flow/{fl['flow_id']}",
                                       headers=ha.h) as r:
                    await r.read()
                out["flow"] = {k: fl.get(k) for k in ("handler", "step_id")}
        finally:
            proc.terminate()
            try:
                logs = proc.communicate(timeout=10)[0]
            except subprocess.TimeoutExpired:
                proc.kill()
                logs = proc.communicate()[0]
            out["announcer"] = logs[-2000:]
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--keep-up", action="store_true", help="leave the scratch HA running afterwards")
    ap.add_argument("--reuse", action="store_true", help="use the scratch HA this caller already started; leave it up")
    ap.add_argument("--phase", choices=["alone", "handover", "zeroconf"], default="alone",
                    help="alone: no HK Frontend (9.2); handover: HK Frontend linked, the bridge handed over and back (9.3)")
    a = ap.parse_args()
    if not a.reuse:
        GE.wait_for_free_harness()
        extra = {"alone": ("--no-hk",), "handover": (), "zeroconf": ("--no-hk", "--zeroconf-probe")}[a.phase]
        say(f"starting the scratch HA (testha.py up --fresh {' '.join(extra)}); this takes a few minutes")
        GE.harness("up", "--fresh", *extra)
    elif not testha.ready():
        raise SystemExit("--reuse: the scratch HA is not answering on 127.0.0.1:8124")
    try:
        token = asyncio.run(GE.token_for_scratch())
        evidence = asyncio.run({"alone": run_alone, "handover": run_handover, "zeroconf": run_zeroconf}[a.phase](token))
        del token
        out = Path(testha.SCRATCH) / f"mantel_link_e2e_{a.phase}.json"
        out.write_text(json.dumps({"checks": RESULTS, **evidence}, indent=1, default=str))
        say(f"ALL {len(RESULTS)} CHECKS PASSED; evidence in {out}")
        return 0
    except GE.Fail as exc:
        say("FAIL", exc)
        return 1
    finally:
        if not (a.keep_up or a.reuse):
            GE.harness("down")
            say("scratch HA stopped")


if __name__ == "__main__":
    sys.exit(main())
