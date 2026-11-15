"""packaging/lxc/mantel-hotfix.sh, a hotfix built on the house's LXC (phase 25, E3): the image is tagged with the
commit's own version, .env is pinned to it, and every way out prunes Docker's build cache (19.5 GB of it had filled
the LXC by 2026-11-11), all of it, and a hotfix that started removes the hotfix images before it (35 of them held 16 GB
of cache on 2026-11-15). Run against a fake `docker` and `git` that log what they are asked."""
import os
import stat
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "packaging/lxc/mantel-hotfix.sh"
SHA = "9298ef9c8" + "0" * 31
GHCR = "ghcr.io/jazzphone/mantel-server:"
IMAGES = [GHCR + "0.1.165-main.9298ef9c8", GHCR + "0.1.164-main.e87faa217", GHCR + "0.1.164-main.545b8e05c",
          GHCR + "0.1.163-main.64d2ec12b", GHCR + "0.1.164", GHCR + "0.1.163", "mantel-rollback/mantel-server:previous",
          "ghcr.io/jazzphone/mantel-transcode:0.1.164", GHCR + "<none>",
          "ghcr.io/someone-else/mantel-server:1.0.0-main.123456789"]


def fake(bin_dir: Path, name: str, body: str) -> None:
    path = bin_dir / name
    path.write_text("#!/bin/bash\n" + body)
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


def hotfix(tmp_path: Path, build_fails: bool = False,
           pinned: str = "0.1.164") -> tuple[subprocess.CompletedProcess, list[str], Path]:
    bin_dir, install, work, logs = (tmp_path / n for n in ("bin", "opt", "work", "logs"))
    for d in (bin_dir, install / "packaging/compose", logs):
        d.mkdir(parents=True)
    (install / "packaging/compose/.env").write_text(f"MANTEL_SERVER_IMAGE={GHCR}{pinned}\n")
    calls = tmp_path / "calls"
    # git worktree add makes the commit's tree: its config.yaml says the version
    fake(bin_dir, "git", f'echo "git $*" >> {calls}\n'
                         f'if [ "$1 $2" = "worktree add" ]; then mkdir -p {work}/packaging/ha-app; '
                         f'printf \'name: Mantel\\nversion: "0.1.165"\\n\' > {work}/packaging/ha-app/config.yaml; fi\n')
    (tmp_path / "images").write_text("".join(f"{i}\n" for i in IMAGES))
    fake(bin_dir, "docker", f'echo "docker $*" >> {calls}\n'
                            + ('[ "$1" = build ] && exit 1\n' if build_fails else "")
                            + f'[ "$1" = images ] && cat {tmp_path / "images"}\nexit 0\n')
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
    assert calls[-1] == "docker builder prune -af" and "build cache pruned" in r.stdout


def test_a_failed_build_still_prunes_the_build_cache_and_changes_nothing(tmp_path):
    r, calls, install = hotfix(tmp_path, build_fails=True)
    assert r.returncode != 0
    assert calls[-1] == "docker builder prune -af"
    assert "0.1.164" in (install / "packaging/compose/.env").read_text()
    assert not any(c.startswith(("docker compose", "docker rmi", "docker images")) for c in calls)


def test_a_hotfix_removes_the_hotfix_images_before_it_all_but_the_one_it_replaced(tmp_path):
    r, calls, _ = hotfix(tmp_path, pinned="0.1.164-main.e87faa217")
    assert r.returncode == 0, r.stderr
    removed = [c for c in calls if c.startswith("docker rmi")]
    # by exact tag, never forced; itself, the one before (the way back), releases, rollback and others' images stay
    assert removed == [f"docker rmi {GHCR}0.1.164-main.545b8e05c", f"docker rmi {GHCR}0.1.163-main.64d2ec12b"]
    assert "old hotfix images removed: 2" in r.stdout
    assert not any("image prune" in c or "system prune" in c for c in calls)
    assert calls.index(removed[-1]) < calls.index("docker builder prune -af")   # then the cache they held can go


def test_a_first_hotfix_over_a_release_removes_every_older_hotfix_image(tmp_path):
    r, calls, _ = hotfix(tmp_path)                       # .env was pinned to the release 0.1.164
    assert r.returncode == 0, r.stderr
    assert [c for c in calls if c.startswith("docker rmi")] == [
        f"docker rmi {GHCR}0.1.164-main.e87faa217", f"docker rmi {GHCR}0.1.164-main.545b8e05c",
        f"docker rmi {GHCR}0.1.163-main.64d2ec12b"]


@pytest.mark.parametrize("doc", ["docs/development/Releasing.md"])
def test_the_release_docs_name_the_hotfix_script(doc):
    assert "packaging/lxc/mantel-hotfix.sh" in (ROOT / doc).read_text()
