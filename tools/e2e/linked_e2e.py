"""Linked mode against a REAL Home Assistant: the scratch HA's hk_frontend linked to Mantel Server
in-process, per-tablet ownership and the rest of the entry (docs/phase5/LINKED-MODE.md).

1. Starts the scratch HA (``tools/testha``; waits while another job uses it), or ``--reuse`` it.
2. Runs Mantel in-process on 127.0.0.1 against it, read-only (commands DISABLED: nothing it does may
   call a household service), with the ``linked`` and ``notifications`` pieces on, and a Service
   account for HA.
3. Through the scratch HA's own REST (as a person would in its UI): Configure -> Linked to Mantel Server
   with Mantel's loopback address and the credential. Then checks, on the real HA:
   - linked with nothing moved: HA's own Seasonal decorations stays HA's, the link says hello, HA's
     diagnostics name the owners (everything HA's) and never the credential;
   - an Owner moves ``house`` to Mantel (Mantel's REST, an Owner's session, audited): HA keeps the
     ownership and reloads; ``switch.hk_frontend_seasonal_decorations`` is now Mantel's (same entity
     id); turning it off in HA saves Mantel's setting and HA shows the state Mantel pushes back;
   - ``hk_frontend.notify`` called in HA reaches a Mantel screen's event feed; ``show_popup`` for an
     unknown pop-up is Mantel's validation error in HA;
   - HK's settings are Mantel's while it runs the house (decision 29, docs/phase9/TWO-PRODUCTS.md): HA's
     dashboards' settings feed is Mantel's and follows a change made in Mantel; a save made in HA is refused
     while Changes from Home Assistant is off, and made in Mantel as the linked person once it is on;
   - the Owner moves ``house`` back: HA's own switch again, same entity id, and HA keeps Mantel's last
     settings as its own; unlinking forgets it.
4. Stops the scratch HA (unless --keep-up / --reuse).

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
testha = GE.testha

SCRATCH_URL = GE.SCRATCH_URL
SEASONAL = "switch.hk_frontend_seasonal_decorations"
RESULTS: list[str] = []


def say(*a):
    print("[linked-e2e]", *a, flush=True)


def check(cond, what):
    if not cond:
        raise GE.Fail(what)
    say("PASS", what)
    RESULTS.append(what)


async def until(fn, timeout=30.0, every=0.25):
    t0 = time.time()
    while True:
        got = await fn()
        if got or time.time() - t0 > timeout:
            return got
        await asyncio.sleep(every)


class HA:
    """The scratch HA's own REST, as its admin (the harness's token)."""

    def __init__(self, http: aiohttp.ClientSession, token: str) -> None:
        self.http, self.h = http, {"Authorization": f"Bearer {token}"}

    async def get(self, path: str):
        async with self.http.get(SCRATCH_URL + path, headers=self.h) as r:
            return r.status, await r.json(content_type=None)

    async def post(self, path: str, body: dict):
        async with self.http.post(SCRATCH_URL + path, headers=self.h, json=body) as r:
            text = await r.text()
            try:
                return r.status, json.loads(text)
            except ValueError:
                return r.status, text

    async def state(self, eid: str) -> dict | None:
        st, body = await self.get(f"/api/states/{eid}")
        return body if st == 200 else None

    async def entry_id(self) -> str:
        st, body = await self.get("/api/config/config_entries/entry?domain=hk_frontend")
        assert st == 200, body
        return next(e["entry_id"] for e in body if not (e.get("title") or "").endswith(" PIN"))

    async def configure_link(self, entry_id: str, **user_input) -> dict:
        st, flow = await self.post("/api/config/config_entries/options/flow", {"handler": entry_id})
        assert st == 200, flow
        st, flow = await self.post(f"/api/config/config_entries/options/flow/{flow['flow_id']}",
                                   {"next_step_id": "linked"})
        assert st == 200 and flow.get("step_id") == "linked", flow
        st, done = await self.post(f"/api/config/config_entries/options/flow/{flow['flow_id']}", user_input)
        assert st == 200, done
        return done

    async def diagnostics(self, entry_id: str) -> dict:
        st, body = await self.get(f"/api/diagnostics/config_entry/{entry_id}")
        assert st == 200, body
        return body.get("data") or {}


async def run(token: str) -> dict:
    from mantel_server import features
    from mantel_server.config import Config
    from mantel_server.server import build_app
    from mantel_server.settings_store import Actor
    from mantel_server.store import Store

    out: dict = {}
    with tempfile.TemporaryDirectory(prefix="mantel-linked-e2e-") as folder:
        base_dir = Path(folder)
        cfg = Config(data_dir=base_dir / "data", secrets_dir=base_dir / "secrets", port=0, ha_url=SCRATCH_URL,
                     ha_ws_url=SCRATCH_URL.replace("http", "ws") + "/api/websocket", commands_enabled=False)
        store = Store(cfg.data_dir / "mantel.db")
        app = build_app(cfg, token, store=store, connect_ha=True)
        hub = app["hub"]
        async with aiohttp.ClientSession() as http:
            ha = HA(http, token)
            entry = await ha.entry_id()
            app["settings"].store.write([("house", features.FEATURES_DOC, features.check_settings({
                "linked": {"enabled": True, "entry_id": entry},
                "notifications": {"enabled": True}}))], actor=Actor(label="e2e"))
            async with TestServer(app, host="127.0.0.1") as server:
                base = str(server.make_url("")).rstrip("/")
                await asyncio.wait_for(hub.ha.ready.wait(), 60)
                check(not cfg.commands_enabled and app.get("gateway") is None,
                      "Mantel runs with house commands DISABLED (no gateway, no command connection)")
                _acct, svc = app["service_accounts"].create("scratch-home-assistant", ["linked"])
                owner = GE.Browser(base, "owner")
                try:
                    st, body = await owner.post("/api/bootstrap", {
                        "token": app["accounts"].issue_bootstrap_token(), "username": "e2e-owner",
                        "name": "Fictional Owner", "password": secrets.token_urlsafe(18)})
                    assert st == 200, body
                    await steps(app, ha, owner, entry, base, svc, out)
                finally:
                    # whatever happened: unlink the scratch HA, so it is left as it was
                    try:
                        await ha.configure_link(entry, enabled=False)
                    except Exception as exc:  # noqa: BLE001
                        say("note: could not unlink the scratch HA:", exc)
                    await owner.http.close()
                out["audit"] = [{k: r[k] for k in ("actor", "role", "kind", "action", "target", "decision")}
                                for r in app["audit"].rows()]
        store.db.close()
    return out


class HaWs:
    """The scratch HA's websocket, as its admin (the harness's token): what HK's pages call."""

    def __init__(self, http: aiohttp.ClientSession, token: str) -> None:
        self.http, self.token, self.n = http, token, 0
        self.events: list[dict] = []

    async def open(self) -> "HaWs":
        self.ws = await self.http.ws_connect(SCRATCH_URL.replace("http", "ws") + "/api/websocket")
        await self.ws.receive_json()
        await self.ws.send_json({"type": "auth", "access_token": self.token})
        assert (await self.ws.receive_json()).get("type") == "auth_ok"
        return self

    async def call(self, msg: dict, timeout: float = 15.0) -> dict:
        self.n += 1
        await self.ws.send_json({"id": self.n, **msg})
        while True:
            m = await self.ws.receive_json(timeout=timeout)
            if m.get("type") == "event":
                self.events.append(m)
            elif m.get("id") == self.n and m.get("type") == "result":
                return m

    async def feed(self, test, timeout: float = 20.0) -> dict | None:
        """The settings feed's next event that passes `test` (subscribed once by `subscribe`)."""
        t0 = time.time()
        for m in list(self.events):
            if m.get("id") == self.sub and test(m["event"]):
                return m["event"]
        while time.time() - t0 < timeout:
            try:
                m = await self.ws.receive_json(timeout=max(0.1, timeout - (time.time() - t0)))
            except asyncio.TimeoutError:
                return None
            if m.get("type") == "event":
                self.events.append(m)
            if m.get("type") == "event" and m.get("id") == self.sub and test(m["event"]):
                return m["event"]
        return None

    async def subscribe(self) -> None:
        got = await self.call({"type": "hk_frontend/settings/subscribe"})
        assert got.get("success"), got
        self.sub = self.n


