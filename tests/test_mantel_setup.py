"""packaging/lxc/mantel-setup.sh: how browsers reach Mantel in the LXC, chosen at the install and changed any time.

Every install starts on "try" (this container's address, Mantel's own certificate), so Mantel always comes up. The
other ways rewrite .env's HTTPS lines and keep the rest (the GPU, Mantel Connect); a DNS token is typed hidden into its
secret file or the saved one kept; a missing token or proxy address stays on "try" and says so. Run against a copy of
.env with stand-ins for docker, id and chown. Needs bash 4 or later (Proxmox has 5)."""
import os
import pty
import select
import shutil
import subprocess
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SETUP = ROOT / "packaging/lxc/mantel-setup.sh"
IP = "192.0.2.10"


def _bash4() -> str | None:
    for cand in (os.environ.get("MANTEL_TEST_BASH"), shutil.which("bash"), "/opt/homebrew/bin/bash", "/usr/local/bin/bash",
                 "/bin/bash"):
        if cand and Path(cand).is_file():
            r = subprocess.run([cand, "-c", "echo ${BASH_VERSINFO[0]}"], capture_output=True, text=True)
            if r.stdout.strip().isdigit() and int(r.stdout) >= 4:
                return cand
    return None


BASH = _bash4()
pytestmark = pytest.mark.skipif(BASH is None, reason="needs bash 4 or later")


@pytest.fixture
def lxc(tmp_path):
    """packaging/compose as the install leaves it: on "try", with the GPU's compose file; empty secret files."""
    compose = tmp_path / "compose"
    compose.mkdir()
    env = (ROOT / "packaging/compose/.env.example").read_text()
    for key, value in (("MANTEL_HOSTNAME", IP), ("MANTEL_LAN_IP", IP), ("MANTEL_ALLOW_HOSTS", IP),
                       ("MANTEL_TLS_SNIPPET", "./caddy/tls-internal.caddy")):
        env = "\n".join(f"{key}={value}" if line.startswith(f"{key}=") else line for line in env.splitlines()) + "\n"
    env += "COMPOSE_FILE=compose.yaml:compose.gpu.yaml\nMANTEL_RENDER_GID=104\n"
    (compose / ".env").write_text(env)
    secrets = tmp_path / "secrets"
    secrets.mkdir()
    for f in ("cloudflare_dns_token", "porkbun_api_key", "porkbun_secret_api_key"):
        (secrets / f).write_text("")
    bin_ = tmp_path / "bin"
    bin_.mkdir()
    for name, body in (("docker", 'echo "docker $*" >> "$DOCKER_LOG"'), ("id", '[ "$1" = -u ] && echo 0 || exec /usr/bin/id "$@"'),
                       ("chown", "exit 0")):
        (bin_ / name).write_text(f"#!/bin/sh\n{body}\n")
        (bin_ / name).chmod(0o755)
    return tmp_path


def environ(lxc: Path, **extra: str) -> dict:
    clean = {k: v for k, v in os.environ.items() if not k.startswith("MANTEL_")}
    return {**clean, "PATH": f"{lxc / 'bin'}:{os.environ['PATH']}", "DOCKER_LOG": str(lxc / "docker.log"),
            "MANTEL_COMPOSE_DIR": str(lxc / "compose"), "MANTEL_SECRETS_DIR": str(lxc / "secrets"), **extra}


def setup(lxc: Path, *args: str, **answers: str) -> subprocess.CompletedProcess:
    return subprocess.run([BASH, str(SETUP), *args], stdin=subprocess.DEVNULL, capture_output=True, text=True,
                          env=environ(lxc, **answers))


def env_of(lxc: Path) -> dict:
    out = {}
    for line in (lxc / "compose/.env").read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, _, v = line.partition("=")
            out[k] = v
    return out


def docker_calls(lxc: Path) -> list[str]:
    log = lxc / "docker.log"
    return log.read_text().splitlines() if log.exists() else []


def test_with_no_answers_it_stays_on_try_and_the_install_starts_nothing(lxc):
    r = setup(lxc, "--install")
    assert r.returncode == 0, r.stderr
    e = env_of(lxc)
    assert e["MANTEL_HOSTNAME"] == IP and e["MANTEL_TLS_SNIPPET"] == "./caddy/tls-internal.caddy"
    assert e["COMPOSE_FILE"] == "compose.yaml:compose.gpu.yaml"
    assert docker_calls(lxc) == [], "the install starts Mantel itself"
    assert f"https://{IP}/login" in r.stdout and "passkeys are off" in r.stdout


def test_a_name_on_the_network_restarts_mantel_with_it(lxc):
    r = setup(lxc, MANTEL_TLS="internal", MANTEL_DOMAIN="mantel.home.arpa")
    assert r.returncode == 0, r.stderr
    e = env_of(lxc)
    assert e["MANTEL_HOSTNAME"] == "mantel.home.arpa" and e["MANTEL_ALLOW_HOSTS"] == IP
    assert any("compose up -d --wait" in c for c in docker_calls(lxc))
    assert f"once mantel.home.arpa points at {IP}" in r.stdout


