"""EVERY PAGE OF HK SETTINGS, drawn at three sizes in Chromium and WebKit, kept as deep DOM text and a screenshot, and compared
(phase 18, Part B: docs/phase18/CODE-HEALTH.md "Proving no change").

hk-settings.js was cut into a shell and parts (tools/split_js.py); the gallery has 19 Settings shots and the panel has hundreds of
pages. This visits every page the panel offers and compares what a tree draws with what another drew.

    python tools/headless/settings_sweep.py --save DIR          # on the parent commit: the pages, their DOM and screenshots
    python tools/headless/settings_sweep.py --compare DIR       # on the change: the same pages again; any difference fails
    python tools/headless/settings_sweep.py --save DIR --repeat # twice into DIR and DIR.2 and compared: is the sweep deterministic?
    python tools/headless/settings_sweep.py --volatile-from DIR # (DIR and DIR.2 are two sweeps of one tree) which pages differ from themselves

A PAGE THAT DIFFERS FROM ITSELF proves nothing: Mantel's own pages show the time ("2 min ago"), a history that grows as the pages are
visited, a measured latency; a live sound card's progress bar moves. `--save --repeat` sweeps the parent twice, and the pages whose
DOM (or picture) differ between the two are recorded in pages.json as volatile; `--compare` reports them as not compared, and
compares everything else. (A person's own page, /mantel/people/<id>, is not visited: its id is new each time the house is built.)

Env: PLAYWRIGHT_PATH (playwright-core, with Chromium and WebKit installed), NODE (else node on the PATH).

WHICH PAGES. The router (hk-settings.js resolve) takes any address, so "every page it knows" is found by asking it: from the
Overview, every `#/...` link a page offers is followed (breadth first, the sidebar first; the list of what a screen, a room, a tablet
and an accessory page link to is the router's). The list is saved with --save (pages.json) and --compare visits exactly it, then
crawls once more and fails if the two trees do not offer the same pages. Options: --limit N (cap the crawl, for a try),
--size WxH (repeatable), --browser chromium|webkit (repeatable), --no-shots.

WHAT IS STORED, per browser and size, per page: <page>.txt (the panel's DOM: tags and attributes, text, <style> as a length and a
hash, shadow roots under #shadow, a form control's live value) and <page>.png (the window). The house is the gallery's fictional
one (tools/headless/gallery.py), signed in as its Owner.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / x) for x in ("tools/headless", "tools", "hosts/server", "tests", ".")]

HEX32 = re.compile(r"[0-9a-f]{32}")
SIZES = ["1180x820", "820x1180", "390x844"]
BROWSERS = ["chromium", "webkit"]


async def run_node(args, req: dict) -> dict:
    proc = await asyncio.create_subprocess_exec(args.node, str(Path(__file__).with_suffix(".cjs")), stdin=asyncio.subprocess.PIPE,
                                                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=os.environ)
    o, e = await proc.communicate(json.dumps(req).encode())
    if proc.returncode != 0:
        raise SystemExit(f"the browser half failed ({req['browsers']} {req['sizes']}):\n{e.decode()[-3000:]}")
    return json.loads(o.decode().strip().splitlines()[-1])


async def sweep(out: Path, pages: list[str] | None, args) -> dict:
    """Every page at every size in every browser, into `out`. `pages` None: the pages are found by the crawl, which runs first
    (in the first browser at the first size, keeping each page as it visits it); the other browser/size pairs then run in
    parallel (--jobs) over the list it found."""
    import gallery
    from aiohttp.test_utils import TestServer
    browsers, sizes = args.browser or BROWSERS, args.size or SIZES
    combos = [(b, s) for b in browsers for s in sizes]
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td), real_model=True)
        async with TestServer(app) as server:
            out.mkdir(parents=True, exist_ok=True)
            base = {"origin": str(server.make_url("")).rstrip("/"), "cookie": cookie, "out": str(out), "limit": args.limit,
                    "shots": not args.no_shots}
            files, errors = 0, {}
            todo = list(combos)
            if pages is None:
                b, s = todo.pop(0)
                first = await run_node(args, {**base, "browsers": [b], "sizes": [s], "pages": None})
                pages, files, errors = first["pages"], first["files"], dict(first["errors"])
            gate = asyncio.Semaphore(max(1, args.jobs))

            async def one(b: str, s: str) -> dict:
                async with gate:
                    return await run_node(args, {**base, "browsers": [b], "sizes": [s], "pages": pages})
            for r in await asyncio.gather(*(one(b, s) for b, s in todo)):
                files += r["files"]
                errors.update(r["errors"])
            return {"pages": pages, "files": files, "errors": errors}


AGO = re.compile(r"\b(?:just now|(?:under )?\d+ (?:sec|second|min|minute|hour|day)s? ago)")


def digest(path: Path) -> str:
    """A file's hash; a DOM text with its elapsed times ("last seen 5 min ago") made the same first."""
    data = path.read_bytes()
    if path.suffix == ".txt":
        data = AGO.sub("<ago>", data.decode("utf-8")).encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def volatile_between(a: Path, b: Path) -> dict[str, list[str]]:
    """The pages (file names without the extension) whose DOM text, or whose picture, differ between two sweeps of one tree."""
    dom: set[str] = set()
    png: set[str] = set()
    for bdir in sorted(p for p in a.iterdir() if p.is_dir()):
        for sdir in sorted(p for p in bdir.iterdir() if p.is_dir()):
            other = b / bdir.name / sdir.name
            for f in sorted(sdir.iterdir()):
                if f.suffix not in (".txt", ".png"):
                    continue
                g = other / f.name
                if not g.exists() or digest(f) != digest(g):
                    (dom if f.suffix == ".txt" else png).add(f.stem)
    return {"dom": sorted(dom), "png": sorted(png)}


