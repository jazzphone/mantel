"""tools/check_private.py: a home's own words, given from outside the repository, in files and commits."""
from __future__ import annotations

import importlib.util
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("check_private", ROOT / "tools/check_private.py")
cp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cp)


def _repo(tmp_path: Path) -> Path:
    def git(*args):
        subprocess.run(["git", *args], cwd=tmp_path, check=True, capture_output=True)
    git("init", "-q")
    git("config", "user.name", "Fictional Owner")
    git("config", "user.email", "owner@example.test")
    (tmp_path / "a.py").write_text("x = 1\nURL = 'http://Fictional-Farm.example:8123'\n")
    (tmp_path / "b.bin").write_bytes(b"\0fictional-farm")
    git("add", ".")
    git("commit", "-q", "-m", "the fictional-farm tablet")
    return tmp_path


def test_words_come_from_the_environment_and_a_file(tmp_path):
    words = tmp_path / "words"
    words.write_text("# a comment\n\nfictional-farm\n192\\.0\\.2\\.\n")
    pats = cp.patterns({"HK_PRIVATE": "ann", "HK_PRIVATE_FILE": str(words)})
    assert [p.pattern for p in pats] == ["ann", "fictional-farm", r"192\.0\.2\."]
    assert cp.patterns({}) == []


def test_files_and_messages_are_found_by_line_never_echoed(tmp_path):
    repo = _repo(tmp_path)
    pats = cp.patterns({"HK_PRIVATE": "fictional-farm"})
    assert cp.scan_files(repo, pats) == ["a.py:2"]                  # case ignored; the binary file is skipped
    hits = cp.scan_messages(repo, "HEAD", pats)
    assert len(hits) == 1 and hits[0].startswith("commit ") and "farm" not in hits[0]


def test_nothing_given_is_nothing_to_check(monkeypatch, capsys):
    monkeypatch.delenv("HK_PRIVATE", raising=False)
    monkeypatch.delenv("HK_PRIVATE_FILE", raising=False)
    assert cp.main([]) == 0
    assert "nothing to check" in capsys.readouterr().out


def test_a_commit_or_the_index_is_read_as_git_has_it(tmp_path):
    repo = _repo(tmp_path)
    pats = cp.patterns({"HK_PRIVATE": "fictional-farm"})
    (repo / "a.py").write_text("x = 1\n")                        # fixed in the working tree only
    assert cp.scan_files(repo, pats) == []
    assert cp.scan_files(repo, pats, rev="HEAD") == ["a.py:2"]     # what a push sends still has it
    assert cp.scan_files(repo, pats, staged=True) == ["a.py:2"]
    (repo / "c.txt").write_text("a Fictional-Farm note\n")       # a local edit, never staged: not a finding
    assert cp.scan_files(repo, pats, staged=True) == ["a.py:2"]
    subprocess.run(["git", "add", "a.py", "c.txt"], cwd=repo, check=True)
    assert cp.scan_files(repo, pats, staged=True) == ["c.txt:1"]
    assert cp.scan_files(repo, pats, rev="HEAD") == ["a.py:2"]


@pytest.mark.skipif(not (cp.patterns()), reason="no private words given (HK_PRIVATE, HK_PRIVATE_FILE)")
def test_this_repository_is_clean():
    # as committed: a local edit that is never committed (a signing team in the Xcode project) is not published
    assert cp.scan_files(ROOT, cp.patterns(), rev="HEAD") == []
