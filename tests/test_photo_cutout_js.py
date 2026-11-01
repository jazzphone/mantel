"""Time Behind and Photo Titles on Mantel's side of the page (docs/phase11/HOMEVIEW-LOOK.md, Phase I; decision 14):
Mantel Settings → Your Files → Photos (web/shim/mantel-photos.js) -- the library's Time Behind count, each photo's
Time Behind badge, How Strict (the preset: what it sends) and why the others don't qualify, an album's Only Photos
That Qualify (what it sends), the preview's word on each photo -- and the shell's listPhotos
(web/shim/mantel-shell.js), which hands the screensaver a photo's cut-out under the page's prefix, the album's name
and the year. Run in node with test_mantel_photos_js.py's stand-in kit: no DOM, no network, no photo."""
from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest
from js_modules import copy_shim
from test_mantel_photos_js import LIBRARY, PAGE_SCRIPT, A, P, overview

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")

STEPS = r"""
const out = {};
const LIB = ['mantel', 'files', 'photos'];
const tb = (c) => groups(c).find((g) => g.header === 'Time Behind') || null;
let drawn = await draw(owner, LIB);
out.library = tb(drawn.c);
await drawn.c.find((e) => e.attrs['data-fk'] === 'mx:photos-cutout-preset').attrs.onChange('relaxed');
await tick(); await tick();
out.presetSent = sent.splice(0);
out.changed = 'mantel-photos-changed' in stored;
const ownerRead = reads['/api/photos'];
reads['/api/photos'] = Object.assign({}, ownerRead, { cutouts: { photos: 812, checked: 400, usable: 90, left: 412, state: 'running' } });
out.cutting = tb((await draw(owner, LIB)).c);
reads['/api/photos'] = Object.assign({}, ownerRead, { cutouts: { photos: 812, checked: 0, usable: 0, left: 812, state: 'unavailable' } });
out.unavailable = tb((await draw(owner, LIB)).c);
const AID = 'a1a1a1a1a1a1a1a1';
const unAlbum = groups((await draw(owner, LIB.concat([AID]))).c);
out.albumWhenUnavailable = unAlbum.map((g) => g.header);
reads['/api/photos'] = ownerRead;
drawn = await draw(owner, LIB.concat([AID]));
let c = drawn.c;
out.album = tb(c);
out.badges = c.all().filter((e) => e.cls.has('mxph')).map((t) => [t.attrs['data-id'], t.attrs['aria-label'],
  t.kids.some((k) => k.cls && k.cls.has('mxtb'))]);
const viewEl = () => drawn.panel.shadowRoot.find((e) => e.cls.has('mxview'));
out.view = [];
for (const i of [0, 1, 3]) {
  c.all().filter((e) => e.cls.has('mxph'))[i].click();
  out.view.push((viewEl().find((e) => e.attrs['data-fk'] === 'mx:view-tb') || {}).text || null);
  viewEl().find((e) => e.attrs['data-fk'] === 'mx:view-done').on.click();
}
await c.find((e) => e.attrs['data-fk'] === 'mx:album-depth-only').attrs.onChange(true);
await tick(); await tick();
out.sent = sent.splice(0);
process.stdout.write(JSON.stringify(out));
"""


def run(reads):
    d = Path(tempfile.mkdtemp())
    try:
        entry = copy_shim(d)
        with entry.open("a", encoding="utf-8") as fh:
            fh.write("\nexport * as _photos from './mantel-photos.mjs';\n")
        (d / "s.mjs").write_text(PAGE_SCRIPT.split("const out = {};")[0] + STEPS)
        (d / "reads.json").write_text(json.dumps(reads))
        sections = ["me", "connections", "people", "devices", "files", "photos", "roles", "audit"]
        got = subprocess.run(["node", str(d / "s.mjs"), str(entry), str(d / "reads.json"),
                              json.dumps(overview("owner", sections)), json.dumps(overview("admin", sections)),
                              json.dumps(overview("adult", ["me"]))], capture_output=True, text=True, timeout=60)
        assert got.returncode == 0, got.stderr
        return json.loads(got.stdout)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_photos_says_which_qualify_marks_them_and_an_album_shows_only_them():
    lib = dict(LIBRARY, cutouts={"photos": 812, "checked": 812, "usable": 214, "left": 0, "state": "done",
                                 "preset": "standard", "presets": {"strict": 120, "standard": 214, "relaxed": 390},
                                 "reasons": {"small": 400, "unsure": 190, "large": 8}})
    lib["albums"] = [dict(a, depth_only=False, depth=3) for a in lib["albums"]]
    photos = [{"id": p, "album_id": A, "name": f"IMG_{i}.jpg", "width": 4032, "height": 3024, "bytes": 2 << 20,
               "source": "upload", "created": 0, "faces": [], "focus": {"x": None, "y": None, "by": "none"},
               "cutout": {"ok": i % 2 == 0, "why": None if i % 2 == 0 else "small", "conf": 0.9, "cover": 0.2,
                          "by": "u2netp/3"} if i < 3 else None}
              for i, p in enumerate(P)]
    out = run({"/api/photos": lib, f"/api/photos/albums/{A}/photos": {"ok": True, "album": {"id": A, "name": "Family"}, "photos": photos}})
    assert out["library"]["rows"][0]["label"] == "Photos That Qualify" and out["library"]["rows"][0]["value"] == "214 of 812 photos"
    assert "only those photos qualify" in out["library"]["footer"] and "goes into the backups" in out["library"]["footer"]
    # How Strict: each preset with how many it takes; why the others don't qualify; a change applies at once
    preset = out["library"]["rows"][1]
    assert preset["fk"] == "mx:photos-cutout-preset" and preset["label"] == "How Strict" and preset["value"] == "standard"
    assert preset["options"] == [["strict", "Strict · 120"], ["standard", "Standard · 214"], ["relaxed", "Relaxed · 390"]]
    assert "Those that don’t: 400 subject too small, 8 subject too large, 190 edges unclear." in out["library"]["footer"]
    assert out["presetSent"] == [{"method": "PUT", "path": "/api/photos/cutouts", "body": {"preset": "relaxed"}}]
    assert out["changed"], "the screens read their albums again"
    assert out["cutting"]["rows"][0]["label"] == "Cutting Out" and out["cutting"]["rows"][0]["value"] == "400 of 812"
    assert out["unavailable"]["rows"][0]["value"] == "Not Available Here" and "time in front" in out["unavailable"]["footer"]
    assert "Time Behind" not in out["albumWhenUnavailable"], "nothing to choose without the model"
    # each photo that qualifies wears the badge, and says so to a screen reader
    assert [(b[0], b[2]) for b in out["badges"]] == [(P[0], True), (P[1], False), (P[2], True), (P[3], False)]
    assert out["badges"][0][1].endswith(", Time Behind: qualifies")
    assert out["badges"][1][1].endswith(", Time Behind: subject too small") and "Time Behind" not in out["badges"][3][1]
    assert out["view"] == ["Time Behind: qualifies", "Time Behind: subject too small", "Time Behind: not checked yet"]
    alb = out["album"]
    assert alb["rows"][0]["fk"] == "mx:album-depth-only" and alb["rows"][0]["label"] == "Only Photos That Qualify"
    assert alb["footer"].startswith("2 photos in this album qualify for Time Behind")
    assert "Those that don’t: 1 subject too small." in alb["footer"]
    assert out["sent"] == [{"method": "PUT", "path": f"/api/photos/albums/{A}/options", "body": {"depth_only": True}}]


