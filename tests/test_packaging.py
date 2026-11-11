"""P3.6 packaging: static validation of the image, compose stack, Caddy, LXC script and HA App,
plus the code that ships with them (health endpoint, entrypoint, listen-address option, asset stamp).

No Docker, no network. Build/run verification is listed in docs/phase3/PACKAGING.md.
"""
import os
import re
import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import package_check as pc  # noqa: E402


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


entrypoint = _load(ROOT / "packaging/docker/entrypoint.py", "mantel_entrypoint")
build_static = _load(ROOT / "tools/build_static.py", "mantel_build_static")

GOOD_DOCKERFILE = f"""
ARG PY=python:3.12-slim@sha256:{'a' * 64}
FROM ${{PY}} AS base
ENV PYTHONUNBUFFERED=1
RUN useradd -u 10001 app
FROM base AS server
USER 10001:10001
HEALTHCHECK CMD ["true"]
"""


# -- the real repository -----------------------------------------------------------------------------------
def test_repository_packaging_is_clean():
    assert pc.run_all() == []


def test_release_mode_refuses_placeholder_digests(tmp_path):
    # every base image in the repo is pinned (2026-10-18): release mode is clean...
    assert pc.run_all(release=True) == []
    # ...and still refuses an all-zero placeholder wherever one appears
    df = tmp_path / "Dockerfile"
    text = (ROOT / "packaging/docker/Dockerfile").read_text()
    pinned = re.search(r"python:3\.12-slim-trixie@(sha256:[0-9a-f]{64})", text).group(1)
    df.write_text(text.replace(pinned, pc.ZERO_DIGEST, 1))
    problems = pc.check_dockerfile(df, release=True)
    assert any("placeholder digest" in p for p in problems), problems


def test_dockerfile_user_healthcheck_and_no_secret_env():
    ins = pc.dockerfile_instructions((ROOT / "packaging/docker/Dockerfile").read_text())
    users = [a for w, a in ins if w == "USER"]
    assert users and users[-1].startswith("10001") and "USER root" not in " ".join(f"USER {u}" for u in users[:1])
    assert any(w == "HEALTHCHECK" and "mantel_server.health" in a for w, a in ins)
    assert not [a for w, a in ins if w in ("ENV", "ARG") and pc.SECRETISH.search(a.split("=")[0])]


def test_compose_secrets_are_files_and_cloudflared_is_isolated():
    doc = pc.parse_yaml((ROOT / "packaging/compose/compose.yaml").read_text())
    assert doc["secrets"] and all(set(v) == {"file"} for v in doc["secrets"].values())
    svc = doc["services"]
    assert set(svc["cloudflared"]["networks"]) == {"tunnel", "cf_out"}
    assert svc["cloudflared"]["profiles"] == ["tunnel"]
    assert doc["networks"]["tunnel"]["internal"] is True and doc["networks"]["backend"]["internal"] is True
    members = {s for s, v in svc.items() if "tunnel" in v.get("networks", {})}
    assert members == {"caddy", "cloudflared"}
    assert "ports" not in svc["cloudflared"]
    # mantel-server publishes only the Intercom's listener (phase 17), the same in Caddy and own-proxy modes: not 8765
    assert svc["mantel-server"]["ports"] == ['${MANTEL_STREAM_BIND:-0.0.0.0}:${MANTEL_STREAM_PORT:-8767}:8767']
    assert svc["mantel-server"]["environment"]["MANTEL_STREAM_INTERNAL_PORT"] == "8767"
    assert "devices" not in svc["go2rtc"]  # /dev/dri is only in compose.gpu.yaml
    gpu = pc.parse_yaml((ROOT / "packaging/compose/compose.gpu.yaml").read_text())
    assert gpu["services"]["go2rtc"]["devices"] == ["/dev/dri:/dev/dri"]


def test_lxc_script_is_unprivileged_debian13_with_gpu():
    text = (ROOT / "packaging/lxc/mantel.sh").read_text()
    assert 'var_unprivileged="${var_unprivileged:-1}"' in text
    assert 'var_gpu="${var_gpu:-yes}"' in text and 'var_version="${var_version:-13}"' in text
    assert "--features nesting=1,keyctl=1" in text and "-dev0" in text


def test_no_env_file_is_committed_and_example_has_no_secrets():
    root = ROOT
    assert not (root / ".env").exists() and not (root / "packaging/compose/.env").exists()
    assert pc.check_no_committed_secrets() == []
    ignored = (root / ".gitignore").read_text()
    assert ".env" in ignored and "!.env.example" in ignored


@pytest.mark.skipif(shutil.which("bash") is None, reason="no bash")
@pytest.mark.parametrize("script", ["packaging/lxc/mantel.sh", "packaging/lxc/mantel-install.sh", "packaging/compose/update.sh"])
def test_shell_scripts_parse(script):
    assert subprocess.run(["bash", "-n", str(ROOT / script)], capture_output=True).returncode == 0


FAKE_DOCKER = """#!/usr/bin/env bash
# a stand-in for docker: logs each call; answers the few questions update.sh asks
echo "$*" >> "$FAKE_LOG"
case "$*" in
  "compose ps -q "*) echo "cid-${4}" ;;
  "inspect "*) echo "sha256:running" ;;
  "compose config --images") printf '%s\\n' $FAKE_IMAGES ;;
  "pull "*) [ "$2" != "$FAKE_PULL_FAILS" ] ;;
  "compose up -d --wait --wait-timeout 180") [ -z "$FAKE_UP_FAILS" ] ;;
  "compose up -d --wait --wait-timeout 180 --pull never") [ -z "$FAKE_ROLLBACK_FAILS" ] ;;
  "compose exec "*) [ -z "$FAKE_EXEC_FAILS" ] && echo "backup written: /backups/mantel-20261101-031500.mbk (4096 bytes)" ;;
esac
"""


def _run_update(tmp_path, images, pull_fails="", up_fails="", exec_fails="", rollback_fails="", env_file=""):
    work = tmp_path / "compose"
    work.mkdir(parents=True)
    if env_file:
        (work / ".env").write_text(env_file)
    shutil.copy(ROOT / "packaging/compose/update.sh", work / "update.sh")
    bindir = tmp_path / "bin"
    bindir.mkdir()
    (bindir / "docker").write_text(FAKE_DOCKER)
    (bindir / "docker").chmod(0o755)
    log = tmp_path / "docker.log"
    env = {"PATH": f"{bindir}:/usr/bin:/bin", "FAKE_LOG": str(log), "FAKE_IMAGES": " ".join(images),
           "FAKE_PULL_FAILS": pull_fails, "FAKE_UP_FAILS": up_fails, "FAKE_EXEC_FAILS": exec_fails,
           "FAKE_ROLLBACK_FAILS": rollback_fails}
    r = subprocess.run(["bash", str(work / "update.sh")], env=env, capture_output=True, text=True)
    return r, log.read_text().splitlines()


@pytest.mark.skipif(shutil.which("bash") is None, reason="no bash")
def test_update_pulls_published_images_although_the_services_can_be_built(tmp_path):
    """Every Mantel service in compose.yaml has a build: section, so `docker compose pull --ignore-buildable`
    skipped all three and an update restarted the old images. update.sh now pulls each registry image the
    stack names, and only those: the :local images are built on this host."""
    doc = pc.parse_yaml((ROOT / "packaging/compose/compose.yaml").read_text())
    assert all("build" in doc["services"][s] for s in ("mantel-server", "go2rtc", "caddy"))
    assert "--ignore-buildable" not in "\n".join(
        line for line in (ROOT / "packaging/compose/update.sh").read_text().splitlines() if not line.lstrip().startswith("#"))
    server = "ghcr.io/jazzphone/mantel-server@sha256:" + "a" * 64
    r, calls = _run_update(tmp_path, [server, "ghcr.io/jazzphone/mantel-transcode:stable", "mantel-caddy:local"])
    assert r.returncode == 0, r.stdout + r.stderr
    assert [c for c in calls if c.startswith("pull ")] == [f"pull {server}", "pull ghcr.io/jazzphone/mantel-transcode:stable"]
    assert "not pulling mantel-caddy:local" in r.stdout
    assert calls.index(f"pull {server}") < calls.index("compose up -d --wait --wait-timeout 180")
    # the running images are kept for the rollback first, Caddy's too
    assert calls.index("tag sha256:running mantel-rollback/caddy:previous") < calls.index(f"pull {server}")


