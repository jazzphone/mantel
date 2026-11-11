"""packaging/lxc/mantel-hotfix.sh, a hotfix built on the house's LXC (phase 25, E3): the image is tagged with the
commit's own version, .env is pinned to it, and every way out prunes Docker's build cache (19.5 GB of it had filled
the LXC by 2026-11-11). Run against a fake `docker` and `git` that log what they are asked."""
import os
import stat
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "packaging/lxc/mantel-hotfix.sh"
SHA = "9298ef9c8" + "0" * 31


def fake(bin_dir: Path, name: str, body: str) -> None:
    path = bin_dir / name
    path.write_text("#!/bin/bash\n" + body)
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


def hotfix(tmp_path: Path, build_fails: bool = False) -> tuple[subprocess.CompletedProcess, list[str], Path]:
    bin_dir, install, work, logs = (tmp_path / n for n in ("bin", "opt", "work", "logs"))
    for d in (bin_dir, install / "packaging/compose", logs):
        d.mkdir(parents=True)
    (install / "packaging/compose/.env").write_text("MANTEL_SERVER_IMAGE=ghcr.io/jazzphone/mantel-server:0.1.164\n")
    calls = tmp_path / "calls"
    # git worktree add makes the commit's tree: its config.yaml says the version
    fake(bin_dir, "git", f'echo "git $*" >> {calls}\n'
                         f'if [ "$1 $2" = "worktree add" ]; then mkdir -p {work}/packaging/ha-app; '
                         f'printf \'name: Mantel\\nversion: "0.1.165"\\n\' > {work}/packaging/ha-app/config.yaml; fi\n')
    fake(bin_dir, "docker", f'echo "docker $*" >> {calls}\n'
                            + ('[ "$1" = build ] && exit 1\n' if build_fails else "") + "exit 0\n")
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "MANTEL_INSTALL_DIR": str(install),
           "MANTEL_HOTFIX_DIR": str(work), "MANTEL_HOTFIX_LOGS": str(logs)}
    r = subprocess.run(["bash", str(SCRIPT), SHA], env=env, capture_output=True, text=True, stdin=subprocess.DEVNULL)
    return r, calls.read_text().splitlines(), install


def test_a_hotfix_is_tagged_with_its_version_pinned_and_prunes_the_build_cache(tmp_path):
    r, calls, install = hotfix(tmp_path)
    assert r.returncode == 0, r.stderr
    tag = "ghcr.io/jazzphone/mantel-server:0.1.165-main.9298ef9c8"
    assert any(c.startswith("docker build") and tag in c for c in calls), calls
    assert (install / "packaging/compose/.env").read_text().strip() == f"MANTEL_SERVER_IMAGE={tag}"
    assert calls[-1] == "docker builder prune -f" and "build cache pruned" in r.stdout


def test_a_failed_build_still_prunes_the_build_cache_and_changes_nothing(tmp_path):
    r, calls, install = hotfix(tmp_path, build_fails=True)
    assert r.returncode != 0
    assert calls[-1] == "docker builder prune -f"
    assert "0.1.164" in (install / "packaging/compose/.env").read_text()
    assert not any(c.startswith("docker compose") for c in calls)


@pytest.mark.parametrize("doc", ["docs/development/Releasing.md"])
def test_the_release_docs_name_the_hotfix_script(doc):
    assert "packaging/lxc/mantel-hotfix.sh" in (ROOT / doc).read_text()