async def settings_steps(app, ha: HA, ws: "HaWs", owner) -> None:
    """While Mantel runs the house: HK's settings are Mantel's (decision 29)."""
    from mantel_server.settings_store import Actor
    service = app["settings"]
    service.store.write([("board", "dashboard-e2e", {"accent": "blue"})], actor=Actor(label="e2e"))
    service.publish()
    await ws.subscribe()
    got = await ws.feed(lambda e: "dashboard-e2e" in (e.get("boards") or {}))
    check(got is not None, "HA's dashboards get Mantel's settings (a screen only Mantel has is in HA's feed)")
    service.store.write([("board", "dashboard-e2e2", {})], actor=Actor(label="e2e"))
    service.publish()
    check(await ws.feed(lambda e: "dashboard-e2e2" in (e.get("boards") or {})) is not None,
          "...and follow a change made in Mantel")
    save = {"type": "hk_frontend/calendar/color", "key": "uid:e2e", "color": "teal"}
    me = await ws.call({"type": "auth/current_user"})
    got = await ws.call(save)
    check(not got["success"] and got["error"]["code"] == "saves_off",
          "a save made in HA is refused while Changes from Home Assistant is off (in words)")
    st, body = await owner.post("/api/linked/ha-saves", {"on": True}, method="PUT")
    check(st == 200 and body["saves"] is True, "the Owner turns Changes from Home Assistant on")
    got = await ws.call(save)
    check(not got["success"] and got["error"]["code"] == "not_linked",
          "an HA user linked to nobody in Mantel can't save (told to link it)")
    app["store"].link(me["result"]["id"], "admin", "Fictional HA Admin")
    got = await ws.call(save)
    colors = ((service.house_settings().get("calendar") or {}).get("event_colors") or {})
    check(got["success"] and colors.get("uid:e2e") == "teal", "linked, the save is made in Mantel, as that person")
    seen = await ws.feed(lambda e: ((e.get("calendar") or {}).get("event_colors") or {}).get("uid:e2e") == "teal")
    check(seen is not None, "...and HA's dashboards see it (Mantel's new settings come back over the link)")
    hist = service.store.history("house", "settings", 1)[0]
    # -- a dashboard's feature reads, answered by Mantel as the person (linked_reads.py) -------------------------
    got = await ws.call({"type": "hk_tv/channels"})
    ctxs = app["linked_reads"].ctxs
    check(got.get("success") and any(k[1] == me["result"]["id"] for k in ctxs),
          "a dashboard's Live TV channels in HA are answered by Mantel, as the linked person")
    got = await ws.call({"type": "hk_frontend/page_headers/subscribe"})
    open_subs = sum(len(c.subs) for c in ctxs.values())
    check(got.get("success") and open_subs >= 1, "a dashboard's live feed (the page headers) stays open at Mantel")
    # -- a screen Home Assistant draws (screens.py): HK's generated dashboard is made there, then removed --------
    st, body = await owner.post("/api/screens", {"title": "E2E HA Screen", "where": "ha"})
    check(st == 200 and body.get("key") == "e2e-ha-screen", f"the Owner adds a screen Home Assistant draws ({st})")
    got = await ws.call({"type": "lovelace/config", "url_path": "e2e-ha-screen"})
    check(got.get("success") and got["result"] == {"strategy": {"type": "custom:hk-dashboard"}},
          "Home Assistant has HK's generated dashboard at its address, and nothing else in its config")
    seen = await ws.feed(lambda e: ((e.get("boards") or {}).get("e2e-ha-screen") or {}).get("where") == "ha")
    check(seen is not None, "HK Frontend's dashboards get it with Mantel's settings, marked Home Assistant's")
    st, body = await owner.post("/api/screens/e2e-ha-screen", {"remove_ha": True}, method="PUT")
    got = await ws.call({"type": "lovelace/config", "url_path": "e2e-ha-screen"})
    check(st == 200 and not got.get("success"), "...and Mantel removes Home Assistant's generated dashboard again")
    st, _ = await owner.post("/api/screens/e2e-ha-screen", {}, method="DELETE")
    check(st == 200 and service.store.get("board", "e2e-ha-screen") is None, "the screen is removed from Mantel")
    check(hist["source"] == "Home Assistant" and hist["actor_role"] == "admin",
          "Mantel's settings history says who, from Home Assistant")


