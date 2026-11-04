"""packaging/proxmox: Mantel's scripts in community-scripts' layout (ct/mantel.sh on the Proxmox host, install/
mantel-install.sh in the container), run by community-scripts' own engine. Here the engine is a stand-in whose start
calls one of the script's functions: which commit `update` moves to, and that a copy fetched with curl finds its
install script in this repository."""
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "packaging/proxmox"
CT = SCRIPTS / "ct/mantel.sh"
INSTALL = SCRIPTS / "install/mantel-install.sh"


def _bash() -> str:
    """bash 4 or later where there is one (Proxmox has 5; macOS's /bin/bash is 3.2), else whatever bash there is."""
    for cand in (os.environ.get("MANTEL_TEST_BASH"), shutil.which("bash"), "/opt/homebrew/bin/bash", "/usr/local/bin/bash",
                 "/bin/bash"):
        if cand and Path(cand).is_file():
            r = subprocess.run([cand, "-c", "echo ${BASH_VERSINFO[0]}"], capture_output=True, text=True)
            if r.stdout.strip().isdigit() and int(r.stdout) >= 4:
                return cand
    return "bash"


BASH = _bash()

ENGINE = """
header_info() { :; }
variables() { :; }
color() { :; }
catch_errors() { :; }
start() { eval "$TEST_CALL"; exit $?; }
check_container_storage() { :; }
check_container_resources() { :; }
msg_info() { echo "INFO $*"; }
msg_ok() { echo "OK $*"; }
msg_error() { echo "ERROR $*" >&2; }
STD=""
"""


def git(cwd: Path, *args: str) -> str:
    env = {**os.environ, "GIT_AUTHOR_NAME": "Fictional Owner", "GIT_AUTHOR_EMAIL": "owner@example.com",
           "GIT_COMMITTER_NAME": "Fictional Owner", "GIT_COMMITTER_EMAIL": "owner@example.com"}
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True, env=env).stdout.strip()


@pytest.fixture
def engine(tmp_path):
    core = tmp_path / "core" / "core"
    core.mkdir(parents=True)
    (core / "build.func").write_text(ENGINE)
    return tmp_path / "core"


def call(engine: Path, what: str, cwd: Path | None = None, **extra: str) -> subprocess.CompletedProcess:
    env = {**{k: v for k, v in os.environ.items() if not k.startswith(("var_", "COMMUNITY_SCRIPTS", "MANTEL_DIR", "MANTEL_UPDATE_REF"))},
           "COMMUNITY_SCRIPTS_CORE_DIR": str(engine), "TEST_CALL": what, **extra}
    return subprocess.run([BASH, str(CT)], capture_output=True, text=True, env=env, cwd=cwd)


@pytest.fixture
def checkout(tmp_path):
    """/opt/mantel as the install leaves it: a clone of a repository with a main branch and, later, release tags."""
    upstream = tmp_path / "upstream"
    upstream.mkdir()
    git(upstream, "init", "-q", "-b", "main")
    for n in range(3):
        (upstream / "f").write_text(str(n))
        git(upstream, "add", "f")
        git(upstream, "commit", "-q", "-m", f"c{n}")
    clone = tmp_path / "clone"
    git(tmp_path, "clone", "-q", str(upstream), str(clone))
    return upstream, clone


def test_latest_follows_main_until_there_is_a_release_tag_then_the_newest_tag(engine, checkout):
    upstream, clone = checkout
    r = call(engine, "mantel_target latest", clone)
    assert r.returncode == 0 and r.stdout.strip() == git(upstream, "rev-parse", "main"), r.stderr
    git(upstream, "tag", "v0.1.9", "HEAD~2")
    git(upstream, "tag", "v0.1.10", "HEAD~1")         # a version sort, not an alphabetical one
    git(upstream, "tag", "nightly", "HEAD")           # not a release tag
    git(clone, "fetch", "-q", "--tags", "origin")
    r = call(engine, "mantel_target latest", clone)
    assert r.stdout.strip() == git(upstream, "rev-parse", "v0.1.10^{commit}"), r.stderr


def test_a_pinned_branch_tag_or_commit_and_one_that_does_not_exist(engine, checkout):
    upstream, clone = checkout
    git(upstream, "branch", "beta", "HEAD~1")
    git(clone, "fetch", "-q", "origin")
    assert call(engine, "mantel_target beta", clone).stdout.strip() == git(upstream, "rev-parse", "beta")
    first = git(upstream, "rev-parse", "HEAD~2")
    assert call(engine, f"mantel_target {first[:10]}", clone).stdout.strip() == first
    assert call(engine, "mantel_target no-such-ref", clone).returncode != 0