SHELL = r"""
const fs = require('fs');
globalThis.window = globalThis;
globalThis.CustomEvent = class { constructor(n, i) { this.type = n; this.detail = i && i.detail; } };
globalThis.dispatchEvent = () => true;
globalThis.addEventListener = () => {};
const out = {};
const id = (n) => String(n).repeat(32);
(async () => {
  for (const base of ['', '/api/hassio_ingress/Fict1onal']) {
    delete globalThis.hkShell; delete globalThis.hkMantelShell;
    globalThis.__mantelBase = base;
    globalThis.location = { pathname: base + '/dashboard-kitchen/home' };
    globalThis.fetch = async (u) => ({ ok: true, json: async () => ({ album: { id: 'a1a1a1a1a1a1a1a1', name: 'Lake Weekend' }, photos: [
      { id: id(1), title: 'One', url: '/api/photos/' + id(1) + '/screen', year: 2025,
        depth: { mask: '/api/photos/' + id(1) + '/mask?v=1000', box: [0.3, 0.1, 0.4, 0.2] } },
      { id: id(2), title: 'Two', url: '/api/photos/' + id(2) + '/screen', year: 1800,
        depth: { mask: '/api/photos/' + id(3) + '/mask', box: [0.3, 0.1, 0.4, 0.2] } },
      { id: id(4), title: 'Four', url: '/api/photos/' + id(4) + '/screen',
        depth: { mask: 'https://elsewhere.example/m.png', box: [0.3, 0.1, 0.4, 0.2] } },
      { id: id(5), title: 'Five', url: '/api/photos/' + id(5) + '/screen',
        depth: { mask: '/api/photos/' + id(5) + '/mask' } }] }) });
    eval(fs.readFileSync(process.argv[1] + '/web/client/hk-host-shell.js', 'utf8'));
    eval(fs.readFileSync(process.argv[1] + '/web/shim/mantel-shell.js', 'utf8'));
    out[base || 'root'] = await hkShell.listPhotos('mantel-photos://a1a1a1a1a1a1a1a1');
  }
  process.stdout.write(JSON.stringify(out));
})();
"""


def test_the_shell_hands_the_screensaver_a_cut_out_its_album_and_year():
    got = json.loads(subprocess.run(["node", "-e", SHELL, str(ROOT)], capture_output=True, text=True, check=True,
                                    timeout=30).stdout)
    one, two, four, five = got["root"]
    assert one["depth"] == {"mask": "/api/photos/" + "1" * 32 + "/mask?v=1000"}, "the mask alone: a box from before is not passed on"
    assert one["album"] == "Lake Weekend" and one["year"] == 2025
    assert "depth" not in two, "another photo's mask is never used"
    assert "year" not in two, "a year that can't be is dropped"
    assert "depth" not in four, "never another host's"
    assert five["depth"] == {"mask": "/api/photos/" + "5" * 32 + "/mask"}, "as Mantel sends it now: the mask, no box"
    assert all(p["album"] == "Lake Weekend" for p in got["root"])
    ing = got["/api/hassio_ingress/Fict1onal"][0]
    assert ing["depth"]["mask"] == "/api/hassio_ingress/Fict1onal/api/photos/" + "1" * 32 + "/mask?v=1000"