def test_a_domain_without_its_token_stays_on_try_and_says_so(lxc):
    r = setup(lxc, MANTEL_TLS="dns01", MANTEL_DNS="cloudflare", MANTEL_DOMAIN="mantel.example.com")
    assert r.returncode == 0, r.stderr
    assert "Not yet: dns01 needs cloudflare_dns_token" in r.stdout
    assert env_of(lxc)["MANTEL_HOSTNAME"] == IP


def test_a_domain_with_its_saved_token(lxc):
    (lxc / "secrets/cloudflare_dns_token").write_text("fictional-token")
    r = setup(lxc, MANTEL_TLS="dns01", MANTEL_DNS="cloudflare", MANTEL_DOMAIN="mantel.example.com")
    assert r.returncode == 0, r.stderr
    e = env_of(lxc)
    assert e["MANTEL_HOSTNAME"] == "mantel.example.com"
    assert e["MANTEL_TLS_SNIPPET"] == "./caddy/tls-dns01-cloudflare.caddy"
    assert e["COMPOSE_FILE"] == "compose.yaml:compose.gpu.yaml"


def test_another_dns_host_adds_its_compose_file_and_keeps_the_gpus(lxc):
    for f in ("porkbun_api_key", "porkbun_secret_api_key"):
        (lxc / "secrets" / f).write_text("fictional")
    r = setup(lxc, MANTEL_TLS="dns01", MANTEL_DNS="porkbun", MANTEL_DOMAIN="mantel.example.com")
    assert r.returncode == 0, r.stderr
    e = env_of(lxc)
    assert e["COMPOSE_FILE"] == "compose.yaml:compose.dns-porkbun.yaml:compose.gpu.yaml"
    assert "MANTEL_TLS_SNIPPET" not in e, "compose.dns-porkbun.yaml mounts its own snippet"


def test_own_proxy_then_back_to_try(lxc):
    r = setup(lxc, MANTEL_TLS="own", MANTEL_DOMAIN="mantel.example.com", MANTEL_PROXY_IP="192.0.2.254")
    assert r.returncode == 0, r.stderr
    e = env_of(lxc)
    assert e["COMPOSE_FILE"] == "compose.yaml:compose.byo-proxy.yaml:compose.gpu.yaml"
    assert e["MANTEL_TRUSTED_PROXY"] == "192.0.2.254" and e["MANTEL_HTTP_BIND"] == IP
    assert any("compose stop caddy" in c for c in docker_calls(lxc))
    assert f"http://{IP}:8765" in r.stdout and "door-key" in r.stdout
    r = setup(lxc, MANTEL_TLS="try")
    assert r.returncode == 0, r.stderr
    e = env_of(lxc)
    assert e["COMPOSE_FILE"] == "compose.yaml:compose.gpu.yaml" and e["MANTEL_HOSTNAME"] == IP
    assert "MANTEL_TRUSTED_PROXY" not in e and "MANTEL_HTTP_BIND" not in e


def test_own_proxy_without_its_address_stays_on_try(lxc):
    r = setup(lxc, MANTEL_TLS="own", MANTEL_DOMAIN="mantel.example.com")
    assert r.returncode == 0, r.stderr
    assert "your proxy's address" in r.stdout and env_of(lxc)["MANTEL_HOSTNAME"] == IP


def test_a_wrong_answer_is_refused(lxc):
    assert "must be try, internal, dns01 or own" in setup(lxc, MANTEL_TLS="https").stderr
    assert "unknown DNS host" in setup(lxc, MANTEL_TLS="dns01", MANTEL_DNS="nope").stderr
    assert "<name>.duckdns.org" in setup(lxc, MANTEL_TLS="dns01", MANTEL_DNS="duckdns", MANTEL_DOMAIN="mantel.example.com").stderr


def at_terminal(lxc: Path, answers: list[tuple[str, str]], timeout: float = 15.0) -> str:
    """mantel-setup at a pseudo-terminal: each answer typed when its prompt (a piece of text) appears."""
    pid, fd = pty.fork()
    if pid == 0:
        os.execve(BASH, [BASH, str(SETUP)], environ(lxc))
    out, pending, deadline = b"", list(answers), time.time() + timeout
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
            if pending and pending[0][0].encode() in out.split(b"\n")[-1]:
                os.write(fd, pending.pop(0)[1].encode() + b"\r")
    finally:
        os.waitpid(pid, 0)
    return out.decode(errors="replace")


def test_at_a_terminal_a_typo_asks_again_and_the_token_is_typed_hidden(lxc):
    out = at_terminal(lxc, [("Choose 1-4", "9"), ("Choose 1-4", "3"), ("Your DNS host", ""),
                            ("The name browsers will use", "mantel.example.com"),
                            ("Value for cloudflare_dns_token", "fictional-typed-token")])
    assert "Type 1, 2, 3 or 4." in out
    assert "fictional-typed-token" not in out, "a token is never echoed"
    token = lxc / "secrets/cloudflare_dns_token"
    assert token.read_text() == "fictional-typed-token" and oct(token.stat().st_mode)[-3:] == "440", out[-1500:]
    assert env_of(lxc)["MANTEL_HOSTNAME"] == "mantel.example.com"


def test_a_domain_without_a_name_says_so(lxc):
    r = setup(lxc, MANTEL_TLS="dns01", MANTEL_DNS="cloudflare")
    assert r.returncode == 1 and "a name is needed for dns01" in r.stderr