def test_a_copy_fetched_with_curl_finds_its_install_script_here(engine):
    """build.func fetches install/<app>-install.sh from COMMUNITY_SCRIPTS_URL when the ct/ script didn't come from a
    checkout; the default must be this folder on GitHub, and the app's slug must match the file's name."""
    r = call(engine, 'echo "$COMMUNITY_SCRIPTS_URL"; echo "$APP"')
    url, app = r.stdout.split()
    assert url == "https://raw.githubusercontent.com/jazzphone/mantel/main/packaging/proxmox"
    assert (SCRIPTS / "install" / f"{app.lower()}-install.sh").is_file()
    # what the engine names the container's variables, exported so lxc-attach carries them in
    r = call(engine, "env | grep -c '^var_mantel_'")
    assert int(r.stdout) == 6


def test_the_install_files_and_the_engine_are_pinned(engine):
    """DEP-17 (audit, third pass): the one-liner ran ct/mantel.sh from main, which fetched the install script from
    main and community-scripts' build.func from their main: a ref-pinned install was not pinned. The install
    files now come from the ref the person names (var_mantel_ref), and the engine from a commit; both can be set."""
    url = lambda r: r.stdout.split()[0]
    core = lambda r: r.stdout.split()[1]
    show = 'echo "$COMMUNITY_SCRIPTS_URL $COMMUNITY_SCRIPTS_CORE_URL"'
    base = "https://raw.githubusercontent.com/jazzphone/mantel/{}/packaging/proxmox"
    assert url(call(engine, show)) == base.format("main")
    assert url(call(engine, show, var_mantel_ref="latest")) == base.format("main")
    assert url(call(engine, show, var_mantel_ref="v0.1.112")) == base.format("v0.1.112")
    assert url(call(engine, show, var_mantel_ref="feature/lxc")) == base.format("feature/lxc")
    r = call(engine, show)
    assert re.fullmatch(r"https://raw\.githubusercontent\.com/community-scripts/core/[0-9a-f]{40}", core(r)), core(r)
    r = call(engine, show, COMMUNITY_SCRIPTS_URL="https://example.com/mantel", COMMUNITY_SCRIPTS_CORE_URL="https://example.com/core")
    assert r.stdout.split() == ["https://example.com/mantel", "https://example.com/core"]
    # the engine is also fetched from that pin when it is not found beside the script
    text = CT.read_text()
    assert 'curl -fsSL "${COMMUNITY_SCRIPTS_CORE_URL}/core/build.func"' in text and "core/main" not in text


def _checkout_function() -> str:
    return re.search(r"^mantel_checkout\(\) \{.*?^\}$", INSTALL.read_text(), re.M | re.S).group(0)


@pytest.fixture
def clone_with_branches(tmp_path):
    upstream = tmp_path / "up"
    upstream.mkdir()
    git(upstream, "init", "-q", "-b", "main")
    for n in range(2):
        (upstream / "f").write_text(str(n))
        git(upstream, "add", "f")
        git(upstream, "commit", "-q", "-m", f"c{n}")
    git(upstream, "branch", "beta")
    git(upstream, "tag", "v0.1.1", "main")
    clone = tmp_path / "clone"
    git(tmp_path, "clone", "-q", str(upstream), str(clone))
    return upstream, clone


def test_the_install_script_checks_out_a_branch_a_tag_or_a_commit_and_refuses_the_rest(clone_with_branches):
    """DEP-12 (audit, third pass): var_mantel_ref=<branch> failed for any branch but main: the clone has only
    origin/<branch>, so `git checkout --detach <bare-branch>` found nothing."""
    upstream, clone = clone_with_branches
    assert "mantel_checkout \"$REF\"" in INSTALL.read_text(), "and it is what the install uses"

    def checkout(ref):
        return subprocess.run([BASH, "-c", f'{_checkout_function()}\ncd "$1" && mantel_checkout "$2" && git rev-parse HEAD', "_",
                               str(clone), ref], capture_output=True, text=True)
    assert checkout("beta").stdout.strip() == git(upstream, "rev-parse", "beta")        # the bare branch name
    assert checkout("v0.1.1").stdout.strip() == git(upstream, "rev-parse", "v0.1.1")
    first = git(upstream, "rev-parse", "HEAD~1")
    assert checkout(first[:10]).stdout.strip() == first
    assert checkout("no-such-ref").returncode != 0


# -- update (DEP-10, DEP-13, DEP-16, audit third pass) --------------------------------------------------------
UPDATE_SCRIPT = "#!/usr/bin/env bash\nexit \"${FAKE_UPDATE_RC:-0}\"\n"
DOCKER = """#!/bin/sh
echo "docker $*" >> "$DOCKER_LOG"
case "$1 $2" in
  "manifest inspect") case "$3" in *:"$FAKE_UNPUBLISHED") exit 1 ;; esac ;;
  "inspect --format") echo "${FAKE_HEALTH:-healthy}" ;;
esac
exit 0
"""


