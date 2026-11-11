#!/usr/bin/env python3
"""Assemble Mantel's Home Assistant App folder (a LOCAL App) from this repository. docs/phase3/HA-APP.md.

    python tools/stage_ha_app.py --dry-run              # list what would be staged + the private-content scan
    python tools/stage_ha_app.py TARGET                 # write a new folder (TARGET must not exist)
    python tools/stage_ha_app.py TARGET --replace       # replace a folder this tool staged before

The folder is what HA's Supervisor builds: packaging/ha-app/ (config.yaml, Dockerfile, DOCS.md,
README.md, requirements.txt, translations/, icon.png, logo.png) plus app/: packaging/docker/entrypoint.py,
hosts/server/mantel_server, hk_core, and web/ stamped with its build id by tools/build_static.py.

Nothing private goes in. Before writing anything the whole plan is scanned and staging stops on any
finding: no secret-shaped text (HA tokens, keys), no private-network addresses beyond the ones named
in ALLOWED_ADDRESSES, no font files at all (Apple's SF Pro and the glyphs are licensed: each home adds
its own through "Your files"), no captured fixtures, databases, key or token files. HK_PRIVATE (a
regex) adds a home's own words to the scan, as tools/build_ha.py does.

It never writes outside TARGET; with --replace it refuses a folder that has no stage marker.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_SRC = ROOT / "packaging/ha-app"
APP_FILES = ("config.yaml", "Dockerfile", "DOCS.md", "README.md", "requirements.txt", "icon.png",
             "logo.png", "translations/en.yaml")
MARKER = ".mantel-stage.json"

TEXT_SUFFIXES = {".py", ".js", ".mjs", ".json", ".yaml", ".yml", ".md", ".css", ".html", ".txt", ".sh", ".sql", ""}
FONT_SUFFIXES = {".woff", ".woff2", ".ttf", ".otf", ".eot"}
FORBIDDEN_NAME = re.compile(r"(^|/)(spikes|fixtures|secrets|\.env(\..*)?|.*\.(key|pem|db|sqlite3?|p12)|"
                            r".*token.*|hk-glyphs[^/]*|hk_local)(/|$)", re.I)
# Apple's font files themselves (SF-Pro.woff2, ...): any font suffix is refused below. HK's sf-pro.css
# only points at /hk/fonts/SF-Pro.* (served from "Your files" when a home has them) and is fine.
# THE OPEN FONTS (phase 20, docs/phase20/HOLIDAY-SLIDE.md): the Holiday slide's four scene fonts are under the SIL Open
# Font License (Google Fonts' files, cut by tools/holiday_art.py), free to redistribute -- the only font files the App may
# carry, each by its exact path and only with its license text beside it. Apple's fonts and the glyphs stay refused.
OPEN_FONTS = {"web/hk/holiday/fonts/vt323.woff2": "VT323-OFL.txt", "web/hk/holiday/fonts/cinzel.woff2": "Cinzel-OFL.txt",
              "web/hk/holiday/fonts/cabin-sketch-bold.woff2": "CabinSketch-OFL.txt", "web/hk/holiday/fonts/oswald-500.woff2": "Oswald-OFL.txt"}


def open_font(src: Path) -> bool:
    """`src` is one of the open fonts, its license beside it."""
    try:
        rel = src.resolve().relative_to(Path(__file__).resolve().parents[1]).as_posix()
    except ValueError:
        return False
    lic = OPEN_FONTS.get(rel)
    return bool(lic) and (src.parent / lic).is_file()


SKIP_PARTS = {"__pycache__", ".DS_Store", ".pytest_cache", "node_modules", ".git"}
PRIVATE = [
    r"\b192\.168\.\d{1,3}\.\d{1,3}\b", r"\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b",
    r"\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b",
    r"eyJ[A-Za-z0-9_-]{20,}", r"gh[pousr]_[A-Za-z0-9]{20,}", r"sk-[A-Za-z0-9]{20,}",
    r"AKIA[0-9A-Z]{16}", r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
]
# Addresses that are not a home's data, each where it may appear and why.
ALLOWED_ADDRESSES = {
    "172.30.32.2": "the Supervisor's fixed address on HA's hassio network (where Ingress comes from)",
    "172.30.32.1": "HA Core as the App sees it on the hassio network (linked mode's client; entrypoint)",
    "172.30.32.0": "HA's hassio network (172.30.32.0/23): never the LAN door on the direct port (direct.py, entrypoint)",
    "172.17.0.0": "Docker's default bridge (172.17.0.0/16): never the LAN door on the direct port (direct.py, entrypoint)",
    "10.0.0.0": "RFC 1918, direct.py's default home networks (built-in HTTPS)",
    "172.16.0.0": "RFC 1918, direct.py's default home networks (built-in HTTPS)",
    "192.168.0.0": "RFC 1918, direct.py's default home networks (built-in HTTPS)",
    "172.31.251.2": "Caddy's fixed backend address in Mantel's own compose file (entrypoint help text)",
}
ALLOWED_AT = {**{n: {"app/hosts/server/mantel_server/network/direct.py"} for n in ("10.0.0.0", "172.16.0.0", "192.168.0.0")}}


def _load_build_static():
    spec = importlib.util.spec_from_file_location("mantel_build_static", ROOT / "tools/build_static.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _tree(src: Path, dest: str, keep=lambda p: True) -> list[tuple[Path, str]]:
    out = []
    for p in sorted(src.rglob("*")):
        rel = p.relative_to(src)
        if not p.is_file() or any(part in SKIP_PARTS or part.startswith(".") for part in rel.parts):
            continue
        if p.suffix == ".pyc" or not keep(p):
            continue
        out.append((p, f"{dest}/{rel.as_posix()}"))
    return out


def plan() -> list[tuple[Path, str]]:
    """(source file, path inside the App folder) for every copied file (the build stamp comes after)."""
    pairs = [(APP_SRC / name, name) for name in APP_FILES]
    pairs.append((ROOT / "packaging/docker/entrypoint.py", "app/entrypoint.py"))
    # (static/dev.html is the developer's landing page, /dev, for a checkout: the App's web app is /home;
    # server.root and dev_page answer without it)
    pairs += _tree(ROOT / "hosts/server/mantel_server", "app/hosts/server/mantel_server",
                   keep=lambda p: p.name != "dev.html")
    # mantel_server.network.connect_pairing imports the pairing protocol (Mantel Connect, for a Mantel outside HA);
    # the code is imported by every server, so it ships in every image, switched off
    pairs += _tree(ROOT / "hosts/server/mantel_connect", "app/hosts/server/mantel_connect")
    # hk_core/link is Home Assistant's side (Mantel Link and HK Frontend vendor it); a server never imports it
    pairs += _tree(ROOT / "hk_core", "app/hk_core",
                   keep=lambda p: p.suffix in (".py", ".md", ".json") and (ROOT / "hk_core/link") not in p.parents)
    # /docs (docs_pages.py): HK's pages and Mantel's own, where config.py looks for them
    pairs += _tree(ROOT / "hosts/ha/custom_components/hk_frontend/docs", "app/help/hk")
    pairs.append((ROOT / "packaging/ha-app/DOCS.md", "app/help/Mantel.md"))
    bs = _load_build_static()
    web = ROOT / "web"
    pairs += [(p, "app/web/" + p.relative_to(web).as_posix())
              for p in sorted(web.rglob("*")) if bs._wanted(p, web)]
    return pairs


def scan(pairs: list[tuple[Path, str]]) -> list[str]:
    """Findings (``dest: reason``); never echoes a matching value beyond an allowed address."""
    extra = os.environ.get("HK_PRIVATE", "")
    pats = [re.compile(p, re.I) for p in PRIVATE + ([extra] if extra else [])]
    hits = []
    for src, dest in pairs:
        if FORBIDDEN_NAME.search(dest):
            hits.append(f"{dest}: a private kind of file (fixtures, secrets, keys, tokens, databases, Apple fonts/glyphs)")
            continue
        if src.suffix.lower() in FONT_SUFFIXES and not open_font(src):
            hits.append(f"{dest}: a font file (fonts are each home's own, through Your files)")
            continue
        if src.suffix.lower() not in TEXT_SUFFIXES or src.stat().st_size > 5_000_000:
            continue
        try:
            text = src.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for n, line in enumerate(text.splitlines(), 1):
            for pat in pats:
                for m in pat.finditer(line):
                    value = m.group(0)
                    if value in ALLOWED_ADDRESSES and dest in ALLOWED_AT.get(value, {dest}):
                        continue
                    kind = "a private-network address" if pat.pattern.startswith(r"\b1") else \
                        ("a home's own word (HK_PRIVATE)" if pat.pattern == extra else "a token or key")
                    hits.append(f"{dest}:{n}: {kind}")
    return hits


def summary(pairs: list[tuple[Path, str]]) -> dict:
    groups: dict[str, list[int]] = {}
    for src, dest in pairs:
        parts = dest.split("/")
        key = "/".join(parts[:2]) if parts[0] == "app" and len(parts) > 2 else parts[0]
        if key == "app/hosts":
            key = "app/hosts/server/mantel_server"
        g = groups.setdefault(key, [0, 0])
        g[0] += 1
        g[1] += src.stat().st_size
    return {k: {"files": v[0], "bytes": v[1]} for k, v in sorted(groups.items())}


def _commit() -> str:
    try:
        return subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"], capture_output=True,
                              text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def _app_version() -> str | None:
    import re
    m = re.search(r'^version:\s*"?([0-9A-Za-z.+-]{1,32})"?\s*$', (ROOT / "packaging/ha-app/config.yaml").read_text(), re.M)
    return m.group(1) if m else None


def write(target: Path, pairs: list[tuple[Path, str]], web_src: Path = ROOT / "web") -> dict:
    """Copy into a new sibling temp folder, stamp it, then move it into place."""
    bs = _load_build_static()
    target = target.resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix=".mantel-stage-", dir=target.parent))
    try:
        for src, dest in pairs:
            if dest.startswith("app/web/"):
                continue
            out = tmp / dest
            out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, out)
        stamp = Path(tempfile.mkdtemp(prefix="mantel-static-")) / "out"
        try:
            build_id = bs.build(web_src, stamp)
            shutil.copytree(stamp / "web", tmp / "app/web")
            shutil.copyfile(stamp / "BUILD_ID", tmp / "app/BUILD_ID")
            shutil.copyfile(stamp / "static-manifest.json", tmp / "app/static-manifest.json")
            # Mantel Settings -> About (about.py): the App's version, the commit and the build, in the image
            (tmp / "app/RELEASE.json").write_text(json.dumps({"version": _app_version(), "commit": _commit(),
                                                              "build": build_id, "staged": int(time.time())}) + "\n")
        finally:
            shutil.rmtree(stamp.parent, ignore_errors=True)
        digest = hashlib.sha256()
        for p in sorted(tmp.rglob("*")):
            if p.is_file():
                digest.update(p.relative_to(tmp).as_posix().encode() + b"\0" + p.read_bytes())
        info = {"tool": "tools/stage_ha_app.py", "commit": _commit(), "build": build_id,
                "files": sum(1 for p in tmp.rglob("*") if p.is_file()), "sha256": digest.hexdigest()}
        (tmp / MARKER).write_text(json.dumps(info, indent=1) + "\n")
        # modes do not depend on the stager's umask (077 would make an unreadable image): the Dockerfile's
        # COPY --chmod is the other half of this
        for p in [tmp, *tmp.rglob("*")]:
            if not p.is_symlink():
                p.chmod(0o755 if p.is_dir() else 0o644)
        old = None
        if target.exists():
            old = target.parent / (f".{target.name}.replaced-{os.getpid()}")
            target.rename(old)
        tmp.rename(target)
        if old is not None:
            shutil.rmtree(old)
        return info
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("target", nargs="?", type=Path, help="the App folder to create (e.g. <local apps share>/mantel)")
    p.add_argument("--dry-run", action="store_true", help="list and scan only; write nothing")
    p.add_argument("--replace", action="store_true", help="replace a folder this tool staged before")
    p.add_argument("--list", action="store_true", help="with --dry-run: print every file")
    a = p.parse_args(argv)
    if not a.dry_run and a.target is None:
        p.error("give a TARGET folder, or --dry-run")
    pairs = plan()
    hits = scan(pairs)
    total = sum(src.stat().st_size for src, _ in pairs)
    if a.dry_run:
        print(f"Mantel HA App: {len(pairs)} files, {total / 1e6:.1f} MB (+ BUILD_ID, static-manifest.json, {MARKER})")
        for key, v in summary(pairs).items():
            print(f"  {key:<34} {v['files']:>5} files {v['bytes'] / 1e6:>7.2f} MB")
        if a.list:
            for _, dest in pairs:
                print("   ", dest)
        if a.target is not None:
            print(f"would write: {a.target.resolve()}")
    if hits:
        print(f"PRIVATE-CONTENT SCAN: {len(hits)} finding(s); nothing written", file=sys.stderr)
        for h in hits[:50]:
            print("  " + h, file=sys.stderr)
        return 1
    print("private-content scan: clean (no secrets, no private addresses beyond the allowed ones, "
          "no fonts/glyphs, no fixtures)")
    if a.dry_run:
        return 0
    target = a.target.resolve()
    if target.exists():
        if not a.replace:
            print(f"{target} exists; pass --replace to replace a folder this tool staged", file=sys.stderr)
            return 2
        if not (target / MARKER).is_file():
            print(f"{target} was not staged by this tool ({MARKER} missing); refusing to replace it", file=sys.stderr)
            return 2
    try:
        target.relative_to(ROOT)
        print("refusing to stage inside the repository", file=sys.stderr)
        return 2
    except ValueError:
        pass
    info = write(target, pairs)
    print(f"staged {info['files']} files into {target} (build {info['build']}, commit {info['commit']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
