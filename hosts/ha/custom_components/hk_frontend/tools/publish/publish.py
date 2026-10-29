"""BUILD THE PUBLIC REPOSITORY from this component (HK Frontend 1.0).

The component is developed in Mantel under hosts/ha/, with shared frontend
source under web/. The build plan composes those sources and publishes the
repository HACS installs from:

    custom_components/hk_frontend/   what HACS installs (no tests, tools, docs)
    tests/  tools/  docs/            beside it
    README.md                        the component's README
    LICENSE  hacs.json  .github/ ... tools/publish/root/

Every published file is scanned for private data (PRIVATE: local host names,
private IP addresses, keys and tokens, plus any names given in HK_PRIVATE);
one hit and nothing is written. With --wiki, the GitHub Wiki is built from
docs/ into WIKI_DIR (a clone of the Wiki's repository), scanned the same way,
and committed with the same message. Then both test suites run IN the built repository, so the layout is
proven, and -- only with --commit -- it is committed (and pushed with --push).

    python3 tools/publish/publish.py REPO_DIR [--commit "message"] [--push [--release]] [--no-tests] [--wiki WIKI_DIR]

    python3 tools/publish/publish.py --scan          only report what would be refused

HACS offers a repository's versions from its GitHub releases, so a version nobody released is one nobody can pick.
With --release (after --commit and --push; never by default) the manifest's version is tagged v<version> and
released with `gh release create`, its notes the CHANGELOG.md section of that version (tools/publish/root/). It
refuses, before anything is committed or pushed, when there is no such section or the tag exists, here or on origin.
"""
from __future__ import annotations

import argparse
import json
import os
import posixpath
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
COMPONENT = os.path.dirname(os.path.dirname(HERE))
# caches -- never published; .sfcache holds glyphs exported from Apple's SF
# Symbols app, which can't be passed on
SKIP_DIRS = {"__pycache__", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".sfcache", "sf-exports",
             ".DS_Store"}
BESIDE = ("tests", "tools", "docs")          # published next to the component
# What must never be published: keys and tokens, and addresses on a private
# network (192.0.2.x, the documentation range, is what examples use). A
# home's own names, host names and subnets are its business: they come from
# HK_PRIVATE (a regex, "word|word|..."), never from this file -- which is
# published, and would name them.
PRIVATE = [
    r"\b192\.168\.\d{1,3}\.\d{1,3}\b", r"\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b",
    # 172.16.0.0/12, except 172.30.32.0/23: Home Assistant's internal "hassio"
    # network (the same on every HA OS install, not a home's own data), which
    # linked mode names to reach Mantel's App (decision 24)
    r"\b172\.(?:(?:1[6-9]|2\d|31)\.\d{1,3}|30\.(?!3[23]\b)\d{1,3})\.\d{1,3}\b",
    r"eyJ[A-Za-z0-9_-]{20,}",                      # a JWT (a Home Assistant token)
    r"gh[pousr]_[A-Za-z0-9]{20,}", r"AKIA[0-9A-Z]{16}", r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
]
# this file names the patterns above; it is not scanned for them
SELF = os.path.abspath(__file__)
TEXT = (".py", ".js", ".json", ".yaml", ".yml", ".md", ".css", ".html", ".txt", ".sh", "")


# AN ART DELIVERY'S PROOFS (tools/sky/src/land-holiday/): its sources and
# DONE.json are published; the artist's working folder, contact sheets and
# diff maps are not (.gitignore says the same)
SKIP_ART = re.compile(r"(^|/)tools/sky/src/[^/]+/(work/|contact-[^/]*\.png$|diff-[^/]*\.png$)")
# THE DASHBOARD SCENES' ART (tools/sky/src/decor*/) and what their parked
# preview built from it (frontend/sky/scenes/): concepts and motion layers still
# in review, untracked and not in any release -- none of it is published. Nor is
# New Decorations' review page, a mock dashboard for judging the art by hand.
SKIP_UNRELEASED = re.compile(r"(^|/)((tools/sky/src/decor[^/]*|frontend/sky/scenes)/"
                             r"|(frontend/)?pages/seasonal-scenery-review\.html$)")


