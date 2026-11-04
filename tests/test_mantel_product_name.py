"""HK's screens and settings name the product after the host they run in (hkShell.productName, settingsName,
settingsPlace, haPlace, haName, docsUrl: web/client/hk-host-shell.js). In Mantel they say Mantel and Mantel
Settings (HK Settings is folded into Mantel Settings there, its pages under the same names); HK Frontend stays the name of
the integration in Home Assistant, whose own places Mantel's text says are Home Assistant's; the docs
links go to Mantel's own /docs (docs_pages.py). Home Assistant's answers (its text unchanged) are pinned by
the HA build's tests/test_hostshell.js.

Run in node with only the globals the files touch, and a source check that no string of the shared pages
hard-codes either name again outside the few that only Home Assistant shows."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from web_sources import owner

ROOT = Path(__file__).resolve().parents[1]

SCRIPT = r"""
const fs = require('fs');
globalThis.window = globalThis;
globalThis.CustomEvent = class { constructor(n, i) { this.type = n; this.detail = i && i.detail; } };
globalThis.dispatchEvent = () => true;
globalThis.document = { body: {}, getElementById: () => null };
const load = (p) => eval(fs.readFileSync(process.argv[1] + p, 'utf8'));
load('/web/client/hk-host-shell.js');
const none = { product: hkShell.productName(), settings: hkShell.settingsName(), settingsPlace: hkShell.settingsPlace('Features → Live TV'),
               place: hkShell.haPlace('Devices & Services → HK Frontend'),
               name: hkShell.haName('HK Frontend device'), docs: hkShell.docsUrl('Sleep-Screen') };
