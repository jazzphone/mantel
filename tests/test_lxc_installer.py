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
