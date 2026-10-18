"""Offline page check for the command gateway's web side: commands ON, a fake command connection.

Run: ~/.venvs/mantel/bin/python tools/headless/gateway_page_check.py
No Home Assistant: the server runs with commands_enabled=True, but its command connection is replaced by
a recorder that checks every frame and ticket (as ha_client.HaCommander does) and sends nothing anywhere.
Checks, in an isolated headless Chrome: the socket's capabilities turn the client's actions on; a
service call goes out as one gateway `command` and comes back; a sensitive one raises HK's step-up
prompt (web/shim/mantel-stepup.js), and after the TOTP code is accepted it is sent again and succeeds;
a read sent through the action port is refused (not_a_write); every command has an audit row.
Then HK's settings save goes to Mantel's settings store (not the gateway), and the browser becomes a
wall tablet: an unlock raises the PIN pad, a wrong PIN keeps it open, a Child's PIN is refused, an
Adult's PIN unlocks and the audit row names the Adult at that tablet.
"""
from __future__ import annotations

import asyncio
import json
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "hosts/server"))
sys.path.insert(0, str(ROOT / "tests"))
from aiohttp.test_utils import TestServer  # noqa: E402
from cdp import Browser  # noqa: E402
from client_smoke import OfflineReads, stand_in_hk_feeds  # noqa: E402
from gateway_fakes import FakeCommander  # noqa: E402
from mantel_server.accounts import totp  # noqa: E402
from mantel_server.config import Config  # noqa: E402
from mantel_server.rbac import Grant  # noqa: E402
from mantel_server.sessions import Identity, User  # noqa: E402
from mantel_server.server import build_app  # noqa: E402
from mantel_server.store import Store  # noqa: E402


def seed_of(secret: str) -> bytes:
    import base64
    return base64.b32decode(secret + "=" * (-len(secret) % 8))