@pytest.fixture
def install(tmp_path, engine):
    """/opt/mantel after an install of 0.1.9 that a release 0.2.0 followed: its mantel.sh is a stand-in whose exit
    status the test sets, and a docker that knows which tag is not published and whether Mantel is healthy."""
    upstream = tmp_path / "up"
    upstream.mkdir()
    git(upstream, "init", "-q", "-b", "main")
    for version in ("0.1.9", "0.2.0"):
        (upstream / "packaging/ha-app").mkdir(parents=True, exist_ok=True)
        (upstream / "packaging/ha-app/config.yaml").write_text(f'name: Mantel\nversion: "{version}"\n')
        (upstream / "packaging/lxc").mkdir(parents=True, exist_ok=True)
        (upstream / "packaging/lxc/mantel.sh").write_text(UPDATE_SCRIPT)
        git(upstream, "add", "-A")
        git(upstream, "commit", "-q", "-m", f"release {version}")
        git(upstream, "tag", f"v{version}")
    mantel = tmp_path / "opt-mantel"
    git(tmp_path, "clone", "-q", str(upstream), str(mantel))
    git(mantel, "checkout", "-q", "--detach", "v0.1.9")
    compose = mantel / "packaging/compose"
    compose.mkdir(parents=True)
    (compose / ".env").write_text("MANTEL_SERVER_IMAGE=ghcr.io/jazzphone/mantel-server:0.1.9\n"
                                  "MANTEL_CADDY_IMAGE=ghcr.io/jazzphone/mantel-caddy:0.1.9\n")
    (compose / "backups").mkdir()
    bindir = tmp_path / "bin"
    bindir.mkdir()
    (bindir / "docker").write_text(DOCKER)
    (bindir / "docker").chmod(0o755)
    return {"mantel": mantel, "upstream": upstream, "compose": compose, "log": tmp_path / "docker.log",
            "env": {"MANTEL_DIR": str(mantel), "PATH": f"{bindir}:{os.environ['PATH']}", "DOCKER_LOG": str(tmp_path / "docker.log")},
            "engine": engine}


def update(x, **env) -> subprocess.CompletedProcess:
    return call(x["engine"], "update_script", x["mantel"], **{**x["env"], **env})


def test_an_install_made_from_main_is_not_downgraded_to_the_newest_tag(install):
    """DEP-13 (audit, third pass): `latest` moved to the newest tag even when it was an ancestor of HEAD, so an install
    made from a main that is past the last release was downgraded by `update`."""
    mantel, upstream = install["mantel"], install["upstream"]
    (upstream / "g").write_text("after the release")
    git(upstream, "add", "g")
    git(upstream, "commit", "-q", "-m", "after 0.2.0")
    git(mantel, "fetch", "-q", "origin")
    git(mantel, "checkout", "-q", "--detach", "origin/main")                    # an install made from main
    head = git(mantel, "rev-parse", "HEAD")
    r = update(install)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "ahead of the newest release (0.2.0)" in r.stdout and "nothing to update" in r.stdout
    assert git(mantel, "rev-parse", "HEAD") == head
    assert not install["log"].exists() or "manifest" not in install["log"].read_text()
    # one release behind, it still goes forward
    git(mantel, "checkout", "-q", "--detach", "v0.1.9")
    assert "ahead" not in update(install, FAKE_UNPUBLISHED="0.2.0").stdout


def test_a_tag_whose_images_are_not_published_is_skipped_and_nothing_is_changed(install):
    """DEP-10 (audit, third pass): a tag is pushed some minutes before release.yml has published the images (and
    v0.1.111's run failed): `update` moved the checkout, rewrote .env's pins and said nothing had changed."""
    mantel, compose = install["mantel"], install["compose"]
    before, env_before = git(mantel, "rev-parse", "HEAD"), (compose / ".env").read_text()
    r = update(install, FAKE_UNPUBLISHED="0.2.0")
    assert r.returncode == 0, r.stdout + r.stderr
    assert "0.2.0 is tagged, but its image ghcr.io/jazzphone/mantel-server:0.2.0 is not published yet" in r.stdout
    assert "Mantel 0.1.9 stays" in r.stdout
    assert git(mantel, "rev-parse", "HEAD") == before and (compose / ".env").read_text() == env_before
    assert "Updating Mantel" not in r.stdout
    assert "manifest inspect ghcr.io/jazzphone/mantel-server:0.2.0" in install["log"].read_text()
    # published: it goes on and updates
    r = update(install)
    assert r.returncode == 0 and "Updated Mantel to 0.2.0" in r.stdout, r.stdout + r.stderr
    assert git(mantel, "rev-parse", "HEAD") == git(mantel, "rev-parse", "v0.2.0^{commit}")


