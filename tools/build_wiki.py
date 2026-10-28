"""Build Mantel's GitHub Wiki from the user guide (docs/guide). LOCAL ONLY: it writes into a clone of the Wiki's
repository and, with --commit, commits there. It never pushes; publishing the Wiki is the maintainer's step.

    python tools/build_wiki.py WIKI_DIR [--commit "message"]
    python tools/build_wiki.py --check          build in memory, report problems, write nothing

docs/guide holds one file per Wiki page, named as the page is (First-Run.md is "First Run"), with Home.md,
_Sidebar.md and _Footer.md beside them, linking to each other as files so the same links work in the
repository. The pages are made by HK Frontend's Wiki builder (wiki_from() in its tools/publish/publish.py,
which builds HK Frontend's Wiki the same way): the first heading goes, Page.md links lose the .md, images
point at docs/images on main (raw.githubusercontent.com), and links out of the guide point at the file on
GitHub. On top of that, every page must be in _Sidebar.md, and the pages are scanned for private data (HK
Frontend's rules, plus HK_PRIVATE / HK_PRIVATE_FILE as tools/check_private.py reads them); one problem and
nothing is written.
"""
from __future__ import annotations

import argparse
import importlib.util
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GUIDE = ROOT / "docs/guide"
REPO_URL = "https://github.com/jazzphone/mantel"
HK_PUBLISHER = ROOT / "hosts/ha/custom_components/hk_frontend/tools/publish/publish.py"
SPECIAL = ("Home.md", "_Sidebar.md", "_Footer.md")
# the fixed Docker networks of Mantel's own compose file (packaging/compose), which Install with Docker names: the
# same on every install, not a home's own addresses
OWN_SUBNETS = re.compile(r"\b172\.31\.25[01]\.\d{1,3}\b")


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def hk_publisher():
    """HK Frontend's publisher: its Wiki builder, its scan rules and its publisher identity, shared."""
    return _load("hk_publisher", HK_PUBLISHER)


def pages(guide: Path = GUIDE, hk=None) -> list[tuple[str, str]]:
    hk = hk or hk_publisher()
    return hk.wiki_from(str(guide), REPO_URL, "docs/guide", "docs/guide")


def problems(guide: Path = GUIDE, built=None, hk=None, env: dict[str, str] | None = None) -> list[str]:
    """What stops a build: a missing Home, _Sidebar or _Footer; a page the sidebar doesn't list; private data."""
    hk = hk or hk_publisher()
    built = pages(guide, hk) if built is None else built
    names = {name for name, _ in built}
    out = [f"docs/guide/{f} is missing" for f in SPECIAL if f not in names]
    sidebar = (guide / "_Sidebar.md").read_text(encoding="utf-8") if (guide / "_Sidebar.md").exists() else ""
    listed = set(re.findall(r"\]\(([A-Za-z_-]+)\.md(?:#[^)]*)?\)", sidebar))
    out += [f"docs/guide/_Sidebar.md doesn't list {name}" for name in sorted(names)
            if not name.startswith("_") and name != "Home.md" and name[:-3] not in listed]
    out += hk.scan_texts([(name, OWN_SUBNETS.sub("own-subnet", text)) for name, text in built])
    check_private = _load("check_private", ROOT / "tools/check_private.py")
    pats = check_private.patterns(env)
    out += [f"wiki/{name}:{n}: a private word" for name, text in built
            for n, line in enumerate(text.splitlines(), 1) if any(p.search(line) for p in pats)]
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("wiki", nargs="?", help="a clone of the Wiki's repository (github.com/jazzphone/mantel.wiki)")
    ap.add_argument("--check", action="store_true", help="build in memory and report; write nothing")
    ap.add_argument("--commit", help="commit the built pages in WIKI_DIR with this message (never pushed)")
    a = ap.parse_args(argv)
    hk = hk_publisher()
    built = pages(hk=hk)
    found = problems(built=built, hk=hk)
    if found:
        print("NOT BUILT:\n" + "\n".join(found[:60]))
        return 2
    if a.check:
        print(f"{len(built)} Wiki pages, clean")
        return 0
    if not a.wiki:
        ap.error("WIKI_DIR is required (or --check)")
    if not os.path.isdir(os.path.join(a.wiki, ".git")):
        ap.error("WIKI_DIR must be a clone of the Wiki's repository")
    hk.build_wiki(a.wiki, built)
    print(f"built {len(built)} Wiki pages in {a.wiki}")
    if a.commit:
        hk.stage(a.wiki)
        if subprocess.call(["git", "diff", "--cached", "--quiet"], cwd=a.wiki) != 0 and \
                hk.run(["git", *hk.AS_PUBLISHER, "commit", "-q", "-m", a.commit], a.wiki) != 0:
            return 1
    print("Not pushed: publishing the Wiki is the maintainer's step.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
