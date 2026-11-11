"""Comments and indentation stripped at build time (Phase 5, 2026-10-29): tools/build_static.py runs every .js and
.css file of the image's web app through esbuild's whitespace minifier, and HK Frontend's publish.py does the same
into frontend_min/. Nothing renamed, nothing bundled: every module still parses, keeps its imports, and a plain
script stays plain -- hk_frontend/boot.py joins the core files into one boot file only while they are (is_plain)."""
from __future__ import annotations

import gzip
import importlib.util
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


bs = _load(ROOT / "tools/build_static.py", "mantel_build_static")
boot = _load(ROOT / "hosts/ha/custom_components/hk_frontend/boot.py", "hk_boot")
pytestmark = pytest.mark.skipif(bs.esbuild() is None, reason="esbuild not installed (npm ci --prefix tools)")

SPEC = re.compile(r"""(?:\bfrom|\bimport)\s*\(?\s*(["'])([^"'\n]+)\1""")
STATIC = re.compile(r"""^\s*(?:import\b[^;'"(]*?|export\b[^;'"]*?\bfrom\s*)(["'])([^"'\n]+)\1""", re.M)


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    out = tmp_path_factory.mktemp("min") / "out"
    bs.build(ROOT / "web", out, stamped=False)      # (minified only: the ?v= stamps, tests/test_cache_versions.py)
    return out / "web"


@pytest.fixture(scope="module")
def minified(tmp_path_factory):
    """Minified, not bundled: every file its own text, for the sizes (a bundled shell carries copies of its parts)."""
    out = tmp_path_factory.mktemp("min-only") / "out"
    bs.build(ROOT / "web", out, stamped=False, bundled=False)
    return out / "web"


@pytest.fixture(scope="module")
def ha_frontend(tmp_path_factory):
    """HK Frontend's own files (hosts/ha/frontend), minified as publish.py minifies frontend_min/."""
    d = tmp_path_factory.mktemp("ha")
    rels = []
    for p in sorted((ROOT / "hosts/ha/frontend").glob("*.js")):
        shutil.copyfile(p, d / p.name)
        rels.append(p.name)
    bs.minify(d, rels)
    return d


def _js(base: Path):
    return sorted(p.relative_to(base).as_posix() for p in base.rglob("*.js"))


def test_the_pinned_esbuild_is_the_one_package_json_names():
    pkg = json.loads((ROOT / "tools/package.json").read_text())
    lock = json.loads((ROOT / "tools/package-lock.json").read_text())
    assert pkg["devDependencies"]["esbuild"] == bs.ESBUILD_VERSION
    assert lock["packages"]["node_modules/esbuild"]["version"] == bs.ESBUILD_VERSION


def test_every_file_is_smaller_and_says_no_comment(minified):
    built = minified
    src = ROOT / "web"
    assert _js(built) == _js(src)
    raw = sum((src / r).stat().st_size for r in _js(src))
    small = sum((built / r).stat().st_size for r in _js(built))
    assert small < 0.65 * raw, (raw, small)
    loader = (built / "hk/modules/hk-loader.js").read_text()
    assert "WHY THIS EXISTS" not in loader and "\n  " not in loader
    css = (built / "hk/css/hk-responsive.css").read_text()
    assert "/*" not in css and len(css) < (src / "hk/css/hk-responsive.css").stat().st_size
    # not renamed: the globals and the functions keep their names
    assert "hkNeed.arm" in loader and "function needFile(" in loader


def _parsed(base: Path) -> dict:
    out = subprocess.run(["node", "--experimental-vm-modules", "--no-warnings", str(ROOT / "tests/parse_check.mjs"),
                          str(base)], capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout.strip().splitlines()[-1])


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_every_module_still_parses(built, ha_frontend):
    for base in (built, ha_frontend):
        got = _parsed(base)
        assert got["failed"] == [] and got["checked"] == len(_js(base))
    assert sorted(_parsed(built)["moduleFiles"]) == sorted(_parsed(ROOT / "web")["moduleFiles"])


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_a_plain_script_stays_plain_and_a_module_is_still_seen(built, ha_frontend):
    """boot.is_plain on the minified text: a plain script is still plain (boot.py can join it), and a module --
    `import{a}from"x"` once minified, no longer at a line's start -- is still seen as one. (A source file whose
    only `import(` was in a comment is plain once minified: that is right.)"""
    modules = set(_parsed(built)["moduleFiles"])
    for base, src in ((built, ROOT / "web"), (ha_frontend, ROOT / "hosts/ha/frontend")):
        for rel in _js(base):
            small, source = (base / rel).read_text(), (src / rel).read_text()
            if boot.is_plain(source):
                assert boot.is_plain(small), rel
            if base is built and rel in modules:
                assert not boot.is_plain(small), rel
    assert {"shim/base.js", "home.js", "shim/early-cards.js"} <= modules
    shared = json.loads((ROOT / "web/shared-assets.json").read_text())

    def core(p):
        mine = built / shared.get(p, "hk/" + p)
        return mine.read_text() if mine.is_file() else (ha_frontend / p.split("/")[-1]).read_text()
    for path in boot.CORE:
        assert boot.is_plain(core(path)), path
    assert "imported separately" not in boot.bundle(core)


def test_is_plain_knows_the_minified_forms():
    for text in ('import{a as b}from"./x.js";a()', 'import*as m from"/hk/x.js";', 'import d from"./d.js";',
                 'import"./side.js";var a=1;', 'var a=1;export{a};', 'var a=1;export function f(){}',
                 'export default 1', 'x.then(()=>import("/hk/y.js"))'):
        assert not boot.is_plain(text), text
    for text in ('(function(){"use strict";var importer={};window.hkX={}})();', '// import the module first\nvar a;',
                 'var s="nothing to export, nothing to import";', "var exportName = 'x'; var important = 1;"):
        assert boot.is_plain(text), text


