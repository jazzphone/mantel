"""--release of the two integrations' publishers (hosts/ha/custom_components/{hk_frontend,mantel}/tools/publish/
publish.py): HACS offers only the versions GitHub has releases of, so after --push the manifest's version is tagged
v<version> and released with `gh release create`, its notes the CHANGELOG.md section. Opt-in; refused (before
anything is committed or pushed) with no section for the version or a tag that exists. `gh` is a stand-in here."""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
COMPONENTS = ROOT / "hosts/ha/custom_components"


def load(domain: str):
    spec = importlib.util.spec_from_file_location(f"publish_{domain}", COMPONENTS / domain / "tools/publish/publish.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CHANGELOG = """# Changelog

Intro text.

## Unreleased

- Not yet.

## 1.10.0 - 2026-10-21

- Ten.

## [1.1.0] - 2026-01-02

- One point one.
- A second line
  that continues.

### A sub-heading stays in its section

text

## 1.0.0

- First.
"""


def test_the_notes_are_the_versions_section():
    notes = load("hk_frontend").release_notes
    assert notes(CHANGELOG, "1.10.0") == "- Ten."
    assert notes(CHANGELOG, "1.1.0") == ("- One point one.\n- A second line\n  that continues.\n\n"
                                         "### A sub-heading stays in its section\n\ntext")
    assert notes(CHANGELOG, "1.0.0") == "- First.", "the last section, with no date"


@pytest.mark.parametrize("version,says", [("1.2.0", "no section '## 1.2.0'"), ("1.1", "no section"),
                                          ("0.1.0", "no section"), ("1.10.1", "no section")])
def test_a_missing_section_is_refused(version, says):
    with pytest.raises(ValueError, match=says):
        load("hk_frontend").release_notes(CHANGELOG, version)


def test_an_empty_section_and_unreleased_are_not_notes():
    pub = load("hk_frontend")
    with pytest.raises(ValueError, match="empty"):
        pub.release_notes("## 2.0.0 - 2026-01-01\n\n## 1.0.0\n\n- x\n", "2.0.0")
    with pytest.raises(ValueError, match="no section"):
        pub.release_notes(CHANGELOG, "Unreleased")


@pytest.mark.parametrize("domain", ["hk_frontend", "mantel"])
def test_each_integrations_changelog_has_its_manifest_versions_section(domain):
    pub = load("hk_frontend")
    manifest = json.loads((COMPONENTS / domain / "manifest.json").read_text())
    changelog = (COMPONENTS / domain / "tools/publish/root/CHANGELOG.md").read_text()
    assert pub.release_notes(changelog, manifest["version"]), f"{domain} {manifest['version']}"
    # newest first: the section after "Unreleased" is the manifest's version, and every section has notes
    versions = [m.group(1) for m in pub.HEADING.finditer(changelog)]
    assert versions[0] == manifest["version"]
    assert all(pub.release_notes(changelog, v) for v in versions)


# ---- the whole flow against a local origin, with `gh` replaced by a script that records its arguments

def git(*args, cwd):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


@pytest.fixture
def world(tmp_path, monkeypatch):
    origin = tmp_path / "origin.git"
    git("init", "-q", "--bare", "-b", "main", str(origin), cwd=tmp_path)
    repo = tmp_path / "repo"
    git("clone", "-q", str(origin), str(repo), cwd=tmp_path)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "gh.log"
    gh = bin_dir / "gh"
    gh.write_text(f'#!/bin/sh\nprintf "%s\\n" "$*" >> "{log}"\n'
                  f'while [ $# -gt 0 ]; do if [ "$1" = "--notes-file" ]; then cat "$2" >> "{log}"; fi; shift; done\n')
    gh.chmod(0o755)
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    return origin, repo, log, tmp_path


def source_files(tmp_path, changelog: str):
    src = tmp_path / "src"
    src.mkdir(exist_ok=True)
    (src / "CHANGELOG.md").write_text(changelog)
    (src / "README.md").write_text("# Hello\n")
    return [(str(src / "CHANGELOG.md"), "CHANGELOG.md"), (str(src / "README.md"), "README.md")]


def publish(domain, monkeypatch, repo, *flags):
    pub = load(domain)
    monkeypatch.setattr(sys, "argv", ["publish.py", str(repo), "--no-tests", *flags])
    return pub, pub.main


@pytest.mark.parametrize("domain,name", [("hk_frontend", "HK Frontend"), ("mantel", "Mantel Link")])
def test_release_tags_pushes_and_releases_with_the_notes(world, monkeypatch, domain, name):
    origin, repo, log, tmp_path = world
    version = json.loads((COMPONENTS / domain / "manifest.json").read_text())["version"]
    pub, main = publish(domain, monkeypatch, repo, "--commit", "Publish", "--push", "--release")
    monkeypatch.setattr(pub, "plan", lambda: source_files(tmp_path, CHANGELOG.replace("1.1.0", version)))
    if domain == "hk_frontend":
        monkeypatch.setattr(pub, "wiki_pages", lambda: [])
    assert main() == 0
    assert git("tag", "-l", cwd=origin) == f"v{version}"
    assert f"v{version}" in git("ls-remote", "--tags", str(origin), cwd=tmp_path)
    out = log.read_text()
    assert f"release create v{version} --title {name} {version} --notes-file" in out and "--verify-tag" in out
    assert "- One point one." in out and "Unreleased" not in out and "- Ten." not in out


@pytest.mark.parametrize("domain", ["hk_frontend", "mantel"])
def test_without_release_nothing_is_tagged_or_released(world, monkeypatch, domain):
    origin, repo, log, tmp_path = world
    pub, main = publish(domain, monkeypatch, repo, "--commit", "Publish", "--push")
    monkeypatch.setattr(pub, "plan", lambda: source_files(tmp_path, "# nothing\n"))
    if domain == "hk_frontend":
        monkeypatch.setattr(pub, "wiki_pages", lambda: [])
    assert main() == 0
    assert git("rev-parse", "main", cwd=origin) and git("tag", "-l", cwd=origin) == ""
    assert not log.exists()


@pytest.mark.parametrize("domain", ["hk_frontend", "mantel"])
def test_a_tag_that_exists_refuses_before_anything_is_pushed(world, monkeypatch, domain):
    origin, repo, log, tmp_path = world
    version = json.loads((COMPONENTS / domain / "manifest.json").read_text())["version"]
    # the tag is on origin already (made by someone else, or by an earlier release)
    other = tmp_path / "other"
    git("clone", "-q", str(origin), str(other), cwd=tmp_path)
    (other / "f").write_text("x")
    git("add", "f", cwd=other)
    git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "x", cwd=other)
    git("tag", f"v{version}", cwd=other)
    git("push", "-q", "origin", "main", "--tags", cwd=other)
    git("pull", "-q", cwd=repo)
    before = git("rev-parse", "main", cwd=origin)
    pub, main = publish(domain, monkeypatch, repo, "--commit", "Publish", "--push", "--release")
    monkeypatch.setattr(pub, "plan", lambda: source_files(tmp_path, CHANGELOG.replace("1.1.0", version)))
    if domain == "hk_frontend":
        monkeypatch.setattr(pub, "wiki_pages", lambda: [])
    with pytest.raises(SystemExit, match=f"the tag v{version} exists"):
        main()
    assert git("rev-parse", "main", cwd=origin) == before and not log.exists()


@pytest.mark.parametrize("domain", ["hk_frontend", "mantel"])
def test_a_version_without_notes_refuses_before_anything_is_pushed(world, monkeypatch, domain):
    origin, repo, log, tmp_path = world
    pub, main = publish(domain, monkeypatch, repo, "--commit", "Publish", "--push", "--release")
    monkeypatch.setattr(pub, "plan", lambda: source_files(tmp_path, "# Changelog\n\n## 0.0.1\n\n- Old.\n"))
    if domain == "hk_frontend":
        monkeypatch.setattr(pub, "wiki_pages", lambda: [])
    with pytest.raises(SystemExit, match="no release: CHANGELOG.md has no section"):
        main()
    assert git("branch", "--list", cwd=origin) == "" and not log.exists()


@pytest.mark.parametrize("domain", ["hk_frontend", "mantel"])
def test_release_needs_push(domain, monkeypatch, tmp_path, capsys):
    pub = load(domain)
    monkeypatch.setattr(sys, "argv", ["publish.py", str(tmp_path / "r"), "--commit", "x", "--release"])
    with pytest.raises(SystemExit):
        pub.main()
    assert "--release needs" in capsys.readouterr().err
