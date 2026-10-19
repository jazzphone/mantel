"""The link client is ONE file in two integrations (mantel_link.py): HK
Frontend's and Mantel Link's copies are the same, byte for byte, wherever both
sit side by side (the Mantel repository)."""
from __future__ import annotations

import os

import pytest

from conftest import COMPONENT

HK_COPY = os.path.join(os.path.dirname(COMPONENT), "hk_frontend", "mantel_link.py")


@pytest.mark.skipif(not os.path.isfile(HK_COPY), reason="no HK Frontend source beside (the published repository)")
def test_hk_frontend_and_mantel_link_share_one_link_client():
    with open(HK_COPY, "rb") as a, open(os.path.join(COMPONENT, "mantel_link.py"), "rb") as b:
        assert a.read() == b.read(), "copy hk_frontend/mantel_link.py to mantel/mantel_link.py (or the other way)"
