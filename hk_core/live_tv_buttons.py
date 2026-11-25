"""Live TV buttons for Apple's Home app (2026-11-25, the owner), the rules with no host in them.

THE ASK: a channel AirPlayed to an Apple HomeView (or any paired AirPlay screen) from a tap in Apple's own Home app, with
no other app, for someone who never opens Mantel. Mantel already plays a channel on a paired screen (phase 35's sender);
this is how the Home app reaches it: Mantel publishes one Home Assistant button per channel and screen the owner picks
(Mantel Link mirrors them), plus a Stop button for each of those screens, and Mantel Link puts the channels' buttons (not
the Stops, which stay in Home Assistant for automations) in a HomeKit Bridge of their own, "Mantel Live TV". The Home app shows each as a switch that turns itself off again; a tap
presses the button, the press comes back over the link, and Mantel plays the channel on the screen as the linked
Service actor (audited).

THE SETTING (Live TV's settings, ``live_tv.buttons`` and ``live_tv.homekit``): the buttons as [{screen, channel}], in the
owner's order, and whether the bridge is wanted. A screen is a paired AirPlay screen's id ("s" + 12 hex); a channel is
the tuner's number ("4.1"). A button whose screen or channel is gone stays saved and is not published, so pairing a
screen again or a lineup that comes back brings it back.

WHAT IS PUBLISHED (``plan``): for each kept button, "<channel> on <screen>"; for each screen with one, "Stop Live TV on
<screen>". Their unique ids are stable (the screen's id and the channel's number, never a name), so a rename keeps an
entity, its id and its place in the Home app. One sensor, "Mantel Live TV" (``carrier``), says how many buttons there
are and carries the bridge's wish for Mantel Link (``homekit``: want, and the unique ids to include); it is published
while there is anything of this to say (a button, the bridge wanted, or the bridge still in Home Assistant), so Remove
from HomeKit reaches Mantel Link even with no button left.

WHO MAY WATCH (``cameras``): the linked actor is given Live TV and live view of exactly the cameras of the channels a
kept button plays, and only while one is set up; the stream's own key asks again on every fetch.
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
STOP = "stop"
KIND = "live_tv_button"                              # linked_house's kind for every entity here


class Invalid(ValueError):
    """A refused button list: ``code`` says why (the settings page words it)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def buttons(v: Any, channels: Any = None, screens: Any = None) -> list[dict[str, str]]:
    """The button list as saved: [{screen, channel}], each once, in the order given. With ``channels`` / ``screens`` (the
    numbers and ids there are now), a new button must name one of them; one already saved may stay (``kept`` decides
    what is published)."""
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
    """The buttons in ``new`` that were not saved before (the ones a save checks against what is there now)."""
    have = {(b["screen"], b["channel"]) for b in saved}
    return [b for b in new if (b["screen"], b["channel"]) not in have]


def kept(saved: Any, channels: Mapping[str, Any], screens: Mapping[str, Any]) -> list[dict[str, str]]:
    """The saved buttons whose screen is paired and whose channel is served now: the ones published."""
    try:
        got = buttons(saved)
    except Invalid:
        return []
    return [b for b in got if b["screen"] in screens and b["channel"] in channels]


def slug(name: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(name or "").lower()).strip("_")


def button_uid(entry: str, screen: str, channel: str) -> str:
    return f"{entry}_live_tv_{screen}_{channel.replace('.', '_')}"


def stop_uid(entry: str, screen: str) -> str:
    return f"{entry}_live_tv_{screen}_{STOP}"


def carrier_uid(entry: str) -> str:
    return f"{entry}_live_tv_buttons"


def name(channel_name: str, screen_name: str) -> str:
    return f"{channel_name} on {screen_name}"[:255]


def stop_name(screen_name: str) -> str:
    return f"Stop Live TV on {screen_name}"[:255]


def entity_id(channel_name: str | None, screen_name: str) -> str:
    """The entity id suggested the first time (Home Assistant's registry keeps it after): button.<screen>_live_tv_<channel>,
    or ..._live_tv_stop."""
    tail = (slug(channel_name) or "channel") if channel_name is not None else STOP
    return f"button.{slug(screen_name) or 'screen'}_live_tv_{tail}"[:200]


def plan(entry: str, saved: Any, channels: Mapping[str, str], screens: Mapping[str, str]) -> list[dict[str, Any]]:
    """The buttons to publish, in order: each kept one, then a Stop for each screen with one. ``channels``: {number: name}
    of the channels served now; ``screens``: {id: name} of the paired screens. Each: {uid, entity_id, name, screen,
    channel} (channel None for a Stop)."""
    out, stops = [], []
    for b in kept(saved, channels, screens):
        sid, num = b["screen"], b["channel"]
        out.append({"uid": button_uid(entry, sid, num), "entity_id": entity_id(channels[num], screens[sid]),
                    "name": name(channels[num], screens[sid]), "screen": sid, "channel": num})
        if sid not in stops:
            stops.append(sid)
    for sid in stops:
        out.append({"uid": stop_uid(entry, sid), "entity_id": entity_id(None, screens[sid]),
                    "name": stop_name(screens[sid]), "screen": sid, "channel": None})
    return out


def cameras(saved: Any, channel_cameras: Mapping[str, str], screens: Mapping[str, Any]) -> tuple[str, ...]:
    """The cameras the linked actor may watch: those of the channels a kept button plays (``channel_cameras``: {number:
    its camera}), sorted; none with no button."""
    got = {channel_cameras[b["channel"]] for b in kept(saved, channel_cameras, screens)}
    return tuple(sorted(c for c in got if isinstance(c, str)))


def carrier(entry: str, published: list[dict[str, Any]], want: bool) -> dict[str, Any]:
    """The sensor that says how many buttons there are and carries the bridge's wish to Mantel Link: {uid, entity_id,
    name, state, homekit: {bridge, want, include}}. The bridge holds the channels' buttons only: a Stop stays in Home
    Assistant, for automations and scripts (the owner, 2026-11-25: "Having a stop option will confuse someone"; a show
    ends by itself when paused on the screen, or after its safety net)."""
    return {"uid": carrier_uid(entry), "entity_id": CARRIER_ID, "name": BRIDGE_NAME,
            "state": sum(1 for p in published if p["channel"] is not None),
            "homekit": {"bridge": "live_tv", "want": bool(want),
                        "include": [p["uid"] for p in published if p["channel"] is not None]}}


def wanted(saved: Any, want: bool, bridge_state: str) -> bool:
    """Publish anything at all: a button saved, the bridge wanted, or the bridge still in Home Assistant (so Remove from
    HomeKit reaches Mantel Link)."""
    return bool(saved) or bool(want) or bridge_state not in ("none", "", None)