@pytest.mark.skipif(shutil.which("bash") is None, reason="no bash")
def test_update_stops_before_restarting_when_a_pull_fails_and_rolls_back_when_unhealthy(tmp_path):
    server = "ghcr.io/jazzphone/mantel-server:stable"
    r, calls = _run_update(tmp_path / "1", [server], pull_fails=server)
    assert r.returncode == 1 and "could not pull" in r.stdout
    assert not any(c.startswith("compose up") for c in calls)
    r, calls = _run_update(tmp_path / "2", [server], up_fails="1")
    assert r.returncode == 1 and "rolling back" in r.stdout
    assert calls[-1] == "compose up -d --wait --wait-timeout 180 --pull never"
    # all local: nothing pulled, and the update says how a build from source is updated
    r, calls = _run_update(tmp_path / "3", ["mantel-server:local", "mantel-transcode:local", "mantel-caddy:local"])
    assert r.returncode == 0 and not any(c.startswith("pull ") for c in calls)
    assert "no image comes from a registry" in r.stdout


@pytest.mark.skipif(shutil.which("bash") is None, reason="no bash")
def test_update_that_cannot_roll_back_prints_the_restore_command_for_its_own_backup(tmp_path):
    """DEP-16 (audit, third pass): when the new version migrated and then failed its health check, the old image
    refused the database (schema_too_new), the rollback's `up` failed under set -e and update.sh exited with no
    words (the LXC wrapper then said the old version "is running again"). Now it says Mantel is NOT running,
    prints the exact restore.sh command for the backup it made, and exits 3."""
    server = "ghcr.io/jazzphone/mantel-server:0.1.99"
    r, calls = _run_update(tmp_path / "1", [server], up_fails="1", rollback_fails="1", env_file="MANTEL_BACKUP_DIR=/srv/mantel-backups\n")
    assert r.returncode == 3, r.stdout + r.stderr
    assert "NOT running" in r.stdout and "schema_too_new" in r.stdout and "rolled back; see" not in r.stdout
    assert "./restore.sh /srv/mantel-backups/mantel-20261101-031500.mbk" in r.stdout
    # the default backups folder is ./backups beside the compose file
    r, _ = _run_update(tmp_path / "2", [server], up_fails="1", rollback_fails="1")
    assert r.returncode == 3 and "./restore.sh ./backups/mantel-20261101-031500.mbk" in r.stdout
    # a rollback that works is still a plain failure (1), as before
    r, _ = _run_update(tmp_path / "3", [server], up_fails="1")
    assert r.returncode == 1 and "rolled back; see" in r.stdout and "NOT running" not in r.stdout


@pytest.mark.skipif(shutil.which("caddy") is None, reason="caddy not installed")
def test_caddyfile_validates(tmp_path):
    (tmp_path / "tls.caddy").write_text((ROOT / "packaging/compose/caddy/tls-internal.caddy").read_text())
    text = (ROOT / "packaging/compose/caddy/Caddyfile").read_text().replace("/etc/caddy/tls.caddy", str(tmp_path / "tls.caddy"))
    (tmp_path / "Caddyfile").write_text(text)
    r = subprocess.run([shutil.which("caddy"), "validate", "--config", str(tmp_path / "Caddyfile"), "--adapter", "caddyfile"],
                       capture_output=True, text=True, cwd=tmp_path,   # `tls internal` writes a local CA: keep it in tmp
                       env={"MANTEL_HOSTNAME": "mantel.example.com", "PATH": "/usr/bin:/bin:/opt/homebrew/bin",
                            "HOME": str(tmp_path), "XDG_DATA_HOME": str(tmp_path / "data"), "XDG_CONFIG_HOME": str(tmp_path / "cfg")})
    assert r.returncode == 0, r.stderr[-800:]


# -- the checker bites -------------------------------------------------------------------------------------
def _dockerfile(tmp_path, text):
    p = tmp_path / "Dockerfile"
    p.write_text(text)
    return p


def test_good_dockerfile_passes(tmp_path):
    assert pc.check_dockerfile(_dockerfile(tmp_path, GOOD_DOCKERFILE)) == []


@pytest.mark.parametrize("edit, expect", [
    (lambda t: t.replace("USER 10001:10001", "USER root"), "non-root USER"),
    (lambda t: t.replace("USER 10001:10001\n", ""), "non-root USER"),
    (lambda t: t.replace('HEALTHCHECK CMD ["true"]', ""), "HEALTHCHECK"),
    (lambda t: t.replace("ENV PYTHONUNBUFFERED=1", "ENV HA_TOKEN=abc"), "looks like a secret"),
    (lambda t: t.replace("ENV PYTHONUNBUFFERED=1", "ARG API_KEY=abc"), "looks like a secret"),
    (lambda t: t.replace(f"@sha256:{'a' * 64}", ""), "not pinned by digest"),
    (lambda t: t + "COPY .env /app/.env\n", "secret-looking path"),
    (lambda t: t.replace("RUN useradd -u 10001 app", "RUN curl https://x.example/i.sh | sh"), "pipes a download"),
    (lambda t: t.replace("PYTHONUNBUFFERED=1", "TZ=eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJhYmNkZWYifQ.abcdefghij"), "credential"),
])
def test_dockerfile_violations_are_found(tmp_path, edit, expect):
    problems = pc.check_dockerfile(_dockerfile(tmp_path, edit(GOOD_DOCKERFILE)))
    assert any(expect in p for p in problems), problems


def test_placeholder_digest_only_fails_in_release_mode(tmp_path):
    text = GOOD_DOCKERFILE.replace("a" * 64, "0" * 64)
    path = _dockerfile(tmp_path, text)
    assert pc.check_dockerfile(path) == []
    assert any("placeholder" in p for p in pc.check_dockerfile(path, release=True))


GOOD_COMPOSE = """
services:
  caddy:
    image: caddy
    read_only: true
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
    security_opt:
      - no-new-privileges:true
    mem_limit: 1g
    cpus: 1
    ports:
      - "443:443"
    healthcheck:
      test: ["CMD", "true"]
    networks:
      backend: {}
      tunnel:
        ipv4_address: 172.31.250.2
  mantel-server:
    image: m
    read_only: true
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    mem_limit: 1g
    cpus: 1
    secrets:
      - ha_token
    healthcheck:
      test: ["CMD", "true"]
    networks:
      - backend
  cloudflared:
    profiles:
      - tunnel
    image: c
    read_only: true
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    mem_limit: 1g
    cpus: 1
    networks:
      tunnel:
        ipv4_address: 172.31.250.3
      cf_out: {}
networks:
  backend:
    internal: true
  tunnel:
    internal: true
    ipam:
      config:
        - subnet: 172.31.250.0/29
  cf_out: {}
secrets:
  ha_token:
    file: /etc/hk/secrets/ha_token
"""


def _compose(tmp_path, text):
    p = tmp_path / "compose.yaml"
    p.write_text(text)
    return p


def test_good_compose_passes(tmp_path):
    assert pc.check_compose(_compose(tmp_path, GOOD_COMPOSE)) == []


@pytest.mark.parametrize("edit, expect", [
    (lambda t: t.replace("    cap_drop:\n      - ALL\n    security_opt:\n      - no-new-privileges:true\n    mem_limit: 1g\n    cpus: 1\n    secrets:",
                         "    security_opt:\n      - no-new-privileges:true\n    mem_limit: 1g\n    cpus: 1\n    secrets:"), "cap_drop must include ALL"),
    (lambda t: t.replace("      - no-new-privileges:true\n    mem_limit: 1g\n    cpus: 1\n    secrets:", "    mem_limit: 1g\n    cpus: 1\n    secrets:"), "no-new-privileges"),
    (lambda t: t.replace("    image: m\n    read_only: true", "    image: m\n    read_only: false"), "read_only"),
    (lambda t: t.replace("    file: /etc/hk/secrets/ha_token", "    environment: HA_TOKEN"), "must be a file"),
    (lambda t: t.replace("    image: m\n", "    image: m\n    environment:\n      HA_TOKEN: x\n"), "looks like a secret"),
    (lambda t: t.replace("    image: m\n", "    image: m\n    privileged: true\n"), "privileged"),
    (lambda t: t.replace("    image: m\n", "    image: m\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n"), "Docker socket"),
    (lambda t: t.replace("      cf_out: {}\nnetworks:", "      cf_out: {}\n      backend: {}\nnetworks:"), "tunnel network"),
    (lambda t: t.replace("  tunnel:\n    internal: true\n    ipam", "  tunnel:\n    ipam"), "must be internal"),
    (lambda t: t.replace("  backend:\n    internal: true", "  backend: {}"), "backend must be internal"),
    (lambda t: t.replace("    image: m\n", "    image: m\n    ports:\n      - \"8765:8765\"\n"), "publishes ports"),
    (lambda t: t.replace("    image: m\n", "    image: m\n    cap_add:\n      - SYS_ADMIN\n"), "cap_add"),
    (lambda t: t.replace("    secrets:\n      - ha_token", "    secrets:\n      - other"), "undeclared secret"),
])
def test_compose_violations_are_found(tmp_path, edit, expect):
    problems = pc.check_compose(_compose(tmp_path, edit(GOOD_COMPOSE)))
    assert any(expect in p for p in problems), problems


