"""The Proxmox LXC installer's questions (packaging/lxc/mantel.sh, sourced for its functions): the HTTPS choice
asked at a terminal and Caddy's own CA without one, the DNS host for a domain, and version-pinned images that
follow the source on update; and mantel-install.sh's secret files per DNS host. Needs bash 4 or later (Proxmox
has 5); skipped where there is none (macOS's /bin/bash is 3.2)."""
import os
import pty
import re
import select
import shutil
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import package_check as pc  # noqa: E402

MANTEL_SH = ROOT / "packaging/lxc/mantel.sh"
INSTALL_SH = ROOT / "packaging/lxc/mantel-install.sh"


def _bash4() -> str | None:
    for cand in (os.environ.get("MANTEL_TEST_BASH"), shutil.which("bash"), "/opt/homebrew/bin/bash",
                 "/usr/local/bin/bash", "/bin/bash"):
        if cand and Path(cand).is_file():
            r = subprocess.run([cand, "-c", "echo ${BASH_VERSINFO[0]}"], capture_output=True, text=True)
            if r.returncode == 0 and r.stdout.strip().isdigit() and int(r.stdout) >= 4:
                return cand
    return None


BASH = _bash4()
pytestmark = pytest.mark.skipif(BASH is None, reason="needs bash 4 or later")
SHOW = 'echo "RESULT [$var_tls][$var_dns][$var_domain][$var_tunnel]"'


def ask(env: dict | None = None) -> subprocess.CompletedProcess:
    """ask_tls with no terminal (stdin is not a tty)."""
    clean = {k: v for k, v in os.environ.items() if not k.startswith("var_")}
    return subprocess.run([BASH, "-c", f'source "{MANTEL_SH}"; ask_tls; {SHOW}'], stdin=subprocess.DEVNULL,
                          capture_output=True, text=True, env={**clean, **(env or {})})


def ask_at_terminal(answers: list[str], env: dict | None = None, timeout: float = 10.0) -> str:
    """ask_tls at a pseudo-terminal, typing each answer when the next prompt appears."""
    clean = {k: v for k, v in os.environ.items() if not k.startswith("var_")}
    pid, fd = pty.fork()
    if pid == 0:  # the child: bash on the terminal
        os.execve(BASH, [BASH, "-c", f'source "{MANTEL_SH}"; ask_tls; {SHOW}'], {**clean, **(env or {})})
    out, pending, deadline = b"", list(answers), time.time() + timeout
    prompts = 0
    try:
        while time.time() < deadline:
            ready, _, _ = select.select([fd], [], [], 0.2)
            if ready:
                try:
                    chunk = os.read(fd, 4096)
                except OSError:
                    break
                if not chunk:
                    break
                out += chunk
            text = out.decode(errors="replace")
            asked = len(re.findall(r"(Choose 1-\d+ \[1\]: |\): |\[y/N\] )", text))
            if asked > prompts and pending:
                prompts = asked
                os.write(fd, (pending.pop(0) + "\n").encode())
            if "RESULT [" in text and text.rstrip().endswith("]"):
                break
    finally:
        os.waitpid(pid, 0)
    return out.decode(errors="replace")


def result(text: str) -> list[str]:
    m = re.search(r"RESULT \[(.*?)\]\[(.*?)\]\[(.*?)\]\[(.*?)\]", text)
    assert m, text
    return list(m.groups())


# -- the HTTPS question -------------------------------------------------------------------------------------
def test_no_terminal_and_no_answer_means_caddys_own_ca():
    r = ask()
    assert r.returncode == 0, r.stderr
    assert result(r.stdout) == ["internal", "", "mantel.home.arpa", "no"]
    assert "Caddy's own certificate authority" in r.stdout


def test_preset_answers_are_kept_and_checked():
    r = ask({"var_tls": "dns01", "var_domain": "mantel.example.com"})
    assert result(r.stdout) == ["dns01", "cloudflare", "mantel.example.com", "no"]   # the DNS host's default
    r = ask({"var_tls": "dns01", "var_dns": "porkbun", "var_domain": "mantel.example.com", "var_tunnel": "yes"})
    assert result(r.stdout) == ["dns01", "porkbun", "mantel.example.com", "yes"]
    r = ask({"var_tls": "own", "var_dns": "porkbun"})                                  # no DNS host without dns01
    assert result(r.stdout)[:2] == ["own", ""]


