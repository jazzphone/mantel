"""tools/publish_ha_apps.py: the add-on repository (the ha-apps branch) Home Assistant installs and updates from."""
from __future__ import annotations

import importlib.util
import shutil
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("publish_ha_apps", ROOT / "tools/publish_ha_apps.py")
pub = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pub)

VERSION = pub.cv.versions()[pub.cv.SOURCE]


@pytest.fixture(scope="module")
def published(tmp_path_factory):
    out = tmp_path_factory.mktemp("ha-apps") / "tree"
    files = pub.publish(out, VERSION, allow_unreleased=True)
    return out, files


def test_the_layout(published):
    out, files = published
    assert set(files) == {
        "repository.yaml", "README.md",
        *(f"{folder}/{name}" for folder in ("mantel", "mantel-connect")
          for name in ("config.yaml", "DOCS.md", "README.md", "CHANGELOG.md", "icon.png", "translations/en.yaml")),
    }
    repo = pub.pc.parse_yaml((out / "repository.yaml").read_text())
    assert repo == {"name": "Mantel", "url": "https://github.com/jazzphone/mantel", "maintainer": "jazzphone"}
    assert (out / "mantel/icon.png").read_bytes() == (ROOT / "packaging/ha-app/icon.png").read_bytes()
    assert (out / "mantel/DOCS.md").read_text() == (ROOT / "packaging/ha-app/DOCS.md").read_text()
    assert (out / "mantel-connect/DOCS.md").read_text() == (ROOT / "packaging/connect-app/DOCS.md").read_text()
    assert "https://github.com/jazzphone/mantel#ha-apps" in (out / "README.md").read_text()


def test_no_dockerfile_or_code_is_published(published):
    out, files = published
    assert not [f for f in files if f.endswith(("Dockerfile", "requirements.txt", ".py", ".js"))
                or "/app/" in f or f.startswith("app/")]
    # the published folder is not something the Supervisor could build: it pulls
    assert not list(out.rglob("Dockerfile"))


def test_config_yaml_names_the_image_and_keeps_everything_else(published):
    out, _ = published
    for app, image in (("mantel", "ghcr.io/jazzphone/mantel-app-{arch}"),
                       ("mantel-connect", "ghcr.io/jazzphone/mantel-connect-app-{arch}")):
        src = "packaging/ha-app" if app == "mantel" else "packaging/connect-app"
        doc = pub.pc.parse_yaml((out / app / "config.yaml").read_text())
        source = pub.pc.parse_yaml((ROOT / src / "config.yaml").read_text())
        assert doc.pop("image") == image and doc == source
        assert str(doc["version"]) == VERSION
        text = (out / app / "config.yaml").read_text()
        assert "LOCAL" not in text and "no\n# `image:` key" not in text and "PULLS the image" in text
    assert pub.APPS[0].image_names == {"amd64": "ghcr.io/jazzphone/mantel-app-amd64",
                                       "aarch64": "ghcr.io/jazzphone/mantel-app-aarch64"}


def test_the_local_build_app_stays_imageless():
    # tools/stage_ha_app.py stages packaging/ha-app as it is: still no image, still a local build
    for name in ("packaging/ha-app/config.yaml", "packaging/connect-app/config.yaml"):
        assert "image" not in pub.pc.parse_yaml((ROOT / name).read_text()), name
    with pytest.raises(pub.PublishError, match="already has an image"):
        pub.published_config("name: x\nversion: \"1.0.0\"\nimage: y\n", pub.APPS[0], "1.0.0")


def test_the_changelog_is_this_versions_section(published):
    out, _ = published
    text = (out / "mantel/CHANGELOG.md").read_text()
    notes = pub.cv.changelog_section(VERSION) or pub.cv.changelog_section("Unreleased")
    assert text.startswith(f"# Changelog\n\n## {VERSION}\n") and text.endswith(notes)


def _repo_copy(tmp_path) -> Path:
    """The files publish() reads, copied, so a test can plant something in them."""
    root = tmp_path / "repo"
    for name in ("CHANGELOG.md", *pub.cv.FILES, "packaging/ha-app/DOCS.md", "packaging/ha-app/icon.png",
                 "packaging/ha-app/translations/en.yaml", "packaging/connect-app/DOCS.md",
                 "packaging/connect-app/translations/en.yaml"):
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, root / name)
    return root


