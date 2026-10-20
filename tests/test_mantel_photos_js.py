"""Mantel Settings → Photos (web/shim/mantel-photos.js) and the screensaver's side in Mantel's shell
(web/shim/mantel-shell.js photoSource / listPhotos). Run in node with a recording stand-in for HK Settings' kit
and the few browser objects the page touches (fetch, XMLHttpRequest, localStorage): no DOM, no network, no photo.

* The library: albums with their covers, the space used against the limit and what goes into the backups; an
  Owner's limits and the import from Home Assistant; an Admin gets neither.
* An album: the grid, the preview's address, selecting, deleting and moving many at once (what is sent).
* Uploads: twenty files at once, at most three in flight, each file's state in words; what isn't a photo, or is
  too big, refused before it is sent.
* A screen's Screensaver Options and All Screens' Screensaver: the album pickers and what they save.
* The shell: a screen's album as its source, an album's photos as same-origin addresses under the prefix.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"

PAGE_SCRIPT = r"""
import { readFileSync } from 'node:fs';
globalThis.window = globalThis;
const stored = {};
globalThis.localStorage = { setItem(k, v) { stored[k] = v; } };
globalThis.location = { hash: '#/mantel/photos', pathname: '/settings' };
globalThis.document = { addEventListener() {}, querySelector: () => null, cookie: '' };
class El {
  constructor(tag, attrs, kids) {
    this.tag = tag; this.attrs = Object.assign({}, attrs || {}); this.kids = []; this.on = {};
    this.text = this.attrs.text || ''; this.cls = new Set(String(this.attrs.class || '').split(' ').filter(Boolean));
    this.classList = { add: (...c) => c.forEach((x) => this.cls.add(x)), remove: (...c) => c.forEach((x) => this.cls.delete(x)) };
    for (const k of [].concat(kids || [])) if (k) this.kids.push(k);
  }
  appendChild(k) { this.kids.push(k); return k; }
  insertBefore(k) { this.kids.unshift(k); return k; }
  get firstChild() { return this.kids[0]; }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(t, f) { this.on[t] = f; }
  click() { if (this.attrs.onClick) return this.attrs.onClick(); if (this.on.click) return this.on.click(); }
  all() { const out = [this]; for (const k of this.kids) if (k instanceof El) out.push(...k.all()); return out; }
  find(pred) { return this.all().find(pred); }
  // the page paints a few things in place: '[attr="v"] .cls' and '[attr]'
  querySelector(sel) {
    const m = /^\[([\w-]+)(?:="([^"]*)")?\](?: \.([\w-]+))?$/.exec(sel);
    if (sel === 'style[data-mx]') return {};          // Mantel's style, already in place
    if (!m) throw new Error('selector ' + sel);
    const hit = this.find((e) => e.attrs[m[1]] !== undefined && (m[2] === undefined || e.attrs[m[1]] === m[2]));
    return hit && m[3] ? hit.find((e) => e.cls.has(m[3])) || null : hit || null;
  }
}
const row = (kind) => (o) => new El(kind, Object.assign({}, o, { 'data-fk': o.fk }));
window.hkSettingsKit = {
  h: (tag, attrs, kids) => new El(tag, attrs, kids),
  group: (o, rows) => new El('group', { header: o.header || null, footer: typeof o.footer === 'string' ? o.footer : null }, rows),
  info: row('info'), toggle: row('toggle'), text: row('text'), select: row('select'), nav: row('nav'), check: row('check'),
  button: (o) => new El('button', Object.assign({}, o, { 'data-fk': o.fk })),
  confirm: () => Promise.resolve(true),
};
const reads = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const sent = [];
globalThis.fetch = async (u, init) => {
  const method = (init && init.method) || 'GET', path = String(u);
  if (method !== 'GET') {
    sent.push({ method, path, body: init.body ? JSON.parse(init.body) : null });
    return { ok: true, status: 200, json: async () => (path.endsWith('/move') ? { ok: true, moved: ['p2'], skipped: [] } : { ok: true }) };
  }
  if (!(path in reads)) throw new Error('unexpected ' + path);
  return { ok: true, status: 200, json: async () => reads[path] };
};
// uploads: answered when the test says, so what is in flight can be counted
const xhrs = [];
globalThis.XMLHttpRequest = class {
  constructor() { this.upload = {}; this.headers = {}; xhrs.push(this); }
  open(m, u) { this.method = m; this.url = u; }
  setRequestHeader(k, v) { this.headers[k] = v; }
  send(fd) { this.fd = fd; this.sent = true; }
  answer(status, body) { this.status = status; this.responseText = JSON.stringify(body); this.done = true; this.onload(); }
};
globalThis.FormData = class { constructor() { this.parts = []; } append(k, v, n) { this.parts.push([k, n]); } };
const m = await import(process.argv[2]);
const tick = () => new Promise((r) => setTimeout(r, 0));
const owner = JSON.parse(process.argv[4]), admin = JSON.parse(process.argv[5]);
async function draw(me, parts, where, ctx) {
  m._reset(me);
  const panel = { render() {}, status() {}, go(h) { panel.went = h; }, shadowRoot: new El('root') };
  let c;
  for (let i = 0; i < 4; i++) {
    c = new El('page');
    if (where) m.host.extend(where, c, ctx, panel);
    else m.host.page(parts, panel).body(c);
    await tick(); await tick();
  }
  return { c, panel };
}
// drawn again (after an action, the page's reads come back first), keeping the module's own state
async function redraw(me, parts) {
  const panel = { render() {}, status() {}, go() {}, shadowRoot: new El('root') };
  let c;
  for (let i = 0; i < 3; i++) { c = new El('page'); m.host.page(parts, panel).body(c); await tick(); await tick(); }
  return c;
}
const groups = (c) => c.kids.filter((k) => k.tag === 'group' || k.tag === 'section').map((g) => ({
  header: g.attrs.header || null, footer: g.attrs.footer || null,
  rows: g.kids.map((r) => ({ kind: r.tag, label: r.attrs.label || r.text || (r.find((x) => x.cls && x.cls.has('t')) || {}).text || '',
                             sub: r.attrs.sub || null, value: r.attrs.value === undefined ? null : r.attrs.value,
                             fk: r.attrs['data-fk'] || null, options: r.attrs.options || null,
                             err: !!(r.find && r.find((x) => x.cls && x.cls.has('err'))) })) }));
