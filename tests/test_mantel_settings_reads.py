"""Mantel Settings' reads (web/shim/mantel-settings.js load() and the pairing poll), drawn in node with a recording
kit as test_mantel_settings_accounts.py does (the audit's second pass, SET-9..11)."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
NODE = shutil.which("node") or "/opt/homebrew/bin/node"

SCRIPT = r"""
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, cookie: '' };
globalThis.location = { hostname: 'mantel.example', hash: '', search: '', pathname: '/settings', assign() {} };
const plain = (o) => (o == null ? o : typeof o === 'object' ? (o._text !== undefined ? o._text : JSON.stringify(o)) : o);
const row = (kind) => (o) => ({ kind, label: o.label, sub: plain(o.sub), value: o.value, onClick: o.onClick, onChange: o.onChange,
                                onCommit: o.onCommit, setAttribute() {} });
window.hkSettingsKit = {
  group: (o, rows) => ({ kind: 'group', header: o.header || null, footer: plain(o.footer), rows: rows.filter(Boolean) }),
  info: row('info'), toggle: row('toggle'), text: row('text'), select: row('select'), nav: row('nav'), button: row('button'),
  check: row('check'), confirm: async () => true, h: (tag, attrs) => ({ _text: (attrs && attrs.text) || '' }),
};
const timers = [];            // setInterval callbacks, run by hand
let cleared = 0;
globalThis.setInterval = (fn) => { timers.push(fn); return timers.length; };
globalThis.clearInterval = () => { cleared += 1; };
const me = { user: { id: 'u1', name: 'Owner', username: 'owner', role: 'owner' }, door: 'lan', csrf: 'x', now: 0, at_tablet: false,
             sections: ['me', 'general', 'audit', 'connect', 'connections'], roles: [], device_roles: [], actions: [], resource_kinds: [],
             features: [], service_scopes: [], connect_port: 8099, ha_set_up: true, setup: null };
const tick = () => new Promise((r) => setTimeout(r, 0));
const ticks = async (n = 4) => { for (let i = 0; i < n; i++) await tick(); };
let renders = 0;
const panel = { render() { renders += 1; }, status() {}, go() {}, shadowRoot: null };
const m = await import(process.argv[2]);
async function draw(route) {
  const c = { kids: [], appendChild(k) { this.kids.push(k); return k; } };
  m.host.page(route, panel).body(c);
  await ticks();
  return c.kids;
}
const rows = (kids) => kids.flatMap((g) => g.rows || []);
const out = {};
const calls = {};
const ok = (body) => ({ ok: true, status: 200, json: async () => body });

// ---- SET-9: a read that failed once is cached as the answer
m._reset(me);
calls.general = 0;
globalThis.fetch = async (u) => {
  if (String(u).includes('server-settings')) {
    calls.general += 1;
    if (calls.general === 1) throw new Error('network blip');
    return ok({ settings: {}, can_edit: false, commands_on: false });
  }
  throw new Error('unexpected ' + u);
};
const first = await draw(['mantel', 'general']);
await draw(['mantel', 'me']);                       // leave the page ...
const again = await draw(['mantel', 'general']);    // ... and come back
out.set9 = { fetches: calls.general, first: first.map((g) => g.footer), again: again.map((g) => g.footer) };

// ---- SET-10: a slow, older read lands after a newer one and replaces it
m._reset(me);
const held = {};
globalThis.fetch = async (u) => {
  u = String(u);
  if (u.startsWith('/api/users') || u.includes('/api/users')) return ok({ users: [] });
  if (u.includes('/api/devices')) return ok({ devices: [] });
  if (u.includes('/api/audit')) {
    const kind = new URL(u, 'http://x').searchParams.get('kind') || 'any';
    return new Promise((res) => { held[kind] = () => res(ok({ rows: [{ id: kind, action: 'rows-for-' + kind, timestamp: 1, decision: 'allowed' }], next: null })); });
  }
  throw new Error('unexpected ' + u);
};
await draw(['mantel', 'audit']);                    // names
let kids = await draw(['mantel', 'audit']);         // request A (no filter) now in flight
const kind = rows(kids).find((r) => r.label === 'Kind');
kind.onChange('config');                            // the person picks a Kind: forget('audit'), redraw
kids = await draw(['mantel', 'audit']);             // request B (kind=config)
held.config(); await ticks();                       // B answers first
const afterB = rows(await draw(['mantel', 'audit'])).filter((r) => r.kind === 'info').map((r) => r.label);
held.any(); await ticks();                          // A (the old filter) answers last
const afterA = rows(await draw(['mantel', 'audit'])).filter((r) => r.kind === 'info').map((r) => r.label);
out.set10 = { afterB, afterA, kindShown: rows(await draw(['mantel', 'audit'])).find((r) => r.label === 'Kind').value };

