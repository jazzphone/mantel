"""The guide, as plain functions (no Home Assistant here).

    parse_xmltv(bytes)  -> {channel_number: {"logo", "network", "programmes"}}
    now_next(progs, t)  -> (current, next)

The guide is keyed by CHANNEL NUMBER ("4.1"), matched against the XMLTV
channel's display-names, because that is the one thing an HDHomeRun lineup
and a Zap2it-style XMLTV file always share.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import xml.etree.ElementTree as ET

# XMLTV display-names carry the network's full name; people know the short one.
NETWORKS = {
    "NATIONAL BROADCASTING COMPANY": "NBC",
    "CBS TELEVISION NETWORK": "CBS",
    "AMERICAN BROADCASTING COMPANY": "ABC",
    "FOX ENTERTAINMENT": "FOX",
    "FOX BROADCASTING COMPANY": "FOX",
    "THE CW TELEVISION NETWORK": "CW",
    "PUBLIC BROADCASTING SERVICE": "PBS",
    "MYNETWORKTV": "MyNetworkTV",
    "ION: INDEPENDENT TELEVISION": "ION",
    "TELEMUNDO": "Telemundo",
    "UNIVISION": "Univision",
}


# Zap2It-style guides still name programme art on zap2it.tmsimg.com, which no
# longer resolves; the same paths are served from zpmc.tmsimg.com, where the
# channel logos already live.
IMAGE_HOSTS = {"://zap2it.tmsimg.com/": "://zpmc.tmsimg.com/"}


def fix_image(url: str | None) -> str | None:
    if not url:
        return url
    for dead, live in IMAGE_HOSTS.items():
        url = url.replace(dead, live)
    return url


def network_of(display_names: list[str]) -> str | None:
    for n in display_names:
        if n and n.upper() in NETWORKS:
            return NETWORKS[n.upper()]
    return None


def _time(s: str) -> datetime | None:
    try:
        return datetime.strptime(s, "%Y%m%d%H%M%S %z")
    except (TypeError, ValueError):
        return None


def parse_xmltv(data: bytes, numbers: set[str] | None = None,
                now: datetime | None = None, hours: float = 12) -> dict:
    """Programmes from an hour ago to `hours` ahead, per channel number."""
    now = now or datetime.now(timezone.utc)
    lo, hi = now - timedelta(hours=1), now + timedelta(hours=hours)
    root = ET.fromstring(data)
    by_id: dict[str, str] = {}
    out: dict[str, dict] = {}
    for ch in root.iter("channel"):
        names = [d.text or "" for d in ch.findall("display-name")]
        number = next((n for n in names if n and n.replace(".", "").isdigit() and "." in n), None)
        if not number or (numbers is not None and number not in numbers):
            continue
        icon = ch.find("icon")
        entry = out.setdefault(number, {"logo": None, "network": None, "programmes": [], "ids": []})
        entry["ids"].append(ch.get("id"))
        entry["network"] = entry["network"] or network_of(names)
        if entry["logo"] is None and icon is not None:
            entry["logo"] = fix_image(icon.get("src"))
        by_id[ch.get("id")] = number
    seen: dict[str, set] = {}
    for p in root.iter("programme"):
        number = by_id.get(p.get("channel"))
        if number is None:
            continue
        start, stop = _time(p.get("start")), _time(p.get("stop"))
        if not start or not stop or stop < lo or start > hi:
            continue
        # Two XMLTV channels can carry one number (a repeater): keep one copy.
        key = start.isoformat()
        if key in seen.setdefault(number, set()):
            continue
        seen[number].add(key)
        icon = p.find("icon")
        out[number]["programmes"].append({
            "title": p.findtext("title") or "",
            "subtitle": p.findtext("sub-title") or "",
            "description": (p.findtext("desc") or "")[:400],
            "start": start.isoformat(),
            "end": stop.isoformat(),
            "image": fix_image(icon.get("src")) if icon is not None else None,
        })
    for entry in out.values():
        entry["programmes"].sort(key=lambda x: x["start"])
    return out


def now_next(programmes: list[dict], now: datetime | None = None):
    now = now or datetime.now(timezone.utc)
    cur = nxt = None
    for p in programmes:
        s, e = datetime.fromisoformat(p["start"]), datetime.fromisoformat(p["end"])
        if s <= now < e:
            cur = p
        elif s >= now and (nxt is None):
            nxt = p
            if cur is not None:
                break
    return cur, nxt
