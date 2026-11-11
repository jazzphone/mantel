"""tools/stage_connect_app.py, the Connect App's packaging checks, the entrypoint/config switches for Connect."""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import package_check as pc  # noqa: E402

spec = importlib.util.spec_from_file_location("stage_connect_app", ROOT / "tools/stage_connect_app.py")
stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)


def test_the_plan_holds_the_app_and_only_the_connect_code():
    pairs = stage.plan()
    dests = {d for _, d in pairs}
    assert {"config.yaml", "Dockerfile", "DOCS.md", "README.md", "requirements.txt", "icon.png", "logo.png",
            "translations/en.yaml",
            "app/mantel_connect/__main__.py", "app/mantel_connect/app.py", "app/mantel_connect/pairing.py",
            "app/mantel_connect/pki.py", "app/mantel_connect/protocol.py", "app/mantel_connect/__init__.py"} == dests
    assert len(dests) == len(pairs) and all(src.is_file() for src, _ in pairs)
    # none of Mantel Server, the web app, or the Phase 0 proof's signed-header channel
    assert not [d for d in dests if "mantel_server" in d or "/web" in d or d.endswith(("channel.py", "proxy.py"))]


def test_the_real_plan_scans_clean():
    assert stage.scan(stage.plan()) == []


def test_the_scan_refuses_secrets_in_the_connect_files(tmp_path):
    def f(name, text):
        p = tmp_path / name
        p.write_text(text)
        return p
    bad = [(f("a.py", "-----BEGIN PRIVATE KEY-----"), "app/mantel_connect/x.py"),
           (f("b.json", '{"a": 1}'), "app/mantel_connect/client.key"),
           (f("c.py", 'HOST = "192.168.1.9"'), "app/mantel_connect/y.py"),
           (f("d.txt", "x"), "app/mantel_connect/ha_token")]
    hits = stage.scan(bad)
    for _, dest in bad:
        assert any(h.startswith(dest) for h in hits), dest
    assert not any("192.168" in h for h in hits)


def test_dry_run_writes_nothing(tmp_path, capsys):
    target = tmp_path / "mantel_connect"
    assert stage.main(["--dry-run", str(target)]) == 0
    out = capsys.readouterr().out
    assert "private-content scan: clean" in out and "would write" in out and not target.exists()


def test_write_stages_a_marked_folder_and_replace_is_guarded(tmp_path, capsys):
    target = tmp_path / "mantel_connect"
    assert stage.main([str(target)]) == 0
    marker = json.loads((target / stage.MARKER).read_text())
    assert marker["tool"] == "tools/stage_connect_app.py" and marker["files"] == 14
    assert (target / "app/mantel_connect/protocol.py").read_text() == (ROOT / "hosts/server/mantel_connect/protocol.py").read_text()
    assert stage.main([str(target)]) == 2                                            # exists: needs --replace
    assert "pass --replace" in capsys.readouterr().err
    assert stage.main([str(target), "--replace"]) == 0
    # another tool's folder (the Mantel App's marker) and a folder with no marker are never replaced
    (target / stage.MARKER).write_text(json.dumps({"tool": "tools/stage_ha_app.py"}))
    assert stage.main([str(target), "--replace"]) == 2
    plain = tmp_path / "plain"
    plain.mkdir()
    (plain / "mine.txt").write_text("keep")
    assert stage.main([str(plain), "--replace"]) == 2 and (plain / "mine.txt").read_text() == "keep"
    # never inside the repository
    assert stage.main([str(ROOT / "packaging/connect-app/staged-here")]) == 2
    assert not (ROOT / "packaging/connect-app/staged-here").exists()


def test_the_staged_folder_runs_without_mantel_server(tmp_path):
    """The App's image has only app/mantel_connect: importing it must need nothing else of this repository."""
    target = tmp_path / "mantel_connect"
    assert stage.main([str(target)]) == 0
    code = ("import sys; sys.path.insert(0, 'app'); import mantel_connect.app, mantel_connect.pairing, "
            "mantel_connect.__main__; assert 'mantel_server' not in sys.modules; print('ok')")
    out = subprocess.run([sys.executable, "-I", "-c", code], cwd=target, capture_output=True, text=True)
    assert out.returncode == 0 and out.stdout.strip() == "ok", out.stderr


def test_connect_app_config_is_checked(tmp_path):
    assert pc.check_connect_app(ROOT / "packaging/connect-app/config.yaml") == []
    good = (ROOT / "packaging/connect-app/config.yaml").read_text()
    for needle, replacement, expect in (
            ("ingress: true", "ingress: false", "ingress"),
            ("startup: application", "startup: application\nhomeassistant_api: true", "homeassistant_api"),
            ("startup: application", "startup: application\nhost_network: true", "host_network"),
            ("startup: application", "startup: application\nmap:\n  - config", "map"),
            ("boot: auto", "boot: manual", "boot: auto"),
            ('pairing_code: "password?"', 'pairing_code: "str?"', "password"),
            ('  pairing_code: ""', '  pairing_code: "ABCDE"', "default to empty")):
        assert needle in good, needle
        p = tmp_path / "config.yaml"
        p.write_text(good.replace(needle, replacement, 1))
        assert any(expect in m for m in pc.check_connect_app(p)), (needle, pc.check_connect_app(p))