// ---- SET-11: the pairing poll redraws the whole panel every tick, on any page, and never stops on errors
m._reset(me);
timers.length = 0; cleared = 0;
let failing = false;
globalThis.fetch = async (u, init = {}) => {
  u = String(u);
  if ((init.method || 'GET') === 'POST' && u.includes('/api/connect/pair')) return ok({ code: '123456', expires: 600, address: 'x:1' });
  if (u.includes('/api/connect')) { if (failing) throw new Error('offline'); return ok({ pending: true, pairings: [], ttl: 600 }); }
  throw new Error('unexpected ' + u);
};
let kids2 = await draw(['mantel', 'connect']);
await rows(kids2).find((r) => r.label === 'Start Pairing').onClick();
await ticks();
const baseCleared = cleared;
await draw(['mantel', 'me']);                       // the person moves on to another page; the code is still out
renders = 0;
for (let i = 0; i < 3; i++) { await timers[0](); }  // three polls, nothing has changed (pending)
const whileWaiting = renders;
failing = true; renders = 0;
for (let i = 0; i < 3; i++) { await timers[0](); }  // three polls that fail
out.set11 = { timers: timers.length, rendersWhilePending: whileWaiting, rendersWhileFailing: renders, cleared: cleared - baseCleared };
process.stdout.write(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def js(tmp_path_factory):
    if not Path(NODE).exists():
        pytest.skip("node not installed")
    d = tmp_path_factory.mktemp("settings-reads")
    (d / "base.mjs").write_text((WEB / "shim/base.js").read_text(encoding="utf-8"))
    (d / "mantel-photos.mjs").write_text((WEB / "shim/mantel-photos.js").read_text(encoding="utf-8"))
    (d / "mantel-settings.mjs").write_text((WEB / "shim/mantel-settings.js").read_text(encoding="utf-8")
                                           .replace("from './base.js'", "from './base.mjs'")
                                           .replace("from './mantel-photos.js'", "from './mantel-photos.mjs'"))
    (d / "script.mjs").write_text(SCRIPT)
    got = subprocess.run([NODE, str(d / "script.mjs"), str(d / "mantel-settings.mjs")], capture_output=True, text=True, timeout=60)
    assert got.returncode == 0, got.stderr
    return json.loads(got.stdout)


# SET-9. P2. mantel-settings.js:152-158 load(): `Promise.resolve().then(fn).then(ok, err => cache[key] = {err})` and
# `if (got && !got.loading) return got` -- the failure is the cached answer. Nothing forgets it when the person
# leaves the page and returns (forget() is only called after an action), so one dropped request or a 503 while
# Mantel starts leaves the page on its error line until the browser reloads. Fix: do not cache errors (delete the
# entry in the rejection handler), or forget the page's keys when host.page() enters a new route; add a Retry row
# to failed().
def test_a_read_that_failed_is_asked_again_when_its_page_is_opened_again(js):
    got = js["set9"]
    assert got["fetches"] >= 2 and "Could not reach the server." not in got["again"], got


# SET-10. P3. Same function: a `forget(key)` while a read is in flight lets the next render start a second read, and
# whichever answers LAST writes `cache[key]`, so an older slow answer replaces the newer one (the Audit Log shows the
# rows of the old filter under the new filter's Kind). Fix: tag each entry (`const mine = cache[key] = {loading: true}`)
# and only store when `cache[key] === mine`.
def test_an_older_slow_read_does_not_replace_the_newer(js):
    got = js["set10"]
    assert got["afterB"] == ["rows-for-config"], got
    assert got["afterA"] == ["rows-for-config"], got


# SET-11. P2. mantel-settings.js:1269-1283 watchPairing(): every 4 s, whether or not the code is still pending,
# `redraw()` runs panel.render() (not render(background=true), so hk-settings.js render()'s typing guard does not
# apply). The interval is not tied to the page or the panel: leaving the pairing page (or closing the panel) keeps
# it, so for up to ten minutes the whole panel is rebuilt every 4 s on whatever page is open, and a field being typed
# in (committed only on blur/Return, hk-settings-kit.js text()) loses its text. The catch swallows every error, so a
# failing poll (session gone, Mantel restarting) is retried every 4 s with no end. Fix: redraw only when the state
# changed, use render(true), stop the timer when shown.pair is cleared by navigation / on a bounded failure count.
def test_the_pairing_poll_is_quiet_while_nothing_changes_and_stops_on_errors(js):
    got = js["set11"]
    assert got["rendersWhilePending"] == 0, got
    assert got["cleared"] >= 1, got