def test_the_private_content_scan_refuses_and_writes_nothing(tmp_path):
    root = _repo_copy(tmp_path)
    docs = root / "packaging/ha-app/DOCS.md"
    docs.write_text(docs.read_text() + "\nOpen http://192.168.7.21:8123 on the tablet.\n")
    out = tmp_path / "out"
    with pytest.raises(pub.PublishError, match="PRIVATE-CONTENT SCAN: mantel/DOCS.md:.*private-network address"):
        pub.publish(out, VERSION, allow_unreleased=True, root=root)
    assert not out.exists() and not list(tmp_path.glob(".mantel-ha-apps-*"))


def test_a_home_s_own_words_are_refused(tmp_path, monkeypatch):
    root = _repo_copy(tmp_path)
    notes = root / "CHANGELOG.md"
    notes.write_text(notes.read_text().replace("## Unreleased\n", "## Unreleased\n\n- Fixed Wobbleton's hallway\n", 1))
    monkeypatch.setenv("HK_PRIVATE", "wobbleton")
    with pytest.raises(pub.PublishError, match=r"mantel/CHANGELOG.md:\d+: a home's own word"):
        pub.publish(tmp_path / "out", VERSION, allow_unreleased=True, root=root)


def test_the_version_and_release_notes_must_be_right(tmp_path):
    root = _repo_copy(tmp_path)
    with pytest.raises(pub.PublishError, match="is not Mantel's version"):
        pub.publish(tmp_path / "a", "9.9.9", allow_unreleased=True, root=root)
    (root / "CHANGELOG.md").write_text("# Changelog\n\n## Unreleased\n\n- new\n")
    # a release needs its own section; Unreleased only for a dry run
    with pytest.raises(pub.PublishError, match=f"no section for {VERSION}"):
        pub.publish(tmp_path / "b", VERSION, root=root)
    (root / "CHANGELOG.md").write_text(f"# Changelog\n\n## {VERSION} - 2026-10-20\n\n- new\n")
    assert "mantel/CHANGELOG.md" in pub.publish(tmp_path / "c", VERSION, root=root)
    p = root / "packaging/connect-app/config.yaml"
    p.write_text(p.read_text().replace(f'version: "{VERSION}"', 'version: "0.1.0"'))
    with pytest.raises(pub.PublishError, match="connect-app"):
        pub.publish(tmp_path / "d", VERSION, root=root)


def test_out_must_be_new_or_empty_and_outside_the_repository(tmp_path):
    (tmp_path / "full").mkdir()
    (tmp_path / "full/keep.txt").write_text("x")
    with pytest.raises(pub.PublishError, match="not empty"):
        pub.publish(tmp_path / "full", VERSION, allow_unreleased=True)
    assert (tmp_path / "full/keep.txt").read_text() == "x"
    with pytest.raises(pub.PublishError, match="inside the repository"):
        pub.publish(ROOT / "build/ha-apps-test", VERSION, allow_unreleased=True)
    (tmp_path / "empty").mkdir()
    assert pub.publish(tmp_path / "empty", VERSION, allow_unreleased=True)


def test_an_extra_file_in_the_tree_is_refused(published, tmp_path):
    out, _ = published
    tree = tmp_path / "t"
    shutil.copytree(out, tree)
    (tree / "mantel/Dockerfile").write_text("FROM scratch\n")
    (tree / "mantel/app").mkdir()
    (tree / "mantel/app/entrypoint.py").write_text("")
    found = pub.checks(tree, VERSION)
    assert any(f.startswith("mantel/Dockerfile:") for f in found)
    assert any(f.startswith("mantel/app/entrypoint.py:") for f in found)


def test_the_cli(tmp_path, capsys):
    assert pub.main([str(tmp_path / "x"), "--version", "0.0.0"]) == 1
    assert "is not Mantel's version" in capsys.readouterr().err
    assert pub.main([str(tmp_path / "y"), "--version", VERSION, "--allow-unreleased"]) == 0
    assert "private-content scan clean" in capsys.readouterr().out
