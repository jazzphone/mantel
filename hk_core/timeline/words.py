"""HOW A TIMELINE ROW READS, without a host (hk_core; tested on its own):

    title(family, kind, label, facts)                                  "Back Door opened"
    search_words(family, kind, label, area_name, title)                the lowercase words a search looks through

A row keeps the title it was written with, so renaming a lock later doesn't rewrite history.
"""
from __future__ import annotations

import re
from collections.abc import Mapping

_ALARM = {
    "armed_away": "armed away", "armed_home": "armed home", "armed_night": "armed night",
    "armed_vacation": "armed vacation", "armed_custom_bypass": "armed (custom bypass)",
    "disarmed": "disarmed", "triggered": "triggered",
}
_SAFETY = {"leak": "Leak", "smoke": "Smoke", "co": "Carbon monoxide", "gas": "Gas"}
_SEEN = {"person": "Person", "vehicle": "Vehicle", "animal": "Animal", "package": "Package"}
_REFUSED = {"unlock": "unlock", "lock": "lock", "open": "open", "close": "close", "arm": "arm",
            "disarm": "disarm", "other": "use"}
_WORD = re.compile(r"[^\W_]+")


def _clean(text: str) -> str:
    return " ".join(text.replace("_", " ").split())


def title(family: str, kind: str, label: str, facts: Mapping | None = None) -> str:
    label = (label or "").strip()
    facts = facts or {}
    if family == "system":
        return label
    if kind == "flapping":
        count = facts.get("count")
        return _clean(f"{label} keeps changing ({count} times)" if count else f"{label} keeps changing")
    if family in ("door", "window", "garage") and kind in ("opened", "closed"):
        return f"{label} {kind}"
    if family == "lock":
        if kind in ("locked", "unlocked", "opened", "closed"):
            return f"{label} {kind}"
        if kind == "jammed":
            return f"{label} is jammed"
    elif family == "alarm" and kind in _ALARM:
        return f"{label or 'Alarm'} {_ALARM[kind]}"
    elif family == "arrival" and kind in ("arrived", "left"):
        return f"{label} {kind} home"
    elif family == "doorbell" and kind == "ring":
        return f"Someone rang {label}"
    elif family == "detection" and kind in _SEEN:
        return f"{_SEEN[kind]} at {label}"
    elif family == "motion" and kind == "motion":
        return f"Motion at {label}"
    elif family == "safety":
        if kind in _SAFETY:
            return f"{_SAFETY[kind]} at {label}"
        if kind == "clear":
            return f"{label} is clear"
    elif family == "refused" and kind in _REFUSED:
        device = str(facts.get("device") or "").strip()
        what = f"to {_REFUSED[kind]} {label}; refused"
        return f"{device} tablet tried {what}" if device else f"Tried {what}"
    return _clean(f"{label} {kind}")


def search_words(family: str, kind: str, label: str, area_name: str | None, title: str) -> str:
    """The lowercase words (letters and digits, deduplicated in order) of the title, the area name and the label.
    An arrival row leaves the person's name out: it searches as "arrived home" or "left home" plus the area."""
    if family == "arrival":
        parts = [f"{kind} home" if kind in ("arrived", "left") else _without(title, label), area_name or ""]
    else:
        parts = [title, area_name or "", label]
    seen: dict[str, None] = {}
    for part in parts:
        for word in _WORD.findall((part or "").lower()):
            seen.setdefault(word)
    out = ""
    for word in seen:
        if len(out) + len(word) + (1 if out else 0) > 300:
            break
        out = f"{out} {word}" if out else word
    return out


def _without(text: str, label: str) -> str:
    gone = set(_WORD.findall((label or "").lower()))
    return " ".join(w for w in _WORD.findall((text or "").lower()) if w not in gone)