def test_compose_outside_the_yaml_subset_is_reported(tmp_path):
    problems = pc.check_compose(_compose(tmp_path, GOOD_COMPOSE.replace("image: m", "image: &m x")))
    assert any("supported YAML subset" in p for p in problems)


def test_lxc_script_violations_are_found(tmp_path):
    good = (ROOT / "packaging/lxc/mantel.sh").read_text()
    for edit, expect in [
        (lambda t: t.replace('var_unprivileged="${var_unprivileged:-1}"', 'var_unprivileged="${var_unprivileged:-0}"'), "var_unprivileged must default to 1"),
        (lambda t: t.replace('--unprivileged "$var_unprivileged"', "--unprivileged 0"), "privileged container"),
        (lambda t: t.replace('var_gpu="${var_gpu:-yes}"', 'var_gpu="${var_gpu:-no}"'), "var_gpu"),
        (lambda t: t + "\ncurl -fsSL https://x.example/i.sh | bash\n", "pipes a download"),
    ]:
        d = tmp_path / expect.replace(" ", "_")
        d.mkdir()
        (d / "mantel.sh").write_text(edit(good))
        shutil.copy(ROOT / "packaging/lxc/mantel-install.sh", d / "mantel-install.sh")
        problems = pc.check_lxc_script(d / "mantel.sh")
        assert any(expect in p for p in problems), (expect, problems)


def test_lxc_installer_offers_the_https_choice(tmp_path):
    text = (ROOT / "packaging/lxc/mantel.sh").read_text()
    assert "dns01" in text and "internal" in text and "own" in text and "var_tunnel" in text
    install = (ROOT / "packaging/lxc/mantel-install.sh").read_text()
    assert "compose.byo-proxy.yaml" in install and "MANTEL_TRUSTED_PROXY=" in install
    d = tmp_path / "x"
    d.mkdir()
    (d / "mantel.sh").write_text(text.replace('MANTEL_TLS="$var_tls"', ""))
    shutil.copy(ROOT / "packaging/lxc/mantel-install.sh", d / "mantel-install.sh")
    assert any("HTTPS choice" in m for m in pc.check_lxc_script(d / "mantel.sh"))


def test_caddy_violations_are_found(tmp_path):
    good = (ROOT / "packaging/compose/caddy/Caddyfile").read_text()
    assert pc.check_caddyfile(ROOT / "packaging/compose/caddy/Caddyfile") == []
    for edit, expect in [
        # Mantel Server sets its own CSP; a second one from Caddy would be enforced too (breaks /ma/)
        (lambda t: t.replace("-Server", '-Server\n\t\tContent-Security-Policy "default-src \'none\'"'),
         "sets a Content-Security-Policy"),
        (lambda t: t.replace("request_header -X-Remote-User-Id", "# gone"), "X-Remote-User-Id"),
        (lambda t: t.replace("admin off", "admin localhost:2019"), "admin API"),
    ]:
        p = tmp_path / "Caddyfile"
        p.write_text(edit(good))
        assert any(expect in m for m in pc.check_caddyfile(p)), expect


DNS_PROVIDERS = ("cloudflare", "duckdns", "porkbun", "route53", "digitalocean", "desec")


def test_the_dns_providers_are_pinned_and_each_has_its_snippet_and_secrets():
    assert pc.check_dns_providers() == []
    modules = pc.DNS_WITH.findall((ROOT / "packaging/docker/caddy.Dockerfile").read_text())
    assert sorted(m.split("@")[0].rsplit("/", 1)[1] for m in modules) == sorted(DNS_PROVIDERS)
    assert all("@v" in m for m in modules)
    # tls-dns01.caddy (existing installs) is still the Cloudflare snippet, and the base stack keeps its secret
    old = (ROOT / "packaging/compose/caddy/tls-dns01.caddy").read_text()
    assert "dns cloudflare {file./run/secrets/cloudflare_dns_token}" in old
    assert "dns cloudflare {file./run/secrets/cloudflare_dns_token}" in \
        (ROOT / "packaging/compose/caddy/tls-dns01-cloudflare.caddy").read_text()
    doc = pc.parse_yaml((ROOT / "packaging/compose/compose.yaml").read_text())
    assert "cloudflare_dns_token" in doc["services"]["caddy"]["secrets"]
    # a new installation (.env.example) gets Caddy's own CA unless it chooses otherwise
    env = (ROOT / "packaging/compose/.env.example").read_text()
    assert re.findall(r"^MANTEL_TLS_SNIPPET=(.*)$", env, re.M) == ["./caddy/tls-internal.caddy"]
    for prov in DNS_PROVIDERS[1:]:
        assert f"compose.dns-{prov}.yaml" in env


def _dns_tree(tmp_path) -> Path:
    root = tmp_path / "repo"
    shutil.copytree(ROOT / "packaging", root / "packaging",
                    ignore=shutil.ignore_patterns("proof4", "mantel-connect", "__pycache__"))
    return root


@pytest.mark.parametrize("path, edit, expect", [
    ("packaging/docker/caddy.Dockerfile", lambda t: t.replace("porkbun@v0.3.1", "porkbun"), "porkbun is not pinned"),
    ("packaging/docker/caddy.Dockerfile", lambda t: t.replace("desec@v1.1.0", "desec@master"), "desec is not pinned"),
    ("packaging/docker/caddy.Dockerfile", lambda t: t.replace(" \\\n    --with github.com/caddy-dns/cloudflare@v0.2.4", ""),
     "Cloudflare module must stay"),
    ("packaging/compose/caddy/tls-dns01-duckdns.caddy",
     lambda t: t.replace("{file./run/secrets/duckdns_token}", "fictional-literal-token"), "not a secret file placeholder"),
    ("packaging/compose/caddy/tls-dns01-desec.caddy",
     lambda t: t.replace("{file./run/secrets/desec_token}", "{env.DESEC_TOKEN}"), "not a secret file placeholder"),
    ("packaging/compose/caddy/tls-dns01-route53.caddy", lambda t: t.replace("dns route53", "dns cloudflare"),
     "no `dns route53` line"),
    ("packaging/compose/compose.dns-porkbun.yaml",
     lambda t: t.replace("./caddy/tls-dns01-porkbun.caddy:/etc/caddy/tls.caddy:ro", "/etc:/etc/caddy/tls.caddy:ro"),
     "must mount ./caddy/tls-dns01-porkbun.caddy"),
    ("packaging/compose/compose.dns-porkbun.yaml", lambda t: t.replace("      - porkbun_secret_api_key\n", ""),
     "caddy's secrets must be exactly"),
    ("packaging/compose/compose.dns-digitalocean.yaml", lambda t: t.replace("    secrets:", "    ports:\n      - \"80:80\"\n    secrets:"),
     "may only add volumes and secrets"),
    ("packaging/compose/compose.dns-desec.yaml",
     lambda t: t.replace("file: ${MANTEL_SECRETS_DIR:-/etc/hk/secrets}/desec_token", "environment: DESEC_TOKEN"),
     "secret desec_token must be the file"),
    ("packaging/lxc/mantel-install.sh", lambda t: t.replace(" digitalocean_token desec_token\"", " desec_token\""),
     "does not prepare the secret file digitalocean_token"),
    ("packaging/compose/secrets/README.md", lambda t: t.replace("`duckdns_token`", "duckdns"), "does not list duckdns_token"),
])
def test_dns_provider_violations_are_found(tmp_path, path, edit, expect):
    root = _dns_tree(tmp_path)
    target = root / path
    target.write_text(edit(target.read_text()))
    problems = pc.check_dns_providers(root)
    assert any(expect in p for p in problems), (expect, problems)


