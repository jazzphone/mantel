"""Offline page check for the command gateway's web side: commands ON, a fake command connection.

Run: .venv/bin/python tools/headless/gateway_page_check.py
No Home Assistant: the server runs with commands_enabled=True, but its command connection is replaced by
a recorder that checks every frame and ticket (as ha_client.HaCommander does) and sends nothing anywhere.
Checks, in an isolated headless Chrome: the socket's capabilities turn the client's actions on; a
service call goes out as one gateway `command` and comes back; a sensitive one (an unlock) goes
straight through with no prompt, on a session with no fresh factor (decision 25: no step-up, no PIN
pad; the step-up sheet no longer exists); a read sent through the action port is refused
(not_a_write); every command has an audit row. Then HK's settings save goes to Mantel's settings store
(not the gateway), and the browser becomes a wall tablet: an unlock goes through with no PIN pad and
the audit row names the tablet.
"""
from __future__ import annotations

import asyncio
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "hosts/server"))
sys.path.insert(0, str(ROOT / "tests"))
from aiohttp.test_utils import TestServer  # noqa: E402
from cdp import Browser  # noqa: E402
from client_smoke import OfflineReads, stand_in_hk_feeds  # noqa: E402
from gateway_fakes import FakeCommander  # noqa: E402
from mantel_server.config import Config  # noqa: E402
from mantel_server.rbac import Grant  # noqa: E402
from mantel_server.sessions import Identity, User  # noqa: E402
from mantel_server.server import build_app  # noqa: E402
from mantel_server.store import Store  # noqa: E402