def test_every_import_specifier_comes_out_as_it_went_in(built):
    import sys
    sys.path.insert(0, str(ROOT / "tests"))
    import web_sources
    for rel in _js(built):
        # (a bundled shell carries its parts: their specifiers are the source's too)
        source = web_sources.read("web/" + rel) if (built / rel).read_text().startswith(bs.BUNDLED) else (ROOT / "web" / rel).read_text()
        small = (built / rel).read_text()
        paths = lambda text, rx: {m.group(2) for m in rx.finditer(text) if re.match(r"\.{0,2}/", m.group(2))}  # noqa: E731
        got = paths(small, SPEC)
        # (esbuild prints `import(a ? b : c)` as `a ? import(b) : import(c)`: each specifier is still one the source
        # wrote, as a string)
        assert all(any(q + spec + q in source for q in "'\"`") for spec in got), rel
        assert paths(source, STATIC) <= got, rel


def test_strings_and_template_literals_survive(tmp_path):
    """Whitespace inside a string, a template literal or a regular expression is content, not indentation; comments
    go, legal ones too; names stay; text stays UTF-8."""
    src = (
        "// a comment\n/*! a legal comment */\nconst CSS = `\n  :host { display: block }\n    .a  b {}\n`;\n"
        "export function   paint(  elementName ) {\n  const re = /a  b\\/c/g;   // why\n"
        "  return '  two  spaces  ' + elementName + `${ CSS }  tail` + re.source + '→ Réglages';\n}\n")
    (tmp_path / "a.js").write_text(src)
    bs.minify(tmp_path, ["a.js"])
    out = (tmp_path / "a.js").read_text()
    assert "comment" not in out and "why" not in out
    for kept in ("`\n  :host { display: block }\n    .a  b {}\n`", "/a  b\\/c/g", "'  two  spaces  '", "  tail`",
                 "elementName", "function paint(", "→ Réglages"):
        assert kept in out.replace('"  two  spaces  "', "'  two  spaces  '").replace('"→ Réglages"', "'→ Réglages'"), kept


def test_the_gzipped_build_is_smaller_too(minified):
    built = minified
    src = ROOT / "web"
    gz = lambda base: sum(len(gzip.compress((base / r).read_bytes(), 9)) for r in _js(base))  # noqa: E731
    assert gz(built) < 0.7 * gz(src)


def test_a_waited_for_split_file_ships_with_its_parts_and_the_server_names_none_to_fetch(built):
    """(2026-11-11) tools/build_static.py bundle(): each split shell something waits for has its parts in front of it, in
    its PARTS order, so its loader starts at once (the parts cost the loft tablet's first draw 200-300 ms as separate
    requests); hk-detail.js ("wait": false) is shipped as it was. The server's card list names no part of either."""
    import sys
    sys.path.insert(0, str(ROOT / "hosts/server"))
    from mantel_server import hk_cards
    seen = 0
    for man in sorted((ROOT / "tools/split_manifests").glob("*.json")):
        m = json.loads(man.read_text())
        shell = built / m["shell"].removeprefix("web/")
        text = shell.read_text()
        if m.get("wait", True) is False:
            assert not text.startswith(bs.BUNDLED), m["shell"]
        else:
            assert text.startswith(bs.BUNDLED), m["shell"]
            at = [text.index(f"['{p['name']}']") if f"['{p['name']}']" in text else text.index(f'["{p["name"]}"]') for p in m["parts"]]
            assert at == sorted(at) and at[-1] < text.index("function loadParts("), m["shell"]
            seen += 1
        assert hk_cards.parts_of(shell) == [], m["shell"]
    assert seen >= 20


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_a_bundled_shell_runs_its_parts_at_once_and_imports_nothing(tmp_path):
    sys_path = str(ROOT / "tools")
    import sys
    sys.path.insert(0, sys_path)
    import split_js
    man = {"shell": "x.js", "folder": "web/hk/xparts", "global": "hkXParts", "label": "hk-x", "what": "X", "name": "x",
           "parts": [{"name": "hk-x-a"}]}
    loader = split_js.loader_block(man, "  ")
    (tmp_path / "hk/cards").mkdir(parents=True)
    (tmp_path / "hk/xparts").mkdir(parents=True)
    (tmp_path / "hk/xparts/hk-x-a.js").write_text("(function(){(window.hkXParts=window.hkXParts||{})['hk-x-a']=function(K){K.ran=1;};})();\n")
    (tmp_path / "hk/cards/x.js").write_text("(function () {\n" + loader + "  loadParts(function () { window.done = 1; });\n})();\n")
    rels = ["hk/cards/x.js", "hk/xparts/hk-x-a.js"]
    assert bs.bundle(tmp_path, rels) == ["hk/cards/x.js"]
    run = subprocess.run(["node", "-e", "global.window=global; var asked=0; global.__imp=function(){asked++;return Promise.resolve({});};"
                          "eval(require('fs').readFileSync(process.argv[1],'utf8').replace(/\\bimport\\(/g,'__imp('));"
                          "console.log(JSON.stringify({done: window.done, asked: asked, ready: typeof window.__hkSplitReady['hk-x']}))",
                          str(tmp_path / "hk/cards/x.js")], capture_output=True, text=True)
    assert json.loads(run.stdout.strip()) == {"done": 1, "asked": 0, "ready": "object"}, run.stderr
