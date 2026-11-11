"""The Swipe card (2026-11-11, the owner: "a Swipe card ... any card we could swipe between with all its settings available"): what a
layout and the assistant may save -- pages of other cards in the block's size, never a Swipe inside a Swipe -- what a viewer who may
not see a page's accessory is sent, and in node the pages the pager draws, each its own card with its own options, as a block and as
a Show When rule's card (the HomeViews' TV with Now Playing a swipe away)."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from hk_core.settings import home_grid as HG

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node") or "/opt/homebrew/bin/node"
PAGES = [{"card": "tv"}, {"card": "now_playing", "opts": {"background": "card"}}]


def grid(*items):
    return {"v": 1, "cols": 6, "rows": 4, "items": list(items)}


def test_a_swipe_block_and_a_rules_swipe_card_save_with_each_pages_own_options():
    got = HG.check(grid({"id": "s", "card": "swipe", "size": "L", "at": [0, 0], "opts": {"pages": PAGES}}))
    assert got["items"][0]["opts"]["pages"] == PAGES
    rule = {"when": {"all": [{"kind": "tv_on", "entity": "tablet_room"}, {"kind": "timer_running"}]}, "card": "swipe", "opts": {"pages": PAGES}}
    got = HG.check(grid({"id": "b2", "card": "music", "size": "L", "at": [0, 0], "rules": [rule]}))
    assert got["items"][0]["rules"][0]["card"] == "swipe" and got["items"][0]["rules"][0]["opts"]["pages"] == PAGES


@pytest.mark.parametrize("pages,code", [
    ([], "grid_option"),
    ([{"card": "swipe"}], "grid_option"),                                      # never a Swipe inside a Swipe
    ([{"card": "no_such_card"}], "grid_option"),
    ([{"card": "clock", "opts": {"no_such_option": 1}}], "grid_option"),     # a page's options are its card's own
    ([{"card": "clock"}] * 7, "grid_option"),                                # six at most
])
def test_what_a_swipe_block_refuses(pages, code):
    with pytest.raises(HG.GridInvalid) as e:
        HG.check(grid({"id": "s", "card": "swipe", "size": "L", "at": [0, 0], "opts": {"pages": pages}}))
    assert e.value.code == code


def test_each_page_comes_in_the_blocks_size():
    small_only = [k for k, c in HG.CATALOG.items() if "XL" not in c["sizes"] and k != "swipe"][0]
    with pytest.raises(HG.GridInvalid) as e:
        HG.check(grid({"id": "s", "card": "swipe", "size": "XL", "at": [0, 0], "opts": {"pages": [{"card": small_only}]}}))
    assert e.value.code == "grid_size"


def test_a_viewer_who_may_not_see_a_pages_tv_gets_the_page_without_it():
    g = grid({"id": "s", "card": "swipe", "size": "L", "at": [0, 0], "opts": {"pages": [{"card": "tv", "opts": {"tv": "media_player.den_tv"}}, {"card": "clock"}]}})
    assert HG.entity_ids(g) == {"media_player.den_tv"}
    assert HG.only_viewable(g, set())["items"][0]["opts"]["pages"] == [{"card": "tv"}, {"card": "clock"}]
    assert HG.only_viewable(g, {"media_player.den_tv"})["items"][0]["opts"]["pages"][0]["opts"] == {"tv": "media_player.den_tv"}


JS = r"""
globalThis.window = globalThis;
require(process.argv[2]);
const G = window.hkGridCatalog;
const block = { id: 's', card: 'swipe', size: 'L', at: [0, 0], opts: { pages: [{ card: 'tv', opts: { tv: 'media_player.den_tv' } }, { card: 'now_playing', opts: { background: 'card' } }, { card: 'swipe' }] } };
const cfg = G.config(block, {}), pages = G.pages(block, {});
const rule = { id: 'b2', card: 'music', size: 'L', at: [0, 0], rules: [{ when: { all: [{ kind: 'timer_running' }] }, card: 'swipe', opts: { pages: [{ card: 'tv' }, { card: 'now_playing' }] } }] };
const ruleItem = Object.assign({}, rule, { card: 'swipe', opts: rule.rules[0].opts, rules: undefined });
console.log(JSON.stringify({
  type: cfg.type, pages: pages.map((p) => [p.card.type, p.card.tv || null, p.card.background || null]),
  empty: G.config({ id: 'e', card: 'swipe', size: 'L', at: [0, 0] }, {}).panel,
  rule: G.config(rule, {}).type, ruleAsBlock: G.config(ruleItem, {}).type,
  cardsL: G.swipe.cards('L').some((c) => c[0] === 'swipe'), cardsS: G.swipe.cards('S').length > 5,
  names: [G.swipe.cards('L').some((c) => c[0] === 'tv'), G.swipe.cards('L').some((c) => c[0] === 'now_playing')]
}));
"""


@pytest.fixture(scope="module")
def js(tmp_path_factory):
    if not Path(NODE).exists():
        pytest.skip("no node")
    f = tmp_path_factory.mktemp("sw") / "run.cjs"
    f.write_text(JS)
    r = subprocess.run([NODE, str(f), str(ROOT / "web/hk/cards/hk-grid-catalog.js")], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_the_pager_draws_each_page_as_its_own_card(js):
    assert js["type"] == "custom:hk-pager-card"
    # (a Swipe page inside is left out; each page keeps its own options)
    assert js["pages"] == [["custom:hk-grid-tv-card", "media_player.den_tv", None], ["custom:hk-now-playing-card", None, "card"]]
    assert js["empty"] == "note"                                         # (no pages yet: a note to add them)


def test_as_a_rules_card_it_is_the_same_pager(js):
    assert js["rule"] == "custom:hk-grid-conditional-card" and js["ruleAsBlock"] == "custom:hk-pager-card"


def test_the_editor_offers_every_card_in_the_size_but_swipe(js):
    assert js["cardsL"] is False and js["cardsS"] is True and js["names"] == [True, True]


def test_both_catalogs_agree():
    assert HG.CATALOG["swipe"]["opts"] == {"pages": "swipe_pages"} and HG.SWIPE_PAGES_MAX == 6