def test_a_domain_is_required_for_a_real_certificate():
    r = ask({"var_tls": "dns01"})
    assert r.returncode != 0 and "var_domain" in r.stderr
    r = ask({"var_tls": "dns01", "var_dns": "duckdns", "var_domain": "mantel.example.com"})
    assert r.returncode != 0 and "duckdns.org" in r.stderr
    r = ask({"var_tls": "dns01", "var_dns": "duckdns", "var_domain": "sam-home.duckdns.org"})
    assert result(r.stdout)[:3] == ["dns01", "duckdns", "sam-home.duckdns.org"]


def test_variables_refuses_an_unknown_dns_host():
    clean = {k: v for k, v in os.environ.items() if not k.startswith("var_")}
    r = subprocess.run([BASH, "-c", f'source "{MANTEL_SH}"; variables'], capture_output=True, text=True,
                       env={**clean, "var_dns": "namecheap"})
    assert r.returncode != 0 and "var_dns must be" in r.stderr


def test_at_a_terminal_it_asks_and_enter_takes_caddys_own_ca():
    out = ask_at_terminal(["", "", ""])
    assert "How should browsers reach Mantel over HTTPS?" in out
    assert result(out) == ["internal", "", "mantel.home.arpa", "no"]


def test_at_a_terminal_a_domain_asks_for_its_dns_host():
    out = ask_at_terminal(["2", "3", "mantel.example.com", "n"])
    assert "Which DNS host serves your domain?" in out
    for name in ("cloudflare", "duckdns", "porkbun", "route53", "digitalocean", "desec"):
        assert name in out
    assert result(out) == ["dns01", "porkbun", "mantel.example.com", "no"]


