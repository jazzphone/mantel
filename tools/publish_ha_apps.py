#!/usr/bin/env python3
"""Write Mantel's Home Assistant add-on repository (the `ha-apps` branch). docs/development/Releasing.md.

    python tools/publish_ha_apps.py OUT --version 0.1.36                      # a release: needs its CHANGELOG section
    python tools/publish_ha_apps.py OUT --version 0.1.36 --allow-unreleased   # a dry run: "Unreleased" will do

Home Assistant users add https://github.com/jazzphone/mantel#ha-apps in Settings -> Apps -> App store ->
Repositories (the Supervisor clones that one branch), install Mantel with one click and get **Update** when
a release raises config.yaml's version. OUT becomes that branch's whole tree:

    repository.yaml        name, url, maintainer (what the store lists the repository as)
    README.md              what the branch is, for someone who opens it on GitHub
    mantel/                the Mantel App: config.yaml, DOCS.md, README.md, CHANGELOG.md, icon.png, translations/
    mantel-connect/        the Mantel Connect App, the same files

Each config.yaml is packaging/<app>/config.yaml with an `image:` key added (ghcr.io/jazzphone/mantel-app-{arch}:
the Supervisor puts its own architecture in for {arch} and pulls <image>:<version>, which the release workflow
pushed) and the header comment about the LOCAL build replaced. CHANGELOG.md (Home Assistant shows it in the
update dialog) is the repository CHANGELOG.md's section for this version. There is no Dockerfile and no code in
OUT: the Supervisor pulls the published image and never builds. The local build-from-source App
(tools/stage_ha_app.py: packaging/ha-app/ as it is, no `image:`) is untouched by any of this.

The same rules as the stagers: the version must be Mantel's one version (tools/check_version.py); the published
config.yaml must pass tools/package_check.py's App checks (the image key aside); and before anything is moved
into OUT, everything in it goes through tools/stage_ha_app.py's private-content scan (HK_PRIVATE adds a home's
own words), which stops it on any finding. OUT must not exist (or be empty), and never inside the repository.
The release workflow (.github/workflows/release.yml) commits OUT alone and force-pushes it to `ha-apps`.
"""
from __future__ import annotations

import argparse
import importlib.util
import shutil
import sys
import tempfile
from pathlib import Path
from typing import NamedTuple

ROOT = Path(__file__).resolve().parents[1]
REPO_URL = "https://github.com/jazzphone/mantel"
BRANCH = "ha-apps"
MAINTAINER = "jazzphone"
REGISTRY = "ghcr.io/jazzphone"