# WHAT GIT IGNORES IS NEVER PUBLISHED: an art delivery's sources stay beside
# what was made from them, untracked (Realistic clouds' 236 MB of PNG in
# tools/sky/src/clouds/, Codex's unused woodland art in land-woods/), and the
# patterns above only know the folders they name. Empty outside a checkout.
def git_ignored(root: str) -> set[str]:
    try:
        out = subprocess.run(["git", "ls-files", "--others", "--ignored", "--exclude-standard", "-z", "."],
                             cwd=root, capture_output=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return set()
    return {p for p in out.decode().split("\0") if p}


# WHO A PUBLISHED COMMIT SAYS MADE IT: the project's GitHub account and its
# noreply address -- never this machine's git identity, which put a full name
# and a host name on the public history (1.4.5 to 1.5.0). The scan above
# reads files only; a commit's author is not a file.
AS_PUBLISHER = ("-c", "user.name=jazzphone", "-c", "user.email=jazzphone@users.noreply.github.com")


def files_under(root: str):
    ignored = git_ignored(root)
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
        for f in files:
            path = os.path.join(d, f)
            rel = os.path.relpath(path, root).replace(os.sep, "/")
            if f not in SKIP_DIRS and rel not in ignored and not SKIP_ART.search(rel) and not SKIP_UNRELEASED.search(rel):
                yield path


def plan() -> list[tuple[str, str]]:
    """(source, path in the repository) for every published file."""
    out: list[tuple[str, str]] = []
    for src in files_under(COMPONENT):
        rel = os.path.relpath(src, COMPONENT)
        top = rel.split(os.sep, 1)[0]
        if top in BESIDE:
            if rel.startswith(os.path.join("tools", "publish")):
                if rel.startswith(os.path.join("tools", "publish", "root") + os.sep):
                    out.append((src, os.path.relpath(src, os.path.join(HERE, "root"))))
                elif rel == os.path.join("tools", "publish", "publish.py"):
                    out.append((src, rel))
                continue
            out.append((src, rel))
        elif rel == "README.md":
            out.append((src, "README.md"))
        else:
            out.append((src, os.path.join("custom_components", "hk_frontend", rel)))
    # Mantel is now the development source. Keep one frontend copy and compose
    # its shared files with the HA host only when producing the HACS artifact.
    mantel = Path(COMPONENT).parent.parent.parent.parent
    frontend = mantel / "web/hk"
    if frontend.is_dir():
        for src in files_under(str(frontend)):
            rel = os.path.relpath(src, frontend)
            out.append((src, os.path.join("custom_components", "hk_frontend", "frontend", rel)))
        shared = json.loads((mantel / "web/shared-assets.json").read_text())
        for rel, src in shared.items():
            source = (mantel / "web" / src).resolve()
            source.relative_to((mantel / "web").resolve())
            out.append((str(source), "custom_components/hk_frontend/frontend/" + rel))
        # The shared feature logic (hk_core): vendored inside the component, so HA imports it
        # as custom_components.hk_frontend.hk_core (it only imports relatively).
        core = mantel / "hk_core"
        for src in files_under(str(core)):
            rel = os.path.relpath(src, core)
            if rel.endswith(".py") or rel == "README.md":
                out.append((src, os.path.join("custom_components", "hk_frontend", "hk_core", rel)))
        out.append((str(mantel / "hosts/ha/frontend/hk-ha-client.js"),
                    "custom_components/hk_frontend/frontend/modules/hk-ha-client.js"))
        out.append((str(mantel / "hosts/ha/frontend/hk-ha-shell.js"),
                    "custom_components/hk_frontend/frontend/modules/hk-ha-shell.js"))
        out.append((str(mantel / "hosts/ha/frontend/hk-ha-elements.js"),
                    "custom_components/hk_frontend/frontend/modules/hk-ha-elements.js"))
        # HK as its own panel (hk_panel.py, opt-in): the panel's element, loaded only by it
        out.append((str(mantel / "hosts/ha/frontend/hk-ha-panel.js"),
                    "custom_components/hk_frontend/frontend/modules/hk-ha-panel.js"))
    return out


def scan(pairs) -> list[str]:
    extra = os.environ.get("HK_PRIVATE", "")
    pats = [re.compile(p, re.I) for p in PRIVATE + ([extra] if extra else [])]
    hits: list[str] = []
    for src, dest in pairs:
        if os.path.splitext(src)[1] not in TEXT or os.path.getsize(src) > 5_000_000:
            continue
        own = os.path.abspath(src) == SELF
        try:
            text = open(src, encoding="utf-8").read()
        except UnicodeDecodeError:
            continue
        for n, line in enumerate(text.splitlines(), 1):
            for i, p in enumerate(pats):
                if own and i < len(PRIVATE):
                    continue
                if p.search(line):
                    hits.append(f"{dest}:{n}: {line.strip()[:120]}")
                    break
    return hits


# ---- the Wiki. docs/ holds one file per Wiki page, named as the page is
# (Live-TV.md is "Live TV"), linking to each other as files so the same links
# work in the repository. For the Wiki: the first heading goes (the Wiki shows
# the page name), Page.md links lose the .md, images point at docs/images on
# main, and links out of docs/ point at the repository.
#
# wiki_from() works for any folder of pages: Mantel's own guide is built into
# Mantel's Wiki with it (tools/build_wiki.py in Mantel), with its repository
# and the folder's place in it.
REPO_URL = "https://github.com/jazzphone/hk-frontend"
RAW = "https://raw.githubusercontent.com/jazzphone/hk-frontend/main/docs/"
IMAGE = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg")
# a Markdown link's target, an <img src="...">, or the old href=(...) form
WIKI_TARGET = re.compile(r'(\]\(|\bhref=\(|\bsrc=")([^)"\s]+)')
SCHEME = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*:|#|//")


def wiki_from(docs: str, repo_url: str, docs_path: str = "docs", label: str = "docs") -> list[tuple[str, str]]:
    """(file name, text) of each Wiki page made from the .md files in `docs`, the folder at `docs_path` in the
    repository at `repo_url` (https://github.com/OWNER/NAME). Page links lose their .md; images point at the
    repository's raw files on main; any other relative link points at the file on GitHub. A link to a page
    that doesn't exist, out of the repository, or to an image that isn't there stops the build."""
    raw = repo_url.replace("https://github.com/", "https://raw.githubusercontent.com/", 1) + "/main/"
    names = {f for f in os.listdir(docs) if f.endswith(".md")}
    out = []
    for f in sorted(names):
        text = open(os.path.join(docs, f), encoding="utf-8").read()
        if not f.startswith("_") and text.startswith("# "):
            text = text.split("\n", 1)[1].lstrip("\n")

        def target(m, f=f):
            lead, link = m.group(1), m.group(2)
            if SCHEME.match(link):
                return m.group(0)
            base, hash_, anchor = link.partition("#")
            if re.fullmatch(r"[A-Za-z_-]+\.md", base):
                if base in names:
                    return f"{lead}{base[:-3]}{hash_}{anchor}"
                raise SystemExit(f"{label}/{f}: link to a page that doesn't exist: {base}")
            path = posixpath.normpath(posixpath.join(docs_path, base))
            if path == ".." or path.startswith("../"):
                raise SystemExit(f"{label}/{f}: link out of the repository: {link}")
            if base.lower().endswith(IMAGE):
                if not os.path.exists(os.path.join(docs, base)):
                    raise SystemExit(f"{label}/{f}: image not in the repository: {base}")
                return f"{lead}{raw}{path}{hash_}{anchor}"
            kind, slash = ("tree", "/") if base.endswith("/") else ("blob", "")
            return f"{lead}{repo_url}/{kind}/main/{path}{slash}{hash_}{anchor}"
        out.append((f, WIKI_TARGET.sub(target, text)))
    return out


def wiki_pages() -> list[tuple[str, str]]:
    return wiki_from(os.path.join(COMPONENT, "docs"), REPO_URL)


def scan_texts(items) -> list[str]:
    extra = os.environ.get("HK_PRIVATE", "")
    pats = [re.compile(p, re.I) for p in PRIVATE + ([extra] if extra else [])]
    return [f"wiki/{name}:{n}: {line.strip()[:120]}"
            for name, text in items for n, line in enumerate(text.splitlines(), 1)
            if any(p.search(line) for p in pats)]


def build_wiki(wiki: str, pages) -> None:
    for name in os.listdir(wiki):
        if name.endswith(".md"):
            os.remove(os.path.join(wiki, name))
    for name, text in pages:
        open(os.path.join(wiki, name), "w", encoding="utf-8").write(text)


def build(repo: str, pairs) -> None:
    keep = {".git"}
    for name in os.listdir(repo) if os.path.isdir(repo) else []:
        if name not in keep:
            path = os.path.join(repo, name)
            shutil.rmtree(path) if os.path.isdir(path) and not os.path.islink(path) else os.remove(path)
    for src, dest in pairs:
        target = os.path.join(repo, dest)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.copy2(src, target)
        # a script (tests/run, tests/py/run) is run by name in the docs; the
        # disk it is developed on keeps no modes of its own (a share, or an
        # external disk that reports 700 on every file), so they are set here
        with open(target, "rb") as f:
            os.chmod(target, 0o755 if f.read(2) == b"#!" else 0o644)
    minified(repo)


# COMMENTS AND INDENTATION STRIPPED (2026-10-29). Beside the component's frontend/ (the readable source, which the
# tests read), frontend_min/ holds its .js and .css files through esbuild's whitespace minifier -- Mantel's
# tools/build_static.py, the same step its own images take: no comments or indentation, nothing renamed or
# bundled. /hk sends that copy (files.py MINIFIED). Made from what was just written, so it always matches.
MINIFIED = ("custom_components", "hk_frontend", "frontend_min")


def minified(repo: str) -> None:
    front = Path(repo, "custom_components", "hk_frontend", "frontend")
    tool = Path(COMPONENT).parents[3] / "tools" / "build_static.py"
    if not front.is_dir() or not tool.is_file():
        print("frontend_min/ not made: no frontend/ here, or not run from Mantel (tools/build_static.py)")
        return
    import importlib.util
    spec = importlib.util.spec_from_file_location("mantel_build_static", tool)
    bs = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bs)
    out = Path(repo, *MINIFIED)
    rels = sorted(p.relative_to(front).as_posix() for p in front.rglob("*")
                  if p.is_file() and p.suffix.lower() in bs.MINIFIED)
    for rel in rels:
        (out / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(front / rel, out / rel)
    bs.minify(out, rels)
    for rel in rels:
        os.chmod(out / rel, 0o644)


def stage(cwd) -> int:
    """Stage exactly what is on disk, names' case included. On a
    case-insensitive disk (a Mac's, the config share) git would otherwise keep
    an old name's case: docs/screens.md replaced by docs/Screens.md stays
    screens.md in the index, and a link to Screens.md breaks on GitHub."""
    subprocess.call(["git", "rm", "-r", "-q", "--cached", "--ignore-unmatch", "."], cwd=cwd)
    return run(["git", "-c", "core.ignorecase=false", "add", "-A"], cwd)


def run(cmd, cwd) -> int:
    print("$", " ".join(cmd))
    return subprocess.call(cmd, cwd=cwd)


# ---- the GitHub release (--release). The changelog's headings are "## 1.14.2 - 2026-10-28" (or "## [1.14.2]"):
# a version's notes are what follows its heading, up to the next "## ".
HEADING = re.compile(r"^## \[?(\d+\.\d+\.\d+)\]?(?:[ \t]+-[ \t]+.*)?[ \t]*$", re.M)


def release_notes(changelog: str, version: str) -> str:
    """The notes of `version` in a changelog; ValueError when it has no section or the section is empty."""
    for m in HEADING.finditer(changelog):
        if m.group(1) == version:
            stop = changelog.find("\n## ", m.end())
            notes = changelog[m.end():stop if stop >= 0 else len(changelog)].strip()
            if not notes:
                raise ValueError(f"CHANGELOG.md's section for {version} is empty")
            return notes
    raise ValueError(f"CHANGELOG.md has no section '## {version}'")


def manifest_version(component: str) -> str:
    with open(os.path.join(component, "manifest.json"), encoding="utf-8") as f:
        return json.load(f)["version"]


def tag_taken(repo: str, tag: str) -> str | None:
    """Why `tag` cannot be made (it exists in the repository or on origin), else None."""
    if subprocess.run(["git", "tag", "-l", tag], cwd=repo, capture_output=True, text=True).stdout.strip():
        return f"the tag {tag} exists here"
    remote = subprocess.run(["git", "ls-remote", "--tags", "origin", f"refs/tags/{tag}"], cwd=repo,
                            capture_output=True, text=True)
    if remote.returncode != 0:
        return f"origin cannot be asked for its tags: {remote.stderr.strip()[:200]}"
    if remote.stdout.strip():
        return f"the tag {tag} exists on origin"
    return None


def check_release(repo: str, component: str) -> tuple[str, str, str]:
    """(version, tag, notes) for a release of this built repository, or SystemExit saying why not."""
    version = manifest_version(component)
    tag = f"v{version}"
    try:
        with open(os.path.join(repo, "CHANGELOG.md"), encoding="utf-8") as f:
            notes = release_notes(f.read(), version)
    except (OSError, ValueError) as e:
        raise SystemExit(f"no release: {e}")
    if why := tag_taken(repo, tag):
        raise SystemExit(f"no release: {why}")
    return version, tag, notes


def github_release(repo: str, name: str, version: str, tag: str, notes: str) -> int:
    """Tag HEAD, push the tag and release it, with the notes."""
    if run(["git", *AS_PUBLISHER, "tag", "-a", tag, "-m", f"{name} {version}"], repo) != 0:
        return 1
    if run(["git", "push", "origin", tag], repo) != 0:
        return 1
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "notes.md")
        with open(path, "w", encoding="utf-8") as f:
            f.write(notes + "\n")
        return run(["gh", "release", "create", tag, "--title", f"{name} {version}", "--notes-file", path,
                    "--verify-tag"], repo)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("repo", nargs="?")
    ap.add_argument("--scan", action="store_true")
    ap.add_argument("--commit")
    ap.add_argument("--push", action="store_true")
    ap.add_argument("--release", action="store_true",
                    help="after --push: tag v<manifest version> and make a GitHub release of it (gh), with the "
                         "CHANGELOG.md section's notes")
    ap.add_argument("--no-tests", action="store_true")
    ap.add_argument("--wiki")
    a = ap.parse_args()
    if a.release and not (a.commit and a.push):
        ap.error("--release needs --commit and --push")
    pairs = plan()
    pages = wiki_pages()
    hits = scan(pairs) + scan_texts(pages)
    if a.scan:
        print("\n".join(hits) if hits else "clean")
        return 2 if hits else 0
    if not a.repo:
        ap.error("REPO_DIR is required")
    if hits:
        print("PRIVATE DATA -- nothing was written:")
        print("\n".join(hits[:60]))
        return 2
    os.makedirs(a.repo, exist_ok=True)
    build(a.repo, pairs)
    print(f"built {len(pairs)} files in {a.repo}")
    if not a.no_tests:
        venv = os.path.expanduser("~/.venvs/hk-ha-test/bin/pytest")
        if run([venv, "-q", "-p", "no:cacheprovider"], os.path.join(a.repo, "tests", "py")) != 0:
            return 1
        if run([os.path.join(a.repo, "tests", "run")], a.repo) != 0:
            return 1
    if a.wiki:
        if not os.path.isdir(os.path.join(a.wiki, ".git")):
            ap.error("--wiki must be a clone of the Wiki's repository")
        build_wiki(a.wiki, pages)
        print(f"built {len(pages)} Wiki pages in {a.wiki}")
    if a.commit:
        if a.wiki:
            stage(a.wiki)
            if subprocess.call(["git", "diff", "--cached", "--quiet"], cwd=a.wiki) != 0 and \
                    run(["git", *AS_PUBLISHER, "commit", "-q", "-m", a.commit], a.wiki) != 0:
                return 1
        if not os.path.isdir(os.path.join(a.repo, ".git")):
            run(["git", "init", "-b", "main"], a.repo)
        stage(a.repo)
        release = check_release(a.repo, COMPONENT) if a.release else None     # before anything is committed or pushed
        if run(["git", *AS_PUBLISHER, "commit", "-q", "-m", a.commit], a.repo) != 0:
            return 1
        if a.push and run(["git", "push", "-u", "origin", "main", "--tags"], a.repo) != 0:
            return 1
        if release and github_release(a.repo, "HK Frontend", *release) != 0:
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
