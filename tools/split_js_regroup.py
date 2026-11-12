"""split_js.py's regroup (phase 25, Part E): a class-method part cut into more parts, as its manifest now lists them.

A split class-mode shell (the settings panel: tools/split_manifests/settings.json, `"class"`) adds each part's methods to the
class's prototype (KIT.install). When one part grows near the size limit, its manifest entry is cut in the manifest (new
parts, each with `"methods": [...]`, placed after it) and `split_js.py <name> --regroup` moves those methods' text, each
whole with its leading comment, out of the file that has them and into the new part's file (made from the part template,
taking from the kit what its methods name of what the old file took, and binding the late names they use). Nothing else
moves. The proof, before anything is written: every method of the folder is there exactly once after, its text the same
character for character. With --write the files are written, the loader's PARTS made again from the manifest, and the whole
structural --check of the split run on the result; if it fails, every file is put back as it was. New parts that take contiguous runs
of a part's methods, in order, right after it, keep the prototype's order of names too (tests/test_settings_prototype.py).
"""
from __future__ import annotations

import re
from pathlib import Path

from split_js_analysis import analyze, by_name, commas, kit_of, pack
from split_js_names import PART_HEADER, ROOT
from split_js_writers import take_lines


def _methods(f: Path, man: dict) -> tuple[list[str], list[dict]]:
    """The file's lines and its class expression's methods (each with first/last line, 1-based, comments included)."""
    a = analyze(f, "part", None, man=man)
    cls = [s for s in a["scopes"] if s["name"] == "class"]
    return f.read_text().split("\n"), (cls[0]["stmts"] if cls else [])


def _takes(lines: list[str], kit: str) -> list[str]:
    """The names a part takes from the kit at its top (`var a = KIT.a, ...;`)."""
    text = "\n".join(lines)
    m = re.search(r"= function \(" + re.escape(kit) + r"\) \{\n(    var [^;]*;)\n", text)
    return re.findall(r"([\w$]+) = " + re.escape(kit) + r"\.\1\b", m.group(1)) if m else []


def _late(lines: list[str], kit: str) -> list[str]:
    text = "\n".join(lines)
    m = re.search(re.escape(kit) + r"\.late\.push\(function \(s\) \{\n(.*?)\n    \}\);", text, re.S)
    return re.findall(r"([\w$]+) = s\.\1;", m.group(1)) if m else []


def _uses(text: str, name: str) -> bool:
    code = re.sub(r"//[^\n]*|/\*.*?\*/", "", text, flags=re.S)
    return re.search(r"(?<![\w$.])" + re.escape(name) + r"(?![\w$])", code) is not None


