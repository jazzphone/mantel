"""Fixtures for HK Frontend.

Run with tests/py/run (it builds the venv on first use). Music, Live TV,
Clean Areas and Alarm PIN are features of this integration (features/), each
an item of the house's entry; their tests are test_feature_*.py.
"""
from __future__ import annotations

import os
import sys
import tempfile
import types

import pytest

from homeassistant.core import HomeAssistant

# `custom_components.hk_frontend`, and ONLY what these tests need: a throwaway
# `custom_components` package holding links, first on the path, so the loader
# finds this integration without also scanning whatever else sits beside it
# in custom_components/.
HERE = os.path.dirname(os.path.abspath(__file__))
_UP = os.path.abspath(os.path.join(HERE, "..", ".."))
# the component's own tests/py, or the repository's tests/py beside
# custom_components/hk_frontend; docs/ is two up either way
COMPONENT = (os.path.join(_UP, "custom_components", "hk_frontend")
             if os.path.isdir(os.path.join(_UP, "custom_components", "hk_frontend")) else _UP)
DOCS = os.path.join(_UP, "docs")
_ROOT = tempfile.mkdtemp(prefix="hk-cc-")
os.makedirs(os.path.join(_ROOT, "custom_components"))
open(os.path.join(_ROOT, "custom_components", "__init__.py"), "w").close()
os.symlink(COMPONENT, os.path.join(_ROOT, "custom_components", "hk_frontend"))
sys.path.insert(0, _ROOT)

pytest_plugins = ["pytest_homeassistant_custom_component"]

# Home Assistant's camera component imports PyTurboJPEG (only to scale
# stills), which the test venv does not have. The house's entry sets up the
# camera platform for Live TV's channels whether or not Live TV is added, so
# a stand-in lets it load in every test. No test asks for a scaled image.
try:
    import turbojpeg  # noqa: F401
except ImportError:
    _stub = types.ModuleType("turbojpeg")
    _stub.TurboJPEG = object
    sys.modules["turbojpeg"] = _stub

DOMAIN = "hk_frontend"


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    # The harness imports ITS OWN `custom_components` (testing_config) before
    # this runs; extend that package's path so it can see this component too.
    import custom_components
    links = os.path.join(_ROOT, "custom_components")
    if links not in list(custom_components.__path__):
        custom_components.__path__.append(links)
    yield


@pytest.fixture
async def base(hass: HomeAssistant):
    """The two dependencies this component's FIRST half needs (serving /hk/
    and registering the bootstrap modules). The harness has no hass_frontend
    build, so http and frontend are marked as already set up, and the two
    calls into them are stood in for."""
    from unittest.mock import MagicMock, patch

    hass.config.components.update({"http", "frontend"})
    hass.http = MagicMock()
    with patch("homeassistant.components.frontend.add_extra_js_url"):
        yield hass


@pytest.fixture
async def frontend(hass: HomeAssistant, base):
    """The integration, added the way a user adds it: empty."""
    from homeassistant import config_entries

    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] == "create_entry"
    await hass.async_block_till_done()
    return entry(hass)


def entry(hass):
    """The house's entry -- the only one."""
    return next(e for e in hass.config_entries.async_entries(DOMAIN) if not e.data.get("kind"))


async def add_feature(hass, kind: str, user_input: dict | None = None, *more_steps: dict):
    """Add a feature the way a user does: Add feature (an item of the house's
    entry) -> the feature's menu item -> its form(s). Returns the flow's last
    result."""
    from homeassistant import config_entries
    flows = hass.config_entries.subentries
    r = await flows.async_init((entry(hass).entry_id, "feature"), context={"source": config_entries.SOURCE_USER})
    assert r["type"] == "menu" and r["step_id"] == "user", r
    r = await flows.async_configure(r["flow_id"], {"next_step_id": kind})
    for step in (user_input, *more_steps):
        if r["type"] != "form":
            break
        r = await flows.async_configure(r["flow_id"], step or {})
    await hass.async_block_till_done()
    return r