def pixels_apart(a: Path, b: Path) -> int | None:
    """How many pixels two pictures differ in (None: they are not the same size, or Pillow is not installed)."""
    try:
        from PIL import Image, ImageChops
    except ImportError:
        return None
    x, y = Image.open(a).convert("RGB"), Image.open(b).convert("RGB")
    if x.size != y.size:
        return None
    diff = ImageChops.difference(x, y).convert("L").point(lambda v: 255 if v else 0)
    return sum(1 for v in diff.getdata() if v)


def compare(saved: Path, now: Path, pages: list[str], shots: bool, volatile: dict[str, list[str]] | None = None,
            tolerance: int = 0) -> list[str]:
    """What differs between two sweeps' folders (empty: identical). Pages that differed from themselves (`volatile`) are left out."""
    bad: list[str] = []
    skip = {"dom": set((volatile or {}).get("dom", [])), "png": set((volatile or {}).get("png", [])) | set((volatile or {}).get("dom", []))}
    for bdir in sorted(p for p in saved.iterdir() if p.is_dir()):
        for sdir in sorted(p for p in bdir.iterdir() if p.is_dir()):
            other = now / bdir.name / sdir.name
            # (Mantel's own pages, /mantel/..., are the host's and carry the time and ids: their pictures are not compared)
            pics = [f for f in sorted(sdir.glob("*.png")) if not f.name.startswith("mantel_") and f.stem not in skip["png"]] if shots else []
            doms = [f for f in sorted(sdir.glob("*.txt")) if f.stem not in skip["dom"] and not HEX32.search(f.stem)]
            for f in doms + pics:
                g = other / f.name
                if not g.exists():
                    bad.append(f"{bdir.name} {sdir.name} {f.name}: missing")
                elif digest(f) != digest(g):
                    if f.suffix == ".png" and tolerance:
                        apart = pixels_apart(f, g)
                        if apart is not None and apart <= tolerance:
                            continue
                    bad.append(f"{bdir.name} {sdir.name} {f.name}: " + ("the DOM differs" if f.suffix == ".txt" else "the screenshot differs"))
    return bad


