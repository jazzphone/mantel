#!/usr/bin/env python3
"""Stage the static web app for the image and stamp it with a content-derived build id (PLAN §8).

    python tools/build_static.py OUT_DIR [--src web]

Writes into OUT_DIR (which must not exist yet):
    web/                    a copy of the web app (no dotfiles, caches or source maps)
    static-manifest.json    {"build": id, "files": {"hk/cards/x.js": {"sha256": ..., "size": n}, ...}}
    BUILD_ID                the id alone; /api/version and the image label read it

The id is the first 16 hex digits of a SHA-256 over every file's path and content, so it changes
exactly when a served byte changes and is identical for identical sources (reproducible).

What this does NOT do yet is rename files to ``name.<hash>.ext``: HK's modules load each other by
absolute ``/hk/...`` paths and by paths assembled at run time, so a blind rename would break them.
docs/phase3/PACKAGING.md describes the safe route. Until then the server sends ``no-cache`` with an
ETag for every asset (a conditional request, answered 304 when nothing changed) and the build id
tells open screens to reload. Since Phase 5 the build also stamps ``?v=<build id>`` on its own imports and
the pages' links, which the server lets a browser keep (``stamp()`` below).

COMMENTS AND INDENTATION STRIPPED (2026-10-29, Phase 5): every .js and .css file of the copy goes through
esbuild's whitespace minifier (``minify()`` below): comments and indentation gone, nothing renamed, nothing
bundled, every file still the same file at the same path with the same imports. The repository's source is
untouched. esbuild is pinned in tools/package.json (``npm ci --prefix tools``; the Docker build takes the same
version's binary from a Node stage). ``--no-minify`` copies the files as they are (a developer's check).
The build id is taken from what ships: the minified files.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {"node_modules", "__pycache__", ".git"}
SKIP_SUFFIXES = {".map", ".pyc"}
# DEVELOPER PAGES STAY IN THE REPOSITORY (2026-10-29): the scenery review page is for someone working on the sky
# with a checkout (the dev server, the tests); the Docker image and the HA App (tools/stage_ha_app.py plans its web/
# through _wanted) do not carry it. Sky Lab and the sky probe do ship: the guide offers them (Tools, Live Sky). Paths
# under web/.
DEV_ONLY = frozenset({"hk/pages/seasonal-scenery-review.html"})


def _wanted(path: Path, base: Path) -> bool:
    rel = path.relative_to(base)
    if any(part in SKIP_DIRS or part.startswith(".") for part in rel.parts) or rel.as_posix() in DEV_ONLY:
        return False
    return path.is_file() and path.suffix not in SKIP_SUFFIXES


def file_digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# -- esbuild ------------------------------------------------------------------------------------------------
ESBUILD_VERSION = "0.28.2"          # tools/package.json pins the same; the Docker build's Node stage installs it
MINIFIED = (".js", ".css")


def esbuild() -> str | None:
    """The pinned esbuild binary: $ESBUILD, else the one `npm ci --prefix tools` installed (its platform package's
    own binary, so Node is not needed to run it), else one on PATH; None when there is none of that version."""
    found = [os.environ.get("ESBUILD")]
    found += [str(p) for p in sorted((ROOT / "tools/node_modules/@esbuild").glob("*/bin/esbuild"))]
    found.append(shutil.which("esbuild"))
    for exe in filter(None, found):
        try:
            got = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=30).stdout.strip()
        except OSError:
            continue
        if got == ESBUILD_VERSION:
            return exe
    return None


def minify(root: Path, rels: list[str]) -> None:
    """Strip comments and indentation from the .js/.css files among `rels` under root, in place: esbuild's
    whitespace minifier and nothing else -- no renaming, no syntax rewrites, no bundling, legal comments dropped
    too, text kept as UTF-8. Template literals, import() and every specifier come out as they went in."""
    exe = esbuild()
    if exe is None:
        raise SystemExit(f"esbuild {ESBUILD_VERSION} not found: run `npm ci --prefix tools` (or set ESBUILD), "
                         "or pass --no-minify")
    files = [r for r in rels if r.endswith(MINIFIED)]
    for i in range(0, len(files), 200):            # (a command line of a sane length)
        r = subprocess.run([exe, "--minify-whitespace", "--legal-comments=none", "--charset=utf8", "--log-level=error",
                            "--allow-overwrite", f"--outdir={root}", f"--outbase={root}",
                            *[str(root / f) for f in files[i:i + 200]]], capture_output=True, text=True)
        if r.returncode != 0:
            raise SystemExit("esbuild failed:\n" + (r.stderr or r.stdout)[-4000:])


# -- ?v=<build id> ------------------------------------------------------------------------------------------
# CACHE THAT LASTS (2026-10-29, Phase 5). Every screen asked again for each of its ~120 files at every start (no-cache:
# a conditional request, a 304). Now the build stamps ?v=<build id> on the addresses of HK's and Mantel's own code
# where they are written down -- each import's specifier and each page's script and stylesheet link -- and the server
# lets a browser keep a file asked for with the build's id for a year (server.py: immutable). A new build is a new id,
# so a new address. What is stamped, and only that:
#   * a module specifier: `from "x"`, `import "x"`, `import("x")` with a string literal, where x is one of this
#     app's own scripts -- relative (./, ../) or under /hk/ or /web/ -- with no query of its own;
#   * in a page, a <script src> or <link href> under /hk/ or /web/ (a .js or .css).
# An address put together at run time ('/hk/sheets/' + file) gets the same ?v= from web/shim/base.js's hkV(), which
# reads it off its own address. Everything else (pictures, fonts, the API) is left as it was.
_OWN = r"(?:\.{1,2}/|/hk/|/web/)[^\"'`?#\s]*\.m?js"
JS_SPECIFIER = re.compile(r"(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)([\"'])(" + _OWN + r")\2")
HTML_LINK = re.compile(r"(<(?:script|link)\b[^>]*?\b(?:src|href)=)([\"'])(/(?:hk|web)/[^\"'?#\s]+\.(?:m?js|css))\2", re.I)
STAMPED = (".js", ".mjs", ".html")


def stamp_text(text: str, version: str, html: bool = False) -> str:
    """The text with ?v=<version> on every own script address it names (see above)."""
    pat = HTML_LINK if html else JS_SPECIFIER
    return pat.sub(lambda m: f"{m.group(1)}{m.group(2)}{m.group(3)}?v={version}{m.group(2)}", text)


def stamp(root: Path, rels: list[str], version: str) -> int:
    """Stamp the .js and .html files among `rels` under root in place; how many addresses were stamped."""
    n = 0
    for rel in rels:
        if not rel.endswith(STAMPED):
            continue
        path = root / rel
        text = path.read_text(encoding="utf-8")
        new = stamp_text(text, version, html=rel.endswith(".html"))
        if new != text:
            n += new.count("?v=" + version) - text.count("?v=" + version)
            path.write_text(new, encoding="utf-8")
    return n


def build(src: Path, out: Path, minified: bool = True, stamped: bool = True) -> str:
    """Copy src to out/web (minified, then stamped with its build id, unless told not to), write the manifest and
    BUILD_ID, return the build id."""
    if out.exists():
        raise SystemExit(f"{out} already exists; choose a new directory")
    if not src.is_dir():
        raise SystemExit(f"{src} is not a directory")
    files = sorted(p for p in src.rglob("*") if _wanted(p, src))
    web = out / "web"
    for p in files:
        dest = web / p.relative_to(src)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(p, dest)
    rels = [p.relative_to(src).as_posix() for p in files]
    if minified:
        minify(web, rels)
    overall = hashlib.sha256()
    for rel in rels:
        overall.update(rel.encode() + b"\0" + file_digest(web / rel).encode() + b"\n")
    build_id = overall.hexdigest()[:16]          # (of what ships, before the id itself is stamped in)
    if stamped:
        stamp(web, rels, build_id)
    manifest = {rel: {"sha256": file_digest(web / rel), "size": (web / rel).stat().st_size} for rel in rels}
    (out / "static-manifest.json").write_text(json.dumps({"build": build_id, "files": manifest}, indent=1, sort_keys=True))
    (out / "BUILD_ID").write_text(build_id + "\n")
    return build_id


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("out", type=Path)
    p.add_argument("--src", type=Path, default=ROOT / "web")
    p.add_argument("--no-minify", action="store_true", help="copy the files as they are (no esbuild)")
    p.add_argument("--no-stamp", action="store_true", help="leave the imports without ?v=<build id>")
    a = p.parse_args(argv)
    build_id = build(a.src, a.out, minified=not a.no_minify, stamped=not a.no_stamp)
    print(f"build {build_id}: {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
