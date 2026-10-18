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


# P2.4: what the HK Settings panel reads first (hk_frontend/panel/get), fictional and minimal: one
# custom page (its content is a YAML page) and nothing else configured. The real ReadProxy refuses
# this read (it is not on its allowlist); this smoke stands in for a host that answers it.
PANEL = {
    "entry_id": "fictional-entry", "setup_done": True,
    "settings": {"sky": {}, "look": {}, "generated": {"include_entities": []}, "weather": {}, "security": {},
                 "features": {}, "headers": {}},
    "boards": {}, "dashboards": [], "popups": [], "custom_chips": [], "chip_kinds": [], "page_kinds": [],
    "custom_pages": [{"path": "offline-page", "title": "Offline Page", "icon": "mdi:file-document-outline",
                      "view": {"cards": [{"type": "tile", "entity": "light.proof"}]}, "item": "fictional-page-item",
                      "used_on": []}],
    "accessories": {"entities": {}}, "kinds": {}, "hidden": {}, "counts": {}, "features": {}, "thirdparty": {},
    "choices": {}, "tablets": {}, "screensavers": {}, "kiosk_devices": [], "tablet_suggest": [], "users": [],
    "presets": [], "suggest": {}, "integration": {}, "scene_pages": [], "shelves": {},
}


class OfflineReads:
    """Fictional reads only. This object has no HTTP connection or credentials."""
    def __init__(self):
        self.callbacks = {}
        self.serial = 0

    async def request(self, msg):
        if msg["type"] == "hk_frontend/panel/get":
            return PANEL
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


# HK's own feeds and reads (its settings, music, headers, snoozes, cleaning rooms, panel). No Home
# Assistant read answers them in Mantel (P3.5 moves HK's settings into Mantel Server); since P3.7 the
# page's reads go through P3.4's RBAC-filtered read handlers, so this smoke answers these the way a
# connector would, as read routes (app["read_routes"]), from the same fictional OfflineReads.
HK_FEEDS = ("hk_frontend/panel/get", "hk_frontend/hidden/get", "hk_frontend/settings/subscribe",
            "hk_frontend/page_headers/subscribe", "hk_frontend/snooze/subscribe", "hk_music/subscribe",
            "hk_clean_areas/subscribe")