def first_difference(a: Path, b: Path) -> str:
    x, y = a.read_text().split("\n"), b.read_text().split("\n")
    for i, (p, q) in enumerate(zip(x, y)):
        if p != q:
            return f"line {i + 1}:\n      - {p.strip()[:200]}\n      + {q.strip()[:200]}"
    return f"one is {len(x)} lines, the other {len(y)}"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--save", type=Path, help="write the sweep into DIR (take it from the parent commit)")
    ap.add_argument("--compare", type=Path, help="sweep this tree and compare with the one saved in DIR")
    ap.add_argument("--repeat", action="store_true", help="with --save: sweep twice; the pages that differ from themselves are volatile")
    ap.add_argument("--volatile-from", type=Path, metavar="DIR", help="mark volatile pages from DIR and DIR.2 (two sweeps of one tree)")
    ap.add_argument("--limit", type=int, help="cap the crawl at this many pages (a try)")
    ap.add_argument("--size", action="append", help="WxH (default: " + ", ".join(SIZES) + ")")
    ap.add_argument("--browser", action="append", choices=BROWSERS)
    ap.add_argument("--no-shots", action="store_true", help="the DOM only")
    ap.add_argument("--tolerance", type=int, default=0, metavar="PIXELS", help="a picture may differ in this many pixels (default 0)")
    ap.add_argument("--reuse", type=Path, metavar="DIR", help="with --compare: compare with the sweep already in DIR (KEEP_SWEEP=1 keeps one)")
    ap.add_argument("--jobs", type=int, default=3, help="browser/size pairs run at once (default 3)")
    ap.add_argument("--node", default=os.environ.get("NODE") or shutil.which("node"))
    args = ap.parse_args(argv)
    if sum(bool(x) for x in (args.save, args.compare, args.volatile_from)) != 1:
        ap.error("give --save DIR, --compare DIR or --volatile-from DIR")
    if not args.node or not os.environ.get("PLAYWRIGHT_PATH"):
        print("settings_sweep: needs NODE and PLAYWRIGHT_PATH")
        return 0

    if args.volatile_from:
        out = args.volatile_from
        vol = volatile_between(out, Path(str(out) + ".2"))
        meta = json.loads((out / "pages.json").read_text())
        meta = {"pages": meta, "volatile": vol} if isinstance(meta, list) else {**meta, "volatile": vol}
        (out / "pages.json").write_text(json.dumps(meta, indent=1) + "\n")
        print(f"{len(vol['dom'])} pages differ from themselves in DOM, {len(vol['png'])} in picture: {vol['dom'][:12]} {vol['png'][:12]}")
        return 0

    if args.save:
        out = args.save
        if out.exists() and any(out.iterdir()):
            raise SystemExit(f"{out} is not empty")
        res = asyncio.run(sweep(out, None, args))
        meta = {"pages": res["pages"], "volatile": {"dom": [], "png": []}}
        (out / "pages.json").write_text(json.dumps(meta, indent=1) + "\n")
        print(f"saved {res['files']} page drawings of {len(res['pages'])} pages in {out}")
        for k, v in res["errors"].items():
            if v:
                print(f"  page errors in {k}: {v[:3]}")
        if args.repeat:
            again = Path(str(out) + ".2")
            asyncio.run(sweep(again, res["pages"], args))
            meta["volatile"] = volatile_between(out, again)
            (out / "pages.json").write_text(json.dumps(meta, indent=1) + "\n")
            v = meta["volatile"]
            print(f"a second sweep of the same tree: {len(v['dom'])} pages differ from themselves in DOM {v['dom'][:10]}, "
                  f"{len(v['png'])} in picture {v['png'][:10]} (recorded as volatile: not compared)")
        return 0

    saved = args.compare
    meta = json.loads((saved / "pages.json").read_text())
    pages = [p for p in meta["pages"] if not HEX32.search(p)]
    volatile = meta.get("volatile") or {"dom": [], "png": []}
    now = Path(tempfile.mkdtemp(prefix="settings-sweep-"))
    try:
        # (the crawl finds this tree's pages, which must be the pages the other tree had: then every one of them is compared)
        if args.reuse:
            shutil.rmtree(now, ignore_errors=True)
            now = args.reuse
            found = sorted({"/" + f.stem for f in (now / "chromium" / "1180x820").glob("*.txt")})
            res = {"pages": pages, "errors": {}} if len(found) == len(pages) else asyncio.run(sweep(now, None, args))
        else:
            res = asyncio.run(sweep(now, None, args))
        bad = []
        if sorted(res["pages"]) != sorted(pages) and not args.limit:
            bad.append(f"the pages differ: only before {sorted(set(pages) - set(res['pages']))[:10]}, only now {sorted(set(res['pages']) - set(pages))[:10]}")
        bad += compare(saved, now, res["pages"], not args.no_shots, volatile, args.tolerance)
        total = sum(1 for _ in saved.rglob("*.txt"))
        print(f"compared {total} drawings of {len(pages)} pages ({len(args.browser or BROWSERS)} browsers x {len(args.size or SIZES)} sizes), "
              f"leaving out {len(volatile['dom'])} pages whose DOM and {len(volatile['png'])} whose picture differ between two sweeps of one tree: "
              f"{'IDENTICAL (DOM text and screenshots)' if not bad else str(len(bad)) + ' DIFFERENCES'}")
        shown = 0
        for b in bad:
            if shown < 40:
                print("  " + b)
                shown += 1
                if b.endswith("the DOM differs"):
                    bname, size, name = b.split()[0], b.split()[1], b.split()[2].rstrip(":")
                    print("    " + first_difference(saved / bname / size / name, now / bname / size / name))
        for k, v in res["errors"].items():
            if v:
                print(f"  page errors in {k}: {v[:3]}")
        return 1 if bad else 0
    finally:
        if args.reuse:
            pass
        elif os.environ.get("KEEP_SWEEP"):
            print(f"kept: {now}")
        else:
            shutil.rmtree(now, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
