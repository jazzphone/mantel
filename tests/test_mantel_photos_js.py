"""Mantel Settings → Your Files → Photos (web/shim/mantel-photos.js) and the screensaver's side in Mantel's shell
(web/shim/mantel-shell.js photoSource / listPhotos). Run in node with a recording stand-in for HK Settings' kit
and the few browser objects the page touches (fetch, XMLHttpRequest, localStorage): no DOM, no network, no photo.

* The library: albums with their covers, the space used against the limit and what goes into the backups; an
  Owner's limits and the import from Home Assistant; an Admin gets neither.
* An album: the grid, the preview's address, selecting, deleting and moving many at once (what is sent).
* Uploads: twenty files at once, at most three in flight, each file's state in words; what isn't a photo, or is
  too big, refused before it is sent.
* A screen's Screensaver Options and All Screens' Screensaver: the album pickers and what they save, New Album…
  (named, made and picked) and Add Photos… right there.
* Keep in View's look through the library: Finding Faces with a count while it runs (read again every few seconds,
  and no more once it is done or the page is left), Faces Checked when done, the Setup Check's words with no detector.
* Where it is: a Photos row in Your Files, no row of its own in the sidebar, the old #/mantel/photos forwarded.
* The shell: a screen's album as its source, an album's photos as same-origin addresses under the prefix.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest
from js_modules import copy_shim

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"

PAGE_SCRIPT = r"""
import { readFileSync } from 'node:fs';
globalThis.window = globalThis;
const stored = {};
globalThis.localStorage = { setItem(k, v) { stored[k] = v; } };
globalThis.location = { hash: '#/mantel/files/photos', pathname: '/settings' };
globalThis.document = { addEventListener() {}, querySelector: () => null, cookie: '' };
class El {
  constructor(tag, attrs, kids) {
    this.tag = tag; this.attrs = Object.assign({}, attrs || {}); this.kids = []; this.on = {};
    this.text = this.attrs.text || ''; this.style = {}; this.cls = new Set(String(this.attrs.class || '').split(' ').filter(Boolean));
    this.classList = { add: (...c) => c.forEach((x) => this.cls.add(x)), remove: (...c) => c.forEach((x) => this.cls.delete(x)) };
    for (const k of [].concat(kids || [])) if (k) this.kids.push(k);
  }
  appendChild(k) { this.kids.push(k); k.parent = this; return k; }
  replaceChildren(...k) { this.kids = k.filter(Boolean); for (const x of this.kids) x.parent = this; }
  remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); }
  focus() {} select() {}
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
const sent = [], gets = [];
globalThis.fetch = async (u, init) => {
  const method = (init && init.method) || 'GET', path = String(u);
  if (method === 'GET') gets.push(path);
  if (method !== 'GET') {
    sent.push({ method, path, body: init.body ? JSON.parse(init.body) : null });
    const answer = path.endsWith('/move') ? { ok: true, moved: ['p2'], skipped: [] }
      : path.endsWith('/focus') ? (JSON.parse(init.body).auto
        ? { ok: true, focus: { x: 0.25, y: 0.3, by: 'faces' }, faces: [[0.2, 0.2, 0.1, 0.2, 0.9]] }
        : { ok: true, focus: Object.assign(JSON.parse(init.body), { by: 'hand' }), faces: [[0.2, 0.2, 0.1, 0.2, 0.9]] })
      : path === '/api/photos/albums' ? { ok: true, album: { id: 'c3c3c3c3c3c3c3c3', name: JSON.parse(init.body).name, count: 0 } } : { ok: true };
    return { ok: true, status: 201, json: async () => answer };
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
globalThis.Image = class { };
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
out.ownerLib = groups((await draw(owner, ['mantel', 'files', 'photos'])).c);
const ownerRead = reads['/api/photos'];
reads['/api/photos'] = Object.assign({}, ownerRead, { owner: false });
out.adminLib = groups((await draw(admin, ['mantel', 'files', 'photos'])).c);
reads['/api/photos'] = ownerRead;

// -- an album: grid, select, delete, move
const AID = 'a1a1a1a1a1a1a1a1';
let { c, panel } = await draw(owner, ['mantel', 'files', 'photos', AID]);
out.albumGroups = groups(c);
const tiles = c.all().filter((e) => e.cls.has('mxph'));
out.tiles = tiles.map((t) => [t.attrs['data-id'], t.kids[0].attrs.src]);
c.find((e) => e.attrs['data-fk'] === 'mx:photos-select').click();
c = await redraw(owner, ['mantel', 'files', 'photos', AID]);
for (const t of c.all().filter((e) => e.cls.has('mxph')).slice(0, 2)) t.click();
out.selected = [...m._photos._state.selected];
c = await redraw(owner, ['mantel', 'files', 'photos', AID]);
out.selection = groups(c).find((g) => g.header === 'Selection');
await c.find((e) => e.attrs['data-fk'] === 'mx:photos-move').attrs.onChange('b2b2b2b2b2b2b2b2');
await tick();
for (const t of (await redraw(owner, ['mantel', 'files', 'photos', AID])).all().filter((e) => e.cls.has('mxph')).slice(2, 3)) t.click();
c = await redraw(owner, ['mantel', 'files', 'photos', AID]);
await c.find((e) => e.attrs['data-fk'] === 'mx:photos-delete').click();
await tick(); await tick();
out.sent = sent.splice(0);

// -- twenty uploads at once
({ c } = await draw(owner, ['mantel', 'files', 'photos', AID]));
const input = c.find((e) => e.attrs['data-fk'] === 'mx:photos-files');
const file = (name, size, type) => ({ name, size, type });
input.files = Array.from({ length: 20 }, (_, i) => file('IMG_' + i + '.HEIC', 3 << 20, ''))
  .concat([file('notes.txt', 100, 'text/plain'), file('huge.jpg', 50 << 20, 'image/jpeg')]);
input.on.change();
out.inFlight = xhrs.filter((x) => x.sent && !x.done).length;
out.firstUpload = { url: xhrs[0].url, csrf: 'X-CSRF-Token' in xhrs[0].headers, parts: xhrs[0].fd.parts };
let early = groups(await redraw(owner, ['mantel', 'files', 'photos', AID])).find((g) => (g.header || '').startsWith('Uploading'));
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
out.uploaded = groups(await redraw(owner, ['mantel', 'files', 'photos', AID])).find((g) => g.header === 'Uploaded');
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
out.houseSet = set.slice();
out.adultSaver = groups((await draw(JSON.parse(process.argv[6]), null, 'saver', { screen: 'x', title: 'X' })).c);

// -- New Album… from the pickers: named in the alert, made, picked
const nameIt = async (panel, name) => {
  await tick();
  const dlg = panel.shadowRoot.find((e) => e.cls.has('mxdlg'));
  dlg.find((e) => e.tag === 'input').value = name;
  dlg.find((e) => e.tag === 'button' && e.text === 'Create').on.click();
  for (let i = 0; i < 6; i++) await tick();
};
s = await draw(owner, null, 'saver', { screen: 'dashboard-kitchen', title: 'Kitchen' });
let picker = s.c.find((e) => e.attrs['data-fk'] === 'mx:saver-album');
picker.attrs.onChange('new');
await nameIt(s.panel, 'Garden');
out.saverNew = sent.splice(0);
s = await draw(owner, null, 'house-saver', { photos: '', set: (v) => { set.push(v); return Promise.resolve(); } });
out.houseEmpty = groups(s.c);
set.length = 0;
s.c.find((e) => e.attrs['data-fk'] === 'mx:house-album').attrs.onChange('new');
await nameIt(s.panel, 'Porch');
out.houseNew = { sent: sent.splice(0), set: set.slice() };
// a cancelled name makes nothing
s = await draw(owner, null, 'saver', { screen: 'dashboard-kitchen', title: 'Kitchen' });
s.c.find((e) => e.attrs['data-fk'] === 'mx:saver-album').attrs.onChange('new');
await tick();
s.panel.shadowRoot.find((e) => e.cls.has('mxdlg')).find((e) => e.tag === 'button' && e.text === 'Cancel').on.click();
for (let i = 0; i < 4; i++) await tick();
out.cancelled = sent.splice(0);
// Add Photos… on a screen's picker: the album's own upload, its progress under the picker
s = await draw(owner, null, 'saver', { screen: 'dashboard-kitchen', title: 'Kitchen' });
const before = xhrs.length;
const pin = s.c.find((e) => e.attrs['data-fk'] === 'mx:photos-files');
pin.files = [file('IMG_A.jpg', 1 << 20, 'image/jpeg'), file('IMG_B.jpg', 1 << 20, 'image/jpeg')];
pin.on.change();
out.saverUploads = xhrs.slice(before).map((x) => x.url);
{
  const c2 = new El('page');
  m.host.extend('saver', c2, { screen: 'dashboard-kitchen', title: 'Kitchen' }, s.panel);     // drawn again, uploads kept
  out.saverUploading = groups(c2);
}
for (const x of xhrs.slice(before)) { x.answer(201, { ok: true, photo: {} }); await tick(); }

// -- Keep in View, in the preview: the faces as boxes, a tap sets the point, Automatic puts it back
({ c, panel } = await draw(owner, ['mantel', 'files', 'photos', AID]));
c.all().filter((e) => e.cls.has('mxph'))[0].click();
const viewEl = () => panel.shadowRoot.find((e) => e.cls.has('mxview'));
const kv = {};
kv.button = viewEl().find((e) => e.attrs['data-fk'] === 'mx:view-keep').attrs['aria-label'];
viewEl().find((e) => e.attrs['data-fk'] === 'mx:view-keep').on.click();
const look = () => ({ boxes: viewEl().all().filter((e) => e.cls.has('fbox')).map((e) => [e.style.left, e.style.width]),
                      ring: (viewEl().find((e) => e.cls.has('ring')) || { style: {} }).style.left || null,
                      caption: viewEl().find((e) => e.cls.has('cap')).text,
                      auto: !!viewEl().find((e) => e.attrs['data-fk'] === 'mx:view-keep-auto') });
kv.opened = look();
const pick = viewEl().find((e) => e.attrs['data-fk'] === 'mx:view-keep-pick');
pick.getBoundingClientRect = () => ({ left: 100, top: 50, width: 400, height: 300 });
pick.on.click({ clientX: 200, clientY: 200 });
for (let i = 0; i < 4; i++) await tick();
kv.tapped = look();
viewEl().find((e) => e.attrs['data-fk'] === 'mx:view-keep-auto').on.click();
for (let i = 0; i < 4; i++) await tick();
kv.automatic = look();
viewEl().find((e) => e.attrs['data-fk'] === 'mx:view-keep-pick').on.keydown({ key: 'Enter', preventDefault() {} });
for (let i = 0; i < 4; i++) await tick();
kv.sent = sent.splice(0);
kv.changed = 'mantel-photos-changed' in stored;
viewEl().find((e) => e.attrs['data-fk'] === 'mx:view-keep-done').on.click();
kv.back = !!viewEl().find((e) => e.attrs['data-fk'] === 'mx:view-keep');
// another photo, not looked at yet
viewEl().find((e) => e.cls.has('next')).on.click();
kv.pendingLabel = viewEl().find((e) => e.attrs['data-fk'] === 'mx:view-keep').attrs['aria-label'];
out.keep = kv;

// -- Keep in View's look through the library: the row in each state; read again every few seconds while it looks
const realTimeout = globalThis.setTimeout, faceTimers = [];
globalThis.setTimeout = (f, ms, ...a) => (ms === 4000 ? faceTimers.push(f) : realTimeout(f, ms, ...a));
const facesRow = (c) => {
  const g = c.kids.find((k) => k.attrs.header === 'Keep in View');
  if (!g) return null;
  const r = g.kids[0], part = (pred) => (r.find(pred) || {}).text || null;
  return { label: r.attrs.label || part((x) => x.cls.has('t')), sub: r.attrs.sub || part((x) => x.tag === 'small'),
           value: r.attrs.value !== undefined ? r.attrs.value : part((x) => x.cls.has('val')),
           bar: !!r.find((x) => x.attrs.role === 'progressbar'), fk: r.attrs['data-fk'], footer: g.attrs.footer };
};
const LIB = ['mantel', 'files', 'photos'];
const fz = {};
const facesSay = (o) => Object.assign({ photos: 1200, checked: 340, with_faces: 120, left: 860, started: 5, finished: null }, o);
const withFaces = (o) => { reads['/api/photos'] = Object.assign({}, ownerRead, { faces: facesSay(o) }); };
withFaces({ state: 'running' });
({ c } = await draw(owner, LIB));
fz.running = facesRow(c);
fz.timers = faceTimers.length;
fz.order = groups(c).map((g) => g.header);
reads['/api/photos/faces'] = { ok: true, faces: facesSay({ state: 'running', checked: 600, left: 600 }) };
await faceTimers.shift()(); await tick();
fz.polled = gets.filter((g) => g === '/api/photos/faces').length;
fz.later = facesRow(await redraw(owner, LIB));
reads['/api/photos/faces'] = { ok: true, faces: facesSay({ state: 'done', checked: 1200, with_faces: 410, left: 0, finished: 9 }) };
await faceTimers.shift()(); await tick();
fz.done = facesRow(await redraw(owner, LIB));
fz.timersWhenDone = faceTimers.length;
withFaces({ state: 'waiting' });
({ c } = await draw(owner, LIB));
fz.waiting = facesRow(c);
location.hash = '#/mantel/files/photos/' + AID;              // left for an album: the next read isn't made
const asked = gets.length;
await faceTimers.shift()(); await tick();
fz.askedAfterLeaving = gets.length - asked;
fz.timersAfterLeaving = faceTimers.length;
location.hash = '#/mantel/files/photos';
withFaces({ state: 'unavailable', checked: 0, with_faces: 0, left: 1200 });
fz.unavailable = facesRow((await draw(owner, LIB)).c);
withFaces({ state: 'stopped', checked: 1199, left: 1 });
fz.stopped = facesRow((await draw(owner, LIB)).c);
withFaces({ state: 'done', photos: 0, checked: 0, with_faces: 0, left: 0 });
fz.empty = facesRow((await draw(owner, LIB)).c);
fz.adminDone = (withFaces({ state: 'done', checked: 1200, left: 0 }), facesRow((await draw(admin, LIB)).c));
fz.timersAtEnd = faceTimers.length;
reads['/api/photos'] = ownerRead;
globalThis.setTimeout = realTimeout;
out.faces = fz;

// -- where it is: Your Files' Photos row, the sidebar, the old address, search
reads['/api/user-files'] = { fonts: [], glyphs: { present: false }, usage: 0, quota: 1 << 20 };
out.files = groups((await draw(owner, ['mantel', 'files'])).c);
out.sidebar = m.host.groups().map((g) => g.rows.map((r) => r.route));
out.forward = ['photos', 'mantel/photos', 'mantel/photos/' + AID, 'mantel/files', 'mantel/photosx'].map((p) => m.host.forward(p));
out.search = m.host.search().filter((x) => /photo/i.test(x.label));
m._reset(JSON.parse(process.argv[6]));
out.adultForward = m.host.forward('mantel/photos');
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
    entry = copy_shim(d)
    with entry.open("a", encoding="utf-8") as fh:
        fh.write("\nexport * as _photos from './mantel-photos.mjs';\n")
    (d / "s.mjs").write_text(PAGE_SCRIPT)
    photos = [{"id": p, "album_id": A, "name": f"IMG_{i}.jpg", "width": 4032, "height": 3024, "bytes": 2 << 20,
               "source": "upload", "created": 0, "faces": None, "focus": {"x": None, "y": None, "by": "pending"}}
              for i, p in enumerate(P)]
    photos[0].update(faces=[[0.2, 0.2, 0.1, 0.2, 0.9], [0.6, 0.25, 0.08, 0.15, 0.8]],
                     focus={"x": 0.44, "y": 0.3, "by": "faces"})
    # the Admin's overview: the same library, but not an Owner's
    reads = {"/api/photos": LIBRARY, f"/api/photos/albums/{A}/photos": {"ok": True, "album": {"id": A, "name": "Family"}, "photos": photos}}
    (d / "reads.json").write_text(json.dumps(reads))
    sections = ["me", "connections", "people", "devices", "files", "photos", "roles", "audit"]
    got = subprocess.run(["node", str(d / "s.mjs"), str(entry), str(d / "reads.json"),
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


def test_keep_in_view_says_how_far_the_look_for_faces_has_got_and_reads_again_only_while_it_runs():
    f = run_page()["faces"]
    assert f["running"] == {"label": "Finding Faces", "sub": "120 with faces so far", "value": "340 of 1,200", "bar": True,
                            "fk": "mx:photos-faces", "footer": f["running"]["footer"]}
    assert "runs in the background" in f["running"]["footer"] and "screensavers use what it finds as it goes" in f["running"]["footer"]
    assert f["order"].index("Keep in View") == f["order"].index("Storage") + 1
    assert f["timers"] == 1 and f["polled"] == 1                        # once, however often the page is drawn
    assert f["later"]["value"] == "600 of 1,200"
    assert f["done"]["label"] == "Faces Checked" and f["done"]["value"] == "1,200 photos, 410 with faces"
    assert not f["done"]["bar"] and f["timersWhenDone"] == 0            # done: no more reads
    assert f["waiting"]["label"] == "Finding Faces" and f["waiting"]["sub"] == "Waiting for the import to finish"
    assert f["askedAfterLeaving"] == 0 and f["timersAfterLeaving"] == 0  # the page left: no more reads
    assert f["unavailable"]["footer"] == "Faces aren’t found on this platform; the screens’ own focus is used."
    assert f["unavailable"]["fk"] == "mx:photos-faces"
    assert f["stopped"]["value"] == "1,199 of 1,200" and "next time Mantel starts" in f["stopped"]["footer"]
    assert f["empty"] is None                                           # no photos: nothing to say
    assert f["adminDone"]["label"] == "Faces Checked"                   # an Admin sees it too
    assert f["timersAtEnd"] == 0


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
                                                                      "Beach · 12 photos", "New Album…"]
    assert [r["label"] for r in g["rows"] if r["kind"] != "input"][1:] == ["Add Photos to Family…", "Mantel Photos"]
    assert g["rows"][2]["fk"] == "mx:files/photos"
    assert out["saverSent"] == [{"method": "PUT", "path": "/api/photos/screens/dashboard-kitchen", "body": {"album": A}}]
    house = out["house"][0]["rows"][0]
    assert house["value"] == A and house["options"][0][1] == "The Home Assistant Folder (Above)"
    assert out["houseSet"] == ["media-source://media_source/local/photos"]
    assert out["adultSaver"] == []                                  # no Photos section: nothing drawn


def test_new_album_from_a_screens_picker_makes_it_and_picks_it():
    out = run_page()
    assert out["saverNew"] == [{"method": "POST", "path": "/api/photos/albums", "body": {"name": "Garden"}},
                               {"method": "PUT", "path": "/api/photos/screens/dashboard-kitchen",
                                "body": {"album": "c3c3c3c3c3c3c3c3"}}]
    assert out["cancelled"] == []                                   # a cancelled name makes nothing


def test_new_album_from_all_screens_makes_it_and_sets_every_screens_photos():
    out = run_page()
    house = out["houseEmpty"][0]["rows"]
    assert house[0]["value"] == "" and house[0]["options"][-1] == ["new", "New Album…"]
    assert len(house) == 1                                          # no album picked: nothing to add photos to
    assert out["houseNew"]["sent"] == [{"method": "POST", "path": "/api/photos/albums", "body": {"name": "Porch"}}]
    assert out["houseNew"]["set"] == ["mantel-photos://c3c3c3c3c3c3c3c3"]


def test_add_photos_on_a_screens_picker_uploads_into_its_album_and_shows_progress_there():
    out = run_page()
    assert out["saverUploads"] == [f"/api/photos/albums/{A}/upload"] * 2
    up = next(g for g in out["saverUploading"] if (g["header"] or "").startswith("Uploading"))
    assert [r["label"] for r in up["rows"]] == ["IMG_A.jpg", "IMG_B.jpg"]


def test_photos_is_inside_your_files_and_its_old_address_forwards_there():
    out = run_page()
    ph = by_header(out["files"], "Photos")
    row = ph["rows"][0]
    assert row["label"] == "Photos" and row["fk"] == "mx:files-photos" and row["value"] == "2 albums · 812 photos"
    assert "Screensaver Options" in ph["footer"]
    assert by_header(out["files"], "Font and Glyphs")["rows"][0]["label"] == "SF Pro (woff2)"
    assert not any("mantel/photos" in r for g in out["sidebar"] for r in g)
    assert out["forward"] == ["mantel/files/photos", "mantel/files/photos", f"mantel/files/photos/{A}", None, None]
    assert out["search"] == [{"label": "Photos", "route": "mantel/files/photos", "where": "Mantel → Your Files",
                              "words": "photos albums upload screensaver pictures"}]


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
                                                       { id: 'p2', url: 'https://evil.example/x.jpg' },
                                                       { id: 'p3', title: 'Kept', url: '/api/photos/' + '3'.repeat(32) + '/screen',
                                                         focus: [0.25, 0.4], faces: [[0.1, 0.2, 0.3, 0.3]] },
                                                       { id: 'p4', title: 'Junk', url: '/api/photos/' + '4'.repeat(32) + '/screen',
                                                         focus: [2, 0.4], faces: [[0.1, 0.2, 0.3], 'x', [0.1, 0.1, 0, 0.2]] }] }) };
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
    assert r["list"][0] == {"id": "p1", "title": "One", "url": "/api/photos/" + "1" * 32 + "/screen"}
    assert [p["id"] for p in r["list"]] == ["p1", "p3", "p4"]                                          # never another host
    # Keep in View: a sound focus and faces passed on, unsound ones dropped (the photo itself still shown)
    assert r["list"][1] == {"id": "p3", "title": "Kept", "url": "/api/photos/" + "3" * 32 + "/screen",
                            "focus": [0.25, 0.4], "faces": [[0.1, 0.2, 0.3, 0.3]]}
    assert r["list"][2] == {"id": "p4", "title": "Junk", "url": "/api/photos/" + "4" * 32 + "/screen"}
    assert r["cleared"] is None and r["toldAgain"] == 2
    ing = got["/api/hassio_ingress/Fict1onal"]
    assert ing["after"] == "mantel-photos://a1a1a1a1a1a1a1a1"       # the screen read without the prefix
    assert ing["list"][0]["url"] == "/api/hassio_ingress/Fict1onal/api/photos/" + "1" * 32 + "/screen"
    assert ing["asked"][0] == "/api/hassio_ingress/Fict1onal/api/photos/screens"


