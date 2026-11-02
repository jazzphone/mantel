"""packaging/proxmox: Mantel's scripts in community-scripts' layout (ct/mantel.sh on the Proxmox host, install/
mantel-install.sh in the container), run by community-scripts' own engine. Here the engine is a stand-in whose start
calls one of the script's functions: which commit `update` moves to, and that a copy fetched with curl finds its
install script in this repository."""
import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "packaging/proxmox"
CT = SCRIPTS / "ct/mantel.sh"

ENGINE = """
header_info() { :; }
variables() { :; }
color() { :; }
catch_errors() { :; }
start() { eval "$TEST_CALL"; exit $?; }
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


def call(engine: Path, what: str, cwd: Path | None = None) -> subprocess.CompletedProcess:
    env = {**{k: v for k, v in os.environ.items() if not k.startswith(("var_", "COMMUNITY_SCRIPTS"))},
           "COMMUNITY_SCRIPTS_CORE_DIR": str(engine), "TEST_CALL": what}
    return subprocess.run(["bash", str(CT)], capture_output=True, text=True, env=env, cwd=cwd)


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