const out = {};

// -- the library
out.ownerLib = groups((await draw(owner, ['mantel', 'photos'])).c);
const ownerRead = reads['/api/photos'];
reads['/api/photos'] = Object.assign({}, ownerRead, { owner: false });
out.adminLib = groups((await draw(admin, ['mantel', 'photos'])).c);
reads['/api/photos'] = ownerRead;

// -- an album: grid, select, delete, move
const AID = 'a1a1a1a1a1a1a1a1';
let { c, panel } = await draw(owner, ['mantel', 'photos', AID]);
out.albumGroups = groups(c);
const tiles = c.all().filter((e) => e.cls.has('mxph'));
out.tiles = tiles.map((t) => [t.attrs['data-id'], t.kids[0].attrs.src]);
c.find((e) => e.attrs['data-fk'] === 'mx:photos-select').click();
c = await redraw(owner, ['mantel', 'photos', AID]);
for (const t of c.all().filter((e) => e.cls.has('mxph')).slice(0, 2)) t.click();
out.selected = [...m._photos._state.selected];
c = await redraw(owner, ['mantel', 'photos', AID]);
out.selection = groups(c).find((g) => g.header === 'Selection');
await c.find((e) => e.attrs['data-fk'] === 'mx:photos-move').attrs.onChange('b2b2b2b2b2b2b2b2');
await tick();
for (const t of (await redraw(owner, ['mantel', 'photos', AID])).all().filter((e) => e.cls.has('mxph')).slice(2, 3)) t.click();
c = await redraw(owner, ['mantel', 'photos', AID]);
await c.find((e) => e.attrs['data-fk'] === 'mx:photos-delete').click();
await tick(); await tick();
out.sent = sent.splice(0);

// -- twenty uploads at once
({ c } = await draw(owner, ['mantel', 'photos', AID]));
const input = c.find((e) => e.attrs['data-fk'] === 'mx:photos-files');
const file = (name, size, type) => ({ name, size, type });
input.files = Array.from({ length: 20 }, (_, i) => file('IMG_' + i + '.HEIC', 3 << 20, ''))
  .concat([file('notes.txt', 100, 'text/plain'), file('huge.jpg', 50 << 20, 'image/jpeg')]);