def _load(name: str, file: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


stage = _load("mantel_stage_ha_app", "tools/stage_ha_app.py")
cv = _load("mantel_check_version", "tools/check_version.py")
pc = _load("mantel_package_check", "tools/package_check.py")


class App(NamedTuple):
    folder: str        # the folder in the add-on repository (the slug comes from config.yaml, not from this)
    src: str           # packaging/<...>: its config.yaml, DOCS.md and translations/
    image: str         # Home Assistant's per-architecture convention: {arch} is amd64 or aarch64
    guide: str         # docs/guide page linked from the folder's README.md
    check: str         # package_check's function for this App's config.yaml

    @property
    def image_names(self) -> dict[str, str]:
        return {arch: self.image.replace("{arch}", arch) for arch in ARCHES}


ARCHES = ("amd64", "aarch64")
ICON = "packaging/ha-app/icon.png"   # both Apps use the Mantel App's icon (stage_connect_app.py does too)
LOGO = "packaging/ha-app/logo.png"   # optional: the store shows it on the App's page when there is one
APPS = (
    App("mantel", "packaging/ha-app", f"{REGISTRY}/mantel-app-{{arch}}", "docs/guide/Install.md", "check_ha_app"),
    App("mantel-connect", "packaging/connect-app", f"{REGISTRY}/mantel-connect-app-{{arch}}",
        "docs/guide/Mantel-Connect.md", "check_connect_app"),
)
# Everything a published App folder may hold. No Dockerfile, requirements.txt or app/: nothing is built.
APP_FILES = {"config.yaml", "DOCS.md", "README.md", "CHANGELOG.md", "icon.png", "logo.png"}


class PublishError(Exception):
    pass


def published_config(text: str, app: App, version: str) -> str:
    """packaging/<app>/config.yaml with the header replaced and `image:` after `version:`."""
    lines = text.splitlines()
    start = 0
    while start < len(lines) and (lines[start].startswith("#") or not lines[start].strip()):
        start += 1
    header = [
        f"# Published in Mantel's add-on repository ({REPO_URL}#{BRANCH}) from {app.src}/config.yaml",
        f"# by tools/publish_ha_apps.py, release {version}. Don't edit it here: each release replaces this branch.",
        "# The Supervisor PULLS the image below, one per architecture, tagged with `version` (the release workflow",
        f"# pushed it); nothing is built. To build from source instead: {app.src}/ and docs/guide/Install.md.",
    ]
    body, done = [], False
    for line in lines[start:]:
        if line.startswith("image:"):
            raise PublishError(f"{app.src}/config.yaml already has an image: key; the source App is built locally")
        body.append(line)
        if not done and line.startswith("version:"):
            body.append(f"image: {app.image}")
            done = True
    if not done:
        raise PublishError(f"{app.src}/config.yaml has no version: line")
    return "\n".join(header + body) + "\n"


def _readme(app: App, doc: dict, version: str) -> str:
    return (f"# {doc.get('name')}\n\n{doc.get('description')}\n\n"
            f"Install, set up and update: [{Path(app.guide).stem.replace('-', ' ')}]({REPO_URL}/blob/v{version}/{app.guide}).\n"
            f"This folder is generated at each release from [{app.src}]({REPO_URL}/tree/v{version}/{app.src}).\n")


def _root_readme(version: str) -> str:
    return (f"# Mantel's Home Assistant add-on repository\n\n"
            f"In Home Assistant: **Settings** → **Apps** → **App store** → **⋮** → **Repositories**, add\n"
            f"`{REPO_URL}#{BRANCH}`, then install **Mantel**. Release {version}.\n\n"
            f"This branch is written by the release workflow (`tools/publish_ha_apps.py`) and replaced at every\n"
            f"release: don't edit it or open pull requests against it. Mantel itself: {REPO_URL}\n")


def plan(version: str, notes: str, root: Path = ROOT) -> dict[str, bytes | Path]:
    """{path in OUT: generated bytes, or the source file to copy}."""
    files: dict[str, bytes | Path] = {
        "repository.yaml": f"name: Mantel\nurl: {REPO_URL}\nmaintainer: {MAINTAINER}\n".encode(),
        "README.md": _root_readme(version).encode(),
    }
    for app in APPS:
        src = root / app.src
        config = published_config((src / "config.yaml").read_text(encoding="utf-8"), app, version)
        doc = pc.parse_yaml(config)
        files[f"{app.folder}/config.yaml"] = config.encode()
        files[f"{app.folder}/DOCS.md"] = src / "DOCS.md"
        files[f"{app.folder}/README.md"] = _readme(app, doc, version).encode()
        files[f"{app.folder}/CHANGELOG.md"] = f"# Changelog\n\n## {version}\n\n{notes}".encode()
        files[f"{app.folder}/icon.png"] = root / ICON
        if (root / LOGO).is_file():
            files[f"{app.folder}/logo.png"] = root / LOGO
        for t in sorted((src / "translations").glob("*.yaml")):
            files[f"{app.folder}/translations/{t.name}"] = t
    return files


def checks(tree: Path, version: str) -> list[str]:
    """What must hold for the written tree; [] when it may be published."""
    out = []
    for p in sorted(tree.rglob("*")):
        rel = p.relative_to(tree).as_posix()
        if p.is_dir() or rel in ("repository.yaml", "README.md"):
            continue
        folder, _, rest = rel.partition("/")
        if folder not in {a.folder for a in APPS} or not (rest in APP_FILES or
                                                          (rest.startswith("translations/") and rest.endswith(".yaml"))):
            out.append(f"{rel}: not something a published App folder holds (no Dockerfile, no code: the image is pulled)")
    for app in APPS:
        config = tree / app.folder / "config.yaml"
        doc = pc.parse_yaml(config.read_text(encoding="utf-8"))
        if doc.get("image") != app.image:
            out.append(f"{app.folder}/config.yaml: image must be {app.image}")
        if str(doc.get("version")) != version:
            out.append(f"{app.folder}/config.yaml: version {doc.get('version')!r} is not {version}")
        if sorted(doc.get("arch") or []) != sorted(ARCHES):
            out.append(f"{app.folder}/config.yaml: arch must be {', '.join(ARCHES)} (the images the workflow pushes)")
        # the App's own packaging rules, except the one that says a LOCAL App has no image
        out += [f"{app.folder}/config.yaml: {line}" for line in getattr(pc, app.check)(config)
                if not line.split(": ", 1)[-1].startswith(("no image", "image must not"))]
    hits = stage.scan([(p, p.relative_to(tree).as_posix()) for p in sorted(tree.rglob("*")) if p.is_file()])
    return out + [f"PRIVATE-CONTENT SCAN: {h}" for h in hits]


def publish(out: Path, version: str, allow_unreleased: bool = False, root: Path = ROOT) -> list[str]:
    """Write the add-on repository into OUT (new or empty). Returns its files; raises PublishError."""
    found = cv.problems(root=root)
    if found:
        raise PublishError("; ".join(found))
    current = cv.versions(root)[cv.SOURCE]
    if version != current:
        raise PublishError(f"--version {version} is not Mantel's version ({cv.SOURCE} says {current})")
    notes = cv.changelog_section(version, root)
    if notes is None and allow_unreleased:
        notes = cv.changelog_section("Unreleased", root)
    if notes is None:
        raise PublishError(f"CHANGELOG.md has no section for {version}" +
                           ("" if allow_unreleased else " (--allow-unreleased takes 'Unreleased', for a dry run)"))
    out = out.resolve()
    if out.is_relative_to(ROOT.resolve()) or out.is_relative_to(root.resolve()):
        raise PublishError("refusing to write the add-on repository inside the repository")
    if out.exists() and (not out.is_dir() or any(out.iterdir())):
        raise PublishError(f"{out} exists and is not empty")
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix=".mantel-ha-apps-", dir=out.parent))
    try:
        for rel, what in plan(version, notes, root).items():
            dest = tmp / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            if isinstance(what, Path):
                shutil.copyfile(what, dest)
            else:
                dest.write_bytes(what)
        found = checks(tmp, version)
        if found:
            raise PublishError(f"{len(found)} problem(s); nothing written:\n  " + "\n  ".join(found[:50]))
        if out.exists():
            out.rmdir()
        tmp.rename(out)
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    return sorted(p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file())


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("out", type=Path, help="the folder to write (it becomes the ha-apps branch)")
    p.add_argument("--version", required=True, help="the release's version (Mantel's one version, X.Y.Z)")
    p.add_argument("--allow-unreleased", action="store_true",
                   help="use CHANGELOG.md's Unreleased section when the version has none (dry runs only)")
    a = p.parse_args(argv)
    try:
        files = publish(a.out, a.version, a.allow_unreleased)
    except PublishError as e:
        print(f"publish_ha_apps: {e}", file=sys.stderr)
        return 1
    print(f"wrote {len(files)} files into {a.out.resolve()} (add-on repository for {a.version}; "
          "private-content scan clean)")
    for f in files:
        print("   ", f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
