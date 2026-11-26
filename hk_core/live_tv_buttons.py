"""Live TV switches for Apple's Home app (2026-11-25, the owner), the rules with no host in them.

THE ASK: a channel AirPlayed to an Apple HomeView (or any paired AirPlay screen) from a tap in Apple's own Home app, with
no other app, for someone who never opens Mantel. Mantel already plays a channel on a paired screen (phase 35's sender);
this is how the Home app reaches it: Mantel publishes one Home Assistant switch per channel and screen the owner picks
(Mantel Link mirrors them), and Mantel Link puts them in a HomeKit Bridge of their own, "Mantel Live TV". A switch is on
while its channel plays on its screen: turned on, Mantel plays it (the screen's other channels' switches go off, one
show a screen); turned off, the show stops. Every other way a show ends turns it off too (paused on the screen, the
safety net, another channel from Mantel's own page). The owner, 2026-11-25, of buttons and a Stop each: "Having a stop
option will confuse someone", then "If the Switch is on, its playing, when you turn it off, it stops".

THE SETTING (Live TV's settings, ``live_tv.buttons`` and ``live_tv.homekit``): the switches as [{screen, channel}], in
the owner's order, and whether the bridge is wanted. A screen is a paired AirPlay screen's id ("s" + 12 hex); a channel
is the tuner's number ("4.1"). One whose screen or channel is gone stays saved and is not published, so pairing a
screen again or a lineup that comes back brings it back.

WHAT IS PUBLISHED (``plan``): for each kept one, "<channel> on <screen>". Their unique ids are stable (the screen's id
and the channel's number, never a name), so a rename keeps an entity, its id and its place in the Home app. One sensor,
"Mantel Live TV" (``carrier``), says how many there are and carries the bridge's wish for Mantel Link (``homekit``:
want, and the unique ids to include); it is published while there is anything of this to say (a switch, the bridge
wanted, or the bridge still in Home Assistant), so Remove from HomeKit reaches Mantel Link even with none left.

WHO MAY WATCH (``cameras``): the linked actor is given Live TV and live view of exactly the cameras of the channels a
kept switch plays, and only while one is set up; the stream's own key asks again on every fetch.
"""
from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

MAX_BUTTONS = 48
SCREEN = re.compile(r"^s[0-9a-f]{12}$")              # cameras/airplay_out/screens.py's ids
CHANNEL = re.compile(r"^\d{1,4}(\.\d{1,4})?$")
BRIDGE_NAME = "Mantel Live TV"                       # the HomeKit Bridge Mantel Link makes (its homekit_entry.py)
CARRIER_ID = "sensor.mantel_live_tv"
KIND = "live_tv_switch"                              # linked_house's kind for every entity here


class Invalid(ValueError):
    """A refused switch list: ``code`` says why (the settings page words it)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def buttons(v: Any, channels: Any = None, screens: Any = None) -> list[dict[str, str]]:
    """The switch list as saved: [{screen, channel}], each once, in the order given. With ``channels`` / ``screens`` (the
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
    """The switches in ``new`` that were not saved before (the ones a save checks against what is there now)."""
    have = {(b["screen"], b["channel"]) for b in saved}
    return [b for b in new if (b["screen"], b["channel"]) not in have]


def kept(saved: Any, channels: Mapping[str, Any], screens: Mapping[str, Any]) -> list[dict[str, str]]:
    """The saved switches whose screen is paired and whose channel is served now: the ones published."""
    try:
        got = buttons(saved)
    except Invalid:
        return []
    return [b for b in got if b["screen"] in screens and b["channel"] in channels]


def slug(name: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(name or "").lower()).strip("_")


def switch_uid(entry: str, screen: str, channel: str) -> str:
    return f"{entry}_live_tv_{screen}_{channel.replace('.', '_')}"


def carrier_uid(entry: str) -> str:
    return f"{entry}_live_tv_buttons"


def name(channel_name: str, screen_name: str) -> str:
    return f"{channel_name} on {screen_name}"[:255]


def entity_id(channel_name: str, screen_name: str) -> str:
    """The entity id suggested the first time (Home Assistant's registry keeps it after): switch.<screen>_live_tv_<channel>."""
    return f"switch.{slug(screen_name) or 'screen'}_live_tv_{slug(channel_name) or 'channel'}"[:200]


def plan(entry: str, saved: Any, channels: Mapping[str, str], screens: Mapping[str, str]) -> list[dict[str, Any]]:
    """The switches to publish, in order. ``channels``: {number: name} of the channels served now; ``screens``: {id: name}
    of the paired screens. Each: {uid, entity_id, name, screen, channel}."""
    return [{"uid": switch_uid(entry, b["screen"], b["channel"]),
             "entity_id": entity_id(channels[b["channel"]], screens[b["screen"]]),
             "name": name(channels[b["channel"]], screens[b["screen"]]), "screen": b["screen"], "channel": b["channel"]}
            for b in kept(saved, channels, screens)]


def is_on(playing: Mapping[str, Any] | None, channel: str) -> bool:
    """A switch is on while its channel plays on its screen (``playing``: the screen's show, {channel, ...}, or None)."""
    return bool(playing) and playing.get("channel") == channel


def cameras(saved: Any, channel_cameras: Mapping[str, str], screens: Mapping[str, Any]) -> tuple[str, ...]:
    """The cameras the linked actor may watch: those of the channels a kept switch plays (``channel_cameras``: {number:
    its camera}), sorted; none with no switch."""
    got = {channel_cameras[b["channel"]] for b in kept(saved, channel_cameras, screens)}
    return tuple(sorted(c for c in got if isinstance(c, str)))


def carrier(entry: str, published: list[dict[str, Any]], want: bool) -> dict[str, Any]:
    """The sensor that says how many switches there are and carries the bridge's wish to Mantel Link: {uid, entity_id,
    name, state, homekit: {bridge, want, include}}."""
    return {"uid": carrier_uid(entry), "entity_id": CARRIER_ID, "name": BRIDGE_NAME, "state": len(published),
            "homekit": {"bridge": "live_tv", "want": bool(want), "include": [p["uid"] for p in published]}}


def wanted(saved: Any, want: bool, bridge_state: str) -> bool:
    """Publish anything at all: a switch saved, the bridge wanted, or the bridge still in Home Assistant (so Remove from
    HomeKit reaches Mantel Link)."""
    return bool(saved) or bool(want) or bridge_state not in ("none", "", None)