def regroup(man: dict, write: bool) -> list[str]:
    """Move each method to the part the manifest names for it; returns what refuses (empty: done, or the plan when not
    writing)."""
    kit = kit_of(man)
    if not man.get("class"):
        return ["--regroup is for a class-method split (the manifest names a class)"]
    folder = ROOT / man["folder"]
    want: dict[str, str] = {}
    for part in man["parts"]:
        for m in part.get("methods", []):
            if m in want:
                return [f"method `{m}` is listed in two parts ({want[m]}, {part['name']})"]
            want[m] = part["name"]
    files = {part["name"]: folder / f"{part['name']}.js" for part in man["parts"]}
    have: dict[str, tuple[str, list[dict]]] = {}      # method name -> (part it is in now, its statements: a get/set pair is two)
    texts: dict[str, list[str]] = {}
    before: dict[str, list[str]] = {}
    for part in man["parts"]:
        f = files[part["name"]]
        if not f.is_file():
            continue
        lines, stmts = _methods(f, man)
        texts[part["name"]] = lines
        for d in stmts:
            if d["kind"] != "method":
                continue
            name = d["method"]
            if name in have and have[name][0] != part["name"]:
                return [f"method `{name}` is in two files ({have[name][0]}, {part['name']})"]
            have.setdefault(name, (part["name"], []))[1].append(d)
            before.setdefault(name, []).append("\n".join(lines[d["first"] - 1:d["last"]]))
    missing = sorted(set(want) - set(have))
    if missing:
        return [f"the manifest lists methods no part has: {missing[:8]}"]
    moves = {n: (have[n][0], want[n]) for n in have if n in want and have[n][0] != want[n]}
    if not moves:
        return []
    out = {n: list(lines) for n, lines in texts.items()}
    added: dict[str, list[tuple[int, str]]] = {}      # target part -> [(original order key, text)]
    order = {n: i for i, n in enumerate(have)}
    # 1. out of their files (from the bottom up, so earlier lines keep their numbers)
    cut: dict[str, list[tuple[int, int]]] = {}
    for n, (src, dst) in moves.items():
        for d in have[n][1]:
            cut.setdefault(src, []).append((d["first"], d["last"]))
            added.setdefault(dst, []).append((d["first"] + 100000 * order[n], "\n".join(texts[src][d["first"] - 1:d["last"]])))
    for src, spans in cut.items():
        lines = out[src]
        for first, last in sorted(spans, reverse=True):
            # with the blank line before it, when it has one and so does what follows the cut
            lo = first - 1
            if lo > 0 and lines[lo - 1].strip() == "" and (last >= len(lines) or lines[last].strip() in ("", "};")):
                lo -= 1
            del lines[lo:last]
        out[src] = lines
    # 2. into theirs: a new part from the template; an existing one, at the end of its class
    for dst, pieces in added.items():
        pieces.sort()
        body = "\n\n".join(t for _k, t in pieces).split("\n")
        part = next(p for p in man["parts"] if p["name"] == dst)
        if dst in out:
            lines = out[dst]
            end = max(i for i, ln in enumerate(lines) if ln == "    };")
            out[dst] = lines[:end] + [""] + body + lines[end:]
            continue
        srcs = {moves[n][0] for n in moves if moves[n][1] == dst}
        takes = sorted({t for s in srcs for t in _takes(texts[s], kit) if _uses("\n".join(body), t)}, key=str.lower)
        late = by_name([n for s in srcs for n in _late(texts[s], kit) if _uses("\n".join(body), n)])
        head = PART_HEADER.format(file=dst + ".js", title=part["title"], what=man["what"], shell=Path(man["shell"]).name,
                                  kit=kit, check="// @ts-check\n").rstrip("\n").split("\n")
        new = head + ["(function () {", "  'use strict';",
                      f"  (window.{man['global']} = window.{man['global']} || {{}})['{dst}'] = function ({kit}) {{"]
        if takes:
            new += take_lines(by_name(takes), kit) + [""]
        if late:
            new += pack(commas(sorted(set(late), key=str.lower)), "    var ", "        ")
            new += ["    // (set when the page starts, not now: the shell calls bindLate() once it has assigned them)",
                    f"    {kit}.late.push(function (s) {{"] + pack([f"{n} = s.{n};" for n in sorted(set(late), key=str.lower)],
                                                                    "      ", "      ") + ["    });", ""]
        new += [f"    // THE METHODS this part adds to {man['class']}.prototype ({kit}.install: not enumerable, as a class body",
                "    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type",
                "    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)",
                "    var Methods = class extends /** @type {any} */ (Object) {"] + body + ["    };", f"    {kit}.install(Methods);",
                                                                                         "  };", "})();", ""]
        out[dst] = new
    # 3. the proof: every method once, its text the same
    after: dict[str, list[str]] = {}
    for name, lines in out.items():
        t = "\n".join(lines)
        files[name].parent.mkdir(parents=True, exist_ok=True)
        tmp = files[name].with_suffix(".regroup.js")
        tmp.write_text(t)
        try:
            ls, stmts = _methods(tmp, man)
        finally:
            tmp.unlink()
        for d in stmts:
            if d["kind"] == "method":
                after.setdefault(d["method"], []).append("\n".join(ls[d["first"] - 1:d["last"]]))
    bad = []
    for n in sorted(set(before) | set(after)):
        if sorted(before.get(n, [])) != sorted(after.get(n, [])):
            bad.append(f"method `{n}`: its text is not the same after the move")
    if bad:
        return bad
    if write:
        for name, lines in out.items():
            files[name].write_text("\n".join(lines))
    print(f"{man['name']}: {len(moves)} methods moved into {len(added)} parts "
          f"({', '.join(f'{d} {sum(1 for n in moves if moves[n][1] == d)}' for d in added)}); proven (each method once, "
          f"its text the same){'' if write else ' -- nothing written (--write)'}")
    return []


if __name__ == "__main__":
    raise SystemExit("run it as tools/split_js.py <name> --regroup [--write]")
