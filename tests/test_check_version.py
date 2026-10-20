"""tools/check_version.py and tools/bump_version.py: one version number for the App, Connect, the package and the tag."""
from __future__ import annotations

import datetime
import importlib.util
import shutil
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / f"tools/{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


cv = _load("check_version")
bump = _load("bump_version")

CHANGELOG = """# Changelog

Intro.

## Unreleased

- something new

## 0.1.35 - 2026-10-01

- the fix

## [0.1.34]

- older
"""


@pytest.fixture
def tree(tmp_path):
    """A copy of the three version files and a small CHANGELOG, all at 0.1.35."""
    for name in cv.FILES:
        (tmp_path / name).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, tmp_path / name)
    bump.set_version("0.1.35", tmp_path)
    (tmp_path / "CHANGELOG.md").write_text(CHANGELOG)
    return tmp_path


def test_the_repository_has_one_version():
    assert cv.problems() == []
    found = cv.versions()
    assert len(set(found.values())) == 1 and cv.SEMVER.match(found[cv.SOURCE])
    assert set(found) == {"packaging/ha-app/config.yaml", "packaging/connect-app/config.yaml", "pyproject.toml"}


def test_the_app_config_is_the_source_and_a_mismatch_is_named(tree):
    assert cv.problems(root=tree) == []
    p = tree / "packaging/connect-app/config.yaml"
    p.write_text(p.read_text().replace('version: "0.1.35"', 'version: "0.1.0"'))
    found = cv.problems(root=tree)
    assert len(found) == 1 and "packaging/connect-app/config.yaml" in found[0] and "'0.1.35'" in found[0]
    assert cv.main(["--root", str(tree)]) == 1


def test_a_version_that_is_not_x_y_z_is_refused(tree):
    bump.set_version("0.1", tree)
    assert any("is not X.Y.Z" in line for line in cv.problems(root=tree))


def test_the_tag_must_match_and_have_release_notes(tree, capsys):
    assert cv.problems("v0.1.35", tree) == []
    assert cv.main(["--root", str(tree), "--tag", "v0.1.35", "--print"]) == 0
    assert capsys.readouterr().out.strip() == "0.1.35"
    assert any("expected v0.1.35" in line for line in cv.problems("v0.1.36", tree))
    assert any("expected v0.1.35" in line for line in cv.problems("0.1.35", tree))
    bump.set_version("0.1.36", tree)
    # the right tag, but CHANGELOG.md has no 0.1.36 section yet
    assert [line for line in cv.problems("v0.1.36", tree) if "CHANGELOG" in line]


def test_changelog_sections(tree):
    assert cv.changelog_section("0.1.35", tree) == "- the fix\n"
    assert cv.changelog_section("0.1.34", tree) == "- older\n"
    assert cv.changelog_section("Unreleased", tree) == "- something new\n"
    assert cv.changelog_section("0.1.3", tree) is None  # a prefix of 0.1.35 is not that section
    assert cv.changelog_section("0.1.33", tree) is None


def test_bump_changes_only_the_version_lines(tree):
    before = {n: (tree / n).read_text() for n in cv.FILES}
    assert sorted(bump.set_version("0.2.0", tree)) == sorted(cv.FILES)
    for name in cv.FILES:
        old, new = before[name].splitlines(), (tree / name).read_text().splitlines()
        assert len(old) == len(new) and sum(a != b for a, b in zip(old, new)) == 1, name
    assert set(cv.versions(tree).values()) == {"0.2.0"}
    assert bump.set_version("0.2.0", tree) == []  # nothing left to change


def test_bump_names_the_unreleased_section(tree):
    assert bump.main(["0.1.36", "--changelog", "--root", str(tree)]) == 0
    assert cv.problems("v0.1.36", tree) == []
    assert cv.changelog_section("0.1.36", tree) == "- something new\n"
    assert cv.changelog_section("Unreleased", tree) is None
    assert bump.name_unreleased("0.1.37", tree, datetime.date(2026, 1, 2)) is False
    # with no Unreleased section and no section for the version, --changelog fails instead of tagging without notes
    assert bump.main(["0.1.37", "--changelog", "--root", str(tree)]) == 1
    assert bump.main(["v0.1.37", "--root", str(tree)]) == 2


def test_the_checks_job_runs_it():
    text = (ROOT / ".github/workflows/tests.yml").read_text()
    assert "python tools/check_version.py" in text
