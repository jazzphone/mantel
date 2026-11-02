"""The checks Music's forms share: its gear's, the preset and playlist forms', and the HK
Settings page's -- one set of rules, whichever way a house edits its music. Each answers
{field: error code} ({} when it passes); the host words the codes (settings.MSG, or HA's
translations)."""
from __future__ import annotations

from collections.abc import Iterable

from ..house import House
from .const import CONF_ITEMS, CONF_MEMBERS, CONF_NAME, CONF_SPEAKERS


def speakers_errors(speakers: list[str]) -> dict[str, str]:
    """Configure's check on the speakers (shared with the settings page)."""
    if not speakers:
        return {CONF_SPEAKERS: "no_speakers"}
    return {}


def preset_errors(name: str, members: list[str], rooms: list[str], pairs: Iterable[str] = ()) -> dict[str, str]:
    """A preset's check (the preset form's, and the settings page's). `pairs`: the stereo pairs among the
    rooms (a Music Assistant group picked as one speaker plays on its own, never with other rooms)."""
    if not name:
        return {CONF_NAME: "no_name"}
    if not members:
        return {CONF_MEMBERS: "no_members"}
    if any(m not in rooms for m in members):
        return {CONF_MEMBERS: "not_a_speaker"}
    if len(members) > 1 and set(members) & set(pairs):
        return {CONF_MEMBERS: "pair_alone"}
    return {}


def playlist_errors(name: str, items: list[str], known: set[str] | None) -> dict[str, str]:
    """A playlist's check. `known`: the library's uris (None: not readable).
    A link the library does not have would not fail when pressed -- Music
    Assistant searches for the text and plays what it finds."""
    if not name:
        return {CONF_NAME: "no_name"}
    if not items:
        return {CONF_ITEMS: "no_items"}
    if known and any(i.startswith("library://") and i not in known for i in items):
        return {CONF_ITEMS: "not_in_library"}
    return {}


def name_of(house: House, entity: str) -> str:
    """A player's name for a choice: its friendly name, else its id."""
    st = house.state(entity)
    return (st.attributes.get("friendly_name") if st else None) or entity
