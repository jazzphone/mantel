"""Fixtures for Mantel Link (custom_components/mantel).

Run with tests/py/run, in the Mantel repository (this folder, with hk_core/ made up beside the component's files)
or in the published repository (custom_components/mantel/ with hk_core/ vendored in). Two optional neighbours:
  * HK_FRONTEND_COMPONENT: a built custom_components/hk_frontend (tools/build_ha.py
    stages one): the hand-over tests run against the real HK Frontend, else they
    are not collected (the published repository has no HK Frontend);
  * MANTEL_ROOT: a Mantel checkout: the end-to-end tests run against Mantel's
    real linked endpoint, else they are not collected.
"""
from __future__ import annotations

import os
import sys
import tempfile
import types

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
_UP = os.path.abspath(os.path.join(HERE, "..", ".."))
# the component's own tests/py, or the published repository's tests/py beside custom_components/mantel
COMPONENT = (os.path.join(_UP, "custom_components", "mantel")
             if os.path.isdir(os.path.join(_UP, "custom_components", "mantel")) else _UP)
HK = os.environ.get("HK_FRONTEND_COMPONENT") or None
if HK and not os.path.isfile(os.path.join(HK, "manifest.json")):
    HK = None
_ROOT = tempfile.mkdtemp(prefix="mantel-cc-")
os.makedirs(os.path.join(_ROOT, "custom_components"))
open(os.path.join(_ROOT, "custom_components", "__init__.py"), "w").close()
# the Mantel repository keeps the shared code in its own hk_core/, which the published component vendors inside
# itself (its publish.py: CORE_PARTS); made up here the same way, so `.hk_core.link` imports work in both layouts
_CORE = os.path.join(COMPONENT, "..", "..", "..", "..", "hk_core")
if os.path.isdir(_CORE) and not os.path.isdir(os.path.join(COMPONENT, "hk_core")):
    _made = os.path.join(_ROOT, "custom_components", "mantel")
    os.makedirs(os.path.join(_made, "hk_core"))
    for _name in os.listdir(COMPONENT):
        os.symlink(os.path.join(COMPONENT, _name), os.path.join(_made, _name))
    for _name in ("__init__.py", "link"):
        os.symlink(os.path.join(os.path.abspath(_CORE), _name), os.path.join(_made, "hk_core", _name))
else:
    os.symlink(COMPONENT, os.path.join(_ROOT, "custom_components", "mantel"))
if HK:
    os.symlink(HK, os.path.join(_ROOT, "custom_components", "hk_frontend"))
sys.path.insert(0, _ROOT)

pytest_plugins = ["pytest_homeassistant_custom_component"]

# Home Assistant's camera component imports PyTurboJPEG (only to scale stills),
# which the test venv may not have; Mantel Link's camera platform loads always
try:
    import turbojpeg  # noqa: F401
except ImportError:
    _stub = types.ModuleType("turbojpeg")
    _stub.TurboJPEG = object
    sys.modules["turbojpeg"] = _stub

collect_ignore = []
if not os.environ.get("MANTEL_ROOT"):
    collect_ignore.append("test_e2e_mantel.py")
if not HK:
    collect_ignore.append("test_handover_hk.py")


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    import custom_components
    links = os.path.join(_ROOT, "custom_components")
    if links not in list(custom_components.__path__):
        custom_components.__path__.append(links)
    yield


@pytest.fixture(autouse=True)
async def unload_at_the_end(hass):
    """Every test ends with Mantel Link's entries unloaded (their link stopped)."""
    yield
    from homeassistant.config_entries import ConfigEntryState
    for e in hass.config_entries.async_entries("mantel"):
        if e.state is ConfigEntryState.LOADED:
            await hass.config_entries.async_unload(e.entry_id)
    await hass.async_block_till_done()


@pytest.fixture
async def hk_base(hass):
    """What HK Frontend needs to set up in the harness (as its own tests have it):
    http and frontend marked as set up, and its two calls into them stood in for."""
    from unittest.mock import AsyncMock, MagicMock, patch
    hass.config.components.update({"http", "frontend"})
    hass.http = MagicMock()
    hass.http.async_register_static_paths = AsyncMock()
    with patch("homeassistant.components.frontend.add_extra_js_url"):
        yield hass


@pytest.fixture
async def mantel(socket_enabled):
    from mantel_fake import FakeMantel
    fake = await FakeMantel().start()
    yield fake
    await fake.close()


_SAID = object()


async def linked(hass, fake, *, owners=_SAID, wait=True, entry_id=None, unique_id=None):
    """Mantel Link's entry, set up and linked to the stand-in. `owners`: what
    the entry last heard (default: what the stand-in says, so no reload)."""
    from pytest_homeassistant_custom_component.common import MockConfigEntry
    from mantel_fake import INSTANCE, TOKEN
    if owners is _SAID:
        owners = fake.owners
    data = {"url": fake.url, "token": TOKEN}
    if owners is not None:
        data["owners"] = owners
    e = MockConfigEntry(domain="mantel", data=data, title="Mantel", unique_id=unique_id or INSTANCE,
                        **({"entry_id": entry_id} if entry_id else {}))
    e.add_to_hass(hass)
    assert await hass.config_entries.async_setup(e.entry_id)
    await hass.async_block_till_done()
    if wait:
        from mantel_fake import until
        await until(hass, lambda: e.runtime_data.connected)
    return e
