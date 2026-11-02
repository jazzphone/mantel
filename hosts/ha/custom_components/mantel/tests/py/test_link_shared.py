"""The link client, the talk-back and the Tonight list's reading are ONE copy in two integrations: hk_core/link/
(written once in the Mantel repository, vendored into HK Frontend and Mantel Link). Here: Mantel Link's modules at
the old import paths are that copy (not a copy of it), and wherever HK Frontend sits beside, its vendored copy is
byte for byte the same."""
from __future__ import annotations

import os

import pytest

from conftest import COMPONENT, HK

SHARED = ("mantel_link", "talk", "talk_live", "page_headers")


def test_mantel_link_s_modules_are_hk_cores():
    from custom_components.mantel import mantel_link, page_headers, talk, talk_live
    from custom_components.mantel.hk_core.link import mantel_link as core_link
    from custom_components.mantel.hk_core.link import page_headers as core_headers
    from custom_components.mantel.hk_core.link import talk as core_talk
    from custom_components.mantel.hk_core.link import talk_live as core_live
    assert mantel_link.MantelLink is core_link.MantelLink and mantel_link.probe is core_link.probe
    assert mantel_link.plain_target is core_link.plain_target and mantel_link.ws_url is core_link.ws_url
    assert talk.Clips is core_talk.Clips and talk.read_limited is core_talk.read_limited
    assert talk_live.Pacer is core_live.Pacer and talk_live.async_target is core_live.async_target
    assert page_headers.Resolver is core_headers.Resolver and page_headers.branch_for is core_headers.branch_for


def test_mantel_link_vendors_only_the_shared_code_it_uses():
    core = os.path.join(COMPONENT, "hk_core")
    if not os.path.isdir(core):
        pytest.skip("the Mantel repository's layout: hk_core/ is the repository's own")
    kept = lambda folder: sorted(f for f in os.listdir(folder) if f != "__pycache__")  # noqa: E731
    assert kept(core) == ["__init__.py", "link", "talk"]          # talk: live talk's core (2026-11-02)
    assert kept(os.path.join(core, "talk")) == ["__init__.py", "core.py"]
    assert kept(os.path.join(core, "link")) == sorted([f"{n}.py" for n in SHARED] + ["__init__.py"])


@pytest.mark.skipif(not HK, reason="no HK Frontend beside (the published repository)")
def test_hk_frontend_and_mantel_link_vendor_the_same_shared_code():
    ours, theirs = os.path.join(COMPONENT, "hk_core", "link"), os.path.join(HK, "hk_core", "link")
    if not os.path.isdir(ours):
        ours = os.path.join(COMPONENT, "..", "..", "..", "..", "hk_core", "link")
    for name in [f"{n}.py" for n in SHARED] + ["__init__.py"]:
        with open(os.path.join(ours, name), "rb") as a, open(os.path.join(theirs, name), "rb") as b:
            assert a.read() == b.read(), f"hk_core/link/{name} differs between Mantel Link's and HK Frontend's copy"
