"""(Kept for the record: it ran once, on 016198eb, and its proof passed. Run it on a checkout of that commit to see it again.)

Rejoin hk-saver.js with its phase 18 parts (web/hk/saver/*.js) as ONE file, so the split tool can cut it afresh, and
prove the rejoin (phase 24, the held files, 2026-11-11).

    rejoin_saver.py ROOT [--write]

The split shell runs its parts at the start of the function it hands loadParts: runParts() builds the kit K (kit()),
runs each part with it, takes back what the shell uses (`x = K.x`), then does a few things by hand that later sessions
added. The one file this writes is the shell without its loader, its take-back `var`, kit() and runParts(), with the
loadParts function's statements back in the IIFE (indent 4 -> 2) and, where runParts() was called, every part's
statements in PARTS order (their takes and hand-backs dropped).

WHAT IS NOT A MOVE (each listed here, each checked by the proof by its exact text):
  * kit()'s two code entries become shell functions: panelDone(v) and clock24();
  * helpers' `K.inPane = function (e, pane, up)` is `var inPaneAt = function (e, pane, up)`, and the shell's
    `var inPane;` (set in runParts to `function (e) { return K.inPane(e, paneEl, paneUp); }`) is
    `function inPane(e) { return inPaneAt(e, paneEl, paneUp); }`;
  * the shell's `var Deck, designController;` loses Deck (helpers declares `function Deck`);
  * runParts' hand-written statements (the design controller; the Now Playing page's registration) come after the
    parts' statements, with `K.x` as `x`;
  * inside the parts' code, a live `K.x` is `x` (the Now Playing page card, music's layoutMusic call), and the page card's
    `var r = this._root, CSS = K.CSS;` is `var r = this._root;` (CSS the outer one, as K.CSS was);
  * pageCard() set `K.PageCard = Page` for runParts to register: `var PageCard = null;` before it, and `PageCard = Page`.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve()
WRITE = "--write" in sys.argv
sys.path.insert(0, str(ROOT / "tools"))
import split_js as S  # noqa: E402

MAN = json.loads((ROOT / "tools/split_manifests/saver.json").read_text())
SHELL = ROOT / MAN["shell"]
FOLDER = ROOT / MAN["folder"]
PARTS = [p["name"] for p in MAN["parts"]]
LOADER_NAMES = {"PARTS", "PARTS_TRIES", "partKey", "partsSettle", "loadParts"}

text = SHELL.read_text()
L = text.split("\n")
an = S.analyze(SHELL, "shell", None, cont=True, man=MAN)
iife, cont = an["scopes"][0]["stmts"], an["scopes"][1]["stmts"]
by_name = {n: st for st in iife for n in st["names"]}

rp = by_name["runParts"]
rp_text = "\n".join(L[rp["first"] - 1:rp["last"]])
taken_back = set(re.findall(r"([\w$]+) = K\.\1;", rp_text))
take_var = [st for st in iife if st["kind"] == "var" and st["names"] and set(st["names"]) <= taken_back]
assert len(take_var) == 1, take_var
drop = {id(st) for st in iife if set(st["names"]) & LOADER_NAMES} | {id(take_var[0]), id(by_name["kit"]), id(rp)}
call = [st for st in iife if st["head"].startswith("loadParts(function")]
assert len(call) == 1
drop.add(id(call[0]))

# runParts' own statements, by hand, after the parts (K.x -> x)
hand = []
dc = re.search(r"\n    (designController = K\.createDesignController\(.*\);)\n", rp_text)
pc = re.search(r" (if \(K\.PageCard && window\.hkHostClient.*?\})   // \(the Now Playing page, hk-saver-pane\.js\)", rp_text)
assert dc and pc
hand.append("  " + re.sub(r"\bK\.([\w$]+)", r"\1", dc.group(1)))
hand.append("  " + re.sub(r"\bK\.([\w$]+)", r"\1", pc.group(1)) + "   // (the Now Playing page)")
kit_text = "\n".join(L[by_name["kit"]["first"] - 1:by_name["kit"]["last"]])
assert "panelDone: function (v) { if (pnl && pnl.view === v) closePanel(false); }" in kit_text
assert "clock24: function () { return !!(cfg && cfg.clock_24); }" in kit_text
KIT_FUNCS = ["  // (the Now Playing page's, hk-saver-pane.js: once the kit's own entries)",
             "  function panelDone(v) { if (pnl && pnl.view === v) closePanel(false); }",
             "  function clock24() { return !!(cfg && cfg.clock_24); }"]

EDITS = {  # shell statements changed in place: old text -> new text
    "  var Deck, designController;": "  var designController;",
    "  var inPane;": "  function inPane(e) { return inPaneAt(e, paneEl, paneUp); }",
}
PART_EDITS = [  # (part, old, new) exact substrings
    ("hk-saver-helpers", "    K.inPane = function (e, pane, up) {", "    var inPaneAt = function (e, pane, up) {"),
    ("hk-saver-pane", "var r = this._root, CSS = K.CSS;", "var r = this._root;"),
    # (pageCard() put its class on the kit, `K.PageCard = Page`, for runParts to register: one file, a variable of its own)
    ("hk-saver-pane", "    function pageCard() {", "    var PageCard = null;\n    function pageCard() {"),
]

# the parts' statements, takes and hand-backs dropped
part_blocks, part_stmts = [], []
for name in PARTS:
    f = FOLDER / f"{name}.js"
    ft = f.read_text()
    for part, old, new in PART_EDITS:
        if part == name:
            assert ft.count(old) == 1, (name, old)
            ft = ft.replace(old, new)
    tmp = ROOT / f".rejoin-{name}.js"
    tmp.write_text(ft)
    try:
        pan = S.analyze(tmp, "part", None, man={})
    finally:
        tmp.unlink()
    lines = ft.split("\n")
    block = []
    for st in pan["scopes"][0]["stmts"]:
        if st.get("takes"):
            continue
        if re.fullmatch(r"(?:K\.([\w$]+) = \1;\s*)+", st["code"].strip()) or re.fullmatch(r"(?:K\.([\w$]+) = \1;\s*)+", "\n".join(
                ln for ln in lines[st["first"] - 1:st["last"]] if not ln.strip().startswith("//")).strip()):
            continue
        body = S.reindent(lines[st["first"] - 1:st["last"]], set(st["protected"]), st["first"], st["indent"], 2)
        body = [re.sub(r"\bK\.([\w$]+)", r"\1", ln) if "K." in ln and not ln.lstrip().startswith("//") else ln for ln in body]
        if block:
            block.append("")
        block += body
        part_stmts.append((name, st))
    part_blocks.append((name, block))

out, skip_to = [], 0
gone_lines = set()
for st in iife:
    if id(st) in drop and st is not call[0]:
        gone_lines.update(range(st["first"], st["last"] + 1))
# the loader's comment lines go with it
b0 = next(i for i, ln in enumerate(L, 1) if S.LOADER_BEGIN in ln)
b1 = next(i for i, ln in enumerate(L, 1) if S.LOADER_END in ln)
gone_lines.update(range(b0, b1 + 1))
cst = call[0]
for no, line in enumerate(L, 1):
    if no in gone_lines:
        continue
    if cst["first"] <= no <= cst["last"]:
        if no != cst["first"]:
            continue
        # the function loadParts was handed, its statements back in the IIFE
        for st in cont:
            body = S.reindent(L[st["first"] - 1:st["last"]], set(st["protected"]), st["first"], st["indent"], 2)
            if st["code"].strip() == "runParts();":
                for name, block in part_blocks:
                    out += ["", f"  // ------------------------------------------------------------ {name} (was web/hk/saver/{name}.js)"] + block
                out += [""] + hand + [""]
                continue
            out += body
        continue
    if line in EDITS:
        out.append(EDITS[line])
        continue
    out.append(line)
    if no == by_name["hookClient"]["last"]:
        out += [""] + KIT_FUNCS
new = re.sub(r"\n{3,}", "\n\n", "\n".join(out))

# THE PROOF
dst = ROOT / ".rejoin-out.js"
dst.write_text(new)
try:
    one = S.analyze(dst, "shell", None, man={})
    diag = S.diagnostics([dst])[str(dst.resolve())]
finally:
    dst.unlink()
ones = one["scopes"][0]["stmts"]
# NOTHING CAPTURED: every reference in the one file resolves where it did. A part's statement may use a declaration of
# its own part, a name it took from K, or (a name it didn't take) nothing of the file's: it was a global. A shell
# statement may use the shell's, or a part's that it took back.
origin = {}
code_of = {}
for name, st in part_stmts:
    code_of.setdefault(re.sub(r"\bK\.([\w$]+)", r"\1", st["code"]), name)
took = {}
for name in PARTS:
    ft = (FOLDER / f"{name}.js").read_text()
    took[name] = set(re.findall(r"([\w$]+) = K\.\1\b", "".join(re.findall(r"^    var [^;]*;", ft, re.M))))
    took[name] |= set(re.findall(r"\bK\.([\w$]+)", ft))           # (a live K.x too)
for st in ones:
    origin[st["index"]] = code_of.get(st["code"], "shell")
capture = []
for st in ones:
    o = origin[st["index"]]
    for r in st["refs"]:
        if r["scope"] != 0:
            continue
        d = origin.get(r["index"], "shell")
        if o == "shell" and d != "shell" and r["name"] not in taken_back | {"PageCard", "inPaneAt", "createDesignController",
                                                                            "clientNow"}:
            capture.append(f"shell -> {d}: {r['name']}")
        if o != "shell" and d != o and r["name"] not in took[o] and not (d == "shell" and r["name"] in {"panelDone", "clock24"}):
            capture.append(f"{o} -> {d}: {r['name']}")
codes = [st["code"] for st in ones]
bad = []
pos = 0
want_shell = [st for st in iife if id(st) not in drop]
for st in want_shell:
    t = st["code"]
    for old, newt in EDITS.items():
        if st["code"] == old.strip():
            t = newt.strip()
    try:
        pos = codes.index(t, pos) + 1
    except ValueError:
        bad.append("shell statement not in order: " + st["head"][:100])
cont_codes = [st["code"] for st in cont if st["code"].strip() != "runParts();"]
pos2 = 0
for t in cont_codes:
    try:
        pos2 = codes.index(t, pos2) + 1
    except ValueError:
        bad.append("a statement that waited for the parts, not in order: " + t[:100])
pos3 = 0
for name, st in part_stmts:
    t = re.sub(r"\bK\.([\w$]+)", r"\1", st["code"])
    try:
        pos3 = codes.index(t, pos3) + 1
    except ValueError:
        bad.append(f"{name}: statement not in order: " + st["head"][:100])
added = {c for c in codes} - {st["code"] for st in want_shell} - set(cont_codes) - {re.sub(r"\bK\.([\w$]+)", r"\1", st["code"]) for _, st in part_stmts}
added -= {v.strip() for v in EDITS.values()}
expected = {"function panelDone(v) {\n    if (pnl && pnl.view === v)\n        closePanel(false);\n}", "function clock24() {\n    return !!(cfg && cfg.clock_24);\n}"}
print(json.dumps({"parts": PARTS, "part_statements": len(part_stmts), "shell_statements_kept": len(want_shell),
                  "waited_statements": len(cont_codes), "problems": bad[:20], "added": sorted(a[:90] for a in added),
                  "duplicates": one.get("duplicates"), "tsc_unresolved": sorted({u["name"] for u in diag["unresolved"]}),
                  "syntax": diag["syntax"][:3], "captured": sorted(set(capture))[:30],
                      "cross_refs": sum(1 for st in ones for r in st["refs"] if r["scope"] == 0 and origin.get(r["index"], "shell") != origin[st["index"]]), "lines": new.count("\n") + 1}, indent=1))
ok = not bad and not one.get("duplicates") and not diag["unresolved"] and not diag["syntax"] and len(added) == 4 and not capture
if WRITE and ok:
    SHELL.write_text(new)
    for name in PARTS:
        (FOLDER / f"{name}.js").unlink()
    print("written:", SHELL.relative_to(ROOT))
sys.exit(0 if ok else 1)