def test_mantel_update_ref_names_this_updates_target_over_the_pin_and_leaves_none(install):
    """Phase 15: tools/release_house.py updates the house to a release's commit before its tag exists, with
    MANTEL_UPDATE_REF=<commit>: it wins over `git config mantel.ref`, and nothing is pinned afterward."""
    mantel, upstream = install["mantel"], install["upstream"]
    (upstream / "packaging/ha-app/config.yaml").write_text('name: Mantel\nversion: "0.2.1"\n')
    git(upstream, "add", "-A")
    git(upstream, "commit", "-q", "-m", "release 0.2.1, not tagged yet")
    commit = git(upstream, "rev-parse", "HEAD")
    git(mantel, "config", "mantel.ref", "v0.1.9")                  # a pin the variable must win over
    r = update(install, MANTEL_UPDATE_REF=commit)
    assert r.returncode == 0 and "Updated Mantel to 0.2.1" in r.stdout, r.stdout + r.stderr
    assert git(mantel, "rev-parse", "HEAD") == commit
    assert git(mantel, "config", "--get", "mantel.ref") == "v0.1.9"  # untouched: nothing new pinned
    # without the variable the pin decides (here: v0.1.9 is behind HEAD, so nothing to update), and without
    # either, `latest`: the newest tag (0.2.0, behind the untagged commit, so nothing either)
    assert "nothing to update" in update(install).stdout
    git(mantel, "config", "--unset", "mantel.ref")
    r = update(install)
    assert "ahead of the newest release (0.2.0)" in r.stdout, r.stdout


def test_a_build_from_source_needs_no_published_image(install):
    (install["compose"] / ".env").write_text("MANTEL_SERVER_IMAGE=mantel-server:local\n")
    r = update(install, FAKE_UNPUBLISHED="0.2.0")
    assert r.returncode == 0 and "Updated Mantel to 0.2.0" in r.stdout
    assert not install["log"].exists() or "manifest" not in install["log"].read_text()


def test_a_failed_update_that_cannot_roll_back_says_so_and_prints_the_restore_command(install):
    """DEP-16 (audit, third pass): when the new version migrated and failed its health check, the old image refused
    the database, and the wrapper still said the old version "is running again". It asks Docker, and when nothing
    is healthy prints the restore.sh command for the newest backup."""
    mantel, compose = install["mantel"], install["compose"]
    older, newer = compose / "backups/mantel-20261101-020000.mbk", compose / "backups/mantel-20261101-031500.mbk"
    older.write_bytes(b"x")
    newer.write_bytes(b"y")
    os.utime(older, (1_000_000, 1_000_000))
    os.utime(newer, (2_000_000, 2_000_000))
    old = git(mantel, "rev-parse", "HEAD")
    r = update(install, FAKE_UPDATE_RC="1", FAKE_HEALTH="unhealthy")
    assert r.returncode == 1 and git(mantel, "rev-parse", "HEAD") == old, "back on the version that was installed"
    assert "NOT running again" in r.stderr and "9 is running again" not in r.stderr
    assert f"./restore.sh {newer}" in r.stdout
    # healthy after the rollback: the old words, no restore command
    r = update(install, FAKE_UPDATE_RC="1", FAKE_HEALTH="healthy")
    assert r.returncode == 1 and "Mantel 0.1.9 is running again" in r.stderr and "restore.sh" not in r.stdout


def test_an_update_adds_mantel_setup_to_a_container_made_before_it(engine, tmp_path):
    """The owner's first LXC was installed from 0.1.112, before mantel-setup: the update that brings the script also
    brings the command, once, and leaves one that is there alone."""
    mantel = tmp_path / "opt-mantel"
    (mantel / "packaging/lxc").mkdir(parents=True)
    (mantel / "packaging/lxc/mantel-setup.sh").write_text("echo setup\n")
    sbin = tmp_path / "sbin"
    sbin.mkdir()
    r = call(engine, "mantel_commands", MANTEL_DIR=str(mantel), MANTEL_SBIN=str(sbin))
    assert r.returncode == 0, r.stderr
    cmd = sbin / "mantel-setup"
    assert f"exec bash {mantel}/packaging/lxc/mantel-setup.sh" in cmd.read_text() and os.access(cmd, os.X_OK)
    assert "New command: mantel-setup" in r.stdout
    cmd.write_text("mine\n")
    r = call(engine, "mantel_commands", MANTEL_DIR=str(mantel), MANTEL_SBIN=str(sbin))
    assert cmd.read_text() == "mine\n" and "New command" not in r.stdout
