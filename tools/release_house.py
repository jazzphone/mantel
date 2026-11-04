#!/usr/bin/env python3
"""Put a release on the house and publish it: one command per product (docs/development/Releasing.md).

    tools/release_house.py mantel 0.1.121                      # Mantel to the LXC, then published (notes: Unreleased)
    tools/release_house.py mantel 0.1.121 --dry-run            # every check (a read-only look at the LXC), nothing sent
    tools/release_house.py mantel 0.1.121 --retry              # an attempt that stopped before its tag, again
    tools/release_house.py plan                                # what changed since each product's last release
    tools/release_house.py all                                 # every product that changed, next patch versions
    tools/release_house.py hk-frontend 1.41.0                  # HK Frontend, copied into HA's config
    tools/release_house.py mantel-link 0.1.13                  # Mantel Link, likewise
    tools/release_house.py backfill-tags                       # once: hk-frontend/v*, mantel-link/v* from the public repos
    ... --from-origin                                          # from a clean worktree at origin/main (detached)

Every product starts the same way: on main (or --from-origin: a worktree whose HEAD is origin/main), nothing
uncommitted but LOCAL_ONLY, not behind origin/main, and a passed whole `tools/ci.py full` run that speaks for HEAD
(tools/ci.py's passed runs, kept by tree): one of HEAD itself, or of a commit HEAD differs from only in version lines
and changelogs (ci.py VERSION_FILES, CHANGELOGS: what a release commits) -- then `tools/ci.py versions`, what reads
those files, must pass on HEAD first, instead of a second full run. Each release commit the tool makes passes
`versions` before it is pushed. The notes are each changelog's "## Unreleased" (empty: refused), which the release
names "## X.Y.Z - date", with a new empty "## Unreleased" above it. Then:

* mantel (phase 15, house first; docs/phase15/FASTER-RELEASES.md): bump, commit and push to main; push the same commit
  to release/X.Y.Z and run release.yml stage=images from it (the images tagged X.Y.Z only); once they are pushed,
  `update` the LXC to exactly that commit (MANTEL_UPDATE_REF, over SSH: ~/.config/mantel/house.json "lxc_ssh" and
  "lxc_key"; hand changes there refuse unless --save-and-revert-hand-changes), and check it: every service healthy,
  mantel-server built from the commit, /healthz?strict=1 200 with Home Assistant connected, no "Traceback" or "ERROR"
  in Mantel's log. Then the Linux suite of that run (rerun once if it failed), and only then the tag v<version>,
  release.yml stage=promote from it (`latest`, the ha-apps branch), the GitHub Release, and release/X.Y.Z deleted.
  A failure before the tag leaves no tag, no `latest`, no ha-apps change and no Release. No Home Assistant token.
* mantel --ha-app: the release for a home that runs the Home Assistant App (the house's way before 2026-11-02):
  stage it into the local apps share, update `local_mantel` through the Supervisor (the admin token), check it, tag,
  then release.yml stage=all from the tag and the GitHub Release (unless --no-publish).
* hk-frontend / mantel-link: set the manifest version and name the component's changelog section, commit and push;
  build (HK Frontend: tools/build_ha.py; Mantel Link: its publish.py, whose layout vendors the hk_core modules it
  imports) and copy the component into the config share with rsync --inplace, never --delete (HA's Samba share
  half-fails without --inplace); check the copy with diff; restart Home Assistant and wait until it serves the new
  files; tag the commit hk-frontend/v<version> or mantel-link/v<version>. HK Frontend is then published to
  jazzphone/hk-frontend's main from a fresh clone (publish.py --commit --push, its Wiki pushed when publish.py
  committed to it), with --no-tests when the full run ran the suites publish.py would run again (PUBLISH_SUITES).

With --github-release (hk-frontend and mantel-link; `all` always does it) the component's public repository also gets
the tag v<version> and a GitHub release, which HACS needs to offer the version.

`plan` says, per product, the last release (Mantel's newest v* tag; hk-frontend/v*, mantel-link/v*) and the files
changed since in what the product is built from, version lines and changelogs not counted. `all` releases the changed
ones in the order Mantel, HK Frontend, Mantel Link (the next patch version, or --versions mantel=0.1.121,...).

Each release ends with a record in docs/development/House-releases.md, committed and pushed, with its times.

The Home Assistant address (components, --ha-app) comes from ~/.config/mantel/house.json ({"ha_url": ...}) or
$MANTEL_HA_URL; the token, a long-lived token of an HA administrator, from the macOS Keychain (service
mantel-ha-admin) or the file ~/.config/mantel/ha_admin_token, which only its owner may read. The token, the LXC's
address and its key's path are never printed or recorded.
"""
from __future__ import annotations

import argparse
import asyncio
import datetime
import importlib.util
import json
import os
import re
import shlex
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
APP_SLUG = "local_mantel"
COMPONENTS = {
    "hk-frontend": {"dir": "hosts/ha/custom_components/hk_frontend", "domain": "hk_frontend",
                    "served": "/hk/panels/hk-settings.js", "public": "jazzphone/hk-frontend"},
    "mantel-link": {"dir": "hosts/ha/custom_components/mantel", "domain": "mantel",
                    "served": "/mantel_link/mantel-link.js?v={version}", "public": "jazzphone/mantel-link"},
}
# THE PUBLISHERS' SUITES, ALREADY RUN (2026-11-01). publish.py runs the component's suites in the repository it
# builds; the full run that speaks for HEAD ran the same: HK Frontend's two in tools/build_ha.py's build, which is
# publish.py's own plan and build; Mantel Link's in the main suite's tests/test_mantel_link.py, which builds its
# published layout and runs the suite there -- or skips without Home Assistant's test venv, which hk-frontend-py
# needs as well, so its pass says the venv was there. Both passed: --no-tests.
PUBLISH_SUITES = {"hk-frontend": ("hk-frontend-py", "hk-frontend-js"), "mantel-link": ("main-suite", "hk-frontend-py")}
COPY_EXCLUDES = ("tests", "docs", "tools", "README.md", "__pycache__")
VERSION = re.compile(r"^\d+\.\d+\.\d+$")


class Refused(Exception):
    """A check failed: nothing after it runs."""


class JobFailed(Refused):
    """A job of a release.yml run finished failed or cancelled (not an error asking GitHub)."""


