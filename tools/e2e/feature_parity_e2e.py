"""End-to-end: HK's feature pages on Mantel against the SCRATCH Home Assistant (tools/testha/).

    ~/.venvs/mantel/bin/python tools/e2e/feature_parity_e2e.py [--keep-up] [--reuse]

1. Starts the scratch HA (``testha.py up --fresh``: 127.0.0.1:8124, HA's ``demo`` devices only; waits
   while another job uses it; ``--reuse``: use one this caller started, and leave it running).
2. As the scratch HA's throwaway admin (the harness's hand, not Mantel's): adds three HK features as
   items of the scratch house's hk_frontend entry (Clean Areas, Energy, Notifications, through HA's own
   subentry flow) and puts one demo vacuum in the Kitchen, so Clean Areas has an area to offer.
3. Runs Mantel Server in this process against it (temp database; house commands DISABLED), then:
   * the feature import (``POST /api/features/import``, the Owner) reads which features HA has added
     and their settings, through the server-only reads; nothing is written to HA;
   * Mantel's settings feed says the same ``added`` as HA's own feed, and carries an Energy plan;
   * ``hk_clean_areas/subscribe`` through Mantel answers what HA's own answers (the Owner), and a
     Guest, who may not view the vacuum, is offered nothing;
   * ``hk_tv/channels`` through Mantel answers as HA does (the scratch HA has no Live TV tuner);
   * a page's read of a feature's settings is refused; no command connection exists.
4. Stops the scratch HA (unless --keep-up / --reuse). Evidence: ``<TESTHA_DIR>/feature_parity_e2e.json``.

SAFETY: refuses to run unless the HA URL is the scratch one; never reads ~/.config/mantel or touches
/Volumes/config or the house's HA. Prints no credential.
"""
from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import secrets
import sys
import tempfile
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
RESULTS: list[str] = []
EVIDENCE: dict = {}


def say(*a):
    print("[parity-e2e]", *a, flush=True)


def check(cond, what):
    if not cond:
        raise GE.Fail(what)
    say("PASS", what)
    RESULTS.append(what)


class HaWs:
    """The scratch HA's websocket, as its admin (the harness's own reads and the setup)."""

    def __init__(self, http, token):
        self.http, self.token, self.n = http, token, 0

    async def __aenter__(self):
        self.ws = await self.http.ws_connect(SCRATCH_URL.replace("http", "ws") + "/api/websocket")
        await self.ws.receive_json()
        await self.ws.send_json({"type": "auth", "access_token": self.token})
        assert (await self.ws.receive_json())["type"] == "auth_ok"
        return self

    async def __aexit__(self, *exc):
        await self.ws.close()

    async def call(self, msg):
        self.n += 1
        await self.ws.send_json({**msg, "id": self.n})
        while True:
            m = await self.ws.receive_json(timeout=30)
            if m.get("id") == self.n and m.get("type") == "result":
                assert m.get("success"), m
                return m.get("result")

    async def first_event(self, msg):
        self.n += 1
        mid = self.n
        await self.ws.send_json({**msg, "id": mid})
        while True:
            m = await self.ws.receive_json(timeout=30)
            if m.get("id") == mid and m.get("type") == "event":
                return m["event"]


async def setup_scratch(http, token) -> dict:
    """Three HK features added in the scratch HA, and a demo vacuum in the Kitchen."""
    h = {"Authorization": f"Bearer {token}"}
    async with http.get(f"{SCRATCH_URL}/api/config/config_entries/entry?domain=hk_frontend", headers=h) as r:
        entry = (await r.json())[0]["entry_id"]
    for kind, form in (("clean_areas", {"vacuums": []}), ("energy", {"follow": True}), ("notifications", {})):
        async with http.post(f"{SCRATCH_URL}/api/config/config_entries/subentries/flow", headers=h,
                             json={"handler": [entry, "feature"]}) as r:
            flow = await r.json()
        assert flow.get("type") == "menu", flow
        async with http.post(f"{SCRATCH_URL}/api/config/config_entries/subentries/flow/{flow['flow_id']}", headers=h,
                             json={"next_step_id": kind}) as r:
            step = await r.json()
        assert step.get("type") == "form", step
        async with http.post(f"{SCRATCH_URL}/api/config/config_entries/subentries/flow/{flow['flow_id']}", headers=h,
                             json=form) as r:
            done = await r.json()
        assert done.get("type") == "create_entry", done
    async with HaWs(http, token) as ws:
        vacuums = sorted(e["entity_id"] for e in await ws.call({"type": "config/entity_registry/list"})
                         if e["entity_id"].startswith("vacuum."))
        await ws.call({"type": "config/entity_registry/update", "entity_id": vacuums[0], "area_id": "kitchen"})
        # a room map (HA's vacuum entity settings: the house's areas -> the robot's rooms), so a robot that
        # cleans by area reaches the Kitchen too
        await ws.call({"type": "config/entity_registry/update", "entity_id": vacuums[0], "options_domain": "vacuum",
                       "options": {"area_mapping": {"kitchen": ["1"]}}})
    return {"entry": entry, "vacuum": vacuums[0]}


