"""WHAT MAY BE A WALL TABLET THAT ISN'T ONE YET: "This looks like a wall tablet" on Wall
Tablets, until it is added or dismissed -- a kiosk app's device no tablet uses, and the
browsers that said they look like one (a kiosk app's browser that is none of the tablets).

The host keeps the browsers seen (`seen`: {key: record}, records made by `seen_record`) and
hands in the time; a record older than SEEN_KEEP is dropped from it when suggestions are read.
"""
from __future__ import annotations

from collections.abc import Container, Mapping, MutableMapping
from datetime import datetime, timedelta
from typing import Any

from ..house import House
from .kiosk import devices, parts, screen_of_url

SEEN_KEEP = timedelta(days=7)


def seen_record(user: str, screen: str, app: str, tablet: str | None, now: datetime,
                apps: Container[str]) -> dict[str, Any] | None:
    """A browser that looks like a wall tablet (a kiosk app's: one of `apps`) and isn't one of
    the tablets, as the host keeps it under its "key"; None when it is a tablet already, or no
    kiosk app's."""
    if tablet or app not in apps:
        return None
    key = f"seen:{user}:{screen}"
    return {"key": key, "user": user, "screen": screen, "app": app, "at": now}


def suggestions(house: House, tabs: Mapping[str, Mapping[str, Any]], dismissed: set[str],
                screens: set[str], seen: MutableMapping[str, dict[str, Any]], now: datetime
                ) -> list[dict[str, Any]]:
    """A kiosk app's device no tablet uses (with the screen its page shows, and its address),
    and the browsers seen whose user and screen no tablet has -- less those dismissed."""
    used = {t["device"] for t in tabs.values() if t["device"]}
    out: list[dict[str, Any]] = []
    for d in devices(house):
        key = f"device:{d['id']}"
        if d["id"] in used or key in dismissed:
            continue
        p = parts(house, d["app"], d["id"])
        st = house.state(p.get("page", ""))
        ip = house.state(p.get("ip", ""))
        out.append({"key": key, "app": d["app"], "device": d["id"], "name": d["name"],
                    "screen": screen_of_url(st.state if st else None, screens),
                    "ip": ip.state if ip is not None and ip.state not in ("unknown", "unavailable") else ""})
    for key, s in list(seen.items()):
        if now - s["at"] > SEEN_KEEP:
            seen.pop(key)
            continue
        if key in dismissed or any(t["user"] == s["user"] and t["screen"] == s["screen"] for t in tabs.values()):
            continue
        out.append({"key": key, "app": s["app"], "user": s["user"], "screen": s["screen"],
                    "at": s["at"].isoformat()})
    return out