def _load(name: str):
    spec = importlib.util.spec_from_file_location(f"mantel_{name}", ROOT / f"tools/{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module          # (ci.py's dataclasses look their module up there)
    spec.loader.exec_module(module)
    return module


CI = _load("ci")                     # tools/ci.py: its passed runs, and what a release commit may change
LOCAL_ONLY = CI.LOCAL_ONLY           # the signing team: changed here, never committed


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

def ci_green(head: str, store: Path | None = None, root: Path = ROOT) -> tuple[dict, str]:
    """The passed whole full run that speaks for HEAD, and how: "same" (it ran on HEAD) or "versions" (HEAD differs
    from its commit only in versions and changelogs: `tools/ci.py versions` must pass on HEAD first). tools/ci.py
    keeps only whole runs on a clean, unchanging tree, and a failed run of a tree takes its passes away."""
    found, how = CI.full_run_for(head, store or CI.store_path(), root)
    if found is None:
        raise Refused(how)
    return found, how


def recheck(store: Path | None = None) -> None:
    """`tools/ci.py versions` on HEAD (the private words in what is committed and in the new commit messages, the
    versions, the links, the package, and the main suite's files that read a version file or a changelog), unless it
    already passed on this very commit."""
    head, tree, _ = CI.git_state(ROOT)
    done = CI.passed_tree(tree, store or CI.store_path(), ("versions",))
    if done and done["commit"] == head:
        print(f"tools/ci.py versions passed on HEAD already ({done['finished']}).")
        return
    start = time.monotonic()
    run(CI.python(), "tools/ci.py", "versions", quiet=True)
    print(f"tools/ci.py versions passed on HEAD ({time.monotonic() - start:.0f} s).")


def preflight(store: Path | None = None, from_origin: bool = False) -> tuple[str, dict]:
    """--from-origin: a clean worktree whose HEAD is origin/main (detached; other sessions work on the shared
    checkout, and a worktree can't check out main twice), with its own tools/node_modules. Else: on main."""
    if from_origin:
        git("fetch", "-q", "origin")
        if git("rev-parse", "HEAD") != git("rev-parse", "origin/main"):
            raise Refused("--from-origin needs HEAD at origin/main: `git checkout --detach origin/main` in a worktree")
        modules = ROOT / "tools/node_modules"
        if modules.is_symlink() or not modules.is_dir():
            print("tools/node_modules isn't this worktree's own: npm ci --prefix tools ...")
            if modules.is_symlink():
                modules.unlink()
            run("npm", "ci", "--prefix", "tools", "--no-audit", "--no-fund", quiet=True)
    elif git("rev-parse", "--abbrev-ref", "HEAD") != "main":
        raise Refused("not on main (or, in a worktree at origin/main, --from-origin)")
    status = run("git", "status", "--porcelain", quiet=True)            # not stripped: " M" starts a line
    dirty = [ln[3:] for ln in status.splitlines() if ln[3:] not in LOCAL_ONLY]
    if dirty:
        raise Refused(f"uncommitted changes: {', '.join(dirty[:5])}")
    git("fetch", "-q", "origin")
    if git("rev-list", "--count", "HEAD..origin/main") != "0":
        raise Refused("main is behind origin/main: merge it and run the checks again")
    head = git("rev-parse", "HEAD")
    found, how = ci_green(head, store)
    if how == "same":
        print(f"The full run of HEAD passed ({found['finished']}).")
    else:
        print(f"The full run of {found['commit'][:9]} ({found['finished']}) speaks for HEAD {head[:9]}: only versions "
              "and changelogs changed since. Checking what reads them (tools/ci.py versions) ...")
        recheck(store)
    return head, found


def publish_tests(found: dict, product: str) -> list[str]:
    """publish.py's --no-tests when the full run that speaks for HEAD ran its suites (PUBLISH_SUITES), else nothing.
    (A suite unchanged in that run passed on the same inputs earlier: tools/ci.py's step keys.)"""
    steps = found.get("steps", {})
    return ["--no-tests"] if all(steps.get(n) in ("passed", "unchanged") for n in PUBLISH_SUITES[product]) else []


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

def check_tag_free(version: str) -> None:
    """A Mantel release's tag v<version> is not here or on GitHub yet."""
    tag = f"v{version}"
    if git("tag", "-l", tag):
        raise Refused(f"the tag {tag} exists here already")
    r = subprocess.run(["git", "ls-remote", "--tags", "origin", f"refs/tags/{tag}"], cwd=ROOT,
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise Refused(f"cannot ask origin for its tags: {r.stderr.strip()[:200]}")
    if r.stdout.strip():
        raise Refused(f"origin has the tag {tag} already")


def tag_release(version: str, commit: str) -> str:
    """Tag the release commit v<version> (annotated) and push only that tag."""
    tag = f"v{version}"
    git("tag", "-a", tag, "-m", f"Mantel {version}", commit)
    git("push", "-q", "--no-verify", "origin", f"refs/tags/{tag}")
    return tag


def changelog_section(changelog: Path, version: str) -> str:
    """The body of CHANGELOG.md's `## X.Y.Z` (or `## [X.Y.Z]`) section, without its heading."""
    m = re.search(rf"^## \[?{re.escape(version)}\]?[^\n]*\n(.*?)(?=^## |\Z)", changelog.read_text(), re.M | re.S)
    if not m or not m.group(1).strip():
        raise Refused(f"no section '## {version}' with notes in {changelog.name}")
    return m.group(1).strip() + "\n"


RELEASE_FOOTER = """
**Install or update:** the Home Assistant App from `https://github.com/jazzphone/mantel#ha-apps`; Docker with the
images `ghcr.io/jazzphone/mantel-server`, `mantel-transcode` and `mantel-caddy` tagged `{version}` (`./update.sh`);
the Proxmox LXC with `update` in the container. See [Updating](https://github.com/jazzphone/mantel/blob/main/docs/guide/Updating.md).
"""


def publish_release(version: str, notes: str, wait_s: float = 120) -> list[str]:
    """Run release.yml from the tag with publish on, wait for it, then make the GitHub Release. A failed run makes
    no Release: the house and the tag stand, and the run can be run again from the tag (Releasing.md)."""
    tag = f"v{version}"
    run("gh", "workflow", "run", "release.yml", "--ref", tag, "-f", "publish=true", quiet=True)
    run_id = url = ""
    deadline = time.monotonic() + wait_s
    while not run_id and time.monotonic() < deadline:
        time.sleep(5)
        listed = json.loads(run("gh", "run", "list", "--workflow", "release.yml", "--branch", tag, "-L", "1",
                                "--json", "databaseId,url", quiet=True) or "[]")
        if listed:
            run_id, url = str(listed[0]["databaseId"]), listed[0]["url"]
    if not run_id:
        raise Refused(f"the release workflow for {tag} did not start: run it from the tag by hand (Releasing.md)")
    print(f"release workflow {url}: waiting (about 20 minutes)")
    if subprocess.run(["gh", "run", "watch", run_id, "--exit-status", "--interval", "30"], cwd=ROOT,
                      capture_output=True).returncode != 0:
        raise Refused(f"the release workflow failed ({url}): nothing was published past the tag; "
                      "fix it and run it again from the tag")
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as f:
        f.write(notes + RELEASE_FOOTER.format(version=version))
    try:
        run("gh", "release", "create", tag, "--title", f"Mantel {version}", "--notes-file", f.name, "--verify-tag",
            quiet=True)
    finally:
        os.unlink(f.name)
    return [f"Published: the release workflow ({url}) pushed the images and the ha-apps branch; "
            f"GitHub Release `{tag}` made."]


def release_mantel_ha_app(version: str, notes: str, dry: bool, publish: bool = True) -> list[str]:
    """--ha-app: the release for a home that runs Mantel as the Home Assistant App (before phase 15, the house's
    own way): stage it, update `local_mantel` through the Supervisor, tag, then release.yml stage=all from the tag."""
    today = datetime.date.today()
    head, _ = preflight()
    check_tag_free(version)
    regex = private_regex()
    url, token = ha_url(), ("" if dry else ha_token())
    print(f"Mantel {version} from {head[:9]} to {url}")
    if dry:
        print("dry run: would bump, add the notes, commit, check it (tools/ci.py versions), push, stage, update, "
              f"verify, and tag v{version}" + (", then publish it and make its GitHub Release" if publish else ""))
        run(sys.executable, "tools/stage_ha_app.py", "--dry-run", env={"HK_PRIVATE": regex})
        return []
    _load("bump_version").set_version(version)
    add_notes(ROOT / "CHANGELOG.md", version, notes, today)
    run(sys.executable, "tools/check_version.py", "--tag", f"v{version}")
    commit_only(f"Release {version} to the house", "CHANGELOG.md", *_load("check_version").FILES)
    commit = git("rev-parse", "HEAD")
    recheck()                                                 # the notes and the version, before they leave
    git("push", "-q", "--no-verify", "origin", "HEAD:refs/heads/main")       # the full run speaks for it, and `versions` passed
    out = run(sys.executable, "tools/stage_ha_app.py", str(APPS_SHARE), "--replace", env={"HK_PRIVATE": regex})
    build = re.search(r"\(build (\S+),", out).group(1)

    async def go():
        async with House(url, token) as house:
            return await update_app(house, build)

    result = asyncio.run(go())
    tag = tag_release(version, commit)                        # only once the house runs it, healthy
    published = publish_release(version, changelog_section(ROOT / "CHANGELOG.md", version)) if publish else []
    return [f"Mantel {result['version']}, commit `{commit[:7]}`, build `{build}`, tagged `{tag}`.", *published,
            f"Strict health ok; Home Assistant connected for {result['health']['upstream']['home_assistant']['connected_for_s']} s.",
            "No \"Traceback\" or \"ERROR\" in the App's log."]


# ---------------------------------------------------------------- the LXC (phase 15: the house runs Mantel there)

LXC_DIR = "/opt/mantel"
COMPOSE_DIR = f"{LXC_DIR}/packaging/compose"
COMMIT = re.compile(r"^[0-9a-f]{40}$")
PIN = re.compile(r"^[A-Za-z0-9._/-]+$")                  # a branch, tag or commit, as mantel.ref holds one
# Mantel's strict health from inside its container: Caddy doesn't forward /healthz from outside
HEALTH_PY = ("import urllib.request, urllib.error\n"
             "try:\n"
             "    r = urllib.request.urlopen('http://127.0.0.1:8765/healthz?strict=1', timeout=10)\n"
             "    print(r.status); print(r.read().decode())\n"
             "except urllib.error.HTTPError as e:\n"
             "    print(e.code); print(e.read().decode())\n")


def house_settings() -> dict:
    try:
        return json.loads((CONFIG / "house.json").read_text())
    except (OSError, ValueError):
        return {}


class Lxc:
    """The house's Mantel on its Proxmox LXC, over SSH as root (`ssh -i <key> -o BatchMode=yes
    -o StrictHostKeyChecking=yes`). Every command goes through `runner(command, timeout) -> (status, output)`, which
    the tests replace. What it prints and what the record says name "the LXC", never its address or the key."""

    def __init__(self, target: str, key: str, runner=None, settle: float = 20, every: float = 10):
        self.target, self.key = target, os.path.expanduser(key)
        self.runner = runner or self._ssh
        self.settle, self.every = settle, every

    @classmethod
    def from_settings(cls, settings: dict | None = None, **kw) -> "Lxc":
        s = house_settings() if settings is None else settings
        if not s.get("lxc_ssh") or not s.get("lxc_key"):
            raise Refused(f'no LXC to release to: add "lxc_ssh" ("root@<its address>") and "lxc_key" (the key file) '
                          f'to {CONFIG / "house.json"}')
        return cls(s["lxc_ssh"], s["lxc_key"], **kw)

    def _ssh(self, command: str, timeout: float) -> tuple[int, str]:
        cmd = ["ssh", "-i", self.key, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
               "-o", "ConnectTimeout=15", self.target, command]
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            return 124, f"no answer in {timeout:.0f} s"
        return r.returncode, r.stdout + r.stderr

    def scrub(self, text: str) -> str:
        """The LXC's address and the key's path never leave this class."""
        host = self.target.split("@")[-1]
        for secret, word in ((self.target, "the LXC"), (host, "the LXC"), (self.key, "<key>")):
            if secret:
                text = text.replace(secret, word)
        return text

    def run(self, command: str, timeout: float = 120, check: bool = True) -> str:
        code, out = self.runner(command, timeout)
        out = self.scrub(out)
        if check and code != 0:
            raise Refused(f"on the LXC, `{self.scrub(command)[:80]}` failed ({code}):\n{out.strip()[-1500:]}")
        return out

    # ---- what it runs

    def head(self) -> str:
        return self.run(f"git -C {LXC_DIR} rev-parse HEAD").strip()

    def previous(self) -> tuple[str, str]:
        """The version and commit the LXC runs now."""
        out = self.run(f"git -C {LXC_DIR} rev-parse HEAD && git -C {LXC_DIR} show HEAD:packaging/ha-app/config.yaml")
        commit, _, rest = out.strip().partition("\n")
        m = re.search(r'^version:\s*"?([^"\s#]+)', rest, re.M)
        return (m.group(1) if m else "?"), commit.strip()

    def clean(self, save_and_revert: bool = False, dry: bool = False) -> list[str]:
        """Tracked files changed by hand in /opt/mantel (`.env` and the secrets are ignored, so never listed). Refuses
        while there are any; with save_and_revert the diff goes to /root/mantel-hand-changes-<time>.patch on the LXC
        first, then the files are put back. Returns the files it found (none: an empty list)."""
        out = self.run(f"git -C {LXC_DIR} status --porcelain --untracked-files=no")
        files = [ln[3:] for ln in out.splitlines() if ln.strip()]
        if not files:
            return []
        if not save_and_revert:
            raise Refused("the LXC has hand changes in " + ", ".join(files[:8]) + ": `update` would carry them along. "
                          "Revert them, or run again with --save-and-revert-hand-changes (the diff is saved on the LXC)")
        if dry:
            print(f"dry run: would save the LXC's hand changes ({', '.join(files[:8])}) and revert them")
            return files
        patch = f"/root/mantel-hand-changes-{datetime.datetime.now():%Y%m%d-%H%M%S}.patch"
        self.run(f"git -C {LXC_DIR} diff --binary HEAD > {patch} && test -s {patch} && git -C {LXC_DIR} reset -q --hard HEAD")
        if self.run(f"git -C {LXC_DIR} status --porcelain --untracked-files=no").strip():
            raise Refused("the LXC's hand changes are still there after the revert")
        print(f"The LXC's hand changes ({', '.join(files[:8])}) saved to {patch} there, and reverted.")
        return files

    def pin(self) -> str:
        """The install's `mantel.ref` ("latest" when none). Refuses an answer that isn't one (a dropped connection):
        it would be written back as the pin."""
        code, out = self.runner(f"git -C {LXC_DIR} config --get mantel.ref", 60)
        out = out.strip()
        if code == 1 and not out:
            return "latest"
        if code != 0 or not PIN.match(out):
            raise Refused(f"cannot read the LXC's mantel.ref ({code}): {self.scrub(out)[:200]}")
        return out

    def repair_pin(self) -> str | None:
        """A commit this tool pinned (the fallback in update(), remembered in mantel.releasepin) and never put back,
        because the release died between the two: back to the pin it replaced. Never a pin the owner set."""
        mine = self.run(f"git -C {LXC_DIR} config --get mantel.releasepin", check=False).strip()
        if not COMMIT.match(mine.split(" ")[0] if mine else ""):
            return None
        commit, _, before = mine.partition(" ")
        if self.pin() == commit:
            self.run(f"git -C {LXC_DIR} config mantel.ref {shlex.quote(before if PIN.match(before) else 'latest')}")
        self.run(f"git -C {LXC_DIR} config --unset mantel.releasepin", check=False)
        return f"the LXC was left pinned to {commit[:9]} by an earlier release: back to {before or 'latest'}"

    def update(self, commit: str) -> str:
        """`update` to exactly this commit: MANTEL_UPDATE_REF names it for this one update (packaging/proxmox/ct/
        mantel.sh). If the LXC's `update` didn't pass the variable on, the commit is pinned for one update instead and
        the pin put back whatever happens. update.sh rolls back by itself when the new version isn't healthy."""
        if not COMMIT.match(commit):
            raise Refused(f"not a commit: {commit!r}")
        code, out = self.runner(f"MANTEL_UPDATE_REF={commit} update", 1800)
        out = self.scrub(out)
        if code != 0:
            raise Refused(f"`update` on the LXC failed ({code}): it went back to what ran before.\n"
                          f"{out.strip()[-2000:]}")
        if self.head() == commit:
            return out
        pin = self.pin()
        try:
            self.run(f"git -C {LXC_DIR} config mantel.releasepin {shlex.quote(commit + ' ' + pin)}")
            self.run(f"git -C {LXC_DIR} config mantel.ref {commit}")
            code, out = self.runner("update", 1800)
            out = self.scrub(out)
        finally:
            self.run(f"git -C {LXC_DIR} config mantel.ref {shlex.quote(pin)}")
            self.run(f"git -C {LXC_DIR} config --unset mantel.releasepin", check=False)
        head = self.head()
        if code != 0 or head != commit:
            raise Refused(f"`update` on the LXC did not move it to {commit[:9]} (it runs {head[:9]}; status {code}).\n"
                          f"{out.strip()[-2000:]}")
        return out

    def health_problems(self, commit: str) -> tuple[list[str], dict]:
        out = self.run(f"cd {COMPOSE_DIR} && docker compose ps --format json")
        services = []
        for ln in out.splitlines():
            ln = ln.strip()
            if ln.startswith("["):
                services += json.loads(ln)
            elif ln.startswith("{"):
                services.append(json.loads(ln))
        bad = [f"{s.get('Service')} {s.get('Health') or s.get('State')}" for s in services
               if s.get("State") != "running" or (s.get("Health") or "healthy") != "healthy"]
        if not services:
            bad.append("no service is running")
        rev = self.run("docker inspect -f '{{index .Config.Labels \"org.opencontainers.image.revision\"}}' "
                       "mantel-server", check=False).strip()
        if rev != commit:
            bad.append(f"mantel-server runs revision {rev[:9] or '?'}, not {commit[:9]}")
        code, _, body = self.run(f"docker exec mantel-server python -c {shlex.quote(HEALTH_PY)}",
                                 check=False).strip().partition("\n")
        try:
            health = json.loads(body)
        except ValueError:
            health = {}
        if code.strip() != "200":
            bad.append(f"/healthz?strict=1 answered {code.strip()[:40] or 'nothing'}")
        elif not health.get("upstream", {}).get("home_assistant", {}).get("connected"):
            bad.append("Home Assistant is not connected")
        return bad, health

    def follows_ha_restart(self, since_restart: float, timeout: float = 300, hold: float = 60) -> float:
        """After a component's Home Assistant restart: Mantel connected to Home Assistant again since the restart
        (its `connected_for_s` is shorter than the time since), and still answering strict health `hold` seconds
        later. (HK Frontend 1.43.0, 2026-11-04: Mantel 0.1.123 reconnected, then stopped answering at 100 % CPU until
        it was restarted; the release had already called the house healthy.) Returns the seconds it took."""
        start = time.monotonic()
        head = self.head()
        while True:
            bad, health = self.health_problems(head)
            ha = health.get("upstream", {}).get("home_assistant", {})
            age = since_restart + time.monotonic() - start
            if not bad and isinstance(ha.get("connected_for_s"), (int, float)) and ha["connected_for_s"] < age:
                break
            if time.monotonic() - start >= timeout:
                raise Refused(f"Mantel on the LXC did not reconnect to Home Assistant within {timeout:.0f} s of its "
                              "restart: " + ("; ".join(bad) or "still connected from before it"))
            sleep(self.every)
        sleep(hold)
        bad, _ = self.health_problems(head)
        if bad:
            raise Refused(f"Mantel on the LXC reconnected to Home Assistant, then stopped being healthy within "
                          f"{hold:.0f} s: " + "; ".join(bad) + " (restart it: docker compose restart mantel-server)")
        return time.monotonic() - start

    def healthy(self, commit: str, timeout: float = 180) -> dict:
        """Every service healthy, mantel-server built from `commit`, and strict health 200 with Home Assistant
        connected, within `timeout` seconds. Returns the health."""
        deadline = time.monotonic() + timeout
        while True:
            bad, health = self.health_problems(commit)
            if not bad:
                return health
            if time.monotonic() >= deadline:
                raise Refused(f"Mantel on the LXC is not healthy after {timeout:.0f} s: " + "; ".join(bad))
            sleep(self.every)

    def log_problems(self) -> tuple[list[str], list[str]]:
        """After a settle, the stack's log since mantel-server started: (errors, warnings). A "Traceback" or "ERROR"
        from mantel-server is an error; from Caddy, go2rtc or the announcer, a warning."""
        sleep(self.settle)
        since = self.run("docker inspect -f '{{.State.StartedAt}}' mantel-server").strip()
        log = self.run(f"cd {COMPOSE_DIR} && docker compose logs --no-color --since {shlex.quote(since)}")
        errors, warnings = [], []
        for ln in log_problems(log):
            (errors if ln.startswith("mantel-server") else warnings).append(ln)
        return errors, warnings


# ---------------------------------------------------------------- the release workflow, from here

IMAGE_JOBS = {"App image ": 4, "Docker image ": 6, "Docker manifest ": 3}     # what the house waits for
SUITE_JOBS = {"The main suite": 1}
WORKFLOW_MINUTES = 30


def sleep(seconds: float) -> None:
    time.sleep(seconds)


def gh_json(*args: str) -> object:
    return json.loads(run("gh", *args, quiet=True) or "null")


def dispatch(ref: str, *fields: str, wait_s: float = 120) -> str:
    """Run release.yml from `ref` with these inputs; the new run's id."""
    started = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=10)
    out = run("gh", "workflow", "run", "release.yml", "--ref", ref, *[a for f in fields for a in ("-f", f)], quiet=True)
    if m := re.search(r"/actions/runs/(\d+)", out):
        return m.group(1)
    deadline = time.monotonic() + wait_s
    while time.monotonic() < deadline:
        sleep(5)
        for r in gh_json("run", "list", "--workflow", "release.yml", "--branch", ref, "-L", "3",
                         "--json", "databaseId,createdAt") or []:
            if datetime.datetime.fromisoformat(r["createdAt"].replace("Z", "+00:00")) >= started:
                return str(r["databaseId"])
    raise Refused(f"the release workflow from {ref} did not start")


def run_view(run_id: str, tries: int = 7, every: float = 10) -> dict:
    """The run's status and jobs. GitHub can answer 404 for a run it created a second ago (0.1.123's release,
    2026-11-04: its jobs right after the dispatch), and any one call can fail: asked again for about a minute."""
    for attempt in range(tries):
        try:
            return gh_json("run", "view", run_id, "--json", "status,conclusion,headSha,jobs,url") or {}
        except Refused:
            if attempt == tries - 1:
                raise
            sleep(every)
    return {}


def wait_jobs(run_id: str, wanted: dict[str, int], what: str, minutes: float = WORKFLOW_MINUTES,
              every: float = 15) -> dict:
    """Until every job whose name starts with a key of `wanted` (that many of each) has finished. A failed or
    cancelled one refuses; so does a run that ended without them all."""
    deadline = time.monotonic() + minutes * 60
    while True:
        view = run_view(run_id)
        jobs = view.get("jobs") or []
        mine = {p: [j for j in jobs if j.get("name", "").startswith(p)] for p in wanted}
        failed = [j["name"] for js in mine.values() for j in js
                  if j.get("status") == "completed" and j.get("conclusion") not in ("success", "skipped")]
        if failed:
            raise JobFailed(f"{what}: {', '.join(failed[:4])} failed ({view.get('url', run_id)})")
        if all(len(mine[p]) >= n and all(j.get("status") == "completed" for j in mine[p]) for p, n in wanted.items()):
            return view
        if view.get("status") == "completed":
            raise Refused(f"{what}: the run ended ({view.get('conclusion')}) without them ({view.get('url', run_id)})")
        if time.monotonic() >= deadline:
            raise Refused(f"{what}: not done after {minutes:.0f} minutes ({view.get('url', run_id)})")
        sleep(every)


def wait_run(run_id: str, minutes: float = WORKFLOW_MINUTES, every: float = 15) -> dict:
    deadline = time.monotonic() + minutes * 60
    while True:
        view = run_view(run_id)
        if view.get("status") == "completed":
            return view
        if time.monotonic() >= deadline:
            raise Refused(f"run {view.get('url', run_id)} not done after {minutes:.0f} minutes")
        sleep(every)


def suite_passed(run_id: str) -> tuple[bool, str]:
    """The run's Linux suite, rerun once if it failed (a timing flake): (passed, how)."""
    try:
        wait_jobs(run_id, SUITE_JOBS, "the Linux suite")
        return True, "passed"
    except JobFailed:
        pass
    wait_run(run_id)                            # GitHub reruns only a run that has ended
    print("The Linux suite failed: running it again once (gh run rerun --failed) ...")
    run("gh", "run", "rerun", run_id, "--failed", quiet=True)
    deadline = time.monotonic() + 120
    while run_view(run_id).get("status") == "completed" and time.monotonic() < deadline:
        sleep(5)
    try:
        wait_jobs(run_id, SUITE_JOBS, "the Linux suite, run again")
        return True, "passed when run again (it failed once)"
    except JobFailed as e:
        return False, str(e)


# ---------------------------------------------------------------- notes from "## Unreleased"

def unreleased(changelog: Path) -> str:
    """The body of a changelog's "## Unreleased" section ("" when it is empty or missing)."""
    m = re.search(r"^## Unreleased[ \t]*\n(.*?)(?=^## |\Z)", changelog.read_text(), re.M | re.S)
    return m.group(1).strip() if m else ""


def add_to_unreleased(changelog: Path, notes: str) -> None:
    """--notes: these bullets go into "## Unreleased" (after what is there), which the bump then names."""
    text = changelog.read_text()
    m = re.search(r"^## Unreleased[ \t]*\n(.*?)(?=^## |\Z)", text, re.M | re.S)
    if not m:
        raise Refused(f'{changelog.name} has no "## Unreleased" section')
    body = (m.group(1).strip() + "\n\n" + notes.strip()).strip()
    changelog.write_text(text[:m.start(1)] + "\n" + body + "\n\n" + text[m.end(1):].lstrip("\n"))


def name_section(changelog: Path, version: str, today: datetime.date) -> None:
    """A component's "## Unreleased" becomes "## X.Y.Z - date", with a new empty "## Unreleased" above it."""
    text = changelog.read_text()
    if re.search(rf"^## \[?{re.escape(version)}\b", text, re.M):
        raise Refused(f"{changelog.name} has a {version} section already")
    new, n = re.subn(r"^## Unreleased[ \t]*$", f"## Unreleased\n\n## {version} - {today.isoformat()}", text,
                     count=1, flags=re.M)
    if n != 1:
        raise Refused(f'{changelog.name} has no "## Unreleased" section')
    changelog.write_text(new)


# ---------------------------------------------------------------- the release, house first

def other_release_in_progress(version: str) -> str | None:
    """Another release/* branch on origin (a release running, or one that failed and left it), or a release.yml run
    still going: None when there is neither."""
    heads = run("git", "ls-remote", "--heads", "origin", "refs/heads/release/*", quiet=True)
    others = [ln.split("refs/heads/")[-1] for ln in heads.splitlines() if ln.strip()
              and not ln.endswith(f"refs/heads/release/{version}")]
    if others:
        return f"origin has {', '.join(others)}: another release is running, or one left its branch (delete it)"
    going = [r for status in ("in_progress", "queued") for r in
             gh_json("run", "list", "--workflow", "release.yml", "--status", status, "--json", "databaseId,url") or []]
    if going:
        return f"a release workflow is running ({going[0].get('url')})"
    return None


def release_ready(version: str, retry: bool, notes: str) -> str:
    """What the release commit will be: "bump" (HEAD is before it; the bump makes it) or "retry" (HEAD is it, from
    an earlier attempt that stopped before the tag). Refuses a release with nothing to say."""
    cv = _load("check_version")
    current = cv.versions(ROOT)[cv.SOURCE]
    if retry:
        if current != version or cv.changelog_section(version, ROOT) is None:
            raise Refused(f"--retry needs HEAD at {version} with its CHANGELOG.md section (it says {current})")
        return "retry"
    if current == version:
        raise Refused(f"HEAD says {version} already: that is a retry (--retry), or the next version is wanted")
    if not unreleased(ROOT / "CHANGELOG.md") and not notes.strip():
        raise Refused('nothing to say: CHANGELOG.md\'s "## Unreleased" is empty (write the notes there, or --notes)')
    return "bump"


def release_mantel(version: str, notes: str, dry: bool, *, retry: bool = False, from_origin: bool = False,
                   save_and_revert: bool = False, lxc: Lxc | None = None) -> list[str]:
    """Mantel to the house (the LXC) and published, house first (docs/phase15/FASTER-RELEASES.md): the release
    commit on main; its images built from release/X.Y.Z (release.yml stage=images); the LXC updated to that commit
    and checked; the Linux suite passed; only then the tag, `latest` and ha-apps (stage=promote) and the GitHub
    Release. A failure before the tag leaves no tag, no `latest`, no ha-apps and no Release."""
    times: list[tuple[str, float]] = []
    clock = time.monotonic()

    def step(name: str) -> None:
        nonlocal clock
        now = time.monotonic()
        times.append((name, now - clock))
        print(f"  [{now - clock:5.0f} s] {name}")
        clock = now

    head, _ = preflight(from_origin=from_origin)
    check_tag_free(version)
    how = release_ready(version, retry, notes)
    if why := other_release_in_progress(version):
        raise Refused(why)
    run("gh", "auth", "status", quiet=True)
    private_regex()
    lxc = lxc or Lxc.from_settings()
    if fixed := (None if dry else lxc.repair_pin()):
        print(fixed)
    reverted = lxc.clean(save_and_revert, dry)
    old_version, old_commit = lxc.previous()
    print(f"Mantel {version} from {head[:9]} to the LXC (it runs {old_version}, {old_commit[:9]})")
    step("preflight")
    if dry:
        print(f"dry run: would {'bump to ' + version + ', commit, check (ci.py versions) and push' if how == 'bump' else 'retry HEAD'}; "
              f"push release/{version}, run release.yml stage=images, update the LXC to that commit and check it, "
              f"wait for the Linux suite, tag v{version}, run stage=promote, make the GitHub Release and record it")
        return []
    # 1. the release commit, on main
    if how == "bump":
        if notes.strip():
            add_to_unreleased(ROOT / "CHANGELOG.md", notes)
        bump = _load("bump_version")
        bump.set_version(version)
        if not bump.name_unreleased(version):
            git("checkout", "--", "CHANGELOG.md", *_load("check_version").FILES)    # nothing half done stays
            raise Refused('CHANGELOG.md\'s "## Unreleased" is not its newest section')
        text = (ROOT / "CHANGELOG.md").read_text()
        (ROOT / "CHANGELOG.md").write_text(re.sub(rf"^(## {re.escape(version)} - )", r"## Unreleased\n\n\1", text,
                                                  count=1, flags=re.M))
        run(sys.executable, "tools/check_version.py", "--staged")
        commit_only(f"Release {version} to the house", "CHANGELOG.md", *_load("check_version").FILES)
        recheck()
        git("push", "-q", "--no-verify", "origin", "HEAD:refs/heads/main")
    commit = git("rev-parse", "HEAD")
    step("release commit on main" if how == "bump" else "release commit (retry)")
    # 2. its images, from a branch that pins the commit
    branch = f"release/{version}"
    git("push", "-q", "--no-verify", "origin", f"{commit}:refs/heads/{branch}")
    run_id = dispatch(branch, "stage=images", "publish=true")
    view = run_view(run_id)
    if view.get("headSha") and view["headSha"] != commit:
        raise Refused(f"the images run {run_id} builds {view['headSha'][:9]}, not {commit[:9]}: stopped before the house")
    print(f"images run {view.get('url', run_id)}")
    step("images run started")
    # 4. wait for the images (3. nothing to build here: a Mantel-only release has no component)
    view = wait_jobs(run_id, IMAGE_JOBS, "the images")
    if view.get("headSha") != commit:
        raise Refused(f"the images run built {str(view.get('headSha'))[:9]}, not {commit[:9]}: stopped before the house")
    step("images built and pushed")
    # 5. the house
    lxc.update(commit)                 # a version update.sh finds unhealthy is rolled back there, by update.sh
    stays = (f"The LXC stays on {commit[:9]} ({version}, untagged): update.sh judged it healthy. Fix it in the next "
             f"commit and release again with --retry, or go back with `MANTEL_UPDATE_REF={old_commit} update` there "
             "(if the database allows: Backups.md)")
    try:
        health = lxc.healthy(commit)
        errors, warnings = lxc.log_problems()
    except Refused as e:
        raise Refused(f"{e}\n{stays}") from None
    if errors:
        raise Refused("Mantel's log on the LXC has errors (no tag):\n  " + "\n  ".join(errors[:10]) + f"\n{stays}")
    for w in warnings[:10]:
        print(f"warning (not Mantel's own log): {w}")
    step("the LXC updated and healthy")
    # 6. the Linux suite (it ran beside the builds and the update)
    ok, suite = suite_passed(run_id)
    if not ok:
        raise Refused(f"the Linux suite failed twice: the house runs {version}, untagged. Fix it in the next commit "
                      f"and release again with --retry.\n{suite}")
    view = wait_run(run_id)
    if view.get("conclusion") != "success":
        raise Refused(f"the images run ended {view.get('conclusion')} ({view.get('url', run_id)}): no tag")
    step("Linux suite " + suite)
    # 7. the tag: the house runs it, healthy, and the suite passed
    tag = tag_release(version, commit)
    step("tagged")
    try:
        # 8. latest and ha-apps
        promote = dispatch(tag, "stage=promote", f"images_run={run_id}", "publish=true")
        pview = wait_run(promote, minutes=15)
        if pview.get("conclusion") != "success":
            raise Refused(f"promote failed ({pview.get('url', promote)}): {tag} is tagged and on the house; run it "
                          f"again: gh workflow run release.yml --ref {tag} -f stage=promote -f images_run={run_id} "
                          f"-f publish=true; then the GitHub Release and the record in House-releases.md by hand")
        step("promoted (latest, ha-apps)")
        # 9. the GitHub Release
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as f:
            f.write(changelog_section(ROOT / "CHANGELOG.md", version) + RELEASE_FOOTER.format(version=version))
        try:
            run("gh", "release", "create", tag, "--title", f"Mantel {version}", "--notes-file", f.name,
                "--verify-tag", quiet=True)
        except Refused as e:
            raise Refused(f"{e}\n{tag} is promoted; make the GitHub Release and the record by hand") from None
        finally:
            os.unlink(f.name)
        step("GitHub Release")
    finally:
        # 10. the branch goes once the tag stands, whatever follows (a left one blocks the next release); the
        # record follows (main())
        try:
            run("git", "push", "-q", "--no-verify", "origin", "--delete", f"refs/heads/{branch}", quiet=True)
        except Refused as e:
            print(f"warning: release/{version} is still on origin (delete it: it blocks the next release): {e}")
    total = sum(t for _, t in times)
    hours = health.get("upstream", {}).get("home_assistant", {}).get("connected_for_s")
    return [f"Mantel {version}, release commit `{commit[:7]}`, tagged `{tag}`; the LXC {old_version} -> {version} "
            f"(build `{health.get('build', '?')}`).",
            f"Images run {run_id} (stage=images), promote run {promote}, GitHub Release `{tag}`.",
            f"Strict health 200, all services healthy, mantel-server built from `{commit[:7]}`, Home Assistant "
            f"connected{f' for {hours:.0f} s' if isinstance(hours, (int, float)) else ''}; no \"Traceback\" or \"ERROR\" in "
            f"Mantel's log" + (f" ({len(warnings)} warnings from the other services)" if warnings else "") + ".",
            *([f"Hand changes on the LXC saved and reverted first: {', '.join(reverted[:5])}."] if reverted else []),
            f"Linux suite {suite}.",
            "Times: " + ", ".join(f"{n} {t:.0f} s" for n, t in times) + f"; {total / 60:.1f} minutes in all."]


# ---------------------------------------------------------------- what changed, per product (plan, all)

PRODUCTS = ("mantel", "hk-frontend", "mantel-link")
TAG_PREFIX = {"mantel": "v", "hk-frontend": "hk-frontend/v", "mantel-link": "mantel-link/v"}
NAMES = {"mantel": "Mantel", "hk-frontend": "HK Frontend", "mantel-link": "Mantel Link"}
# everything the Mantel Server image takes (packaging/docker/Dockerfile copies from these)
MANTEL_INPUTS = ("web/", "hk_core/", "hosts/server/", "pyproject.toml", "packaging/", "tools/build_static.py",
                 "tools/write_release.py")


def product_inputs(product: str) -> tuple[str, ...]:
    if product == "mantel":
        return MANTEL_INPUTS
    if product == "hk-frontend":
        return CI.HK_INPUTS
    pub = _load_path("publish_mantel", ROOT / COMPONENTS["mantel-link"]["dir"] / "tools/publish/publish.py")
    core = tuple(f"hk_core/{p}" + ("" if p.endswith(".py") else "/") for p in pub.CORE_PARTS)
    return (COMPONENTS["mantel-link"]["dir"] + "/", *core)


def last_release(product: str) -> tuple[str | None, str | None]:
    """(version, commit) of the product's newest tag here (v*, hk-frontend/v*, mantel-link/v*), or (None, None)."""
    prefix = TAG_PREFIX[product]
    tags = [t for t in git("tag", "-l", f"{prefix}[0-9]*", "--sort=-v:refname").splitlines()
            if VERSION.match(t[len(prefix):])]
    if not tags:
        return None, None
    return tags[0][len(prefix):], git("rev-parse", f"{tags[0]}^{{commit}}")


def changed_since(product: str, base: str, head: str = "HEAD") -> list[str]:
    """The files of the product's inputs changed from `base` to `head`, version lines and changelogs not counted
    (what a release commit changes: ci.py's VERSION_FILES and CHANGELOGS)."""
    names = git("diff", "--name-only", base, head, "--").splitlines()
    out = []
    for name in names:
        if name in CI.CHANGELOGS or not any(CI.matches(name, spec) for spec in product_inputs(product)):
            continue
        if name in CI.VERSION_FILES:
            lines = [ln[1:] for ln in git("diff", "-U0", base, head, "--", name).splitlines()
                     if ln[:1] in "+-" and not ln.startswith(("+++", "---"))]
            if all(CI.VERSION_LINE.match(ln) for ln in lines):
                continue
        out.append(name)
    return out


def next_version(version: str) -> str:
    major, minor, patch = version.split(".")
    return f"{major}.{minor}.{int(patch) + 1}"


def release_plan() -> list[dict]:
    rows = []
    for product in PRODUCTS:
        version, commit = last_release(product)
        files = changed_since(product, commit) if commit else []
        rows.append({"product": product, "version": version, "commit": commit, "files": files,
                     "changed": bool(files) or commit is None,
                     "next": next_version(version) if version else None})
    return rows


def print_plan(rows: list[dict]) -> None:
    for r in rows:
        if r["commit"] is None:
            print(f"{NAMES[r['product']]}: no {TAG_PREFIX[r['product']]}* tag here (backfill-tags)")
            continue
        what = (f"{len(r['files'])} file{'s' * (len(r['files']) != 1)} changed ({', '.join(r['files'][:3])}"
                f"{', ...' if len(r['files']) > 3 else ''}): next {r['next']}") if r["files"] else "unchanged"
        print(f"{NAMES[r['product']]} {r['version']} ({r['commit'][:9]}): {what}")


def tag_product(product: str, version: str, commit: str) -> str:
    """hk-frontend/vX.Y.Z or mantel-link/vX.Y.Z on the commit it was released from, pushed alone. (Mantel's v* is
    tag_release.) These don't match the LXC's `v[0-9]*`, so `update` never follows them."""
    tag = f"{TAG_PREFIX[product]}{version}"
    git("tag", "-a", tag, "-m", f"{NAMES[product]} {version}", commit)
    git("push", "-q", "--no-verify", "origin", f"refs/tags/{tag}")
    return tag


FROM_MANTEL = re.compile(r"^(HK Frontend|Mantel Link) (\d+\.\d+\.\d+) \(from mantel ([0-9a-f]{7,40})\)")


def backfill_tags(dry: bool) -> list[str]:
    """Once: hk-frontend/vX.Y.Z and mantel-link/vX.Y.Z on the commits their newest public releases came from (the
    public repositories' newest commit says `HK Frontend 1.40.0 (from mantel d81a674d)`)."""
    made = []
    for product in ("hk-frontend", "mantel-link"):
        if last_release(product)[0]:
            print(f"{NAMES[product]}: tagged already ({TAG_PREFIX[product]}{last_release(product)[0]})")
            continue
        found = None
        for message in gh_json("api", f"repos/{COMPONENTS[product]['public']}/commits", "--jq",
                               "[.[].commit.message]") or []:
            if (m := FROM_MANTEL.match(message)) and m.group(1) == NAMES[product]:
                found = m
                break
        if not found:
            raise Refused(f"no '{NAMES[product]} X.Y.Z (from mantel <commit>)' among {COMPONENTS[product]['public']}'s "
                          "newest commits")
        commit = git("rev-parse", f"{found.group(3)}^{{commit}}")
        tag = f"{TAG_PREFIX[product]}{found.group(2)}"
        print(f"{'dry run: would tag' if dry else 'tagging'} {tag} on {commit[:9]}")
        if not dry:
            tag_product(product, found.group(2), commit)
        made.append(tag)
    return made


def check_github_release(product: str, version: str) -> None:
    """--github-release: the version has notes in the component's changelog, and its tag is free on GitHub."""
    spec = COMPONENTS[product]
    src = ROOT / spec["dir"]
    pub = _load_path(f"publish_{spec['domain']}", src / "tools/publish/publish.py")
    hk = pub if product == "hk-frontend" else _load_path(
        "publish_hk_frontend", ROOT / COMPONENTS["hk-frontend"]["dir"] / "tools/publish/publish.py")
    changelog = src / "tools/publish/root/CHANGELOG.md"
    try:
        hk.release_notes(changelog.read_text(encoding="utf-8"), version)
    except (OSError, ValueError) as e:
        if not changelog.is_file() or not unreleased(changelog):     # the release names "## Unreleased" for it
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


def mantel_lxc() -> "Lxc | None":
    """The LXC Mantel runs on, when house.json names one (else nothing to check after a Home Assistant restart)."""
    try:
        return Lxc.from_settings()
    except Refused:
        return None


def release_component(product: str, version: str, dry: bool, github_release: bool = False,
                      from_origin: bool = False) -> list[str]:
    today = datetime.date.today()
    spec = COMPONENTS[product]
    head, found = preflight(from_origin=from_origin)
    changelog = ROOT / spec["dir"] / "tools/publish/root/CHANGELOG.md"
    named = changelog_has(changelog, version)
    if not named and not unreleased(changelog):
        raise Refused(f'nothing to say: {spec["dir"]}/tools/publish/root/CHANGELOG.md\'s "## Unreleased" is empty')
    check_product_tag_free(product, version)
    regex = private_regex()
    url, token = ha_url(), ("" if dry else ha_token())
    src = ROOT / spec["dir"]
    no_tests = publish_tests(found, product)
    publishes = product == "hk-frontend" or github_release
    dest = CONFIG_SHARE / spec["domain"]
    if not dest.parent.is_dir():
        raise Refused(f"{dest.parent} is not mounted")
    print(f"{product} {version} from {head[:9]} into {dest}")
    if github_release:
        check_github_release(product, version)
    if dry:
        print("dry run: would set the manifest version, commit, check it (tools/ci.py versions), push, build, copy, "
              "diff, restart and verify"
              + (f", then publish to {spec['public']}" if publishes else "")
              + (f" and release v{version}" if github_release else ""))
        if publishes or product == "mantel-link":          # (Mantel Link's house copy is publish.py's build too)
            suites = " and ".join(PUBLISH_SUITES[product])
            print(f"dry run: publish.py --no-tests ({suites} passed in the full run)" if no_tests
                  else f"dry run: publish.py with its tests ({suites} did not both pass in the full run)")
        return []
    set_manifest_version(src / "manifest.json", version)
    if not named:
        name_section(changelog, version, today)        # the notes: what "## Unreleased" said
    commit_only(f"{product} {version} to the house", f"{spec['dir']}/manifest.json",
                str(changelog.relative_to(ROOT)))
    commit = git("rev-parse", "HEAD")
    recheck()
    git("push", "-q", "--no-verify", "origin", "HEAD:refs/heads/main")
    with tempfile.TemporaryDirectory(prefix="mantel-house-") as tmp:
        built = house_build(product, tmp, regex, no_tests)
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

        restart = time.monotonic()
        asyncio.run(go())
        restart = time.monotonic() - restart
        mantel = mantel_lxc()                    # Mantel follows Home Assistant: it has to come through the restart
        followed = mantel.follows_ha_restart(restart) if mantel else None
        tag = tag_product(product, version, commit)               # on the house and served: the product's own tag
        lines = [f"{product} {version}, commit `{commit[:7]}`, tagged `{tag}`, copied with rsync --inplace; diff -rq "
                 "shows no difference.",
                 f"Home Assistant restarted and serves `{spec['served'].format(version=version)}` "
                 f"({restart:.0f} s from the restart)."]
        if followed is not None:
            lines.append(f"Mantel on the LXC reconnected to Home Assistant and was still healthy a minute later "
                         f"({followed:.0f} s).")
        if publishes:
            name = NAMES[product]
            clone = Path(tmp) / "public"
            run("git", "clone", "-q", f"https://github.com/{spec['public']}.git", str(clone))
            wiki = []
            if product == "hk-frontend":                             # its Wiki is built from its docs
                wiki_dir = Path(tmp) / "wiki"
                run("git", "clone", "-q", f"https://github.com/{spec['public']}.wiki.git", str(wiki_dir))
                wiki_before = git_in(wiki_dir, "rev-parse", "HEAD")
                wiki = ["--wiki", str(wiki_dir)]
            run(sys.executable, str(src / "tools/publish/publish.py"), str(clone),
                "--commit", f"{name} {version} (from mantel {commit[:7]})", "--push",
                *(["--release"] if github_release else []), *no_tests, *wiki, env={"HK_PRIVATE": regex})
            lines.append(f"Published to {spec['public']} main as `{git_in(clone, 'rev-parse', '--short', 'HEAD')}`, "
                         + (f"tagged `v{version}` and released on GitHub." if github_release else "untagged."))
            if wiki:
                if git_in(wiki_dir, "rev-parse", "HEAD") != wiki_before:   # publish.py committed to it
                    git_in(wiki_dir, "push", "-q", "origin", "HEAD")
                    lines.append("The Wiki pushed (publish.py had committed changes to it).")
                else:
                    lines.append("The Wiki had no changes.")
    return lines


def changelog_has(changelog: Path, version: str) -> bool:
    return bool(re.search(rf"^## \[?{re.escape(version)}\b", changelog.read_text(), re.M))


def check_product_tag_free(product: str, version: str) -> None:
    """hk-frontend/v<version> or mantel-link/v<version>: not here, not on origin."""
    tag = f"{TAG_PREFIX[product]}{version}"
    if git("tag", "-l", tag):
        raise Refused(f"the tag {tag} exists here already")
    if run("git", "ls-remote", "--tags", "origin", f"refs/tags/{tag}", quiet=True).strip():
        raise Refused(f"origin has the tag {tag} already")


def house_build(product: str, tmp: str, regex: str, no_tests: list[str]) -> Path:
    """The component as it goes to the house, built in `tmp`: HK Frontend by tools/build_ha.py; Mantel Link by its
    publish.py, whose layout vendors the hk_core modules it imports (its own folder has none: a copy of that left the
    house's old hk_core/ in place)."""
    spec = COMPONENTS[product]
    if product == "hk-frontend":
        run(sys.executable, "tools/build_ha.py", f"{tmp}/ha", env={"HK_PRIVATE": regex})
        return Path(tmp) / "ha/custom_components" / spec["domain"]
    run(sys.executable, str(ROOT / spec["dir"] / "tools/publish/publish.py"), f"{tmp}/built", *no_tests,
        env={"HK_PRIVATE": regex})
    return Path(tmp) / "built/custom_components" / spec["domain"]


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
    try:
        git("push", "-q", "--no-verify", "origin", "HEAD:refs/heads/main")
    except Refused:
        # another session pushed to main during the release: the record (one commit) goes on top of it
        git("fetch", "-q", "origin")
        git("rebase", "-q", "origin/main")
        git("push", "-q", "--no-verify", "origin", "HEAD:refs/heads/main")


def parse_versions(text: str | None) -> dict[str, str]:
    out = {}
    for part in filter(None, (text or "").split(",")):
        product, _, version = part.partition("=")
        if product not in PRODUCTS or not VERSION.match(version):
            raise Refused(f"--versions takes product=X.Y.Z pairs ({', '.join(PRODUCTS)}): {part!r}")
        out[product] = version
    return out


def release_all(args) -> int:
    """Every product that changed since its last release, in the order Mantel, HK Frontend, Mantel Link."""
    rows = [r for r in release_plan() if r["changed"]]
    print_plan(release_plan())
    if not rows:
        print("nothing changed since the last releases")
        return 0
    if any(r["commit"] is None for r in rows):
        raise Refused("a product has no release tag here: run `release_house.py backfill-tags` first")
    versions = parse_versions(args.versions)
    components = [r["product"] for r in rows if r["product"] != "mantel"]
    if components and not args.dry_run:
        try:
            ha_token()
        except Refused:
            raise Refused(f"{', '.join(NAMES[c] for c in components)} changed, and a component release restarts Home "
                          "Assistant, which needs its admin token (Releasing.md). Release Mantel alone with "
                          "`release_house.py mantel <version>`, and the components by hand.") from None
    for r in rows:
        version = versions.get(r["product"], r["next"])
        notes = args.notes.read_text() if args.notes and r["product"] == "mantel" else ""
        if r["product"] == "mantel":
            lines = release_mantel(version, notes, args.dry_run, from_origin=args.from_origin,
                                   save_and_revert=args.save_and_revert_hand_changes)
        else:
            lines = release_component(r["product"], version, args.dry_run, github_release=True,
                                      from_origin=args.from_origin)
        if not args.dry_run:
            record(f"{NAMES[r['product']]} {version}", lines)
            print("\n".join(lines))
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("product", choices=(*PRODUCTS, "plan", "all", "backfill-tags"))
    ap.add_argument("version", nargs="?")
    ap.add_argument("--notes", type=Path, help="mantel: release notes (Markdown bullets) added to CHANGELOG.md's "
                    "\"## Unreleased\", which is what the release says (the default: what is there already)")
    ap.add_argument("--dry-run", action="store_true", help="make every check; write and send nothing")
    ap.add_argument("--github-release", action="store_true",
                    help="hk-frontend, mantel-link: also publish the public repository, tag v<version> and make its "
                         "GitHub release (needs the version's section in the component's CHANGELOG.md); off by default")
    ap.add_argument("--retry", action="store_true",
                    help="mantel: HEAD is the release commit of an attempt that stopped before its tag (a fix may "
                         "follow it): no bump, the rest again")
    ap.add_argument("--from-origin", action="store_true",
                    help="run from a clean worktree whose detached HEAD is origin/main (push HEAD to main)")
    ap.add_argument("--save-and-revert-hand-changes", action="store_true",
                    help="mantel: hand changes on the LXC are saved there as a patch and reverted, not refused")
    ap.add_argument("--ha-app", action="store_true",
                    help="mantel: a home that runs Mantel as the Home Assistant App: stage and update it through the "
                         "Supervisor (needs the admin token), tag, then release.yml stage=all")
    ap.add_argument("--no-publish", action="store_true",
                    help="mantel --ha-app: put it on the house and tag it, but don't publish it (the release workflow "
                         "and the GitHub Release); publish it later from the tag (Releasing.md)")
    ap.add_argument("--versions", help="all: product=X.Y.Z,... instead of the next patch version")
    args = ap.parse_args(argv)
    if args.product in PRODUCTS and not (args.version and VERSION.match(args.version)):
        print("the version is X.Y.Z", file=sys.stderr)
        return 2
    if args.github_release and args.product == "mantel":
        print("--github-release is for hk-frontend and mantel-link (Mantel's own release is the release workflow's)",
              file=sys.stderr)
        return 2
    if args.no_publish and not args.ha_app:
        print("--no-publish is for --ha-app (the house-first release publishes only once the house runs it)",
              file=sys.stderr)
        return 2
    try:
        if args.product == "plan":
            print_plan(release_plan())
            return 0
        if args.product == "backfill-tags":
            backfill_tags(args.dry_run)
            return 0
        if args.product == "all":
            return release_all(args)
        if args.product == "mantel":
            notes = args.notes.read_text() if args.notes else ""
            if args.ha_app:
                if not notes.strip() and not args.dry_run:
                    raise Refused("a Mantel release for the HA App needs --notes")
                lines = release_mantel_ha_app(args.version, notes, args.dry_run, publish=not args.no_publish)
            else:
                lines = release_mantel(args.version, notes, args.dry_run, retry=args.retry,
                                       from_origin=args.from_origin,
                                       save_and_revert=args.save_and_revert_hand_changes)
        else:
            lines = release_component(args.product, args.version, args.dry_run, args.github_release,
                                      from_origin=args.from_origin)
        if not args.dry_run:
            record(f"{NAMES[args.product]} {args.version}", lines)
            print("\n".join(lines))
    except Refused as e:
        print(f"refused: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
