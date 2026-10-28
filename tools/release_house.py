#!/usr/bin/env python3
"""Put a release on the house: one command for what docs/development/Releasing.md "House releases" lists by hand.

    tools/release_house.py mantel 0.1.77 --notes notes.md      # the Mantel App
    tools/release_house.py hk-frontend 1.12.0                  # HK Frontend, copied into HA's config
    tools/release_house.py mantel-link 0.1.6                   # Mantel Link, likewise
    ... --dry-run                                              # every check, nothing written or sent
    tools/release_house.py hk-frontend 1.12.0 --github-release # also tag it and make its GitHub release (off by default)

Every product starts the same way: tools/ci.py's last run must be a green `full` run of HEAD (with nothing
uncommitted but LOCAL_ONLY), on main, not behind origin/main. Then:

* mantel: set the version (bump_version.py), add the release notes as a section below CHANGELOG.md's
  "## Unreleased", commit and push; stage the App into the local apps share (stage_ha_app.py --replace); through
  Home Assistant's websocket (supervisor/api), reload the store and update `local_mantel`; wait until Mantel's
  /api/version answers the staged build and /healthz?strict=1 is ok (through the App's Ingress); fail on any
  "Traceback" or "ERROR" in the App's log.
* hk-frontend / mantel-link: set the manifest version, commit and push; build (HK Frontend: tools/build_ha.py)
  and copy the component into the config share with rsync --inplace, never --delete (HA's Samba share half-fails
  without --inplace); check the copy with diff; restart Home Assistant and wait until it serves the new files.
  HK Frontend is then published to jazzphone/hk-frontend's main from a fresh clone (publish.py --commit --push).

With --github-release (hk-frontend and mantel-link only; never by default) the component's public repository
(jazzphone/hk-frontend, jazzphone/mantel-link: a fresh clone, publish.py --commit --push --release) also gets the tag
v<version> and a GitHub release, which HACS needs to offer the version: the notes are the version's section of
tools/publish/root/CHANGELOG.md in the component, which must already be committed, and the tag must not exist yet;
both are checked before anything is changed. mantel-link is otherwise not published by this tool at all.

Each release ends with a record in docs/development/House-releases.md, committed and pushed.

The Home Assistant address comes from ~/.config/mantel/house.json ({"ha_url": ...}) or $MANTEL_HA_URL; the
token, a long-lived token of an HA administrator, from the macOS Keychain (service mantel-ha-admin) or the file
~/.config/mantel/ha_admin_token, which only its owner may read. The token is never printed.
"""
from __future__ import annotations

import argparse
import asyncio
import datetime
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
CONFIG = Path.home() / ".config/mantel"
TOKEN_FILE = CONFIG / "ha_admin_token"
KEYCHAIN_SERVICE = "mantel-ha-admin"
PRIVATE_FILE = CONFIG / "private-words"
APPS_SHARE = Path("/Volumes/local_apps/mantel")
CONFIG_SHARE = Path("/Volumes/config/custom_components")
RECORD = ROOT / "docs/development/House-releases.md"
LOCAL_ONLY = ("apple/Mantel.xcodeproj/project.pbxproj",)    # the signing team: changed here, never committed
APP_SLUG = "local_mantel"
COMPONENTS = {
    "hk-frontend": {"dir": "hosts/ha/custom_components/hk_frontend", "domain": "hk_frontend",
                    "served": "/hk/panels/hk-settings.js", "public": "jazzphone/hk-frontend"},
    "mantel-link": {"dir": "hosts/ha/custom_components/mantel", "domain": "mantel",
                    "served": "/mantel_link/mantel-link.js?v={version}", "public": "jazzphone/mantel-link"},
}
COPY_EXCLUDES = ("tests", "docs", "tools", "README.md", "__pycache__")
VERSION = re.compile(r"^\d+\.\d+\.\d+$")


class Refused(Exception):
    """A check failed: nothing after it runs."""


