"""HK Settings' class looks the same after its methods moved into parts (phase 18, B4; tools/split_js.py "class-method mode").

web/hk/panels/hk-settings.js was one class of 399 members. The shell keeps the constructor, the start and the page's core;
the other 329 methods are written in class expressions in web/hk/settings/ and added to ``HkSettingsPanel.prototype`` by the
shell's ``install`` with Object.defineProperty (not enumerable, writable, configurable: what a class body defines; an accessor
stays an accessor). Anything that iterates the class must see what it saw before, so this loads the file as it was before the
split (the blob the manifest records) and as it is now, each in node with the few globals the module touches, and compares the
prototype: the set of property names, each one's kind and flags, its arity and name, and its source text (indentation aside; and, since a part may be annotated for the type checker, comments
and the parentheses of a JSDoc cast do not count: the code is compared).
The comparison of names, kinds and code is the split's own proof: it is made with the files as the split commit left
them (SPLIT_COMMIT, d12fa1c9), so a later edit to a method -- a new Settings row, a method added -- is an ordinary edit and
doesn't fail it. What must stay true as the file changes is checked on the files as they are now: every property is
defined as a class body defines it, nothing on the prototype is enumerable, and the class is still the class.
The ORDER of the names differs by construction (the parts' methods are added after the shell's): the test says so by
comparing sorted lists, and a for-in over a prototype instance (every method is non-enumerable) lists nothing in both.
"""
from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

import web_sources

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "tools/split_manifests/settings.json"

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")

HARNESS = r"""
const vm = require('vm'), fs = require('fs');
const [, , shellFile, partsJson] = process.argv;
const parts = JSON.parse(partsJson);
const ctx = vm.createContext({ console });
ctx.window = ctx;
vm.runInContext(`
  class HTMLElement {}
  var defined = {};
  var customElements = { get: function (n) { return defined[n]; }, define: function (n, c) { defined[n] = c; } };
  var entered = [];
  window.hkHostClient = { entry: function (C) { entered.push(C); } };
  window.addEventListener = function () {};
  window.setTimeout = function () { return 0; };
  var location = { hash: '' };
  var sessionStorage = { getItem: function () { return null; }, setItem: function () {} };
  var localStorage = sessionStorage;
  var document = { querySelector: function () { return null; }, createElement: function () { return {}; }, head: {} };
`, ctx);
for (const f of parts) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
vm.runInContext(fs.readFileSync(shellFile, 'utf8'), ctx, { filename: shellFile });
const out = vm.runInContext(`(function () {
  var C = defined['hk-settings-panel'];
  if (!C) throw new Error('hk-settings-panel was not defined');
  var P = C.prototype, norm = function (s) { return String(s).split('\\n').map(function (l) { return l.replace(/^\\s+/, ''); }).join('\\n'); };
  var names = Object.getOwnPropertyNames(P), rows = {};
  names.forEach(function (n) {
    var d = Object.getOwnPropertyDescriptor(P, n);
    var fns = d.get || d.set ? [d.get, d.set] : [d.value];
    rows[n] = { kind: d.get || d.set ? 'accessor' : typeof d.value, enumerable: d.enumerable, configurable: d.configurable,
                writable: d.writable, has: [!!d.get, !!d.set],
                fns: fns.map(function (f) { return f ? { length: f.length, name: f.name, text: norm(f) } : null; }) };
  });
  var forin = []; for (var k in Object.create(P)) forin.push(k);
  var own = []; for (var k2 in C) own.push(k2);
  return { count: names.length, names: names.slice().sort(), symbols: Object.getOwnPropertySymbols(P).length, rows: rows,
           forin: forin, staticNames: Object.getOwnPropertyNames(C).sort(), entered: entered.length, enteredIsClass: entered[0] === C,
           extendsElement: Object.getPrototypeOf(P) === HTMLElement.prototype, ctorLength: C.length, own: own };
})()`, ctx);
console.log(JSON.stringify(out));
"""