async def check() -> dict:
    with tempfile.TemporaryDirectory(prefix="mantel-gateway-page-") as folder:
        base = Path(folder)
        cfg = Config(data_dir=base / "data", secrets_dir=base / "secrets", fixtures=base / "fixtures",
                     hk_files=base / "user-files", default_screen="dashboard-proof", commands_enabled=True)
        store = Store(cfg.data_dir / "proof.db")
        uid = store.link("fictional-owner", "owner", "Offline Owner")
        cookie = store.create_session("fictional-owner", 600)          # no fresh factor (none is asked)
        app = build_app(cfg, "unused-offline-token", store=store, connect_ha=False)
        fake = FakeCommander(app["gateway"].writes)
        app["gateway"].commander = fake
        hub = app["hub"]
        hub.readproxy = OfflineReads(app, Identity(User(uid, "Offline Owner", "owner", "ha_linked"), None, "lan"))
        stand_in_hk_feeds(app, hub.readproxy)
        hub.store.apply_event({"a": {
            "light.proof": {"s": "off", "a": {"friendly_name": "Offline lamp"}, "lc": 1.0, "lu": 1.0},
            "lock.proof": {"s": "locked", "a": {"friendly_name": "Offline door"}, "lc": 1.0, "lu": 1.0}}})
        hub.registry.load([], [], [{"entity_id": "light.proof", "platform": "demo"},
                                   {"entity_id": "lock.proof", "platform": "demo"}])
        async with TestServer(app) as server:
            async with Browser(port=9341) as browser:
                origin = str(server.make_url("")).rstrip("/")
                await browser.restrict_origin(origin)
                await browser.open(origin + "/dashboard-proof/home?narrow=0", cookie)
                if not await browser.wait("window.__mantelReady === true", 30):
                    raise AssertionError("Home did not load: " + json.dumps(browser.console[-15:]))
                out = {"capabilities": await browser.eval("window.__mantelHub.capabilities")}
                assert out["capabilities"]["commands"] is True, out
                out["light"] = await browser.eval("""(async () => {
                  const r = await window.__mantel.client.actions.callService('light', 'turn_on', {brightness: 80},
                                                                             {entity_id: 'light.proof'});
                  return r && r.context && r.context.id;
                })()""")
                assert out["light"] == "fictional" and fake.sent == ["light.turn_on"], (out, fake.sent)
                out["read_refused"] = await browser.eval("""(async () => {
                  try { await window.__mantel.client.actions.callWS({type: 'get_config'}); return 'sent'; }
                  catch (e) { return e.code; }
                })()""")
                assert out["read_refused"] == "not_a_write", out
                # a sensitive action: no prompt, straight through (decision 25)
                out["unlock"] = await browser.eval("""window.__mantel.client.actions.callService('lock', 'unlock', null,
                                                                       {entity_id: 'lock.proof'})
                                        .then((r) => 'ok:' + (r && r.context && r.context.id), (e) => 'err:' + e.code)""")
                assert out["unlock"] == "ok:fictional" and fake.sent == ["light.turn_on", "lock.unlock"], (out, fake.sent)
                out["no_prompt"] = await browser.eval("!document.querySelector('#mantel-stepup') && !window.hkMantelStepUp")
                assert out["no_prompt"] is True, out
                rows = app["audit"].rows()
                out["audit"] = [(r["action"], r["decision"], r["reason"], r["result"]) for r in rows]
                assert [r[1] for r in out["audit"]] == ["allowed", "denied", "allowed"], out["audit"]
                assert rows[-1]["sensitive"] == "lock" and rows[-1]["step_up"] is None
                # P3.5 page saves with commands ON: HK's settings save still goes to Mantel's settings
                # store (settings_write), never through the gateway to HA
                out["settings_save"] = await browser.eval("""(async () => {
                  try { const r = await window.__mantel.client.actions.callWS({type: 'hk_frontend/settings/set',
                                                                             changes: {'look.glass': 'clear'}});
                        return 'saved:' + (r && r.settings && r.settings.look && r.settings.look.glass); }
                  catch (e) { return 'err:' + e.code; }
                })()""")
                assert out["settings_save"] == "saved:clear", out
                assert app["settings"].store.get("house", "settings").body["look"]["glass"] == "clear"
                assert fake.sent == ["light.turn_on", "lock.unlock"], fake.sent      # nothing toward HA
                # A wall tablet: the browser becomes one; an unlock goes through with no PIN pad
                device_id = await browser.eval("""(async () => {
                  const s = await (await fetch('/api/session', {credentials: 'same-origin'})).json();
                  const r = await fetch('/api/devices/enroll', {method: 'POST', credentials: 'same-origin',
                    headers: {'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf},
                    body: JSON.stringify({name: 'Offline tablet', room: 'Kitchen'})});
                  return (await r.json()).device.id;
                })()""")
                app["rbac"].add_grant(Grant(effect="allow", actions={"control", "control.sensitive"}, resource_kind="entity",
                                            resource="lock.proof", devices={device_id}))
                await browser.eval("location.reload(); true")
                await asyncio.sleep(0.5)
                if not await browser.wait("window.__mantelReady === true && window.__mantelHub.commandsEnabled()", 30):
                    raise AssertionError("the tablet's page did not load: " + json.dumps(browser.console[-15:]))
                out["tablet_session"] = await browser.eval(
                    "fetch('/api/session').then(r => r.json()).then(j => [!!j.user, j.device && j.device.role])")
                assert out["tablet_session"] == [False, "wall_tablet"], out
                out["tablet_unlock"] = await browser.eval("""window.__mantel.client.actions.callService('lock', 'unlock', null,
                                                                       {entity_id: 'lock.proof'})
                                        .then((r) => 'ok:' + (r && r.context && r.context.id), (e) => 'err:' + e.code)""")
                assert out["tablet_unlock"] == "ok:fictional", out
                assert await browser.eval("!document.querySelector('#mantel-stepup')") is True
                assert fake.sent == ["light.turn_on", "lock.unlock", "lock.unlock"], fake.sent
                last = app["audit"].rows()[-1]
                out["tablet_audit"] = {k: last[k] for k in ("actor_name", "role", "device", "device_role", "decision",
                                                            "step_up", "result")}
                assert out["tablet_audit"] == {"actor_name": None, "role": None, "device": device_id,
                                               "device_role": "wall_tablet", "decision": "allowed", "step_up": None,
                                               "result": "ok"}, out
                out["sent"] = fake.sent
                out["browser_exceptions"] = len([c for c in browser.console if c.startswith("EXCEPTION")])
        store.db.close()
    return out


if __name__ == "__main__":
    print(json.dumps(asyncio.run(check()), indent=1))
