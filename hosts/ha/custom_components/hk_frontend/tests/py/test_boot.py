"""THE ORDERED BOOT (boot.py): HA is given ONE extra module, and the /hk view serves it as the
core files in order, then the rest imported. HA imports extra modules in parallel and in no fixed
order, so the old list of fifteen raced (docs/phase1/TESTHA.md)."""
from __future__ import annotations

from unittest.mock import patch

from conftest import DOMAIN


async def test_one_ordered_boot_module_is_registered_and_served(hass, base):
    from homeassistant import config_entries
    from custom_components.hk_frontend import boot

    with patch("homeassistant.components.frontend.add_extra_js_url") as add:
        result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
        await hass.config_entries.flow.async_configure(result["flow_id"], {})
        await hass.async_block_till_done()
    assert [c.args[1] for c in add.call_args_list] == [boot.URL]

    view = next(c.args[0] for c in hass.http.register_view.call_args_list
                if getattr(c.args[0], "name", "") == "hk_frontend:file")
    r = await view.get(None, boot.BOOT)
    assert r.status == 200 and r.content_type == "application/javascript"
    assert r.headers["Cache-Control"] == "no-cache"
    text = r.text
    marks = [text.index(f"/* ---- /hk/{p} ---- */") for p in boot.CORE]
    assert marks == sorted(marks), "the core runs in dependency order"
    assert "imported separately" not in text
    assert "global.hkClient = {" in text and "global.hkHAClient = {" in text, "the files' own text, not copies"
    tail = text[text.rindex(";(function () {"):]
    assert all(f'"/hk/{p}"' in tail for p in boot.AFTER)
    # every other /hk file is still served from disk
    other = await view.get(None, "modules/hk-client.js")
    assert other.status == 200