def _tool():
    spec = importlib.util.spec_from_file_location("split_js", ROOT / "tools/split_js.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["split_js"] = mod
    spec.loader.exec_module(mod)
    return mod


def _load(tmp_path: Path, name: str, shell: Path, parts: list[Path]) -> dict:
    harness = tmp_path / "proto.cjs"
    harness.write_text(HARNESS)
    run = subprocess.run(["node", str(harness), str(shell), json.dumps([str(p) for p in parts])],
                         capture_output=True, text=True, timeout=120)
    assert run.returncode == 0, f"{name}: {run.stderr[-2000:]}"
    return json.loads(run.stdout.strip().splitlines()[-1])


SPLIT_COMMIT = "d12fa1c9"          # Phase 18 B4: the split, before any edit since


def _at(rev: str, path: str, out: Path) -> Path:
    out.write_bytes(subprocess.run(["git", "show", f"{rev}:{path}"], capture_output=True, cwd=ROOT, check=True).stdout)
    return out


@pytest.fixture(scope="module")
def now(tmp_path_factory):
    """The prototype as the files are now (whatever was edited since the split)."""
    tmp_path = tmp_path_factory.mktemp("proto_now")
    man = json.loads(MANIFEST.read_text())
    parts = [ROOT / man["folder"] / (p["name"] + ".js") for p in man["parts"]]
    return _load(tmp_path, "now", ROOT / man["shell"], parts)


@pytest.fixture(scope="module")
def both(tmp_path_factory):
    tmp_path = tmp_path_factory.mktemp("proto")
    man = json.loads(MANIFEST.read_text())
    blob = (man.get("source") or {}).get("blob", "")
    have = subprocess.run(["git", "cat-file", "-t", blob], capture_output=True, text=True, cwd=ROOT).stdout.strip() if blob else ""
    if have != "blob":
        pytest.skip("the file as it was before the split is not in this clone's history")
    if subprocess.run(["git", "cat-file", "-t", SPLIT_COMMIT], capture_output=True, text=True, cwd=ROOT).stdout.strip() != "commit":
        pytest.skip("the split commit is not in this clone's history")
    before = tmp_path / "before.js"
    before.write_bytes(subprocess.run(["git", "cat-file", "blob", blob], capture_output=True, cwd=ROOT).stdout)
    # (the shell and its parts as the split left them)
    shell = _at(SPLIT_COMMIT, man["shell"], tmp_path / "shell.js")
    (tmp_path / "parts").mkdir()
    parts = [_at(SPLIT_COMMIT, f"{man['folder']}/{p['name']}.js", tmp_path / "parts" / (p["name"] + ".js")) for p in man["parts"]]
    return man, _load(tmp_path, "before", before, []), _load(tmp_path, "after", shell, parts)


def test_the_prototype_has_the_same_properties_of_the_same_kinds(both):
    man, before, after = both
    assert before["count"] == after["count"] == 399        # 395 methods, the 3 setters and `constructor`
    assert after["names"] == before["names"], sorted(set(before["names"]) ^ set(after["names"]))
    assert after["symbols"] == before["symbols"] == 0
    kinds = {n: (r["kind"], r["has"]) for n, r in after["rows"].items()}
    assert kinds == {n: (r["kind"], r["has"]) for n, r in before["rows"].items()}
    assert sum(1 for k, _ in kinds.values() if k == "accessor") == 3          # narrow, panel, route: the shell keeps them


def test_every_property_is_defined_as_a_class_body_defines_it(now):
    """As the files are now: a method is writable, configurable and not enumerable (what a class body defines), an
    accessor configurable and not enumerable; a for-in over an instance lists nothing."""
    for n, r in now["rows"].items():
        assert r["enumerable"] is False and r["configurable"] is True, n
        assert r.get("writable") is (True if r["kind"] != "accessor" else None), n
    assert now["forin"] == [] and now["symbols"] == 0


def test_every_method_is_the_same_function(both):
    """Arity, name and source text (indentation aside) of every method, getter and setter."""
    man, before, after = both
    # (`constructor`'s source is the whole class, which is the point of the split; boot() is the one method the manifest's
    # shell_edits change -- it waits for the parts and tells them its modules: compared with those two edits applied)
    def norm(s):
        return "\n".join(line.lstrip() for line in s.split("\n"))
    edits = [(norm(e["find"]), norm(e["replace"])) for e in man["shell_edits"]]
    differ = []
    for n in before["names"]:
        a, b = before["rows"][n]["fns"], after["rows"][n]["fns"]
        if n == "constructor":
            assert [(f["length"], f["name"]) for f in a] == [(f["length"], f["name"]) for f in b]
            continue
        if n == "boot":
            for f in a:
                for find, repl in edits:
                    f["text"] = f["text"].replace(find, repl)
        if a != b:
            differ.append(n)
    # A part may be annotated for the type checker (phase 18, C1): JSDoc comments and `/** @type {T} */ (x)` casts. They are
    # not code: the methods that differ are compared again as tools/split_js.py prints them, with neither.
    texts = [(f or {}).get("text", "") for n in differ for f in before["rows"][n]["fns"] + after["rows"][n]["fns"]]
    plain = dict(zip(texts, _tool().codes(texts))) if texts else {}
    differ = [n for n in differ
              if [None if f is None else {**f, "text": plain[f["text"]]} for f in before["rows"][n]["fns"]]
              != [None if f is None else {**f, "text": plain[f["text"]]} for f in after["rows"][n]["fns"]]]
    assert not differ, differ[:10]


def test_the_class_is_still_the_class(both, now):
    _, before, _ = both
    for key in ("entered", "enteredIsClass", "extendsElement", "ctorLength", "staticNames"):
        assert now[key] == before[key], key
    assert now["entered"] == 1 and now["enteredIsClass"] and now["extendsElement"]
    assert now["own"] == before["own"] == []


def test_a_method_added_twice_is_an_error_not_a_silent_replacement(tmp_path):
    """install() refuses a name the prototype already has (a part and the shell, or two parts, naming one method)."""
    text = web_sources.read("web/hk/panels/hk-settings.js")
    start = text.index("  function install(from) {")
    block = text[start:text.index("  // THE SHELL'S VARIABLES SET ONCE")]
    harness = tmp_path / "twice.cjs"
    harness.write_text("class HkSettingsPanel { boot() {} }\n" + block.replace("function install", "globalThis.install = function install") + """
var A = class { boot() {} get x() { return 1; } };
try { install(A); console.log('no error'); } catch (e) { console.log(/defined twice/.test(e.message) ? 'refused' : e.message); }
var B = class { get y() { return 1; } set y(v) {} z() {} };
install(B);
var d = Object.getOwnPropertyDescriptor(HkSettingsPanel.prototype, 'y');
console.log(typeof d.get, typeof d.set, d.enumerable, d.configurable);
""")
    run = subprocess.run(["node", str(harness)], capture_output=True, text=True, timeout=60)
    assert run.returncode == 0, run.stderr
    assert run.stdout.split("\n")[:2] == ["refused", "function function false true"]