async def steps(app, ha: HA, owner, entry: str, base: str, svc: str, out: dict) -> None:
    lk = app["linked"]
    # -- linked, nothing moved ------------------------------------------------------------------------
    before = await ha.state(SEASONAL)
    check(before is not None and before["state"] in ("on", "off"), f"the scratch HA has its own {SEASONAL}")
    done = await ha.configure_link(entry, enabled=True, url=base, token=svc)
    check(done.get("type") == "menu", "Configure -> Linked to Mantel Server saved (loopback http allowed)")
    check(await until(lambda: asyncio.sleep(0, bool(lk.registry.clients))), "HA's link says hello to Mantel")
    diag = await until(lambda: _diag_connected(ha, entry))
    check(diag and diag["linked"]["owners"] == {"house": "ha", "tablets": [], "bridge": "hk_frontend"} and diag["linked"]["connected"],
          "HA's diagnostics: linked, connected, everything still Home Assistant's")
    check(svc not in json.dumps(diag), "the credential is not in HA's diagnostics")
    check(lk.registry.entities == {}, "Mantel publishes nothing while it owns nothing")
    st = await ha.state(SEASONAL)
    check(st["state"] == before["state"] and st["state"] != "unavailable", "Seasonal decorations is still HA's own")
    # -- an Owner moves the rest of the entry to Mantel ---------------------------------------------------
    st_code, body = await owner.post("/api/linked/owners", {"unit": "house", "owner": "mantel"}, method="PUT")
    check(st_code == 200 and body["wire"] == {"house": "mantel", "tablets": [], "bridge": "hk_frontend"}, "the Owner moves `house` to Mantel")
    rows = app["audit"].rows(kind="config")
    check(rows and rows[-1]["action"] == "linked.owner", "the move is audited (linked.owner)")
    diag = await until(lambda: _diag_owned(ha, entry))
    check(bool(diag), "HA keeps Mantel's word and reloads into 'the whole entry is Mantel's'")
    uid = f"{entry}_seasonal_decorations"
    check(await until(lambda: asyncio.sleep(0, uid in lk.registry.entities)),
          "Mantel publishes Seasonal decorations with hk_frontend's unique id")
    st = await until(lambda: _state_is(ha, SEASONAL, ("on", "off")))
    check(st is not None, f"{SEASONAL} keeps its entity id and is live (Mantel's now)")
    # -- HA turns it off: Mantel's setting, pushed back ---------------------------------------------------
    s, _ = await ha.post("/api/services/switch/turn_off", {"entity_id": SEASONAL})
    check(s == 200, "switch.turn_off on it in HA is answered")
    sky = app["settings"].house_settings().get("sky") or {}
    check(sky.get("decorations") is False, "Mantel saved its own setting sky.decorations = false")
    check(bool(await until(lambda: _state_is(ha, SEASONAL, ("off",)))), "HA shows the state Mantel pushed back")
    await ha.post("/api/services/switch/turn_on", {"entity_id": SEASONAL})
    # -- HK's settings, Mantel's ---------------------------------------------------------------------------
    hws = await HaWs(ha.http, ha.h["Authorization"].split(" ", 1)[1]).open()
    try:
        await settings_steps(app, ha, hws, owner)
    finally:
        await hws.ws.close()
    # -- notify and a refused pop-up --------------------------------------------------------------------
    owner.ws = await owner.http.ws_connect(base + "/ws")
    await owner.ws.send_json({"type": "read_subscribe", "id": 7, "msg": {"type": "hk_frontend/events/subscribe"}})
    got = await owner.recv()
    assert got.get("type") == "read_result" and "error" not in got, got
    s, body = await ha.post("/api/services/hk_frontend/notify?return_response", {"title": "Laundry",
                                                                                "message": "The washer is done."})
    check(s == 200, "hk_frontend.notify called in HA is answered")
    ev = None
    t0 = time.time()
    while time.time() - t0 < 15:
        m = await owner.recv(15)
        if m.get("type") == "read_event" and m.get("id") == 7 and m["event"].get("type") == "notification":
            ev = m["event"]
            break
    check(ev is not None and ev["title"] == "Laundry", "...and the banner reaches a Mantel screen's event feed")
    # (HA's REST answers a raised ServiceValidationError with a bare error status; its log has the words)
    log = Path(testha.SCRATCH) / "hass.log"
    seen = log.read_text(errors="replace").count("Mantel Server refused hk_frontend.show_popup: No pop-up #no-such-popup")
    s, body = await ha.post("/api/services/hk_frontend/show_popup", {"popup": "no-such-popup"})
    now = log.read_text(errors="replace").count("Mantel Server refused hk_frontend.show_popup: No pop-up #no-such-popup")
    check(s >= 400 and now > seen, f"an unknown pop-up is Mantel's validation error in HA (HTTP {s}; "
          "'Mantel Server refused hk_frontend.show_popup: No pop-up #no-such-popup' in HA's log)")
    await owner.ws.close()
    # -- the features' actions run in Mantel; HK's items point to Mantel Settings (decision 29) -----------------
    seen = log.read_text(errors="replace").count("Mantel Server refused hk_frontend.music_stop")
    s, _ = await ha.post("/api/services/hk_frontend/music_stop", {"rooms": ["media_player.e2e_nowhere"]})
    now = log.read_text(errors="replace").count("Mantel Server refused hk_frontend.music_stop")
    check(s >= 400 and now > seen, "hk_frontend.music_stop called in HA is Mantel's to run (refused by Mantel in "
          "words: its music is off here), not HA's own engine")
    s, flow = await ha.post("/api/config/config_entries/subentries/flow", {"handler": [entry, "feature"]})
    check(s == 200 and flow.get("type") == "abort" and flow.get("reason") == "mantel_runs_it",
          f"Add feature in HA says features are set in Mantel Settings ({flow.get('reason') if isinstance(flow, dict) else flow})")
    # -- back to HA ---------------------------------------------------------------------------------------
    st_code, body = await owner.post("/api/linked/owners", {"unit": "house", "owner": "ha"}, method="PUT")
    check(st_code == 200 and body["wire"]["house"] == "ha", "the Owner moves `house` back to Home Assistant")
    diag = await until(lambda: _diag_back(ha, entry))
    check(bool(diag), "HA keeps it and reloads: everything Home Assistant's again")
    st = await until(lambda: _state_is(ha, SEASONAL, ("on", "off")))
    check(st is not None, f"{SEASONAL} is HA's own again, same entity id")
    hws = await HaWs(ha.http, ha.h["Authorization"].split(" ", 1)[1]).open()
    try:
        await hws.subscribe()
        got = await hws.feed(lambda e: "dashboard-e2e" in (e.get("boards") or {}))
        colors = ((got or {}).get("calendar") or {}).get("event_colors") or {}
        if got is None or colors.get("uid:e2e") != "teal":
            last = hws.events[-1]["event"] if hws.events else {}
            say("HA's feed now:", len(hws.events), "events; boards", sorted((last.get("boards") or {}))[:8],
                "calendar", last.get("calendar"), "keys", sorted(last)[:12])
        check(got is not None and colors.get("uid:e2e") == "teal",
              "HA keeps Mantel's last settings as its own (the screens and the save made from HA)")
    finally:
        await hws.ws.close()
    check(app["audit"].rows(kind="service") == [], "no household service was called (commands disabled)")
    out["owners_rows"] = len(app["audit"].rows(kind="config"))