def test_connect_compose_override_adds_one_port_and_nothing_else(tmp_path):
    path = ROOT / "packaging/compose/compose.connect.yaml"
    assert pc.check_connect_compose(path) == []
    good = path.read_text()
    p = tmp_path / "c.yaml"
    for needle, replacement, expect in (
            ('    ports:\n      - "${MANTEL_CONNECT_HOST_PORT:-8766}:8766"',
             '    ports:\n      - "8766:8766"\n      - "9000:9000"', "one published port"),
            ("    environment:", "    volumes:\n      - /:/host\n    environment:", "only environment and ports"),
            ('      MANTEL_CONNECT: "1"', '      MANTEL_CONNECT: "1"\n      MANTEL_CONNECT_TOKEN: abc', "secret")):
        assert needle in good, needle
        p.write_text(good.replace(needle, replacement, 1))
        assert any(expect in m for m in pc.check_connect_compose(p)), (needle, pc.check_connect_compose(p))
    # the base stack publishes no port of mantel-server but the Intercom's listener (8767): Connect's 8766 and the
    # proxy's 8765 come only from their overrides
    base = pc.parse_yaml((ROOT / "packaging/compose/compose.yaml").read_text())
    assert [str(x).rsplit(":", 1)[1] for x in base["services"]["mantel-server"]["ports"]] == ["8767"]


def test_package_check_as_a_whole_is_clean():
    assert pc.run_all() == []


# -- entrypoint and flags -------------------------------------------------------------------------------------
def _entrypoint():
    spec = importlib.util.spec_from_file_location("mantel_entrypoint_c", ROOT / "packaging/docker/entrypoint.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


BASE_ENV = {"MANTEL_HA_URL": "http://ha.invalid:8123", "MANTEL_PUBLIC_URL": "https://mantel.example.com/"}


def test_connect_is_off_unless_asked_for():
    ep = _entrypoint()
    args = ep.container_args(dict(BASE_ENV))
    assert "--connect" not in args
    on = ep.container_args({**BASE_ENV, "MANTEL_CONNECT": "1", "MANTEL_CONNECT_ADDRESS": "mantel.lan:8766"})
    assert on[on.index("--connect"):on.index("--connect") + 1] == ["--connect"]
    assert on[on.index("--ha-door-rules") + 1] == "trusted"                       # Avery's decision: the ha door is trusted
    assert on[on.index("--connect-address") + 1] == "mantel.lan:8766"
    assert on[on.index("--connect-port") + 1] == "8766" and on[on.index("--connect-listen") + 1] == "0.0.0.0"
    with pytest.raises(ep.ConfigError):
        ep.container_args({**BASE_ENV, "MANTEL_CONNECT": "yes", "MANTEL_HA_DOOR_RULES": "everything"})


def test_connect_admin_command_passes_through_with_the_data_dir():
    ep = _entrypoint()
    argv, _ = ep.plan(["connect", "pair"], {"MANTEL_DATA_DIR": "/data"})
    assert argv[:2] == ["connect", "pair"] and argv[-2:] == ["--data-dir", "/data"]


def test_connect_flags_imply_ingress_without_trusting_any_peer():
    from mantel_server.config import parse_args
    cfg = parse_args(["--connect"])
    assert cfg.connect and cfg.ingress and cfg.ingress_peers == () and cfg.connect_port == 8766
    # --ingress alongside keeps the Supervisor's address (an App that also pairs is unusual but coherent)
    both = parse_args(["--connect", "--ingress"])
    assert both.ingress_peers == ("172.30.32.2",)
    off = parse_args([])
    assert not off.connect and not off.ingress
    with pytest.raises(SystemExit):
        parse_args(["--connect", "--ingress", "--ingress-only"])
    with pytest.raises(SystemExit):
        parse_args(["--connect", "--connect-port", "70000"])


def test_the_mantel_app_image_carries_the_protocol_the_server_imports():
    """mantel_server.connect_pairing imports mantel_connect at start-up, so the Mantel App's folder needs it."""
    spec = importlib.util.spec_from_file_location("stage_ha_app_c", ROOT / "tools/stage_ha_app.py")
    ha = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ha)
    dests = {d for _, d in ha.plan()}
    assert {"app/hosts/server/mantel_connect/protocol.py", "app/hosts/server/mantel_connect/pki.py",
            "app/hosts/server/mantel_server/network/connect_pairing.py"} <= dests
    assert ha.scan(ha.plan()) == []