async def run(token: str) -> dict:
    from mantel_server.config import Config
    from mantel_server.server import build_app
    from mantel_server.store import Store

    evidence = EVIDENCE
    async with aiohttp.ClientSession() as http:
        got = await setup_scratch(http, token)
        say(f"scratch HA: Clean Areas, Energy and Notifications added; {got['vacuum']} put in the Kitchen")
        async with HaWs(http, token) as ha:
            ha_feed = await ha.first_event({"type": "hk_frontend/settings/subscribe"})
            ha_areas = await ha.first_event({"type": "hk_clean_areas/subscribe"})
            ha_tv = await ha.call({"type": "hk_tv/channels"})
        evidence["ha"] = {"added": ha_feed.get("added"), "energy": ha_feed.get("energy"), "areas": ha_areas,
                          "tv": ha_tv}

    with tempfile.TemporaryDirectory(prefix="mantel-parity-e2e-") as folder:
        base_dir = Path(folder)
        cfg = Config(ha_url=SCRATCH_URL, data_dir=base_dir / "data", secrets_dir=base_dir / "secrets", port=0)
        assert cfg.ha_url == SCRATCH_URL and "192.168." not in cfg.ha_url and not cfg.commands_enabled
        store = Store(cfg.data_dir / "mantel.db")
        app = build_app(cfg, token, store=store, connect_ha=True)
        hub, host = app["hub"], app["features"]
        people = []
        async with TestServer(app, host="127.0.0.1") as server:
            base = str(server.make_url("")).rstrip("/")
            await asyncio.wait_for(hub.ha.ready.wait(), 60)
            say(f"Mantel is up on {base}, reading the scratch HA ({len(hub.store.states)} entities)")
            pw = {k: secrets.token_urlsafe(18) for k in ("owner", "guest")}
            owner = GE.Browser(base, "owner")
            people.append(owner)
            st, body = await owner.post("/api/bootstrap", {"token": app["accounts"].issue_bootstrap_token(),
                                                          "username": "e2e-owner", "name": "Fictional Owner",
                                                          "password": pw["owner"]})
            assert st == 200, body
            st, body = await owner.post("/api/users", {"username": "e2e-guest", "name": "Fictional Guest",
                                                      "role": "guest", "password": pw["guest"]})
            assert st == 201, body
            # -- the feature import ---------------------------------------------------------------------
            sent_before = len(hub.readproxy.sent_types)
            st, body = await owner.post("/api/features/import")
            check(st == 200 and body["imported"], "the Owner's feature import ran (POST /api/features/import)")
            # (energy/get_prefs follows: Energy is on now, and its plan is worked out from HA's Energy settings)
            reads = [t for t in hub.readproxy.sent_types[sent_before:] if t != "energy/get_prefs"]
            check(sorted(reads) == sorted(["hk_frontend/panel/get", "hk_clean_areas/settings/get",
                                           "hk_energy/settings/get", "hk_notify/settings/get"]),
                  f"it read HA's panel/get and the three added features' settings, nothing else ({reads})")
            evidence["imported"] = {k: body["settings"][k] for k in ("ha", "clean_areas", "energy", "notifications")}
            check(body["settings"]["clean_areas"]["enabled"] and body["settings"]["energy"]["enabled"]
                  and body["settings"]["notifications"]["enabled"], "Clean Areas, Energy and Notifications are on in Mantel")
            await host.refresh_energy(force=True)
            # -- the settings feed, as HK's strategy reads it ---------------------------------------------
            owner.ws = await owner.http.ws_connect(base + "/ws")
            await owner.ws.send_json({"type": "read_subscribe", "id": 5, "msg": {"type": "hk_frontend/settings/subscribe"}})
            feed = None
            while feed is None:
                m = await owner.recv(15)
                if m.get("type") == "read_event" and m.get("id") == 5:
                    feed = m["event"]
            evidence["mantel"] = {"added": feed.get("added"), "energy": feed.get("energy")}
            check(feed["added"] == evidence["ha"]["added"],
                  f"Mantel's feed says the same features are added as HA's own feed ({feed['added']})")
            check(isinstance(feed.get("energy"), dict) and "sections" in feed["energy"],
                  "Mantel's feed carries the Energy page's plan (hk_core's, over Mantel's House)")
            check(feed["energy"] == evidence["ha"]["energy"],
                  "Mantel's Energy plan is identical to HA's own (Status & Chips' thermostats included)")
            # -- Clean Areas' area picker ---------------------------------------------------------------
            await owner.ws.send_json({"type": "read_subscribe", "id": 9, "msg": {"type": "hk_clean_areas/subscribe"}})
            offer = None
            while offer is None:
                m = await owner.recv(15)
                if m.get("id") == 9 and m.get("type") == "read_event":
                    offer = m["event"]
                elif m.get("id") == 9 and m.get("error"):
                    raise GE.Fail(f"hk_clean_areas/subscribe refused: {m}")
            evidence["mantel"]["areas"] = offer
            check(offer == evidence["ha"]["areas"] and offer["areas"],
                  f"the area picker through Mantel offers what HA's own offers ({offer})")
            got = await owner.read({"type": "hk_tv/channels"})
            evidence["mantel"]["tv"] = got.get("result")
            check(got.get("result") == {"configured": bool(evidence["ha"]["tv"].get("configured")), "channels": []},
                  "hk_tv/channels through Mantel answers as HA does (no Live TV in the scratch HA)")
            got = await owner.read({"type": "hk_energy/settings/get"})
            check(got.get("error", {}).get("code") == "not_allowed", "a page's read of a feature's settings is refused")
            # -- a Guest, who may not view the vacuum --------------------------------------------------
            guest = GE.Browser(base, "guest")
            people.append(guest)
            st, _ = await guest.post("/api/auth/password", {"username": "e2e-guest", "password": pw["guest"]})
            assert st == 200
            guest.ws = await guest.http.ws_connect(base + "/ws")
            await guest.ws.send_json({"type": "read_subscribe", "id": 9, "msg": {"type": "hk_clean_areas/subscribe"}})
            g = None
            while g is None:
                m = await guest.recv(15)
                if m.get("id") == 9 and m.get("type") == "read_event":
                    g = m["event"]
            check(g == {"configured": True, "areas": []}, "a Guest is offered no areas (may not view the vacuum)")
            await guest.ws.send_json({"type": "read_subscribe", "id": 5, "msg": {"type": "hk_frontend/settings/subscribe"}})
            gf = None
            while gf is None:
                m = await guest.recv(15)
                if m.get("type") == "read_event" and m.get("id") == 5:
                    gf = m["event"]
            check(gf.get("energy") is None, "a Guest's feed carries no Energy plan (no feature:energy)")
            check(app.get("commander") is None and app.get("gateway") is None, "no command connection exists")
            evidence["checks"] = RESULTS
            for b in people:
                await b.close()
        store.db.close()
    return evidence


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--keep-up", action="store_true", help="leave the scratch HA running afterwards")
    ap.add_argument("--reuse", action="store_true", help="use the scratch HA this caller started; leave it up")
    a = ap.parse_args()
    if not a.reuse:
        GE.wait_for_free_harness()
        say("starting the scratch HA (testha.py up --fresh); this takes a few minutes")
        GE.harness("up", "--fresh")
    try:
        token = asyncio.run(GE.token_for_scratch())
        evidence = asyncio.run(run(token))
        del token
        out = Path(testha.SCRATCH) / "feature_parity_e2e.json"
        out.write_text(json.dumps(evidence, indent=1, default=str))
        say(f"ALL {len(RESULTS)} CHECKS PASSED; evidence in {out}")
        return 0
    except GE.Fail as exc:
        say("FAIL", exc)
        out = Path(testha.SCRATCH) / "feature_parity_e2e.json"
        out.write_text(json.dumps(EVIDENCE, indent=1, default=str))
        say(f"evidence so far in {out}")
        return 1
    finally:
        if not (a.keep_up or a.reuse):
            GE.harness("down")
            say("scratch HA stopped")


if __name__ == "__main__":
    sys.exit(main())
