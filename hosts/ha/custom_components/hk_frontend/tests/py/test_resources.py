"""The integration registers the card files as Lovelace resources -- adding
only what is missing, never touching what is there."""
from __future__ import annotations

from types import SimpleNamespace



class FakeResources:
    """The part of lovelace's ResourceStorageCollection this uses."""

    def __init__(self, items):
        self.items = [dict(i) for i in items]
        self.loaded = False

    async def async_get_info(self):
        self.loaded = True
        return {"resources": len(self.items)}

    def async_items(self):
        return self.items

    async def async_create_item(self, data):
        assert self.loaded, "created before the collection was loaded"
        item = {"id": str(len(self.items)), "type": data["res_type"], "url": data["url"]}
        self.items.append(item)
        return item


def install(hass, coll):
    from homeassistant.components.lovelace.const import LOVELACE_DATA
    hass.data[LOVELACE_DATA] = SimpleNamespace(resources=coll)


async def test_a_fresh_house_gets_every_card_and_both_stylesheets(hass):
    from custom_components.hk_frontend import resources as R
    coll = FakeResources([{"id": "a", "type": "module", "url": "/hacsfiles/other/card.js"}])
    install(hass, coll)
    added = await R.async_ensure(hass)
    urls = [i["url"] for i in coll.items]
    assert "/hk/cards/hk-base.js" in added and "/hk/fonts/sf-pro.css" in added
    assert urls[0] == "/hacsfiles/other/card.js", "what was there stays first and untouched"
    assert {i["type"] for i in coll.items if i["url"].endswith(".css")} == {"css"}
    assert len(added) == len(R.wanted())
    # every card family on disk is registered
    import os
    cards = [f for f in os.listdir(R.FRONTEND / "cards") if f.endswith(".js")]
    assert sorted("/hk/cards/" + c for c in cards) == sorted(u for u in added if u.startswith("/hk/cards/"))


async def test_a_house_that_has_them_all_sees_no_change(hass):
    from custom_components.hk_frontend import resources as R
    have = [{"id": str(i), "type": t, "url": u} for i, (t, u) in enumerate(R.wanted())]
    have[3]["url"] += "?v=7"                 # a cache-busted entry still counts
    coll = FakeResources(list(reversed(have)))
    install(hass, coll)
    before = [dict(i) for i in coll.items]
    assert await R.async_ensure(hass) == []
    assert coll.items == before


async def test_yaml_mode_resources_are_left_alone(hass):
    from custom_components.hk_frontend import resources as R
    install(hass, SimpleNamespace())          # YAML mode: no create API
    assert await R.async_ensure(hass) == []


async def test_no_lovelace_at_all_is_not_an_error(hass):
    from custom_components.hk_frontend import resources as R
    assert await R.async_ensure(hass) == []
