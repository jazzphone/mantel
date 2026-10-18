"""Offline current-Home/client smoke: fictional state, real local WebSocket, isolated Chrome.

Run: ~/.venvs/mantel/bin/python tools/headless/client_smoke.py [--shot /tmp/metric.png]
No production token, DB, HA connection, fonts or captured personal fixtures are used.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "hosts/server"))
from aiohttp.test_utils import TestServer
from cdp import Browser
from mantel_server.config import Config
from mantel_server.server import build_app
from mantel_server.store import Store


class OfflineReads:
    """Fictional reads only. This object has no HTTP connection or credentials."""
    def __init__(self):
        self.callbacks = {}
        self.serial = 0

    async def request(self, msg):
        if msg["type"] == "get_config":
            return {"unit_system": {"temperature": "°C"}, "time_zone": "UTC", "currency": "USD"}
        if msg["type"] == "frontend/get_themes":
            return {"themes": {}, "darkMode": True}
        return {}

    async def subscribe(self, msg, callback):
        payload = {"configured": True, "weather": {"place": "Offline before"}, "boards": {"dashboard-proof": {"pages": [], "headers": {"home": False}}}}
        music = {"configured": True, "speakers": [{"name": "Offline Office", "entity": "media_player.offline_office"}]}
        initial = {"hk_frontend/settings/subscribe": payload, "hk_music/subscribe": music}.get(msg["type"], {})
        asyncio.get_running_loop().call_soon(callback, initial)
        self.serial += 1
        self.callbacks[self.serial] = (msg["type"], callback)
        return self.serial

    def publish_settings(self):
        for kind, callback in list(self.callbacks.values()):
            if kind == "hk_frontend/settings/subscribe":
                callback({"configured": True, "weather": {"place": "Offline after"},
                          "boards": {"dashboard-proof": {"pages": [], "headers": {"home": False}}}})

    def publish_tabbar(self):
        for kind, callback in list(self.callbacks.values()):
            if kind == "hk_frontend/settings/subscribe":
                callback({"configured": True, "weather": {"place": "Offline after"},
                          "boards": {"dashboard-proof": {"pages": [], "headers": {"home": False}, "menu": "tabbar"}}})

    def publish_music(self):
        for kind, callback in list(self.callbacks.values()):
            if kind == "hk_music/subscribe":
                callback({"configured": True, "speakers": [{"name": "Offline Den", "entity": "media_player.offline_den"}]})

    def count(self, kind):
        return sum(1 for k, _ in self.callbacks.values() if k == kind)

    async def unsubscribe(self, mid):
        self.callbacks.pop(mid, None)

    async def close(self):
        pass


async def smoke(shot=None):
    with tempfile.TemporaryDirectory(prefix="mantel-client-smoke-") as folder:
        base = Path(folder)
        cfg = Config(data_dir=base / "data", fixtures=base / "fixtures", hk_files=base / "user-files",
                     default_screen="dashboard-proof")
        store = Store(cfg.data_dir / "proof.db")
        store.link("fictional-owner", "owner", "Offline Owner")
        cookie = store.create_session("fictional-owner", 300)
        app = build_app(cfg, "unused-offline-token", store=store, connect_ha=False)
        hub = app["hub"]
        hub.readproxy = OfflineReads()
        hub.store.apply_event({"a": {"sensor.proof": {"s": "21.4", "a": {
            "friendly_name": "Offline temperature", "unit_of_measurement": "°C"}, "lc": 1.0, "lu": 1.0},
            "light.proof": {"s": "off", "a": {"friendly_name": "Offline lamp", "supported_color_modes": ["brightness"]},
                            "lc": 1.0, "lu": 1.0}}})
        hub.registry.load([], [], [{"entity_id": "sensor.proof", "platform": "demo"},
                                   {"entity_id": "light.proof", "platform": "demo"}])
        try:
            async with TestServer(app) as server:
                async with Browser(port=9337) as browser:
                    origin = str(server.make_url("")).rstrip("/")
                    await browser.restrict_origin(origin)
                    guard = """(() => {
                      const Original = WebSocket, target = new URL(%s).host;
                      window.__blockedWrites = 0;
                      window.__sentFrames = 0;
                      window.WebSocket = class extends Original {
                        constructor(url, ...args) {
                          if (new URL(url, location.href).host !== target) throw new Error('external socket blocked');
                          super(url, ...args);
                        }
                        send(raw) {
                          const msg = JSON.parse(raw);
                          if (!['subscribe','unsubscribe','ping','watch_stats','read','read_subscribe','read_unsubscribe'].includes(msg.type) ||
                              ['call_service','execute_script'].includes(msg.msg && msg.msg.type)) {
                            window.__blockedWrites++; throw new Error('write blocked');
                          }
                          window.__sentFrames++;
                          return super.send(raw);
                        }
                      };
                    })();""" % json.dumps(origin)
                    await browser.send("Page.addScriptToEvaluateOnNewDocument", source=guard)
                    await browser.open(origin + "/dashboard-proof/home?narrow=0", cookie)
                    if not await browser.wait("window.__mantelReady === true", 25):
                        raise AssertionError("Home did not load: " + json.dumps(browser.console[-15:]))
                    await browser.eval("""(async () => {
                      const { createCardElement, setCardHost } = await import('/web/shim/cards-bridge.js');
                      const metric = createCardElement({type:'custom:hk-stat-card',entity:'sensor.proof'});
                      metric.id = 'proof-metric';
                      setCardHost(metric, window.__mantel.hass);
                      document.getElementById('app').prepend(metric);
                      const update = window.__mantel.onHass;
                      window.__mantel.onHass = (snapshot) => { update(snapshot); setCardHost(metric, snapshot); };
                      window.__proofMetric = metric;
                    })()""")
                    text = "window.__proofMetric._e.state.textContent"
                    assert await browser.eval(text) == "21.4 °C"
                    assert await browser.eval("window.__proofMetric.client === window.__mantel.client")
                    assert await browser.eval("window.hkHostClient.kind === 'mantel' && !window.hkHAClient")
                    assert await browser.wait("window.hkSettings.live && window.hkSettings.get('weather.place') === 'Offline before'", 5)
                    await browser.eval("window.__proofClientUpdates = 0; window.__proofEndClient = window.hkCards.onClient(() => window.__proofClientUpdates++);")
                    hub.store.apply_event({"c": {"sensor.proof": {"+": {"s": "22.8", "lu": 2.0}}}})
                    hub.on_change({"sensor.proof"})
                    assert await browser.wait(text + " === '22.8 °C'", 5), "WebSocket update did not reach metric"
                    assert await browser.eval("window.__proofClientUpdates === 1 && window.hkCards.client() === window.__mantel.client")
                    hub.readproxy.publish_settings()
                    assert await browser.wait("window.hkSettings.get('weather.place') === 'Offline after'", 5), "settings update did not reach shared module"
                    # Slice 5: a detail sheet reads through the Mantel client and follows its updates.
                    assert await browser.eval("""(() => {
                      const c = window.hkCards.client();
                      return !!c.entities && 'sensor.proof' in c.entities && !!c.areas && !!c.devices && !('callService' in c);
                    })()"""), "client registries missing"
                    post = await browser.eval("""(async () => {
                      try { await window.hkCards.client().callApi('POST', 'config/config_entries/flow'); return 'sent'; }
                      catch (error) { return error.message; }
                    })()""")
                    assert "read-only" in post, post
                    assert await browser.eval("window.hkDetail.open('sensor.proof', {}) === true"), "detail sheet did not open"
                    sheet = "window.hkDetail._.state()"
                    assert await browser.eval(sheet + ".fed === window.hkCards.client() && " +
                                              sheet + ".panel.client === window.hkCards.client()"), "sheet not fed the client"
                    assert await browser.eval(sheet + ".panel._stateObj.state === '22.8'")
                    hub.store.apply_event({"c": {"sensor.proof": {"+": {"s": "23.5", "lu": 3.0}}}})
                    hub.on_change({"sensor.proof"})
                    assert await browser.wait(sheet + ".panel._stateObj.state === '23.5' && " +
                                              sheet + ".fed === window.hkCards.client()", 5), "open sheet did not follow the client"
                    await browser.eval("window.hkDetail.close(true)")
                    await browser.eval("window.__proofEndClient()")
                    # Music and artwork reconnect handling through the Mantel client's subscription port.
                    assert await browser.wait("window.hkMusic.configured() && window.hkMusic.speakers()[0].name === 'Offline Office'", 5), \
                        "music configuration did not arrive through the client port"
                    assert hub.readproxy.count("hk_music/subscribe") == 1, "music subscribed more than once"
                    hub.readproxy.publish_music()
                    assert await browser.wait("window.hkMusic.speakers()[0].name === 'Offline Den'", 5), "music update did not arrive"
                    music_write = await browser.eval("""(async () => {
                      const taken = window.hkMusic.setFocus('media_player.offline_den');
                      await new Promise(r => setTimeout(r, 50));
                      return taken && window.hkMusic.focus() === 'media_player.offline_den';
                    })()""")
                    assert music_write, "a refused focus write jammed the music model"
                    art = await browser.eval("""new Promise(r => window.hkCards.artUrl(
                      'https://art.invalid/cover.jpg', 300, r))""")
                    assert art == "https://art.invalid/cover.jpg", art  # signing refused offline: unsigned, unloaded
                    assert await browser.eval("window.hkCards.staleEpoch() === 0")
                    # Slice 6: one action port. The read path refuses a write before the host; the
                    # action port refuses every command with commands_disabled and sends nothing.
                    read_path = await browser.eval("""(async () => {
                      try { await window.__mantel.client.callWS({type:'call_service',domain:'light',service:'turn_on'}); }
                      catch (error) { return error.code; }
                    })()""")
                    assert read_path == "read_only", read_path
                    refused = await browser.eval("""(async () => {
                      try { await window.__mantel.client.actions.callWS({type:'call_service',domain:'light',service:'turn_on'}); }
                      catch (error) { return error.code; }
                    })()""")
                    assert refused == "commands_disabled"
                    # Slice 7: the subscription port offers only its read allowlist; the doorbell's
                    # talk-back writes (recorded POST, live socket) go to the action port and are refused.
                    port = await browser.eval("""(async () => {
                      const port = window.__mantel.client.subscriptions, frames = window.__sentFrames;
                      const code = async (p) => { try { await p; return 'sent'; } catch (e) { return e.code; } };
                      return { write: await code(port.subscribeMessage(() => {}, {type: 'call_service', domain: 'light', service: 'turn_on'})),
                               bus: await code(port.subscribeMessage(() => {}, {type: 'subscribe_events', event_type: 'state_changed'})),
                               talk: await code(window.__mantel.client.actions.request('/api/hk_frontend/talk?entity_id=media_player.x', {method: 'POST'})),
                               live: await code(window.__mantel.client.actions.liveSocket()),
                               frames: window.__sentFrames - frames };
                    })()""")
                    assert port == {"write": "not_allowed", "bus": "not_allowed", "talk": "commands_disabled",
                                    "live": "commands_disabled", "frames": 0}, port
                    actions = await browser.eval("""(async () => {
                      const { createCardElement, setCardHost } = await import('/web/shim/cards-bridge.js');
                      const tile = createCardElement({type:'custom:hk-tile-card', entity:'light.proof'});
                      setCardHost(tile, window.__mantel.hass);
                      document.getElementById('app').prepend(tile);
                      const frames = window.__sentFrames, refused0 = window.__mantel.refused.length;
                      const toggled = await tile._call('homeassistant', 'toggle', {entity_id: 'light.proof'});
                      tile._act({action: 'toggle'}, true);
                      window.hkDetail.open('light.proof', {});
                      const panel = window.hkDetail._.state().panel;
                      const fedClient = panel.client === window.hkCards.client() && !panel._hass;
                      const sheet = await panel._svc('light', 'turn_on', {brightness_pct: 40});
                      const keypad = await panel._callErr('alarm_control_panel', 'alarm_disarm', {code: '0000'});
                      await new Promise(r => setTimeout(r, 50));
                      window.hkDetail.close(true);
                      return {toggled, sheet, keypad: keypad.error, fedClient,
                              frames: window.__sentFrames - frames,
                              refused: window.__mantel.refused.slice(refused0)};
                    })()""")
                    assert actions["toggled"] is False and actions["sheet"] is False, actions
                    assert actions["keypad"] == "commands disabled", actions
                    assert actions["fedClient"], actions
                    assert actions["frames"] == 0, actions          # zero writes: not one frame left the page
                    assert actions["refused"] == ["homeassistant.toggle", "homeassistant.toggle", "light.turn_on",
                                                  "alarm_control_panel.alarm_disarm"], actions
                    # The host shell (web/shim/mantel-shell.js): the sky finds Mantel's view container and
                    # the menu mounts in the shell root; the tab bar does too once the screen asks for it.
                    shell = await browser.eval("""(() => {
                      const c = document.querySelector('hk-view-container#view');
                      return { kind: window.hkShell.kind, nav: window.hkShell.navEvent,
                               sky: !!(c && c.querySelector(':scope > #hk-sky')),
                               menu: !!document.querySelector('#hk-shell-root > #hk-menu'),
                               view: !!window.hkShell.view() && window.hkShell.view().parentNode === document.getElementById('app'),
                               config: !!(window.hkShell.dashboardConfig() || {}).views };
                    })()""")
                    assert shell == {"kind": "mantel", "nav": "location-changed", "sky": True, "menu": True,
                                     "view": True, "config": True}, shell
                    hub.readproxy.publish_tabbar()
                    assert await browser.wait("!!document.querySelector('#hk-shell-root > #hk-tabbar')", 5), \
                        "the tab bar did not mount in Mantel's shell root"
                    assert await browser.eval("window.__blockedWrites") == 0
                    exceptions = [line for line in browser.console if line.startswith("EXCEPTION:")]
                    assert not exceptions, exceptions
                    assert not browser.blocked_requests, browser.blocked_requests
                    if shot:
                        await browser.screenshot(shot)
                    return {"home_ready": True, "client": "mantel", "initial": "21.4 °C", "updated": "22.8 °C",
                            "settings": "updated through client subscription", "client_updates": 1,
                            "detail": "sheet fed the client, followed 22.8 -> 23.5; registries readable; REST POST refused",
                            "music": "Offline Office -> Offline Den, one subscription, focus write refused",
                            "artwork": "signing refused offline, URL unchanged, no reconnect marked",
                            "host_shell": "mantel: sky in hk-view-container, menu and tab bar in #hk-shell-root",
                            "commands": refused,
                            "actions": "tile tap, sheet control and keypad refused through the action port; "
                                       "0 frames sent; read path refused call_service (read_only)",
                            "subscriptions": "write and state_changed bus refused (not_allowed); talk-back POST and live socket refused; 0 frames",
                            "external_requests": 0, "browser_exceptions": 0}
        finally:
            store.db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--shot")
    print(json.dumps(asyncio.run(smoke(parser.parse_args().shot)), indent=2))
