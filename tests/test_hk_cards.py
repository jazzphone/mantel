"""Only the cards a screen uses (Phase 5, 2026-10-29): GET /api/hk-cards names the card files a Mantel page loads at
the start (core) and the ones it loads the first time one of their cards is asked for (lazy, with the elements each
defines: mantel_server/hk_cards.py); web/hk/modules/hk-loader.js's hkNeed imports a lazy file on first use (run in
node, with a stand-in customElements and import())."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from mantel_server import hk_cards

ROOT = Path(__file__).resolve().parents[1]
CARDS = ROOT / "web/hk/cards"


def test_the_list_splits_the_card_files_and_names_each_lazy_files_elements():
    got = hk_cards.card_list(CARDS)
    every = sorted(p.name for p in CARDS.glob("*.js") if p.name != "hk-strategy.js")
    assert sorted(got["core"] + list(got["lazy"])) == every
    # what other code reaches for by name, or makes an element of without waiting for it, is loaded at the start
    for name in ("hk-base.js", "hk-detail.js", "hk-layout.js", "hk-grid-catalog.js", "hk-tile.js", "hk-chip.js",
                 "hk-row.js", "hk-popup.js", "hk-room.js", "hk-control.js", "hk-security.js", "hk-person.js"):
        assert name in got["core"], name
    assert set(got["lazy"]) == hk_cards.LAZY
    assert "hk-energy-day-card" in got["lazy"]["hk-energy.js"]
    assert "hk-detail-weather" in got["lazy"]["hk-weather.js"]          # a sheet's panel: hk-detail.js waits for it
    tags = [t for ts in got["lazy"].values() for t in ts]
    assert len(tags) == len(set(tags)), "no element is defined by two lazy files"


def test_every_card_a_config_can_name_is_found_in_its_file():
    """A `custom:hk-...` type named anywhere in HK's code (the strategy, the catalog, the sheets) that a lazy file
    defines must be listed for that file -- else its card would wait for code nobody loads. Defined in a core
    file or a module is fine (loaded already)."""
    got = hk_cards.card_list(CARDS)
    listed = {t: f for f, ts in got["lazy"].items() for t in ts}
    named = set()
    for p in (ROOT / "web").rglob("*.js"):
        named |= set(re.findall(r"custom:(hk-[a-z0-9-]+)", p.read_text(encoding="utf-8")))
    for name in hk_cards.LAZY:
        text = (CARDS / name).read_text(encoding="utf-8")
        for tag in named:
            if re.search(r"""(customElements\.define|register|wireEditor|variant|def)\(\s*['"]%s['"]""" % re.escape(tag), text):
                assert listed.get(tag) == name, (tag, name)


def test_a_file_the_list_does_not_know_is_loaded_at_the_start(tmp_path):
    (tmp_path / "hk-base.js").write_text("register('hk-x-card', X)")
    (tmp_path / "hk-brand-new.js").write_text("register('hk-new-card', X)")
    (tmp_path / "hk-stat.js").write_text("// a lazy file that defines nothing the list can find")
    (tmp_path / "hk-strategy.js").write_text("")
    got = hk_cards.card_list(tmp_path)
    assert got == {"core": ["hk-base.js", "hk-brand-new.js", "hk-stat.js"], "lazy": {}, "parts": {}}


def test_a_changed_file_is_read_again(tmp_path):
    f = tmp_path / "hk-stat.js"
    f.write_text("register('hk-stat-card', X)")
    assert hk_cards.tags_of(f) == ("hk-stat-card",)
    f.write_text("register('hk-stat-card', X); register('hk-rank-card', Y)")
    assert hk_cards.tags_of(f) == ("hk-rank-card", "hk-stat-card")


def test_the_page_preloads_only_the_core_and_arms_the_loader_with_the_rest():
    early = (ROOT / "web/shim/early-cards.js").read_text()
    assert "for (const c of cards.core || [])" in early
    home = (ROOT / "web/home.js").read_text()
    assert "window.hkNeed.arm(cardList.lazy || {})" in home
    # armed after the loader has run and before any card file
    assert home.index("'modules/hk-loader.js'") < home.index("hkNeed.arm") < home.index("cards.map((c) => imp('/hk/cards/' + c))")
    assert "window.hkNeed.config(first)" in home


HARNESS = r"""
const fs = require('fs'), vm = require('vm');
const imported = [];
let fail = new Set();
const defined = new Map(), waits = new Map();
const customElements = {
  get: (t) => defined.get(t),
  whenDefined(t) { if (defined.has(t)) return Promise.resolve(); if (!waits.has(t)) { let r; const p = new Promise((res) => { r = res; }); waits.set(t, { p, r }); } return waits.get(t).p; },
  define(t, c) { defined.set(t, c); if (waits.has(t)) waits.get(t).r(); },
};
const FILES = { 'hk-energy.js': ['hk-energy-day-card', 'hk-power-flow-card'], 'hk-weather.js': ['hk-detail-weather', 'hk-clock-card'],
                'hk-music.js': ['hk-music-card'], 'hk-intercom.js': ['hk-intercom-card', 'hk-intercom-sheet-card'] };
const handlers = {};
const location = { search: '', hash: '' };
const window = { customElements, location, addEventListener: (n, fn) => { (handlers[n] = handlers[n] || []).push(fn); } };
window.__import = (u) => {
  imported.push(u);
  const name = u.split('/').pop().split('?')[0];
  if (fail.has(name)) { fail.delete(name); return Promise.reject(new Error('offline')); }
  (FILES[name] || []).forEach((t) => customElements.define(t, function () {}));
  if (name === 'hk-intercom.js') window.hkIntercom = {};
  return Promise.resolve({});
};
const src = fs.readFileSync(process.argv[2], 'utf8').replace(/\bimport\(/g, 'window.__import(');
vm.runInNewContext(src, { window, customElements, location, console: { error() {} }, document: {}, Promise, setTimeout });
const N = window.hkNeed, out = {};
const cards = () => imported.filter((u) => u.indexOf('/hk/cards/') === 0);
(async () => {
  out.unarmed = { has: N.has('hk-energy-day-card'), patched: customElements.whenDefined !== Object.getPrototypeOf(customElements).whenDefined && customElements.hasOwnProperty('__x') };
  await N('hk-energy-day-card'); await N.file('hk-energy.js');
  out.unarmedImports = cards().length;
  const before = customElements.whenDefined;
  N.arm(FILES);
  out.patched = customElements.whenDefined !== before;
  out.hasBefore = N.has('custom:hk-energy-day-card');
  // the view host's wait for a card whose code has not come
  await customElements.whenDefined('hk-energy-day-card');
  customElements.whenDefined('hk-power-flow-card');
  out.afterWait = cards();
  out.hasAfter = N.has('hk-energy-day-card');
  // a config: nested cards, a core card (not listed), a card already defined
  await N.config({ cards: [{ type: 'custom:hk-grid-card', cards: [{ type: 'custom:hk-clock-card' }, { type: 'custom:hk-energy-day-card' }] }] });
  out.afterConfig = cards();
  // by name: a lazy file once, a core file never
  await N.file('hk-weather.js'); await N.file('hk-base.js');
  out.afterFile = cards();
  // a failed import is asked for again next time
  fail.add('hk-music.js');
  await N.file('hk-music.js');
  out.failedHas = N.has('hk-music-card');
  await N('hk-music-card');
  out.retried = cards().filter((u) => u.indexOf('hk-music') >= 0).length;
  // `#intercom` on any page: nothing for the Intercom until the address says so, then its file once
  const intercom = () => imported.filter((u) => u.indexOf('hk-intercom.js') >= 0).length;
  out.intercomQuiet = intercom();
  location.hash = '#other';
  (handlers.hashchange || []).forEach((f) => f());
  out.intercomOther = intercom();
  location.hash = '#intercom';
  (handlers.hashchange || []).forEach((f) => f());
  (handlers.popstate || []).forEach((f) => f());
  await N.file('hk-intercom.js');
  out.intercomHash = intercom();
  out.intercomListens = Object.keys(handlers).sort();
  console.log(JSON.stringify(out));
})().catch((e) => { console.error(e); process.exit(1); });
"""


@pytest.fixture(scope="module")
def need(tmp_path_factory):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    d = tmp_path_factory.mktemp("need")
    (d / "harness.cjs").write_text(HARNESS)
    out = subprocess.run(["node", str(d / "harness.cjs"), str(ROOT / "web/hk/modules/hk-loader.js")],
                         capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout.strip().splitlines()[-1])


def test_unarmed_hk_need_only_says_ready(need):
    """HK Frontend: nothing arms it, every card file is a Lovelace resource there."""
    assert need["unarmed"]["has"] is False and need["unarmedImports"] == 0


def test_a_wait_for_a_lazy_card_imports_its_file_once(need):
    assert need["patched"] and need["hasBefore"] is True
    assert need["afterWait"] == ["/hk/cards/hk-energy.js"], "two of its cards waited for: one import"
    assert need["hasAfter"] is False, "defined now"


def test_a_config_asks_for_every_card_it_names_and_a_file_by_name(need):
    assert need["afterConfig"] == ["/hk/cards/hk-energy.js", "/hk/cards/hk-weather.js"]
    assert need["afterFile"] == need["afterConfig"], "loaded already; a core file is never imported here"


def test_a_failed_import_is_tried_again(need):
    assert need["failedHas"] is True and need["retried"] == 2


def test_the_intercoms_address_loads_its_file_on_any_page_and_nothing_else_does(need):
    """`#intercom` (the iOS app's menu sets it on whatever page is open) imports the lazy hk-intercom.js; a page
    that never gets that address, and a page at another hash, never load it."""
    assert need["intercomQuiet"] == 0 and need["intercomOther"] == 0
    assert need["intercomHash"] == 1, "the hash asked for it, once (hashchange and popstate both fired)"
    assert need["intercomListens"] == ["hashchange", "popstate"]


def test_the_parts_of_the_files_loaded_at_the_start_are_named_so_they_download_with_them():
    """Phase 24, B8: a file cut into parts fetches them a round trip after itself; /api/hk-cards names the parts of each
    core shell, and of hk-strategy.js, so web/shim/early-cards.js preloads them with the page."""
    got = hk_cards.card_list(CARDS)
    import web_sources
    for name in ("hk-base.js", "hk-strategy.js"):
        want = [p.relative_to(CARDS.parent).as_posix() for p in web_sources.parts("web/hk/cards/" + name)]
        assert got["parts"][name] == want and want
    assert all(name in got["core"] or name == "hk-strategy.js" for name in got["parts"])
    assert not set(got["parts"]) & set(got["lazy"])
    text = (CARDS.parents[1] / "shim/early-cards.js").read_text()
    assert "cards.parts" in text and "link.href = hkV('/hk/' + rel);" in text
