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


def _update(tmp_path, update_sh_exit: int) -> tuple[subprocess.CompletedProcess, Path]:
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
                       capture_output=True, text=True)
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
                       capture_output=True, text=True)
    assert "compose.announce.yaml" not in env.read_text().split("COMPOSE_FILE=", 1)[1].splitlines()[0]