def stand_in_hk_feeds(app, reads):
    from mantel_server.connectors import Route

    async def request(ctx, msg):
        return await reads.request(msg)

    async def subscribe(ctx, msg, on_event):
        mid = await reads.subscribe(msg, on_event)

        async def unsubscribe():
            await reads.unsubscribe(mid)
        return unsubscribe

    for kind in HK_FEEDS:
        app["read_routes"][kind] = Route(request=request, subscribe=subscribe)


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
        stand_in_hk_feeds(app, hub.readproxy)
        hub.store.apply_event({"a": {"sensor.proof": {"s": "21.4", "a": {
            "friendly_name": "Offline temperature", "unit_of_measurement": "°C"}, "lc": 1.0, "lu": 1.0},
            "light.proof": {"s": "off", "a": {"friendly_name": "Offline lamp", "supported_color_modes": ["brightness"]},
                            "lc": 1.0, "lu": 1.0},
            "scene.proof_evening": {"s": "unknown", "a": {"friendly_name": "Offline evening"}, "lc": 1.0, "lu": 1.0}}})
        hub.registry.load([], [], [{"entity_id": "sensor.proof", "platform": "demo"},
                                   {"entity_id": "light.proof", "platform": "demo"},
                                   {"entity_id": "scene.proof_evening", "platform": "demo"}])
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
                    # A card made by HK's view host's factory (as it makes a view's cards), fed each new client.
                    await browser.eval("""(async () => {
                      const metric = window.hkViewHost.createCardElement({type:'custom:hk-stat-card',entity:'sensor.proof'},
                                                                         window.__mantel.client);
                      metric.id = 'proof-metric';
                      document.getElementById('app').prepend(metric);
                      window.__mantelOnSnapshot = () => window.hkHostClient.bridge(metric, window.__mantel.client);
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
                      const tile = window.hkViewHost.createCardElement({type:'custom:hk-tile-card', entity:'light.proof'},
                                                                       window.__mantel.client);
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
                    # P2.5: HK's own sheets and dialogs. An entity HK has no sheet of its own for (a scene) opens HK's
                    # generic sheet in Mantel (no host detail): no HA element anywhere in it, no "Open in Home
                    # Assistant" even for the owner; its Activate is refused at the action port and said in HK's
                    # own toast layer; a toast and a confirm sheet mount in #hk-shell-root; 0 frames sent.
                    sheets = await browser.eval("""(async () => {
                      const frames = window.__sentFrames, refused0 = window.__mantel.refused.length;
                      const root = document.getElementById('hk-shell-root');
                      const tile = window.hkViewHost.createCardElement({type:'custom:hk-tile-card', entity:'scene.proof_evening'},
                                                                       window.__mantel.client);
                      document.getElementById('app').prepend(tile);
                      const asked = window.hkShell.moreInfo('scene.proof_evening', tile);
                      const st = window.hkDetail._.state(), panel = st.panel;
                      await new Promise(r => setTimeout(r, 50));
                      const names = [];
                      const walk = (n) => { for (const e of n.querySelectorAll('*')) { names.push(e.localName); if (e.shadowRoot) walk(e.shadowRoot); } };
                      walk(st.el);
                      const sheet = { event: asked && asked.type, kind: st.kind, tag: panel && panel.localName,
                                      in_shell_root: st.el.parentNode === root, state: panel._big.textContent,
                                      control: panel._gCtl.hidden ? null : panel._gCtl.textContent, link: !panel._gHost.hidden,
                                      ha_elements: names.filter(n => /^(ha|hui)-/.test(n)),
                                      host_dialogs: document.querySelectorAll('home-assistant, ha-more-info-dialog, ha-dialog').length };
                      panel._gCtl.click();
                      await new Promise(r => setTimeout(r, 50));
                      const refusal = window.hkOverlays.current() && window.hkOverlays.current().detail.message;
                      window.hkDetail.close(true);
                      window.hkShell.toast({ message: 'Offline toast' });
                      const layer = root.querySelector(':scope > #hk-toasts'), msg = layer && layer.querySelector('.toast .msg');
                      const confirm = window.hkCards.confirmSheet('Offline question?', () => {});
                      const confirm_in_root = confirm.parentNode === root;
                      confirm.querySelector('[data-no]').click();
                      tile.remove();
                      return { sheet, refusal, toast: msg && msg.textContent, confirm_in_root,
                               mantel_box: !!document.getElementById('mantel-toast'),
                               refused: window.__mantel.refused.slice(refused0), frames: window.__sentFrames - frames };
                    })()""")
                    assert sheets["sheet"] == {"event": "hk-more-info", "kind": "generic", "tag": "hk-detail-generic",
                                               "in_shell_root": True, "state": "unknown", "control": "Activate", "link": False,
                                               "ha_elements": [], "host_dialogs": 0}, sheets
                    assert sheets["refusal"] == "Commands are disabled in Mantel (read-only)", sheets
                    assert sheets["toast"] == "Offline toast" and sheets["confirm_in_root"] and not sheets["mantel_box"], sheets
                    assert sheets["refused"] == ["scene.turn_on"] and sheets["frames"] == 0, sheets
                    # Slice 11: the HK Settings panel reads a client and saves through its action port.
                    # Loaded here with Mantel's client, its saves, a config flow's step and a photo
                    # forgotten are refused at the port; not one frame leaves the page.
                    settings_panel = await browser.eval("""(async () => {
                      for (const f of ['hk-settings-model', 'hk-settings-kit', 'hk-settings-features', 'hk-settings'])
                        await import('/web/hk/panels/' + f + '.js');
                      const P = customElements.get('hk-settings-panel').prototype;
                      const pg = Object.create(P);
                      Object.defineProperty(pg, 'client', { value: window.__mantel.client });
                      pg.data = { entry_id: 'fictional-entry', settings: {}, boards: {} };
                      const frames = window.__sentFrames, refused0 = window.__mantel.refused.length;
                      const code = async (p) => { try { await p; return 'sent'; } catch (e) { return e.code; } };
                      const save = await code(pg.actions().callWS({ type: 'hk_frontend/settings/set', changes: { 'look.glass': 'clear' } }));
                      const flow = await code(pg.rest('POST', 'config/config_entries/subentries/flow', { handler: ['fictional-entry', 'page'] }));
                      pg.photoForget('/api/image/serve/0123456789abcdef0123456789abcdef/original');
                      await new Promise(r => setTimeout(r, 50));
                      return { save, flow, entry: Object.getOwnPropertyDescriptor(P, 'hass') ? 'entry' : 'none',
                               frames: window.__sentFrames - frames, refused: window.__mantel.refused.slice(refused0) };
                    })()""")
                    assert settings_panel == {"save": "commands_disabled", "flow": "commands_disabled", "entry": "entry",
                                              "frames": 0, "refused": ["hk_frontend/settings/set",
                                                                       "POST /api/config/config_entries/subentries/flow",
                                                                       "image/delete"]}, settings_panel
                    # P2.4: the HK Settings panel opens in the Mantel page, drawn with HK's own controls only:
                    # the Mantel adapter's entry hands it Mantel's client; Added Accessories' picker lists the
                    # fictional entities and searches them; a custom page's YAML editor shows its content,
                    # says a mistake by line, and its Save is refused at the action port (0 frames).
                    await browser.eval("""(() => {
                      window.__proofHash = location.hash;
                      history.replaceState(null, '', location.pathname + location.search + '#/overview');
                      const el = document.createElement('hk-settings-panel');
                      el.id = 'proof-settings';
                      el.style.cssText = 'position:fixed;inset:0;z-index:2147483000';
                      el.narrow = true;
                      el.hass = window.__mantel.hass;   // what panel_custom does in HA: the adapter's entry
                      document.body.appendChild(el);
                      window.__proofSettings = el;
                    })()""")
                    if not await browser.wait("window.__proofSettings.ready === true && "
                                              "!!window.__proofSettings.shadowRoot.querySelector('.side .grp')", 20):
                        raise AssertionError("HK Settings did not open: " + json.dumps(browser.console[-15:]) + " " + json.dumps(
                            await browser.eval("window.__proofSettings.shadowRoot.textContent.slice(0, 300)")))
                    panel_open = await browser.eval("""(() => {
                      const el = window.__proofSettings, sr = el.shadowRoot;
                      const all = [...sr.querySelectorAll('*')].map(e => e.localName);
                      return { client: el.client === window.__mantel.client,
                               side: !!sr.querySelector('.side .search input'),
                               menu_button: !!sr.querySelector('.sidehead.menubtn'),
                               ha_forms: all.filter(n => /^ha-(form|yaml-editor|code-editor|selector|entity-picker|textfield|switch|menu-button)$/.test(n)).length };
                    })()""")
                    assert panel_open == {"client": True, "side": True, "menu_button": False, "ha_forms": 0}, panel_open
                    await browser.eval("location.hash = '#/accessories/added'")
                    add_button = "[...window.__proofSettings.shadowRoot.querySelectorAll('button')].find(b => b.textContent.trim() === 'Add\u2026')"
                    assert await browser.wait("!!" + add_button, 5), "Added Accessories did not draw"
                    await browser.eval(add_button + ".click()")
                    assert await browser.wait("!!window.__proofSettings.shadowRoot.querySelector('.page .search input')", 5), \
                        "the picker did not open"
                    picker = await browser.eval("""(async () => {
                      const sr = window.__proofSettings.shadowRoot;
                      const rows = () => [...sr.querySelectorAll('.page button.cell[role=checkbox] .lbl .t')].map(t => t.textContent);
                      const listed = rows();
                      const inp = sr.querySelector('.page .search input');
                      inp.value = 'lamp'; inp.dispatchEvent(new Event('input', { bubbles: true }));
                      await new Promise(r => setTimeout(r, 50));
                      return { listed: listed.sort(), searched: rows(), hash: location.hash };
                    })()""")
                    assert picker == {"listed": ["Offline evening", "Offline lamp", "Offline temperature"], "searched": ["Offline lamp"],
                                      "hash": "#/accessories/added/~also-add"}, picker
                    await browser.eval("location.hash = '#/pages/offline-page/content'")
                    assert await browser.wait("!!window.__proofSettings.shadowRoot.querySelector('.codebox textarea')", 5), \
                        "the YAML page did not draw"
                    yaml_page = await browser.eval("""(async () => {
                      const sr = window.__proofSettings.shadowRoot, ta = sr.querySelector('.codebox textarea');
                      const say = () => sr.querySelector('.codebox .codeerr').textContent;
                      const shown = ta.value;
                      ta.value = 'cards: [\\n  {type: tile'; ta.dispatchEvent(new Event('input', { bubbles: true }));
                      const mistake = say(), invalid = ta.getAttribute('aria-invalid');
                      ta.value = 'cards:\\n  - type: tile\\n    entity: sensor.proof\\n'; ta.dispatchEvent(new Event('input', { bubbles: true }));
                      const mended = say();
                      // every frame that leaves the page while it saves, by its message type
                      const WS = window.WebSocket.prototype, send = WS.send, sent = [];
                      WS.send = function (raw) { const m = JSON.parse(raw); sent.push(m.msg ? m.msg.type : m.type); return send.call(this, raw); };
                      const blocked = window.__blockedWrites, refused0 = window.__mantel.refused.length;
                      [...sr.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click();
                      await new Promise(r => setTimeout(r, 300));
                      WS.send = send;
                      const ha = [...sr.querySelectorAll('*')].map(e => e.localName)
                        .filter(n => /^ha-(form|yaml-editor|code-editor|selector|entity-picker|textfield|switch|menu-button)$/.test(n)).length;
                      return { shown, mistake, invalid, mended, sent, blocked: window.__blockedWrites - blocked,
                               refused: window.__mantel.refused.slice(refused0), ha_forms: ha };
                    })()""")
                    assert yaml_page == {"shown": "cards:\n  - type: tile\n    entity: light.proof\n",
                                         "mistake": "a flow collection is not closed (line 1)", "invalid": "true", "mended": "",
                                         # the save sends nothing; the page then reads itself again, as in HA
                                         "sent": ["hk_frontend/panel/get"], "blocked": 0,
                                         "refused": ["POST /api/config/config_entries/subentries/flow"],
                                         "ha_forms": 0}, yaml_page
                    await browser.eval("""(() => {
                      window.__proofSettings.remove();
                      history.replaceState(null, '', location.pathname + location.search + (window.__proofHash || ''));
                    })()""")
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
                    assert shell == {"kind": "mantel", "nav": "hk-navigate", "sky": True, "menu": True,
                                     "view": True, "config": True}, shell
                    hub.readproxy.publish_tabbar()
                    assert await browser.wait("!!document.querySelector('#hk-shell-root > #hk-tabbar')", 5), \
                        "the tab bar did not mount in Mantel's shell root"
                    # Phase 2 P2.3: HK's view host draws every page of the generated dashboard. Home was drawn by
                    # it; HK's own navigation moves to Lights in the same container (the sky stays), the back
                    # button returns to the cached Home, a hash (a pop-up) is not a page change, and each page's
                    # cards follow the client. Commands stay blocked; not one frame leaves the page meanwhile.
                    await browser.eval("""(() => {
                      window.__drew = (cards) => ({
                        cards: cards.length,
                        drawn: cards.filter(c => c.isConnected && !c.hidden && c.localName !== 'hk-card-placeholder' &&
                                            ((c.shadowRoot && c.shadowRoot.childNodes.length > 0) || c.childNodes.length > 0)).length,
                        hidden: cards.filter(c => c.hidden).length,
                        placeholders: cards.filter(c => c.localName === 'hk-card-placeholder').length,
                        fed: cards.every(c => c.client === window.__mantel.client) });
                      window.__vhFrames = window.__sentFrames;
                      window.__vhSky = document.querySelector('hk-view-container#view > #hk-sky');
                      window.__vhHome = window.__mantelViewHost.current();
                    })()""")
                    home = await browser.eval("""(() => {
                      const vh = window.__mantelViewHost, cur = vh.current(), cfg = window.hkShell.dashboardConfig();
                      return { views: cfg.views.map(v => v.path), path: cur.path,
                               type: cur.element.localName, attached: cur.element.parentNode === document.getElementById('app'),
                               shell: window.hkShell.view() === cur.element, config: cfg === vh.config,
                               grid: cur.cards.filter(c => c.localName === 'hk-view-grid').length,
                               // the scenes row (a container card) makes its child with hkCards.createCard: no
                               // Lovelace here, so HK's own grid, holding hk-grid-card > hk-row-card > the pills
                               scenes: (() => { const s = cur.cards.find(c => c.localName === 'hk-scenes-card');
                                                const g = s && s.firstElementChild;
                                                return s && !s.hidden && g ? [g.localName, !!document.querySelector('hui-card'),
                                                  !!(g.shadowRoot && g.shadowRoot.querySelector('hk-grid-card'))] : null; })(),
                               cards: window.__drew(cur.cards) };
                    })()""")
                    assert home["path"] == "home" and home["type"] == "hk-grid-view" and home["attached"] and home["shell"] \
                        and home["config"] and len(home["views"]) >= 2 and "lights" in home["views"], home
                    assert home["grid"] == 1, home      # Lovelace's grid card, drawn by HK (no hui-* element)
                    assert home["scenes"] == ["hk-view-grid", False, True], home
                    assert home["cards"]["placeholders"] == 0 and home["cards"]["drawn"] >= 1 and home["cards"]["fed"] \
                        and home["cards"]["drawn"] + home["cards"]["hidden"] == home["cards"]["cards"], home
                    await browser.eval("window.hkShell.navigate('/dashboard-proof/lights')")
                    assert await browser.wait("window.__mantelViewHost.current().path === 'lights' && "
                                              "window.__mantelViewHost.current().element.isConnected", 10), \
                        "the view host did not move to Lights: " + json.dumps(browser.console[-10:])
                    hub.store.apply_event({"c": {"light.proof": {"+": {"s": "on", "lu": 4.0}}}})
                    hub.on_change({"light.proof"})
                    assert await browser.wait("window.__mantel.hass.states['light.proof'].state === 'on'", 5)
                    lights = await browser.eval("""(() => {
                      const cur = window.__mantelViewHost.current(), home = window.__vhHome.element;
                      return { path: location.pathname, type: cur.element.localName,
                               attached: cur.element.parentNode === document.getElementById('app'),
                               home_detached: home.parentNode === null, shell: window.hkShell.view() === cur.element,
                               tag: window.hkShell.tags.view,
                               sky: window.__vhSky !== null && window.__vhSky === document.querySelector('hk-view-container#view > #hk-sky'),
                               cards: window.__drew(cur.cards) };
                    })()""")
                    assert lights["path"] == "/dashboard-proof/lights" and lights["type"] == "hk-grid-view" and lights["attached"] \
                        and lights["home_detached"] and lights["shell"] and lights["tag"] == "hk-grid-view" and lights["sky"], lights
                    assert lights["cards"]["placeholders"] == 0 and lights["cards"]["drawn"] >= 1 and lights["cards"]["fed"] \
                        and lights["cards"]["drawn"] + lights["cards"]["hidden"] == lights["cards"]["cards"], lights
                    await browser.eval("history.back()")
                    assert await browser.wait("window.__mantelViewHost.current().path === 'home'", 10), "back did not return Home"
                    back = await browser.eval("""(() => {
                      const cur = window.__mantelViewHost.current();
                      return { cached: cur.element === window.__vhHome.element, attached: cur.element.isConnected,
                               cards: window.__drew(cur.cards) };
                    })()""")
                    assert back["cached"] and back["attached"] and back["cards"]["fed"], back   # caught up with the client
                    hashed = await browser.eval("""(async () => {
                      const el = window.__mantelViewHost.current().element;
                      location.hash = 'proof-popup';
                      await new Promise(r => setTimeout(r, 100));
                      const same = window.__mantelViewHost.current().element === el && el.isConnected;
                      history.back();
                      await new Promise(r => setTimeout(r, 100));
                      return same && window.__mantelViewHost.current().element === el;
                    })()""")
                    assert hashed, "a hash change swapped the view"
                    view_frames = await browser.eval("window.__sentFrames - window.__vhFrames")
                    assert view_frames == 0, view_frames
                    assert await browser.eval("window.__blockedWrites") == 0
                    exceptions = [line for line in browser.console if line.startswith("EXCEPTION:")]
                    assert not exceptions, exceptions
                    assert not browser.blocked_requests, browser.blocked_requests
                    # A page opened by its own address is drawn first by the view host. With narrowing on (the
                    # page's default), the hub subscription narrows to what Lights reads; a page not seen yet
                    # (Home) widens it again first, then it narrows to both pages' reads.
                    await browser.open(origin + "/dashboard-proof/lights", cookie)
                    if not await browser.wait("window.__mantelReady === true", 25):
                        raise AssertionError("Lights did not load: " + json.dumps(browser.console[-15:]))
                    direct = await browser.eval("""(() => {
                      const cur = window.__mantelViewHost.current();
                      return { path: cur.path, cached: window.__mantelViewHost.cached(),
                               cards: cur.cards.length, placeholders: document.querySelectorAll('hk-card-placeholder').length };
                    })()""")
                    assert direct["path"] == "lights" and direct["cached"] == ["lights"] and direct["cards"] >= 1 \
                        and direct["placeholders"] == 0, direct
                    assert await browser.wait("window.__mantelNarrow !== undefined", 15), "Lights did not narrow"
                    narrowed_at = await browser.eval("window.__mantelMarks.narrowed")
                    await browser.eval("window.hkShell.navigate('/dashboard-proof/home')")
                    assert await browser.wait("window.__mantelViewHost.current().path === 'home' && "
                                              "window.__mantelViewHost.current().element.isConnected", 10), "Home after Lights"
                    assert await browser.wait(f"window.__mantelMarks.narrowed > {narrowed_at}", 15), "Home did not narrow"
                    narrow = await browser.eval("""(() => ({
                      ids: window.__mantelNarrow, states: Object.keys(window.__mantel._states).sort(),
                      fed: window.__mantelViewHost.current().cards.every(c => c.client === window.__mantel.client) }))()""")
                    assert narrow["fed"] and "scene.proof_evening" in narrow["states"] and "light.proof" in narrow["states"], narrow
                    assert await browser.eval("window.__blockedWrites") == 0
                    exceptions = [line for line in browser.console if line.startswith("EXCEPTION:")]
                    assert not exceptions, exceptions
                    assert not [line for line in browser.console if "[hk-view-host]" in line], browser.console
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
                            "sheets": "a scene (no sheet of its own) opened HK's generic sheet in #hk-shell-root, no HA element, "
                                      "no Open in Home Assistant link (no host detail); Activate refused and said in HK's toast "
                                      "layer; a toast and a confirm sheet in #hk-shell-root; 0 frames",
                            "subscriptions": "write and state_changed bus refused (not_allowed); talk-back POST and live socket refused; 0 frames",
                            "settings_panel": "loaded with Mantel's client; a save, a config flow step and a photo forgotten refused at the action port; 0 frames",
                            "view_host": f"generated views {home['views']}; Home {home['cards']['drawn']} cards drawn "
                                         f"({home['cards']['hidden']} hidden; Lovelace's grid and the scenes row's child drawn by HK), Lights "
                                         f"{lights['cards']['drawn']} drawn, fed each client; HK navigation and back swap "
                                         f"views in one container (sky kept, Home cached); a hash is no page change; "
                                         f"/dashboard-proof/lights opened directly, narrowed, then Home widened and narrowed to both pages' "
                                         f"{narrow['ids']} states; 0 placeholders; {view_frames} frames sent while moving between views",
                            "settings_forms": "HK Settings opened in the Mantel page with no HA element; the picker listed and searched "
                                              "the fictional entities; the YAML editor showed the page and said a mistake by line; "
                                              "its Save refused at the action port (no write frame; only the page's re-read)",
                            "external_requests": 0, "browser_exceptions": 0}
        finally:
            store.db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--shot")
    print(json.dumps(asyncio.run(smoke(parser.parse_args().shot)), indent=2))
