"""Live TV in Apple's Home app as a TV (2026-11-26, the owner), the rules with no host in them.

THE ASK: a channel AirPlayed to an Apple HomeView (or any paired AirPlay screen) from a tap in Apple's own Home app, with
no other app, for someone who never opens Mantel. Mantel already plays a channel on a paired screen (phase 35's sender);
this is how the Home app reaches it. Mantel publishes one Home Assistant TV (a ``media_player``, device class ``tv``)
for each paired screen with a channel the owner checked, its inputs those channels; Mantel Link mirrors it and gives
each its own HomeKit entry (accessory mode: the Home app shows a TV only so), "Mantel Live TV <screen>". The TV is on
while its screen plays Live TV: turned on, it plays the channel chosen for it (``power_on``: the last one watched there,
or one channel); an input picked plays that channel; turned off, the show stops. Every other way a show ends turns it off
too (paused on the screen, the safety net). The Remote in an iPhone's Control Center works it as well: up and down
change the channel, play/pause turns it on or off.

Before it (2026-11-25): a button per channel and a Stop, then a switch per channel. The owner, 2026-11-26: "TV would look
better though from a UI perspective than a bunch of switches.. Last Channel Watched or Default Channel selection would
solve the time cost as well...it would also have the TV glyph in HomeKit".

THE SETTING (Live TV's settings): ``live_tv.buttons``, the checked channels as [{screen, channel}] in the owner's order
(a TV's inputs, in that order; the name is the first build's); ``live_tv.power_on``, {screen: "last" or a channel};
``live_tv.homekit``, whether the TVs are wanted in the Home app. A screen is a paired AirPlay screen's id ("s" + 12 hex);
a channel is the tuner's number ("4.1"). One whose screen or channel is gone stays saved and is not published, so
pairing a screen again or a lineup that comes back brings it back.

WHAT IS PUBLISHED (``plan``): a TV a screen, "<screen> Live TV". Its unique id is stable (the screen's id, never a name),
so a rename keeps the entity, its id and its place in the Home app. One sensor, "Mantel Live TV" (``carrier``), says how
many there are and carries HomeKit's wish for Mantel Link (``homekit``: want, and the TVs' unique ids); it is published
while there is anything of this to say (a channel, HomeKit wanted, or a TV still in HomeKit), so Remove from Home App
reaches Mantel Link even with none left.

WHO MAY WATCH (``cameras``): the linked actor is given Live TV and live view of exactly the cameras of the channels a
kept TV plays, and only while one is set up; the stream's own key asks again on every fetch.
"""
from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

MAX_BUTTONS = 48
MAX_SOURCES = 40                                     # inputs a TV shows (HomeKit's own limit is a little more)
LAST = "last"                                        # live_tv.power_on: the last channel watched on the screen
SCREEN = re.compile(r"^s[0-9a-f]{12}$")              # cameras/airplay_out/screens.py's ids
CHANNEL = re.compile(r"^\d{1,4}(\.\d{1,4})?$")
BRIDGE_NAME = "Mantel Live TV"                       # the sensor's name, and each TV's HomeKit entry's first words
CARRIER_ID = "sensor.mantel_live_tv"
KIND = "live_tv_tv"                                  # linked_house's kind for every entity here
HOMEKIT_KIND = "live_tv_tv"                          # the sensor's homekit.bridge: a TV a screen, in accessory mode


