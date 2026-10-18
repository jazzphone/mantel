"""P3.6 packaging: static validation of the image, compose stack, Caddy, LXC script and HA App,
plus the code that ships with them (health endpoint, entrypoint, listen-address option, asset stamp).

No Docker, no network. Build/run verification is listed in docs/phase3/PACKAGING.md.
"""
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


def test_release_mode_refuses_placeholder_digests():
    problems = pc.run_all(release=True)
    assert problems and all("placeholder digest" in p for p in problems)


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
    assert all("ports" not in svc[s] for s in ("mantel-server", "cloudflared"))
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


@pytest.mark.skipif(shutil.which("caddy") is None, reason="caddy not installed")
def test_caddyfile_validates(tmp_path):
    (tmp_path / "tls.caddy").write_text((ROOT / "packaging/compose/caddy/tls-internal.caddy").read_text())
    text = (ROOT / "packaging/compose/caddy/Caddyfile").read_text().replace("/etc/caddy/tls.caddy", str(tmp_path / "tls.caddy"))
    (tmp_path / "Caddyfile").write_text(text)
    r = subprocess.run(["caddy", "validate", "--config", str(tmp_path / "Caddyfile"), "--adapter", "caddyfile"],
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


def test_caddy_csp_violations_are_found(tmp_path):
    good = (ROOT / "packaging/compose/caddy/Caddyfile").read_text()
    for edit, expect in [
        (lambda t: t.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"), "script-src"),
        (lambda t: t.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'"), "unsafe"),
        (lambda t: t.replace("Strict-Transport-Security", "X-Other"), "Strict-Transport-Security"),
        (lambda t: t.replace("frame-ancestors", "frame-x"), "frame-ancestors"),
    ]:
        p = tmp_path / "Caddyfile"
        p.write_text(edit(good))
        assert any(expect in m for m in pc.check_caddyfile(p)), expect


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


def test_entrypoint_refuses_missing_settings(tmp_path):
    with pytest.raises(entrypoint.ConfigError, match="MANTEL_HA_URL"):
        entrypoint.plan([], {}, options_path=tmp_path / "none")


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


def test_entrypoint_admin_commands_default_to_the_data_volume(tmp_path):
    args, _ = entrypoint.plan(["links"], {}, options_path=tmp_path / "none")
    assert args == ["links", "--data-dir", "/data"]
    args, _ = entrypoint.plan(["link", "--ha-user-id", "x", "--role", "owner", "--data-dir", "/elsewhere"], {}, options_path=tmp_path / "none")
    assert args.count("--data-dir") == 1


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
    from mantel_server import auth, health
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


def test_build_static_refuses_an_existing_output(tmp_path):
    src = tmp_path / "web"
    _tree(src, {"a.js": "x"})
    (tmp_path / "out").mkdir()
    with pytest.raises(SystemExit):
        build_static.build(src, tmp_path / "out")


def test_build_static_stamps_the_real_web_app(tmp_path):
    assert len(build_static.build(ROOT / "web", tmp_path / "out")) == 16
    assert json.loads((tmp_path / "out/static-manifest.json").read_text())["files"]["home.html"]["size"] > 0