load('/web/shim/mantel-shell.js');
load('/web/hk/panels/hk-settings-model.js');
const M = hkSettingsModel;
const yaml = (id) => M.YAML_REF.filter((g) => g.items.some((it) => it.id === id))[0];
process.stdout.write(JSON.stringify({
  none,
  mantel: { product: hkShell.productName(), settings: hkShell.settingsName(), settingsPlace: hkShell.settingsPlace('Features → Live TV'),
            place: hkShell.haPlace('Devices & Services → HK Frontend → Add feature'),
            name: hkShell.haName('HK Frontend device'), docs: hkShell.docsUrl('Sleep-Screen'),
            docsAnchor: hkShell.docsUrl('Your-Own-Dashboard', 'live-tv') },
  model: { landscapes: M.BG_SAYS.landscapes, view: M.yamlRefItem('view').sub, actions: yaml('clean_action').footer },
}));
"""


@pytest.fixture(scope="module")
def got():
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    out = subprocess.run(["node", "-e", SCRIPT, str(ROOT)], capture_output=True, text=True, check=True, timeout=30)
    return json.loads(out.stdout)


def test_without_a_host_the_words_are_hk_frontends_own(got):
    assert got["none"] == {"product": "HK Frontend", "settings": "HK Settings", "settingsPlace": "HK Settings → Features → Live TV",
                           "place": "Devices & Services → HK Frontend",
                           "name": "HK Frontend device",
                           "docs": "https://github.com/jazzphone/hk-frontend/wiki/Sleep-Screen"}


def test_mantel_names_itself_and_says_home_assistants_places_are_home_assistants(got):
    m = got["mantel"]
    assert m["product"] == "Mantel"
    assert m["settings"] == "Mantel Settings"
    assert m["settingsPlace"] == "Mantel Settings → Features → Live TV"
    assert m["place"] == "Home Assistant → Devices & Services → HK Frontend → Add feature"
    assert m["name"] == "HK Frontend device in Home Assistant"


def test_mantel_links_its_own_docs_not_hk_frontends_wiki(got):
    assert got["mantel"]["docs"] == "/docs/Sleep-Screen"
    assert got["mantel"]["docsAnchor"] == "/docs/Your-Own-Dashboard#live-tv"


def test_the_settings_words_follow_the_host(got):
    m = got["model"]
    assert "come with Mantel" in m["landscapes"] and "HK Frontend" not in m["landscapes"]
    assert m["view"].startswith("HK Frontend’s grid view in Home Assistant,")
    assert m["actions"] == "Actions of HK Frontend’s in Home Assistant, for your automations and scripts."


# ------------------------------------------------------------------ no second copy of either name
# The shared pages: every string in them that names HK Frontend or HK Settings asks the shell instead. web/shim
# is Mantel's own (Home Assistant's build never ships it), where HK Frontend is the integration in Home
# Assistant by name, so only HK Settings is looked for there.
SHARED = ("web/hk", "web/client", "web/cards")
MANTEL_ONLY = ("web/shim",)
NAMES = re.compile(r"HK (?:Frontend|Settings)")
# a name passed to the shell's own calls for Home Assistant's things and places (haPlace('… → HK Frontend → …'))
THROUGH_SHELL = re.compile(r"ha(?:Name|Place)\(\s*$")
# THE STRINGS ONLY HOME ASSISTANT SHOWS, by file: a piece of each. Mantel never draws a card editor (Home
# Assistant's ha-form) or its card picker (window.customCards), and the panel's branches named here are
# Home Assistant's alone. Plus the shell's own defaults (Home Assistant's words) and lines for the console
# and Home Assistant's log, which no screen shows. A piece that is only a name matches only that string.
HA_ONLY = {
    # the contract's defaults: Home Assistant's answers
    "web/client/hk-host-shell.js": ("HK Frontend", "HK Settings"),
    # the console and Home Assistant's log
    "web/hk/iconset/hk-icons.js": ("Put hk-glyphs.js in your HK Frontend files folder",),
    "web/hk/modules/hk-settings.js": ("HK Frontend: ",),
    # card editors' helpers and labels (ha-form)
    "web/hk/cards/hk-base.js": ("Counts what HK finds for it (HK Settings", "the rooms Clean Areas offers (HK Settings"),
    "web/hk/cards/hk-cameras.js": ("not the screen\\'s camera list in HK Settings", "The channels themselves are added in HK Settings"),
    "web/hk/cards/hk-energy.js": ("Empty: HK Settings → Energy",),
    "web/hk/cards/hk-library.js": ("the ones hidden in HK Settings", "the ones picked in HK Settings"),
    "web/hk/cards/hk-room.js": ("Leave empty to follow HK Settings → Status Rows",),
    # ...and the card picker's descriptions (window.customCards)
    "web/hk/cards/hk-media.js": ("Speakers, presets and playlists are set up in HK Settings",
                                "The speakers, presets and playlists are set up in HK Settings"),
    "web/hk/cards/hk-weather.js": ("Set up under HK Settings", "as on the Weather page (HK Settings",
                                  "the weather service chosen in HK Settings"),
    # the panel: a screen's Remove (a host's screen_remove note comes first: Mantel's), the sidebar switch
    # (not on a host that owns the sidebar: Mantel), Easier still (not on a host with pages of its own)
    "web/hk/panels/hk-settings.js": ("Remove HK Settings…", "HK Settings", "Off: HK Settings leaves the sidebar",
                                     "Easier still: HK Settings → Screens"),
    # Mantel's page says where a change is not taken from: Home Assistant's HK Settings
    "web/shim/settings/connections.js": ("a change made in HK Settings inside Home Assistant",),
}
_WORD_BEFORE_REGEX = re.compile(r"(?:^|[^\w$.])(?:return|typeof|case|in|of|delete|void|throw|new|else|do|yield|await)$")


def js_strings(src: str):
    """Each string literal of a script (quotes, double quotes and template literals, a template whole), with
    the code just before it, skipping comments and regular expressions."""
    out, i, n, last = [], 0, len(src), 0
    prev = ""                                   # the last significant character outside strings and comments
    while i < n:
        c = src[i]
        if c == "/" and src.startswith("//", i):
            i = src.find("\n", i)
            i = n if i < 0 else i
            continue
        if c == "/" and src.startswith("/*", i):
            j = src.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if c == "/" and (prev == "" or prev in "(,=:[!&|?{};+-*%<>~^" or _WORD_BEFORE_REGEX.search(src[last:i].rstrip())):
            j, cls = i + 1, False
            while j < n and src[j] != "\n":
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == "[":
                    cls = True
                elif src[j] == "]":
                    cls = False
                elif src[j] == "/" and not cls:
                    break
                j += 1
            i, prev, last = j + 1, "/", j + 1
            continue
        if c in "'\"`":
            j = i + 1
            while j < n and src[j] != c:
                j += 2 if src[j] == "\\" else 1
            out.append((src[max(0, i - 40):i], src[i + 1:j], src.count("\n", 0, i) + 1))
            i, prev, last = j + 1, c, j + 1
            continue
        if not c.isspace():
            prev = c
            if not (c.isalnum() or c in "_$"):
                last = i + 1
        i += 1
    return out


def _named(tops, names):
    for top in tops:
        for path in sorted((ROOT / top).rglob("*.js")):
            rel = path.relative_to(ROOT).as_posix()
            for before, text, line in js_strings(path.read_text(encoding="utf-8")):
                hit = set(names.findall(text))
                if hit and not ("HK Settings" not in hit and THROUGH_SHELL.search(before)):
                    yield rel, line, text


def _ha_only(rel, piece, text):
    return piece in HA_ONLY.get(owner(rel), ()) and (text == piece if NAMES.fullmatch(piece) else piece in text)


def _hard_coded():
    yield from _named(SHARED, NAMES)
    yield from _named(MANTEL_ONLY, re.compile(r"HK Settings"))


def test_the_scanner_finds_strings_not_comments_or_regular_expressions():
    src = ("var a = 'HK Settings'; // 'HK Frontend' here is a comment\n/* \"HK Frontend\" */ var r = /'/g;\n"
           "var b = x / 2 + `HK ${y} Frontend`; var c = haPlace('HK Frontend → Add feature');")
    got = [(t, ln) for _, t, ln in js_strings(src)]
    assert got == [("HK Settings", 1), ("HK ${y} Frontend", 3), ("HK Frontend → Add feature", 3)]


def test_no_shared_string_writes_hk_frontend_or_hk_settings_itself():
    bad = [f"{rel}:{line}: {text[:120]}" for rel, line, text in _hard_coded()
           if not any(_ha_only(rel, a, text) for a in HA_ONLY.get(owner(rel), ()))]
    assert not bad, ("say the product through hkShell.productName(), the settings through hkShell.settingsName() or "
                     "settingsPlace('Features → …'), and Home Assistant's own through haName/haPlace; a string only "
                     "Home Assistant shows goes in HA_ONLY:\n" + "\n".join(bad))


def test_every_ha_only_string_is_still_there():
    seen = {(owner(rel), a) for rel, _, text in _hard_coded() for a in HA_ONLY.get(owner(rel), ()) if _ha_only(rel, a, text)}
    gone = [f"{rel}: {a}" for rel, pieces in HA_ONLY.items() for a in pieces if (rel, a) not in seen]
    assert not gone, "no longer in the shared pages; take it out of HA_ONLY:\n" + "\n".join(gone)