input.on.change();
out.inFlight = xhrs.filter((x) => x.sent && !x.done).length;
out.firstUpload = { url: xhrs[0].url, csrf: 'X-CSRF-Token' in xhrs[0].headers, parts: xhrs[0].fd.parts };
let early = groups(await redraw(owner, ['mantel', 'photos', AID])).find((g) => (g.header || '').startsWith('Uploading'));
out.refused = early.rows.filter((r) => r.err).map((r) => r.label);
let n = 0, maxInFlight = 0;
while (true) {
  const x = xhrs.find((q) => q.sent && !q.done);
  if (!x) break;
  maxInFlight = Math.max(maxInFlight, xhrs.filter((q) => q.sent && !q.done).length);
  n++;
  if (n === 5) x.answer(200, { ok: true, duplicate: true, photo: {} });
  else if (n === 9) x.answer(415, { error: 'photo_invalid', message: 'That picture couldn’t be read.' });
  else x.answer(201, { ok: true, photo: {} });
  await tick();
}
out.maxInFlight = maxInFlight;
out.uploaded = groups(await redraw(owner, ['mantel', 'photos', AID])).find((g) => g.header === 'Uploaded');
out.changedSignal = 'mantel-photos-changed' in stored;

// -- the screensaver pickers on HK's pages
let s = await draw(owner, null, 'saver', { screen: 'dashboard-kitchen', title: 'Kitchen' });
out.saver = groups(s.c);
await s.c.find((e) => e.attrs['data-fk'] === 'mx:saver-album').attrs.onChange(AID);
await tick();
out.saverSent = sent.splice(0);
const set = [];
s = await draw(owner, null, 'house-saver', { photos: 'mantel-photos://' + AID, set: (v) => { set.push(v); return Promise.resolve(); } });
out.house = groups(s.c);
await s.c.find((e) => e.attrs['data-fk'] === 'mx:house-album').attrs.onChange('');
out.houseSet = set;
out.adultSaver = groups((await draw(JSON.parse(process.argv[6]), null, 'saver', { screen: 'x', title: 'X' })).c);
process.stdout.write(JSON.stringify(out));
"""


def overview(role, sections):
    return {"user": {"id": "u1", "name": f"Fictional {role}", "username": role, "role": role, "kind": "mantel",
                     "totp": False, "passkeys": 0},
            "door": "lan", "csrf": "x", "now": 0, "at_tablet": False, "sections": sections, "roles": [], "device_roles": [],
            "actions": [], "resource_kinds": [], "features": [], "service_scopes": [], "connect_port": None, "ha_set_up": True}


A, B = "a1a1a1a1a1a1a1a1", "b2b2b2b2b2b2b2b2"
P = [f"{i:032x}" for i in range(1, 5)]
LIBRARY = {"ok": True, "owner": True, "usage": 3 << 30, "photos": 812, "limits": {"quota_mb": 4096, "file_mb": 40},
           "albums": [{"id": A, "name": "Family", "count": 800, "bytes": 3 << 30, "cover": P[0]},
                      {"id": B, "name": "Beach", "count": 12, "bytes": 1 << 20, "cover": None}],
           "screens": {"dashboard-kitchen": A, "dashboard-loft": A},
           "backup": {"mantel": True, "nightly": True, "home_assistant": True}, "importing": None}


def run_page():
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    return _run_page()


_CACHE: dict = {}


def _run_page():
    if "out" in _CACHE:
        return _CACHE["out"]
    import tempfile
    d = Path(tempfile.mkdtemp())
    (d / "base.mjs").write_text((WEB / "shim/base.js").read_text(encoding="utf-8"))
    (d / "mantel-photos.mjs").write_text((WEB / "shim/mantel-photos.js").read_text(encoding="utf-8"))
    (d / "m.mjs").write_text((WEB / "shim/mantel-settings.js").read_text(encoding="utf-8")
                             .replace("from './base.js'", "from './base.mjs'")
                             .replace("from './mantel-photos.js'", "from './mantel-photos.mjs'")
                             + "\nexport * as _photos from './mantel-photos.mjs';\n")
    (d / "s.mjs").write_text(PAGE_SCRIPT)
    photos = [{"id": p, "album_id": A, "name": f"IMG_{i}.jpg", "width": 4032, "height": 3024, "bytes": 2 << 20,
               "source": "upload", "created": 0} for i, p in enumerate(P)]
    # the Admin's overview: the same library, but not an Owner's
    reads = {"/api/photos": LIBRARY, f"/api/photos/albums/{A}/photos": {"ok": True, "album": {"id": A, "name": "Family"}, "photos": photos}}
    (d / "reads.json").write_text(json.dumps(reads))
    sections = ["me", "connections", "people", "devices", "files", "photos", "roles", "audit"]
    got = subprocess.run(["node", str(d / "s.mjs"), str(d / "m.mjs"), str(d / "reads.json"),
                          json.dumps(overview("owner", sections)), json.dumps(overview("admin", sections)),
                          json.dumps(overview("adult", ["me"]))], capture_output=True, text=True, timeout=60)
    assert got.returncode == 0, got.stderr
    _CACHE["out"] = json.loads(got.stdout)
    shutil.rmtree(d, ignore_errors=True)
    return _CACHE["out"]


def by_header(groups, header):
    return next(g for g in groups if g["header"] == header)


def test_the_library_shows_albums_space_and_backups():
    out = run_page()
    albums = by_header(out["ownerLib"], "Albums")
    assert [r["label"] for r in albums["rows"]] == ["Family", "Beach", "New Album…"]
    assert albums["rows"][0]["sub"] == "800 photos · 3.0 GB · on 2 screens" and albums["rows"][1]["sub"] == "12 photos · 1.0 MB"
    storage = by_header(out["ownerLib"], "Storage")
    assert "Location and camera details are removed" in storage["footer"]
    assert "encrypted backups every night, and in Home Assistant’s backups of the Mantel App: 3.0 GB" in storage["footer"]
    fks = [r["fk"] for r in storage["rows"]]
    assert "mx:photos-quota" in fks and "mx:photos-filecap" in fks
    imp = by_header(out["ownerLib"], "Import from Home Assistant")
    assert [r["fk"] for r in imp["rows"]][-1] == "mx:photos-import"
    assert "Nothing in Home Assistant is changed or deleted" in imp["footer"]


def test_an_admin_manages_photos_but_not_the_limits_or_the_import():
    out = run_page()
    heads = [g["header"] for g in out["adminLib"]]
    assert "Albums" in heads and "Import from Home Assistant" not in heads
    storage = by_header(out["adminLib"], "Storage")
    assert [r["fk"] for r in storage["rows"]] == ["mx:photos-usage"] and "Only an Owner changes the limits." in storage["footer"]


def test_an_album_shows_a_grid_and_many_are_deleted_and_moved_at_once():
    out = run_page()
    assert [t[0] for t in out["tiles"]] == P
    assert out["tiles"][0][1] == f"/api/photos/{P[0]}/thumb"
    assert out["selected"] == P[:2]
    sel = out["selection"]
    assert sel["rows"][0]["label"] == "2 Photos Selected"
    move = next(r for r in sel["rows"] if r["fk"] == "mx:photos-move")
    assert [o[1] for o in move["options"]] == ["Choose…", "Beach"]                # not the album it is in
    assert out["sent"][0] == {"method": "POST", "path": "/api/photos/move", "body": {"ids": P[:2], "album": B}}
    assert out["sent"][1]["path"] == "/api/photos/delete" and len(out["sent"][1]["body"]["ids"]) == 1


def test_twenty_uploads_go_three_at_a_time_and_each_says_how_it_went():
    out = run_page()
    assert out["inFlight"] == 3 and out["maxInFlight"] == 3
    assert out["firstUpload"]["url"] == f"/api/photos/albums/{A}/upload" and out["firstUpload"]["csrf"]
    assert out["firstUpload"]["parts"] == [["file", "IMG_0.HEIC"]]
    assert out["refused"] == ["notes.txt", "huge.jpg"]
    up = out["uploaded"]
    assert up["footer"] == "18 added, 1 already in this album, 3 couldn’t be added."
    assert [r["label"] for r in up["rows"] if r["err"]] == ["IMG_8.HEIC", "notes.txt", "huge.jpg"]
    assert len([r for r in up["rows"] if r["kind"] == "div"]) == 22
    assert out["changedSignal"]


def test_the_screensaver_pickers_save_a_screens_album_and_the_houses():
    out = run_page()
    g = by_header(out["saver"], "Photos")
    pick = g["rows"][0]
    assert pick["value"] == A and [o[1] for o in pick["options"]] == ["Screensaver Photos (All Screens)", "Family · 800 photos",
                                                                      "Beach · 12 photos"]
    assert out["saverSent"] == [{"method": "PUT", "path": "/api/photos/screens/dashboard-kitchen", "body": {"album": A}}]
    house = out["house"][0]["rows"][0]
    assert house["value"] == A and house["options"][0][1] == "The Home Assistant Folder (Above)"
    assert out["houseSet"] == ["media-source://media_source/local/photos"]
    assert out["adultSaver"] == []                                  # no Photos section: nothing drawn


SHELL_SCRIPT = r"""
const fs = require('fs');
globalThis.window = globalThis;
globalThis.CustomEvent = class { constructor(n, i) { this.type = n; this.detail = i && i.detail; } };
globalThis.dispatchEvent = () => true;
const listeners = {};
globalThis.addEventListener = (t, f) => { listeners[t] = f; };
const out = {};
(async () => {
  for (const base of ['', '/api/hassio_ingress/Fict1onal']) {
    delete globalThis.hkShell; delete globalThis.hkMantelShell;
    globalThis.__mantelBase = base;
    globalThis.location = { pathname: base + '/dashboard-kitchen/home' };
    const asked = [];
    let screens = { 'dashboard-kitchen': 'a1a1a1a1a1a1a1a1' };
    globalThis.fetch = async (u) => {
      asked.push(u);
      if (u.endsWith('/api/photos/screens')) return { ok: true, json: async () => ({ screens }) };
      return { ok: true, json: async () => ({ photos: [{ id: 'p1', title: 'One', url: '/api/photos/' + '1'.repeat(32) + '/screen' },
                                                       { id: 'p2', url: 'https://evil.example/x.jpg' }] }) };
    };
    let told = 0;
    globalThis.hkSaver = { photosChanged() { told++; } };
    eval(fs.readFileSync(process.argv[1] + '/web/client/hk-host-shell.js', 'utf8'));
    eval(fs.readFileSync(process.argv[1] + '/web/shim/mantel-shell.js', 'utf8'));
    const r = { first: hkShell.photoSource('media-source://media_source/local/photos') };
    await new Promise((ok) => setTimeout(ok, 0)); await new Promise((ok) => setTimeout(ok, 0));
    r.after = hkShell.photoSource('media-source://media_source/local/photos');
    r.told = told;
    r.folder = hkShell.listPhotos('media-source://media_source/local/photos');
    r.list = await hkShell.listPhotos(r.after);
    screens = {};
    listeners.storage({ key: 'mantel-photos-changed' });
    await new Promise((ok) => setTimeout(ok, 0)); await new Promise((ok) => setTimeout(ok, 0));
    r.cleared = hkShell.photoSource('x');
    r.toldAgain = told;
    r.asked = asked;
    out[base || 'root'] = r;
  }
  process.stdout.write(JSON.stringify(out));
})();
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_the_shell_gives_a_screen_its_album_and_lists_it_under_the_prefix():
    got = json.loads(subprocess.run(["node", "-e", SHELL_SCRIPT, str(ROOT)], capture_output=True, text=True,
                                    check=True, timeout=30).stdout)
    r = got["root"]
    assert r["first"] is None and r["after"] == "mantel-photos://a1a1a1a1a1a1a1a1" and r["told"] == 1
    assert r["folder"] is None                                      # a Home Assistant folder is HK's to walk
    assert r["list"] == [{"id": "p1", "title": "One", "url": "/api/photos/" + "1" * 32 + "/screen"}]   # never another host
    assert r["cleared"] is None and r["toldAgain"] == 2
    ing = got["/api/hassio_ingress/Fict1onal"]
    assert ing["after"] == "mantel-photos://a1a1a1a1a1a1a1a1"       # the screen read without the prefix
    assert ing["list"][0]["url"] == "/api/hassio_ingress/Fict1onal/api/photos/" + "1" * 32 + "/screen"
    assert ing["asked"][0] == "/api/hassio_ingress/Fict1onal/api/photos/screens"
