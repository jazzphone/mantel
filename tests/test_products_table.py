"""The products table (tools/products_table.md) is written once and copied into each product's README and wiki
Home by tools/products_table.py; this keeps every copy the same."""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("products_table", ROOT / "tools/products_table.py")
T = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(T)


def test_every_copy_matches_the_source():
    assert T.problems() == [], "run: python tools/products_table.py"


def test_it_is_in_each_products_readme_and_wiki_home():
    assert {"README.md", "docs/guide/Home.md", "hosts/ha/custom_components/hk_frontend/README.md",
            "hosts/ha/custom_components/hk_frontend/docs/Home.md",
            "hosts/ha/custom_components/mantel/README.md"} <= set(T.PAGES)


def test_the_table_has_the_five_columns_and_only_full_links():
    text = T.table()
    header = text.splitlines()[0]
    for column in ("Mantel App", "Docker or the LXC", "HK Frontend alone", "HK Frontend linked to Mantel",
                   "Mantel Link"):
        assert column in header
    rows = [line for line in text.splitlines() if line.startswith("| **")]
    assert all(line.count(" | ") == 5 for line in rows), "every row has a cell for each column"
    assert "Use this when" in rows[0]


def test_a_stale_or_missing_copy_is_found_and_rewritten(tmp_path):
    (tmp_path / "tools").mkdir()
    (tmp_path / "tools/products_table.md").write_text("| a | b |\n|---|---|\n| [x](https://e.example) | y |\n")
    for rel in T.PAGES:
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / rel).write_text(f"# Page\n\n{T.START}\nold\n{T.END}\n\nafter\n")
    assert len(T.problems(tmp_path)) == len(T.PAGES)
    assert T.write(tmp_path) == list(T.PAGES)
    assert T.problems(tmp_path) == []
    assert (tmp_path / "README.md").read_text().endswith(f"{T.END}\n\nafter\n")
    (tmp_path / "README.md").write_text("# no markers\n")
    assert T.problems(tmp_path)[0].startswith("README.md: expected one products table")


def test_relative_links_are_refused(tmp_path):
    (tmp_path / "tools").mkdir()
    (tmp_path / "tools/products_table.md").write_text("[guide](docs/guide/Home.md)\n")
    with pytest.raises(SystemExit):
        T.table(tmp_path)