class Invalid(ValueError):
    """A refused setting: ``code`` says why (the settings page words it)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def buttons(v: Any, channels: Any = None, screens: Any = None) -> list[dict[str, str]]:
    """The checked channels as saved: [{screen, channel}], each once, in the order given. With ``channels`` / ``screens`` (the
    numbers and ids there are now), a new one must name one of them; one already saved may stay (``kept`` decides what
    is published)."""
    if not isinstance(v, list) or len(v) > MAX_BUTTONS:
        raise Invalid("list")
    out, seen = [], set()
    for b in v:
        if not isinstance(b, Mapping) or set(b) != {"screen", "channel"}:
            raise Invalid("list")
        sid, num = b["screen"], b["channel"]
        if not isinstance(sid, str) or not SCREEN.match(sid):
            raise Invalid("screen")
        if not isinstance(num, str) or not CHANNEL.match(num):
            raise Invalid("channel")
        if screens is not None and sid not in screens:
            raise Invalid("screen")
        if channels is not None and num not in channels:
            raise Invalid("channel")
        if (sid, num) not in seen:
            seen.add((sid, num))
            out.append({"screen": sid, "channel": num})
    return out


def added(saved: list[dict[str, str]], new: list[dict[str, str]]) -> list[dict[str, str]]:
    """The channels in ``new`` that were not saved before (the ones a save checks against what is there now)."""
    have = {(b["screen"], b["channel"]) for b in saved}
    return [b for b in new if (b["screen"], b["channel"]) not in have]


def kept(saved: Any, channels: Mapping[str, Any], screens: Mapping[str, Any]) -> list[dict[str, str]]:
    """The saved channels whose screen is paired and whose channel is served now: the ones published."""
    try:
        got = buttons(saved)
    except Invalid:
        return []
    return [b for b in got if b["screen"] in screens and b["channel"] in channels]


def slug(name: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(name or "").lower()).strip("_")


def tv_uid(entry: str, screen: str) -> str:
    return f"{entry}_live_tv_tv_{screen}"


def carrier_uid(entry: str) -> str:
    return f"{entry}_live_tv_buttons"


def name(screen_name: str) -> str:
    return f"{screen_name} Live TV"[:255]


def entity_id(screen_name: str) -> str:
    """The entity id suggested the first time (Home Assistant's registry keeps it after): media_player.<screen>_live_tv."""
    return f"media_player.{slug(screen_name) or 'screen'}_live_tv"[:200]


def sources(numbers: list[str], channels: Mapping[str, str]) -> list[str]:
    """The TV's inputs, one a channel in the owner's order: the channel's name, its number after it where two share a
    name (HomeKit picks an input by its name)."""
    names = [str(channels[n]) for n in numbers]
    return [f"{nm} ({n})" if names.count(nm) > 1 else nm for nm, n in zip(names, numbers)][:MAX_SOURCES]


def plan(entry: str, saved: Any, channels: Mapping[str, str], screens: Mapping[str, str]) -> list[dict[str, Any]]:
    """The TVs to publish, one a paired screen with a kept channel, in the order of their first channel. ``channels``:
    {number: name} of the channels served now; ``screens``: {id: name} of the paired screens. Each: {uid, entity_id,
    name, screen, channels: [number, ...], sources: [input name, ...]} (``sources[i]`` is ``channels[i]``'s)."""
    by: dict[str, list[str]] = {}
    for b in kept(saved, channels, screens):
        by.setdefault(b["screen"], []).append(b["channel"])
    out = []
    for sid, nums in by.items():
        nums = nums[:MAX_SOURCES]
        out.append({"uid": tv_uid(entry, sid), "entity_id": entity_id(screens[sid]), "name": name(screens[sid]),
                    "screen": sid, "channels": nums, "sources": sources(nums, channels)})
    return out


def power_on(v: Any) -> dict[str, str]:
    """``live_tv.power_on`` as saved: {screen id: "last" or a channel number}, what turning a screen's TV on plays (none
    said: the last one watched there)."""
    if not isinstance(v, Mapping) or len(v) > MAX_BUTTONS:
        raise Invalid("power_on")
    out = {}
    for sid, how in v.items():
        if not isinstance(sid, str) or not SCREEN.match(sid) or not isinstance(how, str) or not (
                how == LAST or CHANNEL.match(how)):
            raise Invalid("power_on")
        out[sid] = how
    return out


def turn_on_channel(tv: Mapping[str, Any], how: Any, last: Any) -> str | None:
    """The channel turning ``tv`` on plays: its chosen channel while it is one of the TV's, else the last one watched on
    its screen while it is, else its first."""
    nums = list(tv.get("channels") or [])
    if not nums:
        return None
    if isinstance(how, str) and how != LAST and how in nums:
        return how
    return last if isinstance(last, str) and last in nums else nums[0]


def stepped(tv: Mapping[str, Any], current: Any, step: int) -> str | None:
    """The channel ``step`` (1 or -1) from ``current`` among the TV's, round the end (channel up and down on the
    Remote); from none, the first (up) or the last (down)."""
    nums = list(tv.get("channels") or [])
    if not nums:
        return None
    if current not in nums:
        return nums[0] if step > 0 else nums[-1]
    return nums[(nums.index(current) + step) % len(nums)]


def channel_of(tv: Mapping[str, Any], source: Any) -> str | None:
    """The channel an input name is (``select_source``), or None."""
    srcs = list(tv.get("sources") or [])
    return tv["channels"][srcs.index(source)] if source in srcs else None


def tv_state(tv: Mapping[str, Any], playing: Mapping[str, Any] | None) -> tuple[str, str | None]:
    """The TV's state and input: ``playing`` while its screen plays Live TV (whatever started it), else ``off``; the
    input is the channel's while it is one of the TV's."""
    if playing is None:
        return "off", None
    num = playing.get("channel")
    nums = list(tv.get("channels") or [])
    return "playing", (tv["sources"][nums.index(num)] if num in nums else None)


def cameras(saved: Any, channel_cameras: Mapping[str, str], screens: Mapping[str, Any]) -> tuple[str, ...]:
    """The cameras the linked actor may watch: those of the channels a kept TV plays (``channel_cameras``: {number:
    its camera}), sorted; none with no TV."""
    got = {channel_cameras[b["channel"]] for b in kept(saved, channel_cameras, screens)}
    return tuple(sorted(c for c in got if isinstance(c, str)))


def carrier(entry: str, published: list[dict[str, Any]], want: bool) -> dict[str, Any]:
    """The sensor that says how many TVs there are and carries HomeKit's wish to Mantel Link: {uid, entity_id, name,
    state, homekit: {bridge, want, include}}. ``bridge`` is ``live_tv_tv``, not 0.1.16-0.1.17's ``live_tv`` (the
    switches' bridge), so a Mantel Link of then reads none of it and leaves its bridge alone."""
    return {"uid": carrier_uid(entry), "entity_id": CARRIER_ID, "name": BRIDGE_NAME, "state": len(published),
            "homekit": {"bridge": HOMEKIT_KIND, "want": bool(want), "include": [p["uid"] for p in published]}}


def wanted(saved: Any, want: bool, bridge_state: str) -> bool:
    """Publish anything at all: a channel saved, HomeKit wanted, or a TV still in Home Assistant's HomeKit (so Remove
    from Home App reaches Mantel Link)."""
    return bool(saved) or bool(want) or bridge_state not in ("none", "", None)
