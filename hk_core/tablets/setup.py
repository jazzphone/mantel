"""SETUP CHECK'S LINE FOR THE WALL TABLETS: each tablet's user, screen and kiosk app's device,
and its kiosk app's own settings (kiosk.checks). Answers (ok, title, detail) lines; the host
draws them (inside Home Assistant, setup_check.Line)."""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ..house import House
from .kiosk import PARTS, checks, parts

TITLE = "Wall Tablets"


def check_lines(house: House, tabs: Mapping[str, Mapping[str, Any]], boards: Mapping[str, Mapping[str, Any]],
                users: set[str]) -> list[tuple[bool, str, str]]:
    """`tabs`: every tablet; `boards`: every screen's settings, by path; `users`: the house's
    user names."""
    lines: list[tuple[bool, str, str]] = []
    savers = [p for p, b in boards.items() if b.get("screensaver") and b.get("screensaver_engine") != "wallpanel"]
    if not tabs:
        if savers:
            lines.append((False, TITLE, "Photo Screensaver is on, but no wall tablet runs "
                          "those screens, so the screensaver never shows. Add the tablet: Wall Tablets → Add Tablet."))
        return lines
    probs: list[str] = []
    for t in tabs.values():
        if t["user"] and t["user"] not in users:
            probs.append(f"{t['name']}: no Home Assistant user “{t['user']}”")
        if not t["screen"] or t["screen"] not in boards:
            probs.append(f"{t['name']}: no screen")
        if t["app"] in PARTS and not t["device"]:
            probs.append(f"{t['name']}: its kiosk app’s device isn’t chosen")
        for c in checks(house, t, parts(house, t["app"], t["device"])):
            if not c["ok"]:
                probs.append(f"{t['name']}: {c['title'].lower()} — {c['detail']}")
    n = len(tabs)
    if probs:
        lines.append((False, TITLE, "; ".join(probs) + ". See each tablet’s page in Wall Tablets."))
    else:
        lines.append((True, TITLE, f"{n} tablet{'s' if n != 1 else ''}, each set up right."))
    return lines
