"""Docs hygiene: every relative link in README.md and docs/**/*.md must resolve (tools/check_links.py)."""
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("check_links", ROOT / "tools/check_links.py")
check_links = importlib.util.module_from_spec(_spec)
sys.modules["check_links"] = check_links  # dataclasses looks its module up
_spec.loader.exec_module(check_links)


def test_the_repository_docs_have_no_broken_relative_links():
    problems = check_links.check(ROOT)
    assert not problems, "broken links:\n" + "\n".join(str(p) for p in problems)


def test_the_expected_documents_are_covered():
    names = {p.relative_to(ROOT).as_posix() for p in check_links.doc_files(ROOT)}
    assert {"README.md", "docs/OPERATIONS.md", "docs/phase3/HA-APP.md", "docs/guide/Install.md"} <= names


# -- the checker itself, on a tiny tree ---------------------------------------------------------------
def _tree(tmp_path, files: dict[str, str]) -> Path:
    for name, text in files.items():
        p = tmp_path / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
    return tmp_path


def test_good_links_pass(tmp_path):
    root = _tree(tmp_path, {
        "README.md": "# R\n[plan](docs/PLAN.md) [part](docs/PLAN.md#second-part) [web](https://example.com/x) [m](mailto:a@b.c)\n"
                     "[code](tools/x.py) [dir](tools/) ![img](docs/pic.png)\n\n[ref]: docs/a/B.md\n",
        "docs/PLAN.md": "# Plan\n\n## Second part\n\nsee [up](../README.md#r) and [self](#second-part)\n",
        "docs/a/B.md": "# B\n",
        "docs/pic.png": "x",
        "tools/x.py": "",
    })
    assert check_links.check(root) == []


def test_broken_file_folder_and_anchor_are_reported(tmp_path):
    root = _tree(tmp_path, {
        "README.md": "[a](docs/missing.md)\n[b](docs/PLAN.md#nope)\n[c](nowhere/)\n[d](#absent)\n",
        "docs/PLAN.md": "# Plan\n",
    })
    got = {(p.line, p.target) for p in check_links.check(root)}
    assert got == {(1, "docs/missing.md"), (2, "docs/PLAN.md#nope"), (3, "nowhere/"), (4, "#absent")}


def test_links_resolve_from_the_linking_file_not_the_root(tmp_path):
    root = _tree(tmp_path, {
        "README.md": "# R\n",
        "docs/phase9/X.md": "[ok](../PLAN.md) [bad](docs/PLAN.md)\n",
        "docs/PLAN.md": "# P\n",
    })
    problems = check_links.check(root)
    assert [(p.file.as_posix(), p.target) for p in problems] == [("docs/phase9/X.md", "docs/PLAN.md")]


def test_code_is_not_treated_as_links(tmp_path):
    root = _tree(tmp_path, {
        "README.md": "```\n[x](nowhere.md)\n```\nand `[y](also-nowhere.md)` inline\n",
    })
    assert check_links.check(root) == []


def test_a_link_out_of_the_repository_is_reported(tmp_path):
    root = _tree(tmp_path / "repo", {"README.md": "[x](../outside.md)\n"})
    (tmp_path / "outside.md").write_text("# x\n")
    assert [p.reason for p in check_links.check(root)] == ["points outside the repository"]


def test_github_style_anchors():
    s = check_links.slug
    assert s("Phase 3: tablet PINs, the audit API") == "phase-3-tablet-pins-the-audit-api"
    assert s("`mantel-server` flags") == "mantel-server-flags"
    assert s("What is it? (a [link](x.md))") == "what-is-it-a-link"