async def check() -> dict:
    with tempfile.TemporaryDirectory(prefix="mantel-gateway-page-") as folder:
        base = Path(folder)
        cfg = Config(data_dir=base / "data", secrets_dir=base / "secrets", fixtures=base / "fixtures",
                     hk_files=base / "user-files", default_screen="dashboard-proof", commands_enabled=True)
        store = Store(cfg.data_dir / "proof.db")
        uid = store.link("fictional-owner", "owner", "Offline Owner")
        cookie = store.create_session("fictional-owner", 600)          # no fresh factor: sensitive needs step-up
        app = build_app(cfg, "unused-offline-token", store=store, connect_ha=False)
        fake = FakeCommander(app["gateway"].writes)
        app["gateway"].commander = fake
        acc = app["accounts"]
        secret, _ = acc.totp_begin(uid, "owner")
        seed = seed_of(secret)
        assert acc.totp_check(uid, totp(seed, time.time() - 30), confirm=True)   # the previous time step
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
                # a sensitive action: the prompt appears, the code is entered, the command goes again
                await browser.eval("""window.__unlock = window.__mantel.client.actions.callService('lock', 'unlock', null,
                                                                       {entity_id: 'lock.proof'})
                                        .then((r) => 'ok:' + (r && r.context && r.context.id), (e) => 'err:' + e.code)
                                        .then((v) => { window.__unlockDone = v; });
                                      true""")
                if not await browser.wait("!!document.querySelector('#mantel-stepup input')", 10):
                    raise AssertionError("no step-up prompt: " + json.dumps(browser.console[-10:]))
                out["prompt_in_overlay_root"] = await browser.eval(
                    "document.querySelector('#mantel-stepup').parentNode === window.hkOverlays.root()")
                assert fake.sent == ["light.turn_on"], fake.sent                    # nothing sent while step-up is owed
                code = totp(seed, time.time())
                await browser.eval(f"""(() => {{ const i = document.querySelector('#mantel-stepup input');
                  i.value = {json.dumps(code)}; document.querySelector('#mantel-stepup button.go').click(); return true; }})()""")
                if not await browser.wait("window.__unlockDone !== undefined", 10):
                    raise AssertionError("the unlock did not settle")
                out["unlock"] = await browser.eval("window.__unlockDone")
                assert out["unlock"] == "ok:fictional" and fake.sent == ["light.turn_on", "lock.unlock"], (out, fake.sent)
                out["prompt_gone"] = await browser.eval("!document.querySelector('#mantel-stepup')")
                rows = app["audit"].rows()
                out["audit"] = [(r["action"], r["decision"], r["reason"], r["result"]) for r in rows]
                assert [r[1] for r in out["audit"]] == ["allowed", "denied", "step_up", "allowed"], out["audit"]
                assert rows[-1]["step_up"] == "totp"
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
                # A person's PIN at a wall tablet: the browser becomes a tablet; an Adult and a Child have PINs
                device_id = await browser.eval("""(async () => {
                  const s = await (await fetch('/api/session', {credentials: 'same-origin'})).json();
                  const r = await fetch('/api/devices/enroll', {method: 'POST', credentials: 'same-origin',
                    headers: {'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf},
                    body: JSON.stringify({name: 'Offline tablet', room: 'Kitchen'})});
                  return (await r.json()).device.id;
                })()""")
                app["rbac"].add_grant(Grant(effect="allow", actions={"control", "control.sensitive"}, resource_kind="entity",
                                            resource="lock.proof", devices={device_id}))
                adult = await acc.create_user("offline-adult", "Offline Adult", "adult", None)
                child = await acc.create_user("offline-child", "Offline Child", "child", None)
                await app["pins"].set_pin(adult, "2580")
                await app["pins"].set_pin(child, "7913")
                await browser.eval("location.reload(); true")
                await asyncio.sleep(0.5)
                if not await browser.wait("window.__mantelReady === true && window.__mantelHub.commandsEnabled()", 30):
                    raise AssertionError("the tablet's page did not load: " + json.dumps(browser.console[-15:]))
                out["tablet_session"] = await browser.eval(
                    "fetch('/api/session').then(r => r.json()).then(j => [!!j.user, j.device && j.device.role])")
                assert out["tablet_session"] == [False, "wall_tablet"], out
                await browser.eval("""window.__pin = (digits) => {
                  for (const d of digits) document.querySelector('#mantel-stepup .keys button[aria-label="' + d + '"]').click();
                  document.querySelector('#mantel-stepup button.go').click(); return true; };
                  window.__unlockAt = () => { window.__unlockDone = undefined;
                    window.__mantel.client.actions.callService('lock', 'unlock', null, {entity_id: 'lock.proof'})
                      .then((r) => 'ok:' + (r && r.context && r.context.id), (e) => 'err:' + e.code)
                      .then((v) => { window.__unlockDone = v; }); return true; };
                  window.__unlockAt()""")
                if not await browser.wait("!!document.querySelector('#mantel-stepup .keys')", 10):
                    raise AssertionError("no PIN pad: " + json.dumps(browser.console[-10:]))
                out["pin_pad"] = await browser.eval("""(() => { const b = document.querySelector('#mantel-stepup');
                  return { title: b.querySelector('h2').textContent, keys: b.querySelectorAll('.keys button').length,
                           input: b.querySelector('input').type }; })()""")
                assert out["pin_pad"] == {"title": "A person needs to confirm this", "keys": 12, "input": "password"}, out
                await browser.eval("window.__pin('9999')")                          # wrong: the pad stays, says so
                if not await browser.wait("document.querySelector('#mantel-stepup .err').textContent !== ''", 10):
                    raise AssertionError("a wrong PIN said nothing")
                out["wrong_pin"] = await browser.eval("document.querySelector('#mantel-stepup .err').textContent")
                assert out["wrong_pin"] == "That PIN was not accepted." and fake.sent == ["light.turn_on", "lock.unlock"], out
                await browser.eval("window.__pin('7913')")                          # the Child's PIN: refused
                if not await browser.wait("window.__unlockDone !== undefined", 10):
                    raise AssertionError("the Child's PIN did not settle")
                out["child_pin"] = await browser.eval("[window.__unlockDone, !document.querySelector('#mantel-stepup')]")
                assert out["child_pin"] == ["err:forbidden", True] and fake.sent == ["light.turn_on", "lock.unlock"], out
                await browser.eval("window.__unlockAt()")
                if not await browser.wait("!!document.querySelector('#mantel-stepup .keys')", 10):
                    raise AssertionError("no PIN pad the second time")
                await browser.eval("window.__pin('2580')")                          # the Adult's PIN: unlocked
                if not await browser.wait("window.__unlockDone !== undefined", 10):
                    raise AssertionError("the Adult's PIN did not settle")
                out["adult_pin"] = await browser.eval("[window.__unlockDone, !document.querySelector('#mantel-stepup')]")
                assert out["adult_pin"] == ["ok:fictional", True], out
                assert fake.sent == ["light.turn_on", "lock.unlock", "lock.unlock"], fake.sent
                last = app["audit"].rows()[-1]
                out["tablet_audit"] = {k: last[k] for k in ("actor_name", "role", "device", "device_role", "decision",
                                                            "step_up", "result")}
                assert out["tablet_audit"] == {"actor_name": "Offline Adult", "role": "adult", "device": device_id,
                                               "device_role": "wall_tablet", "decision": "allowed", "step_up": "pin",
                                               "result": "ok"}, out
                out["sent"] = fake.sent
                out["browser_exceptions"] = len([c for c in browser.console if c.startswith("EXCEPTION")])
        store.db.close()
    return out


if __name__ == "__main__":
    print(json.dumps(asyncio.run(check()), indent=1))