def test_keep_in_view_shows_the_faces_and_sets_the_point_by_hand_or_back_to_automatic():
    kv = run_page()["keep"]
    assert kv["button"] == "Keep in View: 2 faces found · kept in view automatically"
    assert kv["opened"] == {"boxes": [["20.00%", "10.00%"], ["60.00%", "8.00%"]], "ring": None,
                            "caption": "2 faces found · kept in view automatically", "auto": False}
    # a tap at (200, 200) on the photo drawn at (100, 50) 400 x 300: a quarter across, half down
    assert kv["tapped"]["caption"] == "Set by hand" and kv["tapped"]["ring"] == "25.00%" and kv["tapped"]["auto"] is True
    assert kv["automatic"]["caption"] == "1 face found · kept in view automatically" and kv["automatic"]["auto"] is False
    pid = f"{1:032x}"
    assert kv["sent"] == [{"method": "PUT", "path": f"/api/photos/{pid}/focus", "body": {"x": 0.25, "y": 0.5}},
                          {"method": "PUT", "path": f"/api/photos/{pid}/focus", "body": {"auto": True}},
                          {"method": "PUT", "path": f"/api/photos/{pid}/focus", "body": {"x": 0.5, "y": 0.5}}]
    assert kv["changed"] is True and kv["back"] is True
    assert kv["pendingLabel"] == "Keep in View: Not checked yet"