def _load(name: str):
    spec = importlib.util.spec_from_file_location(f"mantel_{name}", ROOT / f"tools/{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run(*cmd: str, cwd: Path = ROOT, env: dict | None = None, quiet: bool = False) -> str:
    r = subprocess.run(cmd, cwd=cwd, env={**os.environ, **(env or {})}, capture_output=True, text=True)
    if r.returncode != 0:
        raise Refused(f"{' '.join(cmd[:3])} failed:\n{(r.stdout + r.stderr).strip()[-2000:]}")
    if not quiet and r.stdout.strip():
        print(r.stdout.strip())
    return r.stdout


def git(*args: str) -> str:
    return run("git", *args, quiet=True).strip()


# ---------------------------------------------------------------- checks before anything changes

def ci_green(record_path: Path, head: str) -> None:
    """The last tools/ci.py run was `full`, passed, ran on HEAD, and nothing but LOCAL_ONLY was uncommitted."""
    try:
        record = json.loads(record_path.read_text())
    except (OSError, ValueError):
        raise Refused("no tools/ci.py record: run `tools/ci.py full` first") from None
    if record.get("tier") != "full":
        raise Refused(f"the last check run was `{record.get('tier')}`, not `full`")
    if not record.get("ok"):
        failed = [s["name"] for s in record.get("steps", []) if s.get("status") == "failed"]
        raise Refused(f"the last full run failed: {', '.join(failed)}")
    if record.get("commit") != head:
        raise Refused(f"the last full run was on {str(record.get('commit'))[:9]}, not HEAD {head[:9]}")
    extra = [p for p in record.get("dirty", []) if p not in LOCAL_ONLY]
    if extra:
        raise Refused(f"the last full run had uncommitted changes: {', '.join(extra[:5])}")


def preflight(record_path: Path = ROOT / ".ci/last-run.json") -> str:
    if git("rev-parse", "--abbrev-ref", "HEAD") != "main":
        raise Refused("not on main")
    status = run("git", "status", "--porcelain", quiet=True)            # not stripped: " M" starts a line
    dirty = [ln[3:] for ln in status.splitlines() if ln[3:] not in LOCAL_ONLY]
    if dirty:
        raise Refused(f"uncommitted changes: {', '.join(dirty[:5])}")
    git("fetch", "-q", "origin")
    if git("rev-list", "--count", "HEAD..origin/main") != "0":
        raise Refused("main is behind origin/main: merge it and run the checks again")
    head = git("rev-parse", "HEAD")
    ci_green(record_path, head)
    return head


def private_regex() -> str:
    words = [ln.strip() for ln in PRIVATE_FILE.read_text().splitlines()
             if ln.strip() and not ln.lstrip().startswith("#")] if PRIVATE_FILE.exists() else []
    if not words:
        raise Refused(f"no private words in {PRIVATE_FILE}: the staging scan needs them")
    return "|".join(words)


def ha_url() -> str:
    url = os.environ.get("MANTEL_HA_URL")
    if not url:
        try:
            url = json.loads((CONFIG / "house.json").read_text()).get("ha_url")
        except (OSError, ValueError):
            url = None
    if not url:
        raise Refused(f'no Home Assistant address: set MANTEL_HA_URL or {CONFIG / "house.json"} {{"ha_url": ...}}')
    return url.rstrip("/")


def ha_token(token_file: Path = TOKEN_FILE, keychain: bool = True) -> str:
    """The admin token: the Keychain first, then the file, which no one but its owner may read."""
    if keychain and shutil.which("security"):
        r = subprocess.run(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
                           capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
    if token_file.exists():
        if token_file.stat().st_mode & 0o077:
            raise Refused(f"{token_file} can be read by others: chmod 600 it")
        token = token_file.read_text().strip()
        if token:
            return token
    raise Refused(f"no Home Assistant admin token: add one to the Keychain (service {KEYCHAIN_SERVICE}) "
                  f"or to {token_file}")


# ---------------------------------------------------------------- version and notes

def add_notes(changelog: Path, version: str, notes: str, today: datetime.date) -> None:
    """A `## X.Y.Z - date` section right after "## Unreleased"'s section (that one holds the next public notes)."""
    text = changelog.read_text()
    if re.search(rf"^## {re.escape(version)}\b", text, re.M):
        raise Refused(f"CHANGELOG.md already has a {version} section")
    start = text.find("\n## Unreleased")
    if start < 0:
        raise Refused('CHANGELOG.md has no "## Unreleased" section')
    nxt = text.find("\n## ", start + 1)
    nxt = len(text) if nxt < 0 else nxt
    section = f"\n## {version} - {today.isoformat()}\n\n{notes.strip()}\n"
    changelog.write_text(text[:nxt].rstrip("\n") + "\n" + section + text[nxt:])


def set_manifest_version(manifest: Path, version: str) -> None:
    text = manifest.read_text()
    new, n = re.subn(r'("version":\s*")[^"]*(")', rf"\g<1>{version}\g<2>", text, count=1)
    if n != 1:
        raise Refused(f"no version in {manifest}")
    manifest.write_text(new)


def append_record(record: Path, title: str, lines: list[str], today: datetime.date) -> None:
    if not record.exists():
        record.write_text("# House releases\n\nWhat `tools/release_house.py` put on the house, newest last, with "
                          "the checks it made. Earlier releases are recorded in the audits' pages.\n")
    body = "\n".join(f"- {ln}" for ln in lines)
    record.write_text(record.read_text().rstrip("\n") + f"\n\n## {title} ({today.isoformat()})\n\n{body}\n")


# ---------------------------------------------------------------- Home Assistant

class House:
    """Home Assistant over its websocket (supervisor/api for the Supervisor) and REST, as an administrator."""

    def __init__(self, url: str, token: str):
        self.url, self.token, self._id = url, token, 0
        self.session = self.ws = None

    async def __aenter__(self):
        import aiohttp
        self.session = aiohttp.ClientSession(headers={"Authorization": f"Bearer {self.token}"})
        try:
            self.ws = await self.session.ws_connect(f"{self.url}/api/websocket", heartbeat=30)
            await self.ws.receive_json()                                 # auth_required
            await self.ws.send_json({"type": "auth", "access_token": self.token})
            if (await self.ws.receive_json()).get("type") != "auth_ok":
                raise Refused("Home Assistant refused the token")
        except BaseException:
            await self.__aexit__()
            raise
        return self

    async def __aexit__(self, *exc):
        if self.ws is not None:
            await self.ws.close()
        if self.session is not None:
            await self.session.close()

    async def call(self, msg: dict, timeout: float = 60) -> object:
        self._id += 1
        await self.ws.send_json({"id": self._id, **msg})
        deadline = time.monotonic() + timeout
        while True:
            reply = await asyncio.wait_for(self.ws.receive_json(), max(0.1, deadline - time.monotonic()))
            if reply.get("id") == self._id and reply.get("type") == "result":
                if not reply.get("success"):
                    raise Refused(f"Home Assistant: {reply.get('error', {}).get('message', 'failed')}")
                return reply.get("result")

    async def supervisor(self, endpoint: str, method: str = "get", timeout: int = 60) -> object:
        return await self.call({"type": "supervisor/api", "endpoint": endpoint, "method": method,
                                "timeout": timeout}, timeout=timeout + 15)

    async def get(self, path: str, **kw) -> tuple[int, str]:
        try:
            async with self.session.get(f"{self.url}{path}", **kw) as r:
                return r.status, await r.text()
        except Exception as e:                                          # noqa: BLE001 (HA restarting)
            return 0, str(e)

    async def wait_for(self, check, what: str, timeout: float = 300, every: float = 5) -> object:
        deadline = time.monotonic() + timeout
        last = None
        while time.monotonic() < deadline:
            try:
                last = await check()
                if last:
                    return last
            except Exception as e:                                      # noqa: BLE001
                last = e
            await asyncio.sleep(every)
        raise Refused(f"timed out waiting for {what} ({last})")


def log_problems(log: str) -> list[str]:
    return [ln.strip() for ln in log.splitlines() if "Traceback" in ln or re.search(r"\bERROR\b", ln)]


async def update_app(house: House, build: str) -> dict:
    await house.supervisor("/store/reload", "post")
    await house.supervisor(f"/store/addons/{APP_SLUG}/update", "post", timeout=1200)
    info = await house.supervisor(f"/addons/{APP_SLUG}/info")
    session = (await house.supervisor("/ingress/session", "post"))["session"]
    base = info["ingress_entry"]
    cookies = {"ingress_session": session}

    async def version():
        code, text = await house.get(f"{base}/api/version", cookies=cookies)
        return code == 200 and json.loads(text).get("build") == build and text

    await house.wait_for(version, f"Mantel to answer build {build}")

    async def healthy():
        code, text = await house.get(f"{base}/healthz?strict=1", cookies=cookies)
        return code == 200 and json.loads(text)

    health = await house.wait_for(healthy, "Mantel's strict health")
    await asyncio.sleep(20)                                              # the log of its first moments
    code, log = await house.get(f"/api/hassio/addons/{APP_SLUG}/logs")
    if code != 200:
        raise Refused(f"could not read the App's log ({code})")
    problems = log_problems(log)
    if problems:
        raise Refused("the App's log has errors:\n  " + "\n  ".join(problems[:10]))
    return {"version": info.get("version"), "health": health}


async def restart_and_wait(house: House, served: str) -> None:
    # sent, not awaited: Home Assistant may close the socket before it answers a restart
    house._id += 1
    await house.ws.send_json({"id": house._id, "type": "call_service", "domain": "homeassistant",
                              "service": "restart"})
    await asyncio.sleep(15)

    async def back():
        code, _ = await house.get(served)
        return code == 200

    await house.wait_for(back, f"Home Assistant to serve {served}", timeout=600)


# ---------------------------------------------------------------- the releases

def release_mantel(version: str, notes: str, dry: bool) -> list[str]:
    today = datetime.date.today()
    head = preflight()
    regex = private_regex()
    url, token = ha_url(), ("" if dry else ha_token())
    print(f"Mantel {version} from {head[:9]} to {url}")
    if dry:
        print("dry run: would bump, add the notes, commit, push, stage, update and verify")
        run(sys.executable, "tools/stage_ha_app.py", "--dry-run", env={"HK_PRIVATE": regex})
        return []
    _load("bump_version").set_version(version)
    add_notes(ROOT / "CHANGELOG.md", version, notes, today)
    run(sys.executable, "tools/check_version.py", "--tag", f"v{version}")
    commit_only(f"Release {version} to the house", "CHANGELOG.md", *_load("check_version").FILES)
    commit = git("rev-parse", "HEAD")
    git("push", "-q", "--no-verify", "origin", "main")       # HEAD's full run passed; this commit only versions
    out = run(sys.executable, "tools/stage_ha_app.py", str(APPS_SHARE), "--replace", env={"HK_PRIVATE": regex})
    build = re.search(r"\(build (\S+),", out).group(1)

    async def go():
        async with House(url, token) as house:
            return await update_app(house, build)

    result = asyncio.run(go())
    return [f"Mantel {result['version']}, commit `{commit[:7]}`, build `{build}`.",
            f"Strict health ok; Home Assistant connected for {result['health']['upstream']['home_assistant']['connected_for_s']} s.",
            "No \"Traceback\" or \"ERROR\" in the App's log."]


def check_github_release(product: str, version: str) -> None:
    """--github-release: the version has notes in the component's changelog, and its tag is free on GitHub."""
    spec = COMPONENTS[product]
    src = ROOT / spec["dir"]
    pub = _load_path(f"publish_{spec['domain']}", src / "tools/publish/publish.py")
    hk = pub if product == "hk-frontend" else _load_path(
        "publish_hk_frontend", ROOT / COMPONENTS["hk-frontend"]["dir"] / "tools/publish/publish.py")
    try:
        hk.release_notes((src / "tools/publish/root/CHANGELOG.md").read_text(encoding="utf-8"), version)
    except (OSError, ValueError) as e:
        raise Refused(f"no GitHub release: {e} (add and commit it first)") from None
    tag = f"v{version}"
    r = subprocess.run(["git", "ls-remote", "--tags", f"https://github.com/{spec['public']}.git", f"refs/tags/{tag}"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise Refused(f"cannot ask {spec['public']} for its tags: {r.stderr.strip()[:200]}")
    if r.stdout.strip():
        raise Refused(f"no GitHub release: {spec['public']} has the tag {tag} already")


def _load_path(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def release_component(product: str, version: str, dry: bool, github_release: bool = False) -> list[str]:
    today = datetime.date.today()
    spec = COMPONENTS[product]
    head = preflight()
    regex = private_regex()
    url, token = ha_url(), ("" if dry else ha_token())
    src = ROOT / spec["dir"]
    dest = CONFIG_SHARE / spec["domain"]
    if not dest.parent.is_dir():
        raise Refused(f"{dest.parent} is not mounted")
    print(f"{product} {version} from {head[:9]} into {dest}")
    if github_release:
        check_github_release(product, version)
    if dry:
        print("dry run: would set the manifest version, commit, push, build, copy, diff, restart and verify"
              + (f", then publish to {spec['public']} and release v{version}" if github_release else ""))
        return []
    set_manifest_version(src / "manifest.json", version)
    commit_only(f"{product} {version} to the house", f"{spec['dir']}/manifest.json")
    commit = git("rev-parse", "HEAD")
    git("push", "-q", "--no-verify", "origin", "main")
    with tempfile.TemporaryDirectory(prefix="mantel-house-") as tmp:
        if product == "hk-frontend":
            run(sys.executable, "tools/build_ha.py", f"{tmp}/ha", env={"HK_PRIVATE": regex})
            built = Path(tmp) / "ha/custom_components" / spec["domain"]
        else:
            built = src
        excludes = [a for x in COPY_EXCLUDES for a in ("--exclude", x)]
        run("rsync", "-rt", "--inplace", *excludes, f"{built}/", f"{dest}/")
        diff = subprocess.run(["diff", "-rq", *[a for x in COPY_EXCLUDES for a in ("-x", x)], str(built), str(dest)],
                              capture_output=True, text=True).stdout
        differs = [ln for ln in diff.splitlines() if not ln.startswith(f"Only in {dest}")]
        if differs:
            raise Refused("the copy differs from the build:\n  " + "\n  ".join(differs[:10]))

        async def go():
            async with House(url, token) as house:
                await restart_and_wait(house, spec["served"].format(version=version))

        asyncio.run(go())
        lines = [f"{product} {version}, commit `{commit[:7]}`, copied with rsync --inplace; diff -rq shows no "
                 "difference.", f"Home Assistant restarted and serves `{spec['served'].format(version=version)}`."]
        if product == "hk-frontend" or github_release:
            name = "HK Frontend" if product == "hk-frontend" else "Mantel Link"
            clone = Path(tmp) / "public"
            run("git", "clone", "-q", f"https://github.com/{spec['public']}.git", str(clone))
            run(sys.executable, str(src / "tools/publish/publish.py"), str(clone),
                "--commit", f"{name} {version} (from mantel {commit[:7]})", "--push",
                *(["--release"] if github_release else []), env={"HK_PRIVATE": regex})
            lines.append(f"Published to {spec['public']} main as `{git_in(clone, 'rev-parse', '--short', 'HEAD')}`, "
                         + (f"tagged `v{version}` and released on GitHub." if github_release else "untagged."))
    return lines


def commit_only(message: str, *paths: str) -> None:
    """Commit these files and nothing else (never `-a`: LOCAL_ONLY files stay out)."""
    git("commit", "-q", "-m", f"{message}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>", "--", *paths)


def git_in(repo: Path, *args: str) -> str:
    return run("git", *args, cwd=repo, quiet=True).strip()


def record(title: str, lines: list[str]) -> None:
    today = datetime.date.today()
    append_record(RECORD, title, lines, today)
    git("add", str(RECORD.relative_to(ROOT)))
    commit_only(f"Record {title} on the house", str(RECORD.relative_to(ROOT)))
    git("push", "-q", "--no-verify", "origin", "main")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("product", choices=("mantel", *COMPONENTS))
    ap.add_argument("version")
    ap.add_argument("--notes", type=Path, help="mantel: the release notes (Markdown bullets) for CHANGELOG.md")
    ap.add_argument("--dry-run", action="store_true", help="make every check; write and send nothing")
    ap.add_argument("--github-release", action="store_true",
                    help="hk-frontend, mantel-link: also publish the public repository, tag v<version> and make its "
                         "GitHub release (needs the version's section in the component's CHANGELOG.md); off by default")
    args = ap.parse_args(argv)
    if not VERSION.match(args.version):
        print("the version is X.Y.Z", file=sys.stderr)
        return 2
    if args.github_release and args.product == "mantel":
        print("--github-release is for hk-frontend and mantel-link (Mantel's own release is the release workflow's)",
              file=sys.stderr)
        return 2
    try:
        if args.product == "mantel":
            notes = args.notes.read_text() if args.notes else ""
            if not notes.strip() and not args.dry_run:
                raise Refused("a Mantel release needs --notes")
            lines = release_mantel(args.version, notes, args.dry_run)
            title = f"Mantel {args.version}"
        else:
            lines = release_component(args.product, args.version, args.dry_run, args.github_release)
            title = f"{'HK Frontend' if args.product == 'hk-frontend' else 'Mantel Link'} {args.version}"
        if not args.dry_run:
            record(title, lines)
            print("\n".join(lines))
    except Refused as e:
        print(f"refused: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