async def feature_gear(hass, feat, *steps: dict):
    """A feature's gear (its item's reconfigure), then each of `steps`.
    Returns the last result."""
    from homeassistant import config_entries
    flows = hass.config_entries.subentries
    r = await flows.async_init((entry(hass).entry_id, "feature"), context={
        "source": config_entries.SOURCE_RECONFIGURE, "subentry_id": feat.entry_id})
    for step in steps:
        if r["type"] != "form":
            break
        r = await flows.async_configure(r["flow_id"], step)
    await hass.async_block_till_done()
    return r


def feature_entries(hass, kind: str):
    """The added features of one kind (features/ Feature: the running one
    when it runs)."""
    from custom_components.hk_frontend import features as F
    return F.entries(hass, kind)


def update_feature(hass, feat, **changes):
    """Write a feature's data/options the way its settings page does."""
    from custom_components.hk_frontend import features as F
    return F.async_update(hass, feat, **changes)


def feature_item(kind: str, data: dict | None = None, options: dict | None = None, *,
                 title: str | None = None, key: str = "", subentry_id: str | None = None) -> dict:
    """A feature item as Add feature stores it, in a MockConfigEntry's
    subentries_data shape."""
    from custom_components.hk_frontend import features as F
    item = {"subentry_type": F.SUBENTRY_FEATURE, "data": F.item_data(kind, data, options),
            "title": title or F.TITLES[kind], "unique_id": F.unique_id(kind, key)}
    if subentry_id:
        item["subentry_id"] = subentry_id
    return item


async def put_feature(hass, kind: str, data: dict | None = None, options: dict | None = None, **kw):
    """A feature item written straight into the house's entry, as a
    restore would, with no flow. A loaded house starts it (its update
    listener). Returns the feature."""
    from types import MappingProxyType

    from homeassistant.config_entries import ConfigSubentry

    from custom_components.hk_frontend import features as F
    item = feature_item(kind, data, options, **kw)
    sub = ConfigSubentry(subentry_type=item["subentry_type"], data=MappingProxyType(item["data"]),
                         title=item["title"], unique_id=item["unique_id"],
                         **({"subentry_id": item["subentry_id"]} if "subentry_id" in item else {}))
    hass.config_entries.async_add_subentry(entry(hass), sub)
    await hass.async_block_till_done()
    return F.item(hass, sub.subentry_id)


def house_entry(*items: dict, **kw):
    """The house's entry as storage holds it, not yet set up (a
    MockConfigEntry to add before the integration starts), with `items`."""
    from pytest_homeassistant_custom_component.common import MockConfigEntry
    kw = {"title": "HK Frontend", "unique_id": DOMAIN, "version": 1, "minor_version": 13,
          "data": {}, "options": {}, **kw}
    return MockConfigEntry(domain=DOMAIN, subentries_data=list(items), **kw)


def pre_release_entry(kind: str, data: dict | None = None, options: dict | None = None, **kw):
    """A feature as a pre-release of 1.0 kept it: an entry of its own
    (features.async_fold folds it into the house's at start)."""
    from pytest_homeassistant_custom_component.common import MockConfigEntry

    from custom_components.hk_frontend import features as F
    kw.setdefault("title", F.TITLES[kind])
    return MockConfigEntry(domain=DOMAIN, data={"kind": kind, **(data or {})}, options=options or {}, **kw)


class FakeConnection:
    """The websocket handler's side of a connection: who is signed in, the
    subscriptions it holds, and every message sent to it."""

    def __init__(self, user):
        self.user, self.subscriptions, self.sent = user, {}, []

    def send_message(self, msg):
        self.sent.append(msg)

    def send_result(self, msg_id, result=None):
        self.sent.append({"id": msg_id, "type": "result", "success": True})


def device_place(dev) -> tuple[str | None, str | None]:
    """Where a device belongs: (config entry id, config subentry id). Home
    Assistant 2026.10 gives a device ONE entry (config_entry_id /
    config_subentry_id) and deprecates the sets before them
    (config_entries / config_entries_subentries) -- reading those raises in
    its test harness -- so this reads whichever the version has."""
    if hasattr(dev, "config_subentry_id"):
        return dev.config_entry_id, dev.config_subentry_id
    entries = sorted(dev.config_entries)
    eid = entries[0] if len(entries) == 1 else None
    subs = sorted(x for x in (dev.config_entries_subentries.get(eid) or ()) if x) if eid else []
    return eid, subs[0] if len(subs) == 1 else None
