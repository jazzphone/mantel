"""tools/stage_ha_app.py: what the local HA App folder holds, the private-content scan, and how it writes."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("stage_ha_app", ROOT / "tools/stage_ha_app.py")
stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)


@pytest.fixture(scope="module")
def pairs():
    return stage.plan()


def test_the_plan_holds_the_app_and_its_code(pairs):
    dests = {d for _, d in pairs}
    for name in ("config.yaml", "Dockerfile", "DOCS.md", "README.md", "requirements.txt", "icon.png",
                 "translations/en.yaml", "app/entrypoint.py", "app/hosts/server/mantel_server/ingress.py",
                 "app/hosts/server/mantel_server/__main__.py", "app/hosts/server/mantel_server/migrations/0008_ha_door.sql",
                 "app/hosts/server/mantel_server/static/dev.html", "app/hosts/server/mantel_server/hk_writes.json",
                 "app/web/home.html", "app/web/shim/base.js", "app/web/hk/shell/hk-view-host.js", "app/web/mdi/icons.json"):
        assert name in dests, name
    assert any(d.startswith("app/hk_core/") and d.endswith(".py") for d in dests)
    assert len(dests) == len(pairs)                                     # no destination twice
    assert not [d for d in dests if "__pycache__" in d or d.endswith(".pyc")]
    assert not [d for d in dests if d.startswith(("app/tests", "app/docs", "app/spikes", "app/hosts/ha"))]
    # /docs (docs_pages.py): HK's pages and Mantel's own, as config.py finds them in an image
    assert "app/help/Mantel.md" in dests and "app/help/hk/Sleep-Screen.md" in dests


def test_no_folder_the_ha_samba_add_on_refuses(pairs):
    # HA's Samba add-on (the share the App is staged into) refuses to create a folder named "icons", any case:
    # web/app/icons made 0.1.29's staging fail until it became web/app/art (2026-10-19)
    folders = {part.lower() for _, d in pairs for part in d.split("/")[:-1]}
    assert "icons" not in folders
    assert "app/web/app/art/mantel-192.png" in {d for _, d in pairs}


def test_the_real_plan_scans_clean(pairs):
    assert stage.scan(pairs) == []


def test_the_scan_refuses_private_content(tmp_path):
    def f(name, text=b"x"):
        p = tmp_path / name.replace("/", "_")
        p.write_bytes(text if isinstance(text, bytes) else text.encode())
        return p
    bad = [
        (f("a.woff2"), "app/web/hk/fonts/SF-Pro.woff2"),
        (f("b.ttf"), "app/web/hk/fonts/whatever.ttf"),
        (f("c.json"), "app/web/fixtures/settings.json"),
        (f("d.key"), "app/at_rest.key"),
        (f("e.txt"), "app/ha_token"),
        (f("f.db"), "app/mantel.db"),
        (f("g.js", "var t = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0';"), "app/web/x.js"),
        (f("h.py", 'URL = "http://192.168.1.20:8123"'), "app/hosts/server/mantel_server/x.py"),
        (f("i.py", 'URL = "http://192.0.2.53:8123"'), "app/hosts/server/mantel_server/elsewhere.py"),
        (f("j.md", "-----BEGIN PRIVATE KEY-----"), "DOCS.md"),
        (f("k.png", b"\x89PNG"), "app/web/hk-glyphs/a.png"),
        (f("o.js", "window.hkGlyphs = {};"), "app/web/hk/iconset/hk-glyphs.js"),
        (f("p.ttf"), "app/web/hk/fonts/SF-Pro.ttf"),
    ]
    hits = stage.scan(bad)
    for _, dest in bad:
        assert any(h.startswith(dest) for h in hits), dest
    assert not any("192.168" in h or "eyJ" in h for h in hits)           # findings never echo the value
    fine = [(f("l.py", 'peers = ("172.30.32.2",)'), "app/hosts/server/mantel_server/config.py"),
            (f("m.py", 'ha_url = "http://192.0.2.53:8123"'), "app/hosts/server/mantel_server/config.py"),
            (f("n.css", 'src: url("/hk/fonts/SF-Pro.woff2")'), "app/web/hk/fonts/sf-pro.css")]
    assert stage.scan(fine) == []


def test_dry_run_writes_nothing(tmp_path, capsys):
    target = tmp_path / "mantel"
    assert stage.main(["--dry-run", str(target)]) == 0
    out = capsys.readouterr().out
    assert "private-content scan: clean" in out and "would write" in out and not target.exists()


def _small_web(tmp_path):
    web = tmp_path / "web"
    (web / "shim").mkdir(parents=True)
    (web / "home.html").write_text("<!doctype html><head></head>")
    (web / "shim/base.js").write_text("export const base = '';")
    return web


def test_write_stages_a_complete_folder_and_replaces_only_its_own(tmp_path, monkeypatch):
    web = _small_web(tmp_path)
    pairs = [(s, d) for s, d in stage.plan() if not d.startswith("app/web/")]
    target = tmp_path / "local_apps" / "mantel"
    info = stage.write(target, pairs, web_src=web)
    assert (target / "config.yaml").is_file() and (target / "Dockerfile").is_file()
    assert (target / "app/entrypoint.py").is_file() and (target / "app/web/shim/base.js").is_file()
    assert (target / "app/BUILD_ID").read_text().strip() == info["build"]
    marker = json.loads((target / stage.MARKER).read_text())
    assert marker["files"] == info["files"] and marker["tool"] == "tools/stage_ha_app.py"
    assert sorted(p.name for p in target.parent.iterdir()) == ["mantel"]  # no temp folder left behind
    # main(): refuses an existing folder unless --replace, and --replace only a folder it staged
    real_write = stage.write
    monkeypatch.setattr(stage, "plan", lambda: pairs)
    monkeypatch.setattr(stage, "write", lambda t, p: real_write(t, p, web_src=web))
    other = tmp_path / "local_apps" / "someone_else"
    other.mkdir()
    (other / "config.yaml").write_text("name: theirs\n")
    assert stage.main([str(target)]) == 2
    assert stage.main([str(other), "--replace"]) == 2 and (other / "config.yaml").read_text() == "name: theirs\n"


def test_main_replaces_a_staged_folder(tmp_path, monkeypatch):
    web = _small_web(tmp_path)
    pairs = [(s, d) for s, d in stage.plan() if not d.startswith("app/web/")]
    real_write = stage.write
    monkeypatch.setattr(stage, "plan", lambda: pairs)
    monkeypatch.setattr(stage, "write", lambda t, p: real_write(t, p, web_src=web))
    target = tmp_path / "apps" / "mantel"
    assert stage.main([str(target)]) == 0
    (target / "stale.txt").write_text("from an older stage")
    assert stage.main([str(target), "--replace"]) == 0
    assert not (target / "stale.txt").exists() and (target / stage.MARKER).is_file()
    assert sorted(p.name for p in target.parent.iterdir()) == ["mantel"]


def test_main_refuses_to_stage_inside_the_repository():
    assert stage.main([str(ROOT / "build-here-never")]) == 2
    assert not (ROOT / "build-here-never").exists()


def test_the_real_plan_holds_none_of_the_licensed_assets(pairs):
    """SF Pro and the glyph set reach a home only through Your files (user_files.py), never the staged App."""
    for src, dest in pairs:
        low = dest.lower()
        assert "sf-pro." not in low or low.endswith(".css"), dest
        assert "hk-glyphs" not in low and not low.endswith((".woff", ".woff2", ".ttf", ".otf")), dest