def test_a_dns_snippet_or_override_without_its_module_is_found(tmp_path):
    root = _dns_tree(tmp_path)
    (root / "packaging/compose/caddy/tls-dns01-namecheap.caddy").write_text("tls {\n\tdns namecheap x\n}\n")
    (root / "packaging/compose/compose.dns-gandi.yaml").write_text("services:\n  caddy:\n    secrets:\n      - x\n")
    (root / "packaging/compose/compose.dns-porkbun.yaml").unlink()
    problems = pc.check_dns_providers(root)
    for expect in ("caddy/tls-dns01-namecheap.caddy: no caddy-dns module", "compose.dns-gandi.yaml: no caddy-dns module",
                   "compose.dns-porkbun.yaml is missing"):
        assert any(expect in p for p in problems), (expect, problems)


def _image_ok(image: str) -> bool:
    if shutil.which("docker") is None:
        return False
    return subprocess.run(["docker", "image", "inspect", image], capture_output=True).returncode == 0


# opt-in (a local mantel-caddy:local may predate the providers): MANTEL_CADDY_TEST_IMAGE=mantel-caddy:local after
# `docker compose build caddy`, or any image built from packaging/docker/caddy.Dockerfile
CADDY_TEST_IMAGE = os.environ.get("MANTEL_CADDY_TEST_IMAGE", "")


@pytest.mark.skipif(not CADDY_TEST_IMAGE or not _image_ok(CADDY_TEST_IMAGE),
                    reason="set MANTEL_CADDY_TEST_IMAGE to an image built from caddy.Dockerfile")
@pytest.mark.parametrize("snippet", ["tls-internal.caddy", "tls-dns01.caddy",
                                     *(f"tls-dns01-{p}.caddy" for p in DNS_PROVIDERS)])
