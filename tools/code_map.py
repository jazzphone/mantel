#!/usr/bin/env python3
"""Write docs/development/Code-map.md: where everything lives, one line per file (phase 24, A5: docs/phase24/CLEAN-CODE.md).

    tools/code_map.py           # write it
    tools/code_map.py --check   # is it fresh? (tests/test_code_map.py)

Each line is a file and what its opening comment (or docstring) says it is, cut to its first sentence. A file cut into
parts (tools/split_js.py, tools/split_py.py) is listed with its parts under it, each with the title its manifest gives,
so the page reads as a table of contents: "where do I change X" for every later session. Generated from the files
themselves, so it is never out of date for longer than a commit (the test fails until it is written again).
"""
from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs/development/Code-map.md"
# the folders mapped, in this order, each with what it is
SECTIONS = [
    ("web", "web/", "Mantel's pages and the code both hosts share: HK's cards, modules, panels and their parts."),
    ("hk_core", "hk_core/", "The decisions both hosts make the same way (Rule 2), in Python."),
    ("server", "hosts/server/mantel_server/", "Mantel Server."),
    ("ha", "hosts/ha/custom_components/", "Home Assistant's integrations (HK Frontend, Mantel Link)."),
    ("tools", "tools/", "Build, release and check tools."),
]
SKIP_DIRS = {"node_modules", "__pycache__", "vendor", "tests", "fixtures", "frontend_min", "testha"}


def first_sentence(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    m = re.match(r"(.+?[.!?:])(\s|$)", text)
    s = (m.group(1) if m else text).rstrip(":")
    return s if len(s) <= 150 else s[:147].rstrip() + "..."


def describe(path: Path) -> str:
    try:
        text = path.read_text(errors="replace")
    except OSError:
        return ""
    if path.suffix == ".py":
        try:
            doc = ast.get_docstring(ast.parse(text)) or ""
        except SyntaxError:
            doc = ""
        return first_sentence(doc.split("\n\n")[0]) if doc else ""
    lines = []
    for ln in text.split("\n"):
        s = ln.strip()
        if s.startswith("//"):
            body = s.lstrip("/").strip()
            if body == "@ts-check" or body.startswith("@ts-"):
                continue
            if not body and lines:
                break
            if body:
                lines.append(body)
        elif s.startswith(("/*", "*")) and not lines:
            continue
        elif lines or s:
            break
    head = " ".join(lines)
    head = re.sub(r"^[\w.-]+\.(?:c?js)\s*(?:--|-|—|:)\s*", "", head)     # the file's own name first: dropped
    return first_sentence(head)


def manifests() -> dict[str, dict]:
    out = {}
    for d, key in ((ROOT / "tools/split_manifests", "shell"), (ROOT / "tools/split_py_manifests", "module")):
        for p in sorted(d.glob("*.json")) if d.is_dir() else []:
            m = json.loads(p.read_text())
            m["_name"] = p.stem
            m["_kind"] = "js" if key == "shell" else "py"
            out[m[key]] = m
    return out


def part_folders(mans: dict[str, dict]) -> set[str]:
    out = set()
    for m in mans.values():
        if m["_kind"] == "js":
            out.add(m["folder"])
        elif m.get("mode", "package") == "package":
            out.add(str(Path(m["module"]).with_suffix("")))
    return out


def files_of(base: str, parts: set[str]) -> list[Path]:
    root = ROOT / base
    out = []
    for p in sorted(root.rglob("*")):
        rel = p.relative_to(ROOT).as_posix()
        if not p.is_file() or p.suffix not in (".js", ".cjs", ".py") or set(p.relative_to(root).parts[:-1]) & SKIP_DIRS:
            continue
        if any(rel.startswith(f + "/") for f in parts) or p.name == "__init__.py":
            continue
        out.append(p)
    return out


def render() -> str:
    mans = manifests()
    parts = part_folders(mans)
    out = ["# Code map", "",
           "Where everything lives: one line per file, from its own opening comment. A file cut into parts lists its parts",
           "under it, each with what it holds; `tools/split_js.py --find NAME` (or `tools/split_py.py --find NAME`) says which",
           "file holds a name. Written by `tools/code_map.py` (phase 24); `tests/test_code_map.py` fails until it is written",
           "again after a file is added, moved or split. Don't edit it by hand.", ""]
    seen_py_pkgs = {str(Path(m["module"]).with_suffix("")): m for m in mans.values()
                    if m["_kind"] == "py" and m.get("mode", "package") == "package"}
    for _, base, what in SECTIONS:
        out += [f"## `{base}`", "", what, ""]
        by_dir: dict[str, list[Path]] = {}
        for p in files_of(base, parts):
            by_dir.setdefault(p.parent.relative_to(ROOT).as_posix(), []).append(p)
        for pkg, m in seen_py_pkgs.items():
            if pkg.startswith(base.rstrip("/")):
                by_dir.setdefault(str(Path(pkg).parent), []).append(ROOT / (pkg + "/__init__.py"))
        for d in sorted(by_dir):
            out.append(f"- **{d}/**")
            for p in sorted(by_dir[d], key=lambda x: x.as_posix()):
                rel = p.relative_to(ROOT).as_posix()
                if p.name == "__init__.py" and rel.removesuffix("/__init__.py") in seen_py_pkgs:
                    m = seen_py_pkgs[rel.removesuffix("/__init__.py")]
                    out.append(f"  - `{Path(m['module']).stem}/` (a package: `tools/split_py_manifests/{m['_name']}.json`) "
                               f"— {describe(p) or ''}".rstrip(" —"))
                    for q in m["parts"]:
                        out.append(f"    - `{q['name']}.py` — {q['title']}")
                    continue
                desc = describe(p)
                m = mans.get(rel)
                line = f"  - `{p.name}`" + (f" — {desc}" if desc else "")
                if m and m["_kind"] == "js":
                    line += f" *(a shell: its parts are in `{m['folder']}/`, `tools/split_manifests/{m['_name']}.json`)*"
                elif m and m["_kind"] == "py":
                    line += f" *(its parts beside it: `tools/split_py_manifests/{m['_name']}.json`)*"
                out.append(line)
                if m and m["_kind"] == "js":
                    for q in m["parts"]:
                        out.append(f"    - `{q['name']}.js` — {q['title']}")
                elif m and m["_kind"] == "py":
                    for q in m["parts"]:
                        out.append(f"    - `{Path(m['module']).stem}_{q['name']}.py` — {q['title']}")
        out.append("")
    return "\n".join(out).rstrip() + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args(argv)
    text = render()
    if a.check:
        if not OUT.is_file() or OUT.read_text() != text:
            print(f"{OUT.relative_to(ROOT)} is not fresh: run tools/code_map.py")
            return 1
        print(f"{OUT.relative_to(ROOT)} is fresh")
        return 0
    OUT.write_text(text)
    print(f"wrote {OUT.relative_to(ROOT)} ({text.count(chr(10))} lines)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