async def _diag_connected(ha: HA, entry: str):
    d = await ha.diagnostics(entry)
    return d if d.get("linked", {}).get("connected") else None


async def _diag_owned(ha: HA, entry: str):
    d = await ha.diagnostics(entry)
    lk = d.get("linked", {})
    return d if lk.get("owners", {}).get("house") == "mantel" and lk.get("connected") else None


async def _diag_back(ha: HA, entry: str):
    d = await ha.diagnostics(entry)
    lk = d.get("linked", {})
    return d if lk.get("owners", {}).get("house") == "ha" and lk.get("connected") else None


async def _state_is(ha: HA, eid: str, states: tuple[str, ...]):
    st = await ha.state(eid)
    return st if st is not None and st["state"] in states else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--keep-up", action="store_true", help="leave the scratch HA running afterwards")
    ap.add_argument("--reuse", action="store_true", help="use the scratch HA this caller already started; leave it up")
    a = ap.parse_args()
    if not a.reuse:
        GE.wait_for_free_harness()
        say("starting the scratch HA (testha.py up --fresh); this takes a few minutes")
        GE.harness("up", "--fresh")
    elif not testha.ready():
        raise SystemExit("--reuse: the scratch HA is not answering on 127.0.0.1:8124")
    try:
        token = asyncio.run(GE.token_for_scratch())
        evidence = asyncio.run(run(token))
        del token
        out = Path(testha.SCRATCH) / "linked_e2e.json"
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
