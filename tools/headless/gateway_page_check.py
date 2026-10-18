"""Offline page check for the command gateway's web side: commands ON, a fake command connection.

Run: ~/.venvs/mantel/bin/python tools/headless/gateway_page_check.py
No Home Assistant: the server runs with commands_enabled=True, but its command connection is replaced by
a recorder that checks every frame and ticket (as ha_client.HaCommander does) and sends nothing anywhere.
Checks, in an isolated headless Chrome: the socket's capabilities turn the client's actions on; a
service call goes out as one gateway `command` and comes back; a sensitive one raises HK's step-up
prompt (web/shim/mantel-stepup.js), and after the TOTP code is accepted it is sent again and succeeds;
a read sent through the action port is refused (not_a_write); every command has an audit row.
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
        hub.readproxy = OfflineReads()
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
                out["sent"] = fake.sent
                out["browser_exceptions"] = len([c for c in browser.console if c.startswith("EXCEPTION")])
        store.db.close()
    return out


if __name__ == "__main__":
    print(json.dumps(asyncio.run(check()), indent=1))
