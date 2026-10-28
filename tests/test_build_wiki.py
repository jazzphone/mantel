"""Mantel's Wiki (tools/build_wiki.py): built from docs/guide by HK Frontend's Wiki builder (wiki_from)."""
from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("build_wiki", ROOT / "tools/build_wiki.py")
W = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(W)
RAW = "https://raw.githubusercontent.com/jazzphone/mantel/main/"
HK_DOCS = ROOT / "hosts/ha/custom_components/hk_frontend/docs"


def test_the_guide_builds_into_a_clean_wiki():
    assert W.problems(env={}) == []


def test_pages_lose_md_images_go_raw_and_links_out_point_at_github():
    pages = dict(W.pages())
    assert {"Home.md", "_Sidebar.md", "_Footer.md", "Install.md", "Arrange-a-Page.md"} <= set(pages)
    home = pages["Home.md"]
    assert not home.startswith("# ")                                  # the Wiki shows the page name
    assert "](Install)" in home and "](First-Run)" in home and ".md)" not in home
    assert f'src="{RAW}docs/images/home-tablet.webp"' in home
    docker = pages["Install-Docker.md"]
    assert "](https://github.com/jazzphone/mantel/blob/main/docs/OPERATIONS.md#https-four-ways)" in docker
    assert "](https://github.com/jazzphone/mantel/blob/main/SECURITY.md)" in pages["Security-Model.md"]
    for name, text in pages.items():
        assert "](../" not in text and 'src="../' not in text, name


def test_every_image_the_guide_names_is_in_the_repository():
    for _, text in W.pages():
        for rel in text.split(RAW)[1:]:
            path = rel.split(")")[0].split('"')[0]
            assert (ROOT / path).is_file(), path


def test_a_page_missing_from_the_sidebar_or_a_broken_link_stops_the_build(tmp_path):
    for name in ("Home.md", "_Footer.md", "A.md", "B.md"):
        (tmp_path / name).write_text(f"# {name}\n\nsee [A](A.md)\n")
    (tmp_path / "_Sidebar.md").write_text("* [A](A.md)\n")
    found = W.problems(tmp_path, env={})
    assert found == ["docs/guide/_Sidebar.md doesn't list B.md"]
    (tmp_path / "B.md").write_text("# B\n\n[gone](Gone.md)\n")
    try:
        W.pages(tmp_path)
    except SystemExit as e:
        assert "Gone.md" in str(e)
    else:
        raise AssertionError("a link to a missing page must stop the build")


def test_private_words_stop_the_build(tmp_path):
    for name in ("Home.md", "_Footer.md"):
        (tmp_path / name).write_text("# x\n\nthe Zyxwv house at 192.168.1.20\n")
    (tmp_path / "_Sidebar.md").write_text("* [Home](Home.md)\n")
    found = W.problems(tmp_path, env={"HK_PRIVATE": "zyxwv"})
    assert any("private word" in f for f in found) and any("192.168.1.20" in f for f in found)


def test_it_writes_only_into_a_clone_and_replaces_old_pages(tmp_path):
    wiki = tmp_path / "mantel.wiki"
    (wiki / ".git").mkdir(parents=True)
    (wiki / "Old-Page.md").write_text("gone")
    assert W.main([str(wiki)]) == 0
    assert not (wiki / "Old-Page.md").exists()
    assert (wiki / "Home.md").is_file() and (wiki / "_Sidebar.md").is_file()
    r = subprocess.run([sys.executable, str(ROOT / "tools/build_wiki.py"), str(tmp_path / "nowhere")],
                       capture_output=True, text=True)
    assert r.returncode != 0 and "clone" in r.stderr


def test_hk_frontends_wiki_still_builds_with_the_shared_code():
    hk = W.hk_publisher()
    pages = dict(hk.wiki_pages())
    assert {"Home.md", "_Sidebar.md", "_Footer.md"} <= set(pages)
    assert "](https://raw.githubusercontent.com/jazzphone/hk-frontend/main/docs/images/" in "".join(pages.values())
    assert "](Install)" in pages["Home.md"] and "](Install.md)" not in pages["Home.md"]
    assert not any("](images/" in t or 'src="images/' in t for t in pages.values())
    assert len(pages) == len(list(HK_DOCS.glob("*.md")))
