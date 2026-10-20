"""Linked mode against a REAL Home Assistant: the scratch HA's hk_frontend linked to Mantel Server
in-process, per-tablet ownership and the rest of the entry (docs/phase5/LINKED-MODE.md).

1. Starts the scratch HA (``tools/testha``; waits while another job uses it), or ``--reuse`` it.
2. Runs Mantel in-process on 127.0.0.1 against it, read-only (commands DISABLED: nothing it does may
   call a household service), with the ``linked`` and ``notifications`` pieces on, and a Service
   account for HA.
3. Through the scratch HA's own REST (as Avery would in its UI): Configure -> Linked to Mantel Server
   with Mantel's loopback address and the credential. Then checks, on the real HA:
   - linked with nothing moved: HA's own Seasonal decorations stays HA's, the link says hello, HA's
     diagnostics name the owners (everything HA's) and never the credential;
   - an Owner moves ``house`` to Mantel (Mantel's REST, an Owner's session, audited): HA keeps the
     ownership and reloads; ``switch.hk_frontend_seasonal_decorations`` is now Mantel's (same entity
     id); turning it off in HA saves Mantel's setting and HA shows the state Mantel pushes back;
   - ``hk_frontend.notify`` called in HA reaches a Mantel screen's event feed; ``show_popup`` for an
     unknown pop-up is Mantel's validation error in HA;
   - the Owner moves ``house`` back: HA's own switch again, same entity id; unlinking forgets it.
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
    sky = app["settings"].store.body("house", "settings").get("sky") or {}
    check(sky.get("decorations") is False, "Mantel saved its own setting sky.decorations = false")
    check(bool(await until(lambda: _state_is(ha, SEASONAL, ("off",)))), "HA shows the state Mantel pushed back")
    await ha.post("/api/services/switch/turn_on", {"entity_id": SEASONAL})
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
    # -- back to HA ---------------------------------------------------------------------------------------
    st_code, body = await owner.post("/api/linked/owners", {"unit": "house", "owner": "ha"}, method="PUT")
    check(st_code == 200 and body["wire"]["house"] == "ha", "the Owner moves `house` back to Home Assistant")
    diag = await until(lambda: _diag_back(ha, entry))
    check(bool(diag), "HA keeps it and reloads: everything Home Assistant's again")
    st = await until(lambda: _state_is(ha, SEASONAL, ("on", "off")))
    check(st is not None, f"{SEASONAL} is HA's own again, same entity id")
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
