"""hk_core's sleep tests, run again with Mantel's House underneath (PLAN §0 plan review item 1 (c)).

Every test of `tests/test_hk_core_sleep.py` is collected here a second time, its FakeHouse swapped for
one whose reads go through HA's wire shapes into a real StateStore and Registry and back out through
`mantel_server.house.MantelHouse` (see mantel_house_fakes.py). Same expectations, Mantel's adapter.
"""
import pytest

import test_hk_core_sleep as T
from mantel_house_fakes import mantel_backed
from test_hk_core_sleep import *  # noqa: F401,F403 -- the same tests (and fixtures), collected here again

BACKED = mantel_backed(T.FakeHouse, tz='Etc/GMT+4')


@pytest.fixture(autouse=True)
def _mantel_house(monkeypatch):
    monkeypatch.setattr(T, "FakeHouse", BACKED)