def test_each_tls_snippet_validates_in_the_caddy_image(tmp_path, snippet):
    """The real mantel-caddy image (its DNS modules) provisions the Caddyfile with each snippet, reading
    fictional credentials from secret files: the module exists in the image and the snippet's syntax is its."""
    secrets = tmp_path / "secrets"
    secrets.mkdir()
    for name in ("duckdns_token", "porkbun_api_key", "porkbun_secret_api_key", "route53_access_key_id",
                 "route53_secret_access_key", "digitalocean_token", "desec_token"):
        (secrets / name).write_text(f"fictional-{name}")
    (secrets / "cloudflare_dns_token").write_text("Fictional" + "0" * 31)    # the module checks a token's shape
    caddy = ROOT / "packaging/compose/caddy"
    r = subprocess.run(["docker", "run", "--rm", "-e", "MANTEL_HOSTNAME=mantel.example.com",
                        "-v", f"{caddy / 'Caddyfile'}:/etc/caddy/Caddyfile:ro",
                        "-v", f"{caddy / snippet}:/etc/caddy/tls.caddy:ro", "-v", f"{secrets}:/run/secrets:ro",
                        CADDY_TEST_IMAGE, "caddy", "validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"],
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr[-800:]


def test_mantels_own_security_headers_are_checked(tmp_path):
    src = ROOT / "hosts/server/mantel_server/network/security_headers.py"
    assert pc.check_security_headers(src) == []
    good = src.read_text()
    for edit, expect in [
        (lambda t: t.replace('"script-src": ("\'self\'",),', '"script-src": ("\'self\'", "\'unsafe-inline\'"),', 1), "exactly \'self\'"),
        (lambda t: t.replace('"script-src": ("\'self\'", "\'unsafe-inline\'"),', '"script-src": ("\'self\'", "\'unsafe-eval\'"),'), "eval"),
        (lambda t: t.replace('"frame-ancestors": ("\'self\'",),', '"frame-ancestors": ("*",),', 1), "frame-ancestors"),
        (lambda t: t.replace("if https and not ingress:", "if True:"), "HSTS"),
    ]:
        p = tmp_path / "security_headers.py"
        p.write_text(edit(good))
        assert edit(good) != good, expect
        assert any(expect in m for m in pc.check_security_headers(p)), (expect, pc.check_security_headers(p))


def test_byo_proxy_override_is_checked(tmp_path):
    src = ROOT / "packaging/compose/compose.byo-proxy.yaml"
    assert pc.check_byo_compose(src) == []
    good = src.read_text()
    for edit, expect in [
        (lambda t: t.replace("MANTEL_TRUSTED_PROXY: ${MANTEL_TRUSTED_PROXY:?set", "MANTEL_TRUSTED_PROXY: ${MANTEL_TRUSTED_PROXY:-set"), "required"),
        (lambda t: t.replace("}:8765\"", "}:8765\"\n      - \"8443:8443\""), "exactly one published port"),
        (lambda t: t.replace("ipv4_address: 172.31.250.2", "ipv4_address: 172.31.250.9"), "tunnel network"),
        (lambda t: t.replace("MANTEL_PROXY_KIND: own", "MANTEL_PROXY_KIND: caddy"), "own"),
        (lambda t: t.replace("      - caddy-not-used", "      - caddy-not-used\n    image: caddy"), "profile"),
    ]:
        p = tmp_path / "compose.byo-proxy.yaml"
        p.write_text(edit(good))
        assert edit(good) != good, expect
        assert any(expect in m for m in pc.check_byo_compose(p)), (expect, pc.check_byo_compose(p))


def test_committed_env_and_secret_files_are_found(tmp_path):
    (tmp_path / "packaging/compose/secrets").mkdir(parents=True)
    (tmp_path / "packaging/compose/.env").write_text("MANTEL_HOSTNAME=x\n")
    (tmp_path / "packaging/compose/.env.example").write_text("MANTEL_HA_TOKEN=abc\nMANTEL_HOSTNAME=x\n")
    (tmp_path / "packaging/compose/secrets/ha_token").write_text("x")
    text = "\n".join(pc.check_no_committed_secrets(tmp_path))
    assert "a real .env" in text and "MANTEL_HA_TOKEN has a value" in text and "only README.md" in text


def test_ha_app_config_is_checked(tmp_path):
    good = (ROOT / "packaging/ha-app/config.yaml").read_text()
    p = tmp_path / "config.yaml"
    p.write_text(good + "full_access: true\n")
    assert any("full_access" in m for m in pc.check_ha_app(p))
    p.write_text(good.replace("ingress: true", "ingress: false"))
    assert any("ingress" in m for m in pc.check_ha_app(p))
    # an empty default under a typed schema entry: HA's Supervisor refused the 0.1.16 update with
    # "expected an email address" for acme_email: "email?" defaulting to "" (the house, 2026-10-18)
    assert not pc.check_ha_app(ROOT / "packaging/ha-app/config.yaml")
    p.write_text(good.replace('acme_email: "str?"', 'acme_email: "email?"'))
    assert any("acme_email" in m and "empty default" in m for m in pc.check_ha_app(p))
    # HA's backups stop the App first: a hot copy of the live WAL database could restore damaged
    assert pc.parse_yaml(good)["backup"] == "cold"
    for edit in (good.replace("backup: cold\n", ""), good.replace("backup: cold", "backup: hot")):
        p.write_text(edit)
        assert any("backup must be cold" in m for m in pc.check_ha_app(p))


def test_yaml_subset_reader():
    doc = pc.parse_yaml("a:\n  b: [x, \"y, z\"]  # c\n  c: {}\n  d:\n    - '1:2'\n    - /dev/dri:/dev/dri\n  e:\n    - k: v\n      w: 3\n    - k: u\nf: true\n")
    assert doc == {"a": {"b": ["x", "y, z"], "c": {}, "d": ["1:2", "/dev/dri:/dev/dri"],
                         "e": [{"k": "v", "w": 3}, {"k": "u"}]}, "f": True}
    with pytest.raises(pc.YamlSubsetError):
        pc.parse_yaml("a: &x 1\n")


# -- entrypoint --------------------------------------------------------------------------------------------
def test_entrypoint_container_mode_builds_the_listen_arguments(tmp_path):
    env = {"MANTEL_HA_URL": "http://ha.local:8123", "MANTEL_PUBLIC_URL": "https://mantel.example.com/",
           "MANTEL_ALLOW_HOSTS": "192.0.2.10, ,mantel.lan", "MANTEL_DEFAULT_SCREEN": "dashboard-loft"}
    args, out_env = entrypoint.plan([], env, options_path=tmp_path / "none")
    assert args[:2] == ["--ha-url", "http://ha.local:8123"]
    assert args[args.index("--token-file") + 1] == "/run/secrets/ha_token"
    assert args[args.index("--data-dir") + 1] == "/data"
    assert args[args.index("--listen") + 1] == "0.0.0.0"
    assert [args[i + 1] for i, a in enumerate(args) if a == "--allow-host"] == ["192.0.2.10", "mantel.lan"]
    assert args[args.index("--screen") + 1] == "dashboard-loft"
    # and the server accepts exactly these
    from mantel_server.config import parse_args
    cfg = parse_args(args)
    assert cfg.host == "0.0.0.0" and cfg.client_id == "https://mantel.example.com/"
    assert cfg.host_allowed("mantel.example.com") and cfg.host_allowed("192.0.2.10") and not cfg.host_allowed("evil.example")


def test_entrypoint_passes_the_intercoms_stream_port_only_when_the_stack_sets_it(tmp_path):
    from mantel_server.config import parse_args
    env = {"MANTEL_PUBLIC_URL": "https://mantel.example.com/"}
    args, _ = entrypoint.plan([], env, options_path=tmp_path / "none")
    assert "--stream-port" not in args and parse_args(args).stream_port == 0
    args, _ = entrypoint.plan([], {**env, "MANTEL_STREAM_INTERNAL_PORT": "8767"}, options_path=tmp_path / "none")
    assert args[args.index("--stream-port") + 1] == "8767" and parse_args(args).stream_port == 8767
    # the real compose file sets it, and the same value is the container side of the published port
    doc = pc.parse_yaml((ROOT / "packaging/compose/compose.yaml").read_text())
    assert doc["services"]["mantel-server"]["environment"]["MANTEL_STREAM_INTERNAL_PORT"] == "8767"


def test_entrypoint_ha_app_always_passes_the_intercoms_port_8101(tmp_path):
    from mantel_server.config import parse_args
    options = tmp_path / "options.json"
    options.write_text(json.dumps({}))
    env = {"SUPERVISOR_TOKEN": "fictional-supervisor-credential", "PATH": "/bin"}
    args, _ = entrypoint.plan([], env, options_path=options, token_file=tmp_path / "ha_token")
    assert args[args.index("--stream-port") + 1] == "8101" and parse_args(args).stream_port == 8101
    args, _ = entrypoint.plan([], {**env, "MANTEL_STREAM_PORT": "9101"}, options_path=options, token_file=tmp_path / "ha_token")
    assert parse_args(args).stream_port == 9101


def test_the_package_check_lets_mantel_server_publish_only_the_intercoms_listener(tmp_path):
    src = ROOT / "packaging/compose/compose.yaml"
    good = src.read_text()
    assert pc.check_compose(src) == []
    port = '      - "${MANTEL_STREAM_BIND:-0.0.0.0}:${MANTEL_STREAM_PORT:-8767}:8767"\n'
    assert port in good
    for edit, expect in [
        (lambda t: t.replace(port, port + '      - "8765:8765"\n'), "Intercom's listener"),
        (lambda t: t.replace(port, '      - "${MANTEL_HTTP_PORT:-8765}:8765"\n'), "Intercom's listener"),
    ]:
        p = tmp_path / "compose.yaml"
        p.write_text(edit(good))
        assert edit(good) != good, expect
        assert any(expect in m for m in pc.check_compose(p)), (expect, pc.check_compose(p))


def test_entrypoint_passes_caddys_address_as_the_trusted_proxy(tmp_path, capsys):
    env = {"MANTEL_HA_URL": "http://ha.local:8123", "MANTEL_PUBLIC_URL": "https://mantel.example.com/",
           "MANTEL_TRUSTED_PROXY": "172.31.251.2"}
    args, _ = entrypoint.plan([], env, options_path=tmp_path / "none")
    assert [args[i + 1] for i, a in enumerate(args) if a == "--trusted-proxy"] == ["172.31.251.2"]
    from mantel_server.config import parse_args
    assert parse_args(args).trusted_proxies == ("172.31.251.2",)
    # more than one, normalised; a service name is refused (Mantel compares the peer's address exactly)
    args, _ = entrypoint.plan([], {**env, "MANTEL_TRUSTED_PROXY": " 172.31.251.2 , fd00::0002"}, options_path=tmp_path / "none")
    assert [args[i + 1] for i, a in enumerate(args) if a == "--trusted-proxy"] == ["172.31.251.2", "fd00::2"]
    with pytest.raises(entrypoint.ConfigError, match="IP addresses"):
        entrypoint.plan([], {**env, "MANTEL_TRUSTED_PROXY": "caddy"}, options_path=tmp_path / "none")
    # unset: no flag (every request is the tunnel door), and the start says so
    args, _ = entrypoint.plan([], {k: v for k, v in env.items() if k != "MANTEL_TRUSTED_PROXY"},
                              options_path=tmp_path / "none")
    assert "--trusted-proxy" not in args and "MANTEL_TRUSTED_PROXY is not set" in capsys.readouterr().err


def test_entrypoint_gives_passkeys_the_public_urls_name(tmp_path):
    """Docker / LXC: the passkeys' RP ID is MANTEL_PUBLIC_URL's host name, so a passkey added at
    https://mantel.example.com is accepted there (it was "localhost", and every passkey failed with
    origin_not_allowed_for_passkeys). An IP address cannot be an RP ID: no flag then."""
    from types import SimpleNamespace

    from aiohttp import web as aioweb

    from mantel_server.identity.accounts import passkey_origin
    from mantel_server.config import parse_args
    none = tmp_path / "none"
    args, _ = entrypoint.plan([], {"MANTEL_PUBLIC_URL": "https://Mantel.Example.com:8443/"}, options_path=none)
    assert args[args.index("--rp-id") + 1] == "mantel.example.com"
    cfg = parse_args(args)
    assert cfg.webauthn_rp_id == "mantel.example.com"

    def check(origin):
        acc = SimpleNamespace(rp_id=cfg.webauthn_rp_id)
        return passkey_origin(SimpleNamespace(headers={"Origin": origin}), acc)
    assert check("https://mantel.example.com:8443") == "https://mantel.example.com:8443"
    with pytest.raises(aioweb.HTTPBadRequest):
        check("https://evil.example")
    # an IP address: no RP ID from it (the server keeps its default; passkeys need a name)
    for public in ("https://192.0.2.10/", "https://[2001:db8::1]:8443/"):
        args, _ = entrypoint.plan([], {"MANTEL_PUBLIC_URL": public}, options_path=none)
        assert "--rp-id" not in args
    # the operator's own --rp-id (the old compose.local.yaml workaround) comes later and still wins
    args, _ = entrypoint.plan(["--rp-id", "other.example.com"], {"MANTEL_PUBLIC_URL": "https://m.example.com/"},
                              options_path=none)
    assert parse_args(args).webauthn_rp_id == "other.example.com"


def test_compose_makes_caddy_the_trusted_proxy_on_the_backend_network():
    """Static: the address the entrypoint is given is Caddy's fixed backend address, inside the backend
    subnet, and Caddy reaches Mantel only by its backend-only alias, so Caddy's connections to Mantel
    come from exactly that address and the LAN door is recognised behind Caddy."""
    import ipaddress
    doc = pc.parse_yaml((ROOT / "packaging/compose/compose.yaml").read_text())
    services, networks = doc["services"], doc["networks"]
    trusted = services["mantel-server"]["environment"]["MANTEL_TRUSTED_PROXY"]
    assert services["caddy"]["networks"]["backend"]["ipv4_address"] == trusted
    subnet = ipaddress.ip_network(networks["backend"]["ipam"]["config"][0]["subnet"])
    assert ipaddress.ip_address(trusted) in subnet and networks["backend"]["internal"] is True
    assert services["mantel-server"]["networks"]["backend"]["aliases"] == ["mantel-backend"]
    assert "mantel-backend" not in str(services["mantel-server"]["networks"]["egress"])
    caddyfile = (ROOT / "packaging/compose/caddy/Caddyfile").read_text()
    upstreams = [line.split()[1] for line in caddyfile.splitlines() if line.strip().startswith("reverse_proxy")]
    assert upstreams == ["mantel-backend:8765", "mantel-backend:8765"]          # LAN door and tunnel door
    # the tunnel network is a different subnet: cloudflared can never be the trusted proxy
    assert ipaddress.ip_address(trusted) not in ipaddress.ip_network(networks["tunnel"]["ipam"]["config"][0]["subnet"])


def test_behind_caddy_the_lan_door_is_recognised_only_from_caddys_address():
    """What the entrypoint's flag buys: X-Mantel-Door: lan from 172.31.251.2 is the LAN door; the same
    header from any other peer (or no flag) is the tunnel door."""
    from types import SimpleNamespace

    from mantel_server.identity.authz import resolve_door
    from mantel_server.config import parse_args
    args, _ = entrypoint.plan([], {"MANTEL_HA_URL": "http://ha.local:8123", "MANTEL_PUBLIC_URL": "https://m.example/",
                                   "MANTEL_TRUSTED_PROXY": "172.31.251.2"}, options_path=Path("/nonexistent"))
    cfg = parse_args(args)

    def door(peer, claim, config=cfg):
        return resolve_door(SimpleNamespace(app={"cfg": config}, remote=peer,
                                            headers={"X-Mantel-Door": claim} if claim else {}))
    assert door("172.31.251.2", "lan") == "lan"
    assert door("172.31.251.2", "tunnel") == "tunnel" and door("172.31.251.2", None) == "tunnel"
    assert door("172.31.251.3", "lan") == "tunnel" and door("172.31.250.3", "lan") == "tunnel"
    assert door("172.31.251.2", "lan", parse_args([])) == "tunnel"        # no --trusted-proxy: fail closed


def test_entrypoint_refuses_missing_settings(tmp_path):
    with pytest.raises(entrypoint.ConfigError, match="MANTEL_PUBLIC_URL"):
        entrypoint.plan([], {}, options_path=tmp_path / "none")


def test_entrypoint_without_an_ha_address_leaves_it_to_the_connections_page(tmp_path):
    """No MANTEL_HA_URL: an explicitly empty address (never the built-in default); the page sets it up."""
    args, _ = entrypoint.plan([], {"MANTEL_PUBLIC_URL": "https://m.example/"}, options_path=tmp_path / "none")
    assert args[:2] == ["--ha-url", ""]
    from mantel_server.config import parse_args
    cfg = parse_args(args)
    assert cfg.ha_url == "" and cfg.ha_managed_by_app is False


def test_entrypoint_ha_app_moves_the_supervisor_token_into_a_private_file(tmp_path):
    options = tmp_path / "options.json"
    options.write_text(json.dumps({"default_screen": "dashboard-hall", "session_hours": 8}))
    token_file = tmp_path / "ha_token"
    env = {"SUPERVISOR_TOKEN": "fictional-supervisor-credential", "PATH": "/bin"}
    args, out_env = entrypoint.plan([], env, options_path=options, token_file=token_file)
    assert "SUPERVISOR_TOKEN" not in out_env
    assert token_file.read_text() == "fictional-supervisor-credential"
    assert oct(token_file.stat().st_mode & 0o777) == "0o600"
    assert args[args.index("--ha-url") + 1] == "http://supervisor/core"
    assert args[args.index("--port") + 1] == "8099" and "*" in args
    assert args[args.index("--screen") + 1] == "dashboard-hall" and args[args.index("--session-hours") + 1] == "8"
    from mantel_server.config import parse_args
    assert parse_args(args).host_allowed("anything.example")
    assert "fictional-supervisor-credential" not in " ".join(args)
    assert parse_args(args).ha_managed_by_app is True          # the Connections page shows HA as the App's


def test_entrypoint_ha_app_music_assistant_token_is_a_private_file_never_an_argument(tmp_path):
    options = tmp_path / "options.json"
    ma_file = tmp_path / "ma_token"
    env = {"SUPERVISOR_TOKEN": "fictional-supervisor-credential", "MANTEL_APP_MA_TOKEN_FILE": str(ma_file)}
    # no address or no token: Mantel's music engine stays off and nothing is written
    for opts in ({}, {"ma_url": "http://ma.fake.test:8095"}, {"ma_token": "fictional-ma-token"}):
        options.write_text(json.dumps(opts))
        args, _ = entrypoint.plan([], dict(env), options_path=options, token_file=tmp_path / "ha_token")
        assert "--ma-url" not in args and not ma_file.exists()
    options.write_text(json.dumps({"ma_url": "http://ma.fake.test:8095", "ma_token": "fictional-ma-token"}))
    args, out_env = entrypoint.plan([], dict(env), options_path=options, token_file=tmp_path / "ha_token")
    assert args[args.index("--ma-url") + 1] == "http://ma.fake.test:8095"
    assert args[args.index("--ma-token-file") + 1] == str(ma_file)
    assert ma_file.read_text() == "fictional-ma-token" and oct(ma_file.stat().st_mode & 0o777) == "0o600"
    assert "fictional-ma-token" not in " ".join(args) and "fictional-ma-token" not in json.dumps(out_env)
    from mantel_server.config import parse_args
    cfg = parse_args(args)
    assert cfg.ma_url == "http://ma.fake.test:8095" and cfg.ma_token_file == ma_file


def test_entrypoint_admin_commands_default_to_the_data_volume(tmp_path):
    args, _ = entrypoint.plan(["links"], {}, options_path=tmp_path / "none")
    assert args == ["links", "--data-dir", "/data"]
    args, _ = entrypoint.plan(["link", "--ha-user-id", "x", "--role", "owner", "--data-dir", "/elsewhere"], {}, options_path=tmp_path / "none")
    assert args.count("--data-dir") == 1


def test_entrypoint_import_settings_gets_the_secrets_folder_for_the_saved_connection(tmp_path):
    """import-settings reaches HA as the server does: the connection saved on Connections opens with the at-rest
    key in the container's secrets folder, so the command gets that folder too (connections.ha_in_effect)."""
    args, _ = entrypoint.plan(["import-settings"], {"MANTEL_SECRETS_DIR": "/run/secrets"}, options_path=tmp_path / "none")
    assert args == ["import-settings", "--data-dir", "/data", "--token-file", "/run/secrets/ha_token",
                    "--secrets-dir", "/run/secrets"]                     # no MANTEL_HA_URL: the saved connection's


def test_entrypoint_drops_root_only_through_the_helper(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(entrypoint.os, "chown", lambda p, u, g: calls.append(("chown", str(p), u, g)))
    monkeypatch.setattr(entrypoint.os, "setgroups", lambda g: calls.append(("setgroups", g)))
    monkeypatch.setattr(entrypoint.os, "setgid", lambda g: calls.append(("setgid", g)))
    monkeypatch.setattr(entrypoint.os, "setuid", lambda u: calls.append(("setuid", u)))
    entrypoint.drop_privileges([tmp_path])
    assert calls == [("chown", str(tmp_path), 10001, 10001), ("setgroups", []), ("setgid", 10001), ("setuid", 10001)]


# -- health endpoint ---------------------------------------------------------------------------------------
class FakeHub:
    class ha:  # noqa: N801
        connected_since = None


@pytest.fixture
async def health_client():
    from mantel_server import health
    hub = FakeHub()
    app = web.Application()
    health.register(app, hub)
    async with TestClient(TestServer(app)) as client:
        client.hub = hub
        yield client


async def test_healthz_reports_liveness_and_upstream_without_secrets(health_client):
    import time
    r = await health_client.get("/healthz")
    body = await r.json()
    assert r.status == 200 and body["status"] == "degraded"
    assert body["upstream"]["home_assistant"] == {"connected": False, "connected_for_s": None}
    health_client.hub.ha.connected_since = time.time() - 5
    body = await (await health_client.get("/healthz")).json()
    assert body["status"] == "ok" and body["upstream"]["home_assistant"]["connected"] is True
    assert set(body) == {"status", "uptime_s", "build", "upstream"}
    assert r.headers["Cache-Control"] == "no-store"


async def test_healthz_strict_mode_fails_when_degraded(health_client):
    health_client.hub.ha.connected_since = None
    assert (await health_client.get("/healthz?strict=1")).status == 503
    assert (await health_client.get("/healthz")).status == 200


async def test_version_endpoint_and_build_id(health_client, monkeypatch, tmp_path):
    from mantel_server import health
    assert (await (await health_client.get("/api/version")).json()) == {"build": health.build_id()}
    monkeypatch.setattr(health, "REPO", tmp_path)
    assert health.build_id() == "dev"
    (tmp_path / "BUILD_ID").write_text("0123456789abcdef\n")
    assert health.build_id() == "0123456789abcdef"
    (tmp_path / "BUILD_ID").write_text("not ok; rm -rf\n")
    assert health.build_id() == "dev"


async def test_health_paths_are_exempt_from_sign_in():
    from mantel_server.identity import auth
    from mantel_server import health
    health.register(web.Application(), FakeHub())
    assert set(health.PUBLIC_PATHS) <= auth.PUBLIC_PATHS


async def test_probe_exit_codes(health_client):
    import asyncio
    from mantel_server import health
    port = health_client.server.port
    loop = asyncio.get_running_loop()
    assert await loop.run_in_executor(None, health.probe, port, 3.0) == 0
    assert await loop.run_in_executor(None, health.probe, 1, 0.5) == 1
    assert await loop.run_in_executor(None, health.main, ["--port", str(port)]) == 0


def test_healthcheck_commands_name_a_module_that_exists():
    from mantel_server import health
    assert callable(health.main) and callable(health.register)
    dockerfile = (ROOT / "packaging/docker/Dockerfile").read_text()
    compose = (ROOT / "packaging/compose/compose.yaml").read_text()
    assert "mantel_server.health" in dockerfile and "mantel_server.health" in compose


# -- /healthz through the real app --------------------------------------------------------------------------
async def test_full_app_serves_healthz_without_a_session_once_registered(tmp_path):
    from mantel_server import health
    from mantel_server.config import Config
    from mantel_server.server import build_app
    from mantel_server.store import Store
    store = Store(tmp_path / "db")
    app = build_app(Config(data_dir=tmp_path), "unused", store=store, connect_ha=False)
    health.register(app, app["hub"])
    async with TestClient(TestServer(app)) as client:
        assert (await client.get("/healthz")).status == 200
        assert (await client.get("/api/entities")).status == 401   # everything else still needs a session
    store.db.close()


# -- static build stamp ---------------------------------------------------------------------------------------
def _tree(base: Path, files: dict[str, str]):
    for rel, text in files.items():
        p = base / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)


def test_build_static_is_deterministic_and_content_derived(tmp_path):
    src = tmp_path / "web"
    _tree(src, {"home.html": "<p>", "hk/a.js": "export {}", "hk/.hidden": "x", "hk/a.js.map": "{}", "node_modules/x.js": "y"})
    id1 = build_static.build(src, tmp_path / "out1")
    id2 = build_static.build(src, tmp_path / "out2")
    assert id1 == id2 and len(id1) == 16
    manifest = json.loads((tmp_path / "out1/static-manifest.json").read_text())
    assert sorted(manifest["files"]) == ["hk/a.js", "home.html"] and manifest["build"] == id1
    assert (tmp_path / "out1/BUILD_ID").read_text().strip() == id1 and (tmp_path / "out1/web/hk/a.js").is_file()
    (src / "hk/a.js").write_text("export const changed = 1")
    assert build_static.build(src, tmp_path / "out3") != id1


def test_build_static_leaves_the_developer_pages_out(tmp_path):
    src = tmp_path / "web"
    _tree(src, {"home.html": "<p>", "hk/modules/hk-sky.js": "x", "hk/modules/hk-skylab.js": "x", "hk/pages/skylab.html": "x",
                "hk/pages/skyprobe.html": "x", "hk/pages/seasonal-scenery-review.html": "x", "hk/pages/other.html": "x"})
    build_static.build(src, tmp_path / "out")
    assert sorted(json.loads((tmp_path / "out/static-manifest.json").read_text())["files"]) == [
        "hk/modules/hk-sky.js", "hk/modules/hk-skylab.js", "hk/pages/other.html", "hk/pages/skylab.html",
        "hk/pages/skyprobe.html", "home.html"]                         # Sky Lab and the probe ship: the guide offers them
    real = {p.relative_to(ROOT / "web").as_posix() for p in (ROOT / "web").rglob("*") if build_static._wanted(p, ROOT / "web")}
    assert not real & build_static.DEV_ONLY and all((ROOT / "web" / n).is_file() for n in build_static.DEV_ONLY)   # still in the repo


def test_build_static_refuses_an_existing_output(tmp_path):
    src = tmp_path / "web"
    _tree(src, {"a.js": "x"})
    (tmp_path / "out").mkdir()
    with pytest.raises(SystemExit):
        build_static.build(src, tmp_path / "out")


def test_build_static_stamps_the_real_web_app(tmp_path):
    assert len(build_static.build(ROOT / "web", tmp_path / "out")) == 16
    assert json.loads((tmp_path / "out/static-manifest.json").read_text())["files"]["home.html"]["size"] > 0


def test_every_backend_service_has_a_fixed_address():
    # Docker hands out the lowest free address, so an unpinned service that started first took Caddy's
    # 172.31.251.2 and Caddy could not start (found by tools/e2e/compose_e2e.py, 2026-10-18)
    text = (ROOT / "packaging/compose/compose.yaml").read_text()
    services = text.split("\nservices:\n", 1)[1].split("\nnetworks:\n", 1)[0]
    for block in re.split(r"\n(?=  [a-z0-9-]+:\n)", services):
        name = block.strip().split(":", 1)[0]
        nets = block.split("    networks:", 1)
        if len(nets) < 2 or "backend" not in nets[1].split("\n    ")[0] + nets[1][:200]:
            continue
        after = "\n".join(l for l in nets[1].split("backend", 1)[1].splitlines()[:8] if not l.strip().startswith("#"))
        assert "ipv4_address: 172.31.251." in after, f"{name} is on backend without a fixed address"


def _docker_ignored(path: str, patterns: list[str]) -> bool:
    """Docker's .dockerignore rule, enough for these paths: the last pattern matching the path or one of its parent
    folders decides; `!` re-includes."""
    import fnmatch
    parts = path.strip("/").split("/")
    prefixes = ["/".join(parts[:i]) for i in range(1, len(parts) + 1)]
    ignored = False
    for raw in patterns:
        neg = raw.startswith("!")
        pat = raw[1:] if neg else raw
        pat = pat.strip("/")
        if any(fnmatch.fnmatchcase(p, pat) or (pat.startswith("**/") and fnmatch.fnmatchcase(p.split("/")[-1], pat[3:]))
               for p in prefixes):
            ignored = not neg
    return ignored


def test_every_file_the_dockerfile_copies_is_in_the_build_context():
    """A COPY from the build context of something .dockerignore leaves out fails only when the image is built
    (hk_frontend/docs was left out by `hosts/ha` until the first release build); this catches it without Docker."""
    import re
    patterns = [ln.strip() for ln in (ROOT / ".dockerignore").read_text().splitlines()
                if ln.strip() and not ln.strip().startswith("#")]
    sources = []
    for line in (ROOT / "packaging/docker/Dockerfile").read_text().splitlines():
        m = re.match(r"\s*COPY\s+(.*)", line)
        if not m or "--from=" in m.group(1):
            continue
        args = [a for a in m.group(1).split() if not a.startswith("--")]
        sources += [s.replace("[k]", "k") for s in args[:-1]]
    assert sources and "hosts/ha/custom_components/hk_frontend/docs" in sources
    for src in sources:
        if (ROOT / src).exists():
            assert not _docker_ignored(src, patterns), f"{src} is copied by the Dockerfile but left out by .dockerignore"


def test_the_image_installs_a_hashed_lock_and_a_release_needs_one(tmp_path):
    """Without packaging/docker/requirements.lock the image installed pyproject's open ranges, whatever PyPI served
    on build day, and two builds of one tag could differ. The lock is checked: present for a release, every runtime
    dependency pinned, every pin hashed."""
    assert pc.check_requirements_lock(ROOT, release=True) == []
    (tmp_path / "packaging/docker").mkdir(parents=True)
    (tmp_path / "pyproject.toml").write_text('[project]\nname = "x"\ndependencies = ["aiohttp>=3.9", "Pillow>=11"]\n')
    assert pc.check_requirements_lock(tmp_path, release=True)[0].startswith("packaging/docker/requirements.lock: missing")
    assert pc.check_requirements_lock(tmp_path, release=False) == []
    (tmp_path / "packaging/docker/requirements.lock").write_text(
        "aiohttp==3.14.5 \\\n    --hash=sha256:" + "a" * 64 + "\nyarl==1.0\n")
    got = pc.check_requirements_lock(tmp_path)
    assert any("pillow" in g and "not pinned" in g for g in got) and any("yarl has no hash" in g for g in got)


# -- deployment and operations (audit, second pass) ----------------------------------------------------------
@pytest.mark.skipif(shutil.which("bash") is None, reason="no bash")
def test_update_makes_a_backup_before_it_starts_new_images_and_stops_if_it_fails(tmp_path):
    """DEP-2 (audit, second pass): update.sh's rollback restarts the old image, but a new image that got as far as
    migrating leaves a database the old build refuses (schema_too_new), so a "rolled back" stack crash-looped and
    the only way back was a backup the docs asked the person to make. update.sh now runs `mantel backup --target
    /backups` in the running server before `up`, and a failed backup stops the update with nothing restarted."""
    server = "ghcr.io/jazzphone/mantel-server:0.1.99"
    r, calls = _run_update(tmp_path / "1", [server])
    assert r.returncode == 0, r.stdout + r.stderr
    backup = "compose exec -T mantel-server mantel backup --target /backups"
    assert backup in calls
    assert calls.index(backup) < calls.index("compose up -d --wait --wait-timeout 180")
    r, calls = _run_update(tmp_path / "2", [server], exec_fails="1")
    assert r.returncode == 1 and "the backup failed; nothing was restarted" in r.stdout
    assert not any(c.startswith("compose up") for c in calls)


def test_the_lxc_build_mode_update_makes_a_backup_before_it_restarts():
    """DEP-2 (audit, second pass): the LXC's build-mode update (mantel-update with images built here) restarted on
    new images with no backup, as update.sh had: a migration the rollback can't undo. It backs up first too."""
    src = (ROOT / "packaging/lxc/mantel.sh").read_text()
    start = src.index("update_script() {")
    body = src[start:src.index("\n}\n", start)]
    build = body[body.index("docker compose build --pull"):]
    assert "mantel backup --target /backups" in build
    assert build.index("mantel backup --target /backups") < build.index("docker compose up -d --wait")


def test_compose_forwards_the_variables_operations_md_documents():
    """DEP-4 (audit, second pass): OPERATIONS.md lists MANTEL_DEFAULT_SCREEN and MANTEL_SESSION_HOURS and the
    entrypoint reads them, but compose.yaml's environment: block never passed them, so setting them in .env (the
    only place a compose or LXC user can) did nothing. Both are first-start seeds, and the docs say so."""
    compose = (ROOT / "packaging/compose/compose.yaml").read_text()
    docs = (ROOT / "docs/OPERATIONS.md").read_text()
    for var in ("MANTEL_DEFAULT_SCREEN", "MANTEL_SESSION_HOURS"):
        assert re.search(rf"^\s+{var}: \$\{{{var}:-\}}$", compose, re.M), f"{var} never reaches the container"
    row = next(line for line in docs.splitlines() if line.startswith("| `MANTEL_DEFAULT_SCREEN`"))
    assert "First start only" in row


def test_admin_commands_in_the_app_container_use_the_apps_secrets_folder(tmp_path):
    """DEP-4 (audit, second pass): the App keeps at_rest.key in /data/secrets (app_args), but `mantel door-key |
    import-settings | backup | restore` in its container defaulted to --secrets-dir /run/secrets: as root they
    made a NEW at_rest.key there and sealed with it; as uid 10001 they failed on a folder that does not exist.
    The default now follows the detected mode (and MANTEL_SECRETS_DIR still wins; a compose container is as it was)."""
    options = tmp_path / "options.json"
    options.write_text("{}")
    app_env = {"SUPERVISOR_TOKEN": "x", "MANTEL_APP_OPTIONS": str(options)}
    for command in ("door-key", "backup", "restore", "import-settings"):
        args, _ = entrypoint.plan([command], app_env, options_path=options)
        assert args[args.index("--secrets-dir") + 1] == "/data/secrets", command
        args, _ = entrypoint.plan([command], {**app_env, "MANTEL_DATA_DIR": "/srv/d"}, options_path=options)
        assert args[args.index("--secrets-dir") + 1] == "/srv/d/secrets", command
        args, _ = entrypoint.plan([command], {**app_env, "MANTEL_SECRETS_DIR": "/elsewhere"}, options_path=options)
        assert args[args.index("--secrets-dir") + 1] == "/elsewhere", command
        args, _ = entrypoint.plan([command], {}, options_path=tmp_path / "none")
        assert args[args.index("--secrets-dir") + 1] == "/run/secrets", command


def test_no_supervisor_token_alias_reaches_the_server(tmp_path):
    """DEP-5 (audit, second pass): the Supervisor has also exported the token as HASSIO_TOKEN (the old name bashio
    still reads). The entrypoint removed only SUPERVISOR_TOKEN, so where the alias is set it stayed in the
    server's environment and in every process the server spawns, against the "only a file path" design."""
    options = tmp_path / "options.json"
    options.write_text("{}")
    env = {"SUPERVISOR_TOKEN": "tok", "HASSIO_TOKEN": "tok", "MANTEL_APP_OPTIONS": str(options),
           "MANTEL_APP_TOKEN_FILE": str(tmp_path / "ha_token")}
    _, server_env = entrypoint.plan([], env, options_path=options, token_file=tmp_path / "ha_token")
    assert "tok" not in server_env.values() and "HASSIO_TOKEN" not in server_env
    assert (tmp_path / "ha_token").read_text() == "tok"        # the file is how the server gets it
    env.pop("HASSIO_TOKEN")                                    # harmless where the alias is absent
    entrypoint.plan([], env, options_path=options, token_file=tmp_path / "ha_token")


def test_the_app_image_copies_its_files_with_explicit_modes():
    """DEP-6 (audit, second pass): packaging/ha-app/Dockerfile did a plain `COPY app /app`, which keeps the staged
    files' modes: staged under umask 077 they are 0600 and root owns files the server's user (10001) cannot read.
    packaging/docker/Dockerfile has --chmod=0755 for exactly this; the App's now has it too."""
    lines = [line for line in (ROOT / "packaging/ha-app/Dockerfile").read_text().splitlines() if line.startswith("COPY app ") or " app /app" in line]
    assert lines and all(line.startswith("COPY --chmod=0755 ") for line in lines), lines


def test_the_image_carries_a_release_json_made_from_the_releases_version():
    """DEP-14 (audit, third pass): Docker and LXC images had no /app/RELEASE.json, so Mantel Settings -> About showed no
    version. The Dockerfile's release stage writes it (tools/write_release.py) from the MANTEL_VERSION build argument
    that release.yml passes, falling back to packaging/ha-app/config.yaml for a local build; the base stage copies it
    to /app, and .dockerignore lets config.yaml into the build context."""
    text = (ROOT / "packaging/docker/Dockerfile").read_text()
    stage = text[text.index("AS release"):text.index("AS deps")]
    assert "ARG MANTEL_VERSION=" in stage and "tools/write_release.py /out/RELEASE.json" in stage
    assert '--version "${MANTEL_VERSION}"' in stage and "COPY packaging/ha-app/config.yaml" in stage
    assert "COPY --chmod=0755 --from=release /out/RELEASE.json /app/RELEASE.json" in text
    assert (ROOT / "tools/write_release.py").is_file()
    assert "MANTEL_VERSION=${{ needs.version.outputs.version }}" in (ROOT / ".github/workflows/release.yml").read_text()
    assert "!packaging/ha-app/config.yaml" in (ROOT / ".dockerignore").read_text().splitlines()


def test_the_lock_pins_a_pyasn1_without_the_quadratic_attestation_parsing():
    """DEP-15 (audit, third pass): pyasn1 0.6.4 (pulled in by webauthn's attestation parsing) is affected by
    CVE-2026-119194 to -119197, quadratic CPU on crafted input; 0.6.5 fixes them. The pin stays at or above it, hashed."""
    lock = (ROOT / "packaging/docker/requirements.lock").read_text()
    m = re.search(r"^pyasn1==(\d+)\.(\d+)\.(\d+) \\\n((?:    --hash=sha256:[0-9a-f]{64}(?: \\)?\n)+)", lock, re.M)
    assert m, "pyasn1 is pinned with hashes"
    assert tuple(int(x) for x in m.groups()[:3]) >= (0, 6, 5)
    assert m.group(4).count("--hash=") == 2          # the wheel and the sdist, as pip-compile writes them


def test_caddy_serves_an_address_with_no_name_sent():
    """mantel-setup's "try" makes MANTEL_HOSTNAME the LXC's address. A browser sends no SNI to an address, and behind
    Docker's port mapping Caddy can't see which address was dialed, so the handshake failed until default_sni named it
    (checked with Caddy 2.10.2: no certificate without it, Mantel's with it)."""
    text = (ROOT / "packaging/compose/caddy/Caddyfile").read_text()
    globals_block = text[text.index("\n{\n"):text.index("\n}\n", text.index("\n{\n"))]
    assert "default_sni {$MANTEL_HOSTNAME}" in globals_block


def test_the_images_leave_out_the_developer_pages_the_ha_app_leaves_out():
    """/dev's state hub and the scenery review are a checkout's (tools/stage_ha_app.py drops them from the App): the
    Docker build context leaves them out too, so Docker and the LXC never serve them (the owner, 2026-11-02)."""
    ignored = {ln.strip() for ln in (ROOT / ".dockerignore").read_text().splitlines()}
    assert {"hosts/server/mantel_server/static/dev.html", "web/hk/pages/seasonal-scenery-review.html"} <= ignored
