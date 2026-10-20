"""Mantel Settings → People inside Home Assistant (the App's sidebar page): a link to the household's linking page.

ingress.py people_get lists Home Assistant's users to give each a role or a wall tablet. It was linked only from the
first-Owner page, so an Owner could not find it again; People now offers it whenever the page runs under the App's
Ingress prefix (base.js BASE), and elsewhere keeps the server's link command in its footer.
"""
from __future__ import annotations

import json
import shutil
import subprocess

import pytest

from test_mantel_settings_accounts import DATA, SCRIPT, labels, footers

PREFIX = "/api/hassio_ingress/fictional0token"
HEAD, _, _ = SCRIPT.partition("const out = {};")
TAIL = r"""
const out = {};
const owner = data.me.owner;
const g = await open(owner, ['mantel', 'people']);
out.people = g;
const link = rowsOf(g).find((r) => r.label === 'Link Home Assistant Users…');
if (link) { link.onClick(); }
out.went = assigned;
process.stdout.write(JSON.stringify(out));
"""


def run(tmp_path, ingress):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    from test_mantel_settings import node_modules
    node_modules(tmp_path)
    meta = (f"{{ getAttribute: () => '{PREFIX}' }}" if ingress else "null")
    head = HEAD.replace("globalThis.document = { querySelector: () => null, cookie: '' };",
                        f"globalThis.document = {{ querySelector: (q) => (q.includes('mantel-base') ? {meta} : null), cookie: '', addEventListener() {{}} }};")
    head = head.replace("pathname: '/settings' };", "pathname: '/settings', assign(u) { assigned.push(u); } };\nconst assigned = [];\n"
                        "globalThis.history = { pushState() {}, replaceState() {} };\nglobalThis.open = () => null;")
    head = head.replace("const path = String(u),", f"const path = String(u).replace('{PREFIX}', ''),")
    assert "assigned.push" in head and "mantel-base" in head and PREFIX in head
    (tmp_path / "script.mjs").write_text(head + TAIL)
    (tmp_path / "data.json").write_text(json.dumps(DATA))
    out = subprocess.run(["node", str(tmp_path / "script.mjs"), str(tmp_path / "mantel-settings.mjs"),
                          str(tmp_path / "data.json")], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_inside_home_assistant_people_links_the_household_page(tmp_path):
    got = run(tmp_path, ingress=True)
    assert "Link Home Assistant Users…" in labels(got["people"])
    assert got["went"] == [PREFIX + "/ingress/people"]
    assert "mantel-server link" not in footers(got["people"])


def test_elsewhere_people_keeps_the_link_command(tmp_path):
    got = run(tmp_path, ingress=False)
    assert "Link Home Assistant Users…" not in labels(got["people"])
    assert got["went"] == [] and "mantel-server link" in footers(got["people"])