# -- updates: version-pinned images follow the source -------------------------------------------------------
def test_version_pinned_images_follow_the_source_version(tmp_path):
    env = tmp_path / ".env"
    env.write_text("MANTEL_HOSTNAME=mantel.example.com\n"
                   "MANTEL_SERVER_IMAGE=ghcr.io/jazzphone/mantel-server:0.1.40\n"
                   "MANTEL_TRANSCODE_IMAGE=ghcr.io/jazzphone/mantel-transcode:latest\n"
                   "MANTEL_CADDY_IMAGE=ghcr.io/jazzphone/mantel-caddy:0.1.40\n"
                   "#MANTEL_SERVER_IMAGE=ghcr.io/jazzphone/mantel-server:0.1.1\n")
    config = tmp_path / "config.yaml"
    config.write_text('name: Mantel\nversion: "0.2.0"\nslug: mantel\n')
    r = subprocess.run([BASH, "-c", f'source "{MANTEL_SH}"; follow_source_version "$1" "$2"', "_", str(env), str(config)],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert env.read_text().splitlines() == [
        "MANTEL_HOSTNAME=mantel.example.com",
        "MANTEL_SERVER_IMAGE=ghcr.io/jazzphone/mantel-server:0.2.0",
        "MANTEL_TRANSCODE_IMAGE=ghcr.io/jazzphone/mantel-transcode:latest",    # :latest is left alone
        "MANTEL_CADDY_IMAGE=ghcr.io/jazzphone/mantel-caddy:0.2.0",
        "#MANTEL_SERVER_IMAGE=ghcr.io/jazzphone/mantel-server:0.1.1",           # and comments
    ]
    real = subprocess.run([BASH, "-c", f'source "{MANTEL_SH}"; source_version "$1"', "_",
                           str(ROOT / "packaging/ha-app/config.yaml")], capture_output=True, text=True)
    assert re.fullmatch(r"\d+\.\d+\.\d+\n", real.stdout)


FAKE_DOCKER = """#!/bin/sh
echo "docker $*" >> "$DOCKER_LOG"
case "$1" in
  images) cat "$FAKE_IMAGES" ;;
  ps) cat "$FAKE_PS" ;;
  info) echo "$FAKE_ROOT" ;;
  rmi) [ -n "${FAKE_RMI_FAIL:-}" ] && [ "$2" = "$FAKE_RMI_FAIL" ] && exit 1 ;;
esac
exit 0
"""


def _fake_docker(tmp_path: Path, images: list[str] = (), ps: list[str] = (), **extra: str) -> dict:
    """An environment whose docker is a stand-in: `docker images` lists IMAGES, `docker ps -a` PS, and each call is
    logged in tmp_path/docker.log (never the real docker: the update tests would otherwise prune this machine's)."""
    bindir = tmp_path / "fake-bin"
    bindir.mkdir(exist_ok=True)
    (bindir / "docker").write_text(FAKE_DOCKER)
    (bindir / "docker").chmod(0o755)
    (tmp_path / "images.txt").write_text("".join(f"{i}\n" for i in images))
    (tmp_path / "ps.txt").write_text("".join(f"{i}\n" for i in ps))
    return {**os.environ, "PATH": f"{bindir}:{os.environ['PATH']}", "DOCKER_LOG": str(tmp_path / "docker.log"),
            "FAKE_IMAGES": str(tmp_path / "images.txt"), "FAKE_PS": str(tmp_path / "ps.txt"),
            "FAKE_ROOT": str(tmp_path), **extra}


def _update(tmp_path, update_sh_exit: int, extra: dict | None = None) -> tuple[subprocess.CompletedProcess, Path]:
    """update_script in an install whose source says 0.2.0 and whose .env pins 0.1.40; update.sh is a stand-in."""
    compose = tmp_path / "packaging/compose"
    compose.mkdir(parents=True)
    (tmp_path / "packaging/ha-app").mkdir(parents=True)
    (tmp_path / "packaging/ha-app/config.yaml").write_text('name: Mantel\nversion: "0.2.0"\n')
    env = compose / ".env"
    env.write_text("MANTEL_HOSTNAME=mantel.example.com\n"
                   "MANTEL_SERVER_IMAGE=ghcr.io/jazzphone/mantel-server:0.1.40\n"
                   "MANTEL_CADDY_IMAGE=ghcr.io/jazzphone/mantel-caddy:0.1.40\n")
    (compose / "update.sh").write_text(f"#!/usr/bin/env bash\ngrep -q ':0.2.0' .env || exit 99\nexit {update_sh_exit}\n")
    r = subprocess.run([BASH, "-c", f'source "{MANTEL_SH}"; INSTALL_DIR="$1"; update_script', "_", str(tmp_path)],
                       capture_output=True, text=True, env=_fake_docker(tmp_path, **(extra or {})))
    return r, env


@pytest.mark.parametrize("update_sh_exit", [1, 3])
def test_a_failed_update_puts_the_image_pins_back(tmp_path, update_sh_exit):
    """DEP-10 (audit, third pass): `update` rewrote .env's image pins to the new version before the images were
    pulled and never put them back when the pull failed (a tag is pushed some minutes before its images exist, and
    v0.1.111's run failed), while update.sh said "nothing was changed". Any failure now restores .env."""
    r, env = _update(tmp_path, update_sh_exit)
    assert r.returncode == update_sh_exit, r.stdout + r.stderr          # update.sh did see the new pins (it exits 99 if not)
    assert ":0.1.40" in env.read_text() and ":0.2.0" not in env.read_text()
    assert "image pins are back as they were" in r.stderr
    assert not (tmp_path / "packaging/compose/.env.before-update").exists()


def test_a_successful_update_keeps_the_new_pins_and_leaves_no_copy(tmp_path):
    r, env = _update(tmp_path, 0)
    assert r.returncode == 0, r.stdout + r.stderr
    assert ":0.2.0" in env.read_text() and ":0.1.40" not in env.read_text()
    assert not (tmp_path / "packaging/compose/.env.before-update").exists()


def test_the_default_install_mode_pulls_published_images_and_falls_back_to_a_build():
    text = MANTEL_SH.read_text()
    assert 'var_install_mode="${var_install_mode:-auto}"' in text
    install = INSTALL_SH.read_text()
    assert 'MODE="${MANTEL_INSTALL_MODE:-auto}"' in install
    for image in ("mantel-server", "mantel-transcode", "mantel-caddy"):
        assert image in install
    assert "MODE=build" in install          # the fallback when this version is not published


# -- mantel-install.sh: each DNS host's secret files --------------------------------------------------------
def _install_function(name: str) -> str:
    text = INSTALL_SH.read_text()
    m = re.search(rf"^{name}\(\) \{{.*?^\}}$", text, re.S | re.M)
    assert m, name
    return m.group(0)


def test_each_dns_hosts_secret_files_are_what_its_snippet_reads():
    func = _install_function("dns_secrets")
    listed = re.search(r'^DNS_SECRETS="([^"]+)"$', INSTALL_SH.read_text(), re.M).group(1).split()
    providers = [m.split("@")[0].rsplit("/", 1)[1]
                 for m in pc.DNS_WITH.findall((ROOT / "packaging/docker/caddy.Dockerfile").read_text())]
    assert len(providers) == 6
    every = []
    for prov in providers:
        r = subprocess.run([BASH, "-c", f'{func}\ndns_secrets "$1"', "_", prov], capture_output=True, text=True)
        assert r.returncode == 0, prov
        snippet = ROOT / f"packaging/compose/caddy/tls-dns01-{prov}.caddy"
        reads, problems = pc._snippet_secrets(snippet.name, snippet.read_text(), prov)
        assert problems == [] and r.stdout.split() == reads, prov
        every += reads
    assert sorted(listed) == sorted(every)
    r = subprocess.run([BASH, "-c", f'{func}\ndns_secrets namecheap'], capture_output=True, text=True)
    assert r.returncode != 0


def test_the_install_turns_the_nightly_backup_on():
    """DEP-2 (audit, second pass): mantel-install.sh made the backups folder but left MANTEL_BACKUP_TARGET empty
    (as .env.example has it), so a new LXC had no backup at all although Backups.md says it runs nightly. The
    generated .env now sets it to /backups, where compose mounts MANTEL_BACKUP_DIR (the folder made next to it)."""
    text = INSTALL_SH.read_text()
    assert 's|^MANTEL_BACKUP_TARGET=.*|MANTEL_BACKUP_TARGET=/backups|' in text
    assert re.search(r"^MANTEL_BACKUP_TARGET=$", (ROOT / "packaging/compose/.env.example").read_text(), re.M)
    assert "${MANTEL_BACKUP_DIR:-./backups}:/backups" in (ROOT / "packaging/compose/compose.yaml").read_text()
    assert 'install -d -m 0750 -o 10001 -g 10001 "$COMPOSE_DIR/backups"' in text


def test_a_source_push_removes_what_the_new_version_deleted(tmp_path):
    """DEP-7 (audit, second pass): push_source extracted the tarball over /opt/mantel, so files deleted or
    renamed upstream stayed: a renamed migration left two files with one number and the server refused to start.
    The code trees are now removed first, never packaging/compose (its .env and backups/), never data or secrets."""
    text = MANTEL_SH.read_text()
    line = next(raw for raw in text.splitlines() if "tar -xzf /root/mantel-src.tar.gz" in raw)
    assert "rm -rf ${trees}" in line and line.index("rm -rf") < line.index("tar -xzf")
    assert "tar -tzf /root/mantel-src.tar.gz" in line and line.index("tar -tzf") < line.index("rm -rf")
    trees = re.search(r'local trees="([^"]+)"', text).group(1).split()
    assert "hosts" in trees and "packaging/lxc" in trees
    for tree in trees:                                          # code only, and each one is in the source
        assert (ROOT / tree).is_dir(), tree
        assert not (tree.startswith(("packaging/compose", "etc")) or tree in ("data", "secrets", "backups")), tree
    assert "packaging/compose" not in trees
    # run for real against a stand-in install: stale files go, .env and backups stay
    install = tmp_path / "opt"
    (install / "hosts/server/migrations").mkdir(parents=True)
    (install / "hosts/server/migrations/0015_push.sql").write_text("old")
    (install / "packaging/compose/backups").mkdir(parents=True)
    (install / "packaging/compose/.env").write_text("KEEP=1\n")
    (install / "packaging/compose/backups/mantel-1.mbk").write_text("backup")
    src = tmp_path / "src"
    (src / "hosts/server/migrations").mkdir(parents=True)
    (src / "hosts/server/migrations/0016_push.sql").write_text("new")
    subprocess.run(["tar", "-czf", str(tmp_path / "s.tar.gz"), "-C", str(src), "."], check=True)
    remove = f"cd {install} && rm -rf {' '.join(trees)} && tar -xzf {tmp_path / 's.tar.gz'} -C {install}"
    assert subprocess.run([BASH, "-c", remove], capture_output=True).returncode == 0
    assert sorted(p.name for p in (install / "hosts/server/migrations").iterdir()) == ["0016_push.sql"]
    assert (install / "packaging/compose/.env").read_text() == "KEEP=1\n"
    assert (install / "packaging/compose/backups/mantel-1.mbk").is_file()


def test_update_turns_the_announcer_on_once_and_off_keeps_it_out(tmp_path):
    """0.1.117: Home Assistant finds Mantel by itself (compose.announce.yaml). An older container gets the announcer
    at its next update, once; MANTEL_ANNOUNCER=off in .env takes it out and keeps it out."""
    r, env = _update(tmp_path, 0)
    assert r.returncode == 0, r.stdout + r.stderr
    text = env.read_text()
    assert "COMPOSE_FILE=compose.yaml:compose.announce.yaml" in text and "MANTEL_ANNOUNCER=on" in text
    t2 = tmp_path / "second"
    t2.mkdir()
    r, env = _update(t2, 0)
    env.write_text(env.read_text().replace("MANTEL_ANNOUNCER=on", "MANTEL_ANNOUNCER=off"))
    r = subprocess.run([BASH, "-c", f'source "{MANTEL_SH}"; INSTALL_DIR="$1"; update_script', "_", str(t2)],
                       capture_output=True, text=True, env=_fake_docker(t2))
    assert "compose.announce.yaml" not in env.read_text().split("COMPOSE_FILE=", 1)[1].splitlines()[0]


# -- old images go once an update is healthy (2026-11-06: 0.1.139's update stopped at 84% used) -------------------
GHCR = "ghcr.io/jazzphone/mantel-"
# the house's LXC on 2026-11-06, plus a Caddy image no container uses (the house has its own proxy) at an old and at
# the running version, a stopped container's old image, and what else a Docker host may hold
HOUSE_IMAGES = [
    f"{GHCR}transcode:0.1.141", f"{GHCR}server:0.1.141", f"{GHCR}caddy:0.1.141",
    "mantel-rollback/mantel-server:previous", f"{GHCR}server:0.1.140",
    "mantel-rollback/go2rtc:previous", f"{GHCR}transcode:0.1.140", "mantel-rollback/caddy:previous",
    f"{GHCR}transcode:0.1.139", f"{GHCR}server:0.1.139", f"{GHCR}server:0.1.138", f"{GHCR}transcode:0.1.138",
    f"{GHCR}transcode:0.1.137", f"{GHCR}server:0.1.137", f"{GHCR}caddy:0.1.130",
    f"{GHCR}server:latest", "mantel-server:local", "ghcr.io/someone-else/mantel-server:0.1.100",
    "ghcr.io/jazzphone/mantel-server-dev:0.1.100", "postgres:16", "<none>:<none>",
]
HOUSE_PS = [f"{GHCR}server:0.1.141", f"{GHCR}server:0.1.141", f"{GHCR}transcode:0.1.141"]


def old_images(tmp_path: Path, images: list[str], ps: list[str]) -> list[str]:
    (tmp_path / "local").write_text("".join(f"{i}\n" for i in images))
    (tmp_path / "in-use").write_text("".join(f"{i}\n" for i in ps))
    r = subprocess.run([BASH, "-c", f'source "{MANTEL_SH}"; old_mantel_images "$1" "$2"', "_",
                        str(tmp_path / "local"), str(tmp_path / "in-use")], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return r.stdout.splitlines()


def test_old_images_are_the_published_tags_older_than_the_running_version_and_the_one_before(tmp_path):
    assert old_images(tmp_path, HOUSE_IMAGES, HOUSE_PS) == [
        f"{GHCR}transcode:0.1.139", f"{GHCR}server:0.1.139", f"{GHCR}server:0.1.138", f"{GHCR}transcode:0.1.138",
        f"{GHCR}transcode:0.1.137", f"{GHCR}server:0.1.137",
        f"{GHCR}caddy:0.1.130",              # an old Caddy no container uses goes; the running version's stays
    ]                                        # the rollback images, :latest, :local and others' images stay


def test_an_image_a_container_uses_stays_whatever_its_version(tmp_path):
    ps = [*HOUSE_PS, f"{GHCR}caddy:0.1.130"]           # a stopped container made from an old image
    assert f"{GHCR}caddy:0.1.130" not in old_images(tmp_path, HOUSE_IMAGES, ps)


def test_versions_are_compared_as_versions(tmp_path):
    images = [f"{GHCR}server:0.1.100", f"{GHCR}server:0.1.99", f"{GHCR}server:0.1.98", f"{GHCR}server:0.1.101"]
    # a newer image than the running one (pulled, never started) is not "old"; 0.1.99 is the one before 0.1.100
    assert old_images(tmp_path, images, [f"{GHCR}server:0.1.100"]) == [f"{GHCR}server:0.1.98"]


@pytest.mark.parametrize("ps", [[], ["mantel-server:local", "mantel-rollback/mantel-server:previous"],
                                [f"{GHCR}server:latest", "sha256:6f88f8534665"]])
def test_nothing_is_removed_when_no_container_runs_a_published_version(tmp_path, ps):
    assert old_images(tmp_path, HOUSE_IMAGES, ps) == []


def prune(tmp_path: Path, **extra: str) -> subprocess.CompletedProcess:
    return subprocess.run([BASH, str(MANTEL_SH), "prune-images"], capture_output=True, text=True,
                          env=_fake_docker(tmp_path, HOUSE_IMAGES, HOUSE_PS, **extra))


def test_prune_images_removes_each_old_tag_by_name_and_says_so_in_one_line(tmp_path):
    r = prune(tmp_path)
    assert r.returncode == 0, r.stderr
    log = (tmp_path / "docker.log").read_text()
    removed = [line.split(" ", 2)[2] for line in log.splitlines() if line.startswith("docker rmi ")]
    (tmp_path / "selection").mkdir()
    assert removed == old_images(tmp_path / "selection", HOUSE_IMAGES, HOUSE_PS)
    assert "prune" not in log.replace("prune-images", "") and " -f" not in log and "--force" not in log
    assert len(r.stdout.splitlines()) == 1, r.stdout
    assert r.stdout.startswith("Removed 7 old Mantel image tags (0.1.139, 0.1.138, 0.1.137, 0.1.130): freed ")
    assert "the disk is " in r.stdout and "% used" in r.stdout


def test_a_tag_that_cannot_be_removed_never_fails(tmp_path):
    r = prune(tmp_path, FAKE_RMI_FAIL=f"{GHCR}server:0.1.138")
    assert r.returncode == 0 and "Removed 6 old Mantel image tags" in r.stdout and "1 could not be removed" in r.stdout
    t2 = tmp_path / "no-docker"
    t2.mkdir()
    env = _fake_docker(t2)
    (t2 / "fake-bin/docker").write_text("#!/bin/sh\nexit 1\n")      # docker itself fails
    r = subprocess.run([BASH, str(MANTEL_SH), "prune-images"], capture_output=True, text=True, env=env)
    assert r.returncode == 0 and r.stdout.startswith("No old Mantel images to remove"), r.stdout + r.stderr


def test_a_healthy_update_removes_old_images_and_a_failed_one_does_not(tmp_path):
    (tmp_path / "ok").mkdir()
    r, _ = _update(tmp_path / "ok", 0)
    assert r.returncode == 0 and "ok: No old Mantel images to remove" in r.stdout, r.stdout + r.stderr
    assert "docker images" in (tmp_path / "ok/docker.log").read_text()
    for name, rc, extra in (("failed", 1, {}), ("later", 0, {"MANTEL_PRUNE_LATER": "1"})):
        (tmp_path / name).mkdir()
        r, _ = _update(tmp_path / name, rc, extra)
        assert r.returncode == rc and "Mantel images" not in r.stdout, r.stdout + r.stderr
        assert not (tmp_path / name / "docker.log").exists()
