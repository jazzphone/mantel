"""HK's screens and settings name the product after the host they run in (hkShell.productName, haPlace,
haName, docsUrl: web/client/hk-host-shell.js). In Mantel they say Mantel; HK Frontend stays the name of
the integration in Home Assistant, whose own places Mantel's text says are Home Assistant's; the docs
links go to Mantel's own /docs (docs_pages.py). Home Assistant's answers (its text unchanged) are pinned by
the HA build's tests/test_hostshell.js.

Run in node with only the globals the files touch, and a source check that no shared label hard-codes the
name again."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]

SCRIPT = r"""
const fs = require('fs');
globalThis.window = globalThis;
globalThis.CustomEvent = class { constructor(n, i) { this.type = n; this.detail = i && i.detail; } };
globalThis.dispatchEvent = () => true;
globalThis.document = { body: {}, getElementById: () => null };
const load = (p) => eval(fs.readFileSync(process.argv[1] + p, 'utf8'));
load('/web/client/hk-host-shell.js');
const none = { product: hkShell.productName(), place: hkShell.haPlace('Devices & Services → HK Frontend'),
               name: hkShell.haName('HK Frontend device'), docs: hkShell.docsUrl('Sleep-Screen') };
load('/web/shim/mantel-shell.js');
load('/web/hk/panels/hk-settings-model.js');
const M = hkSettingsModel;
const yaml = (id) => M.YAML_REF.filter((g) => g.items.some((it) => it.id === id))[0];
process.stdout.write(JSON.stringify({
  none,
  mantel: { product: hkShell.productName(), place: hkShell.haPlace('Devices & Services → HK Frontend → Add feature'),
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
    assert got["none"] == {"product": "HK Frontend", "place": "Devices & Services → HK Frontend",
                           "name": "HK Frontend device",
                           "docs": "https://github.com/jazzphone/hk-frontend/wiki/Sleep-Screen"}


def test_mantel_names_itself_and_says_home_assistants_places_are_home_assistants(got):
    m = got["mantel"]
    assert m["product"] == "Mantel"
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


# ------------------------------------------------------------------ no second copy of the name
SHARED = ("web/hk", "web/client", "web/cards")
# HK Frontend's name as a host's answer, through the shell's own calls
THROUGH_SHELL = re.compile(r"ha(?:Name|Place)\('[^']*'\)")
# where the name stays written out: the contract's defaults, and messages for HA's log and the console
# (not labels a person reads on a screen)
ALLOWED = {
    "web/client/hk-host-shell.js": ("return 'HK Frontend'",),
    "web/hk/iconset/hk-icons.js": ("Put hk-glyphs.js in your HK Frontend files folder",),
    "web/hk/modules/hk-settings.js": ("var msg = 'HK Frontend: '",),
}


def _code_lines(path: Path):
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        s = line.strip()
        if s.startswith("//") or s.startswith("*") or s.startswith("/*"):
            continue
        yield n, line


def test_no_shared_label_writes_the_product_name_itself():
    bad = []
    for top in SHARED:
        for path in sorted((ROOT / top).rglob("*.js")):
            rel = path.relative_to(ROOT).as_posix()
            for n, line in _code_lines(path):
                rest = THROUGH_SHELL.sub("", line)
                if "HK Frontend" not in rest:
                    continue
                if any(a in line for a in ALLOWED.get(rel, ())):
                    continue
                bad.append(f"{rel}:{n}: {line.strip()[:120]}")
    assert not bad, "say the product through hkShell.productName() (or haName/haPlace for HA's own):\n" + "\n".join(bad)
