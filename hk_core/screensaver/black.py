"""WHAT A TABLET'S BLACK SCREEN SWITCH MEANS (Black Screen: HK Frontend): on while the screen is
HK Frontend's own black over the page with the backlight at its lowest; `confirmed` once the
page says it went black since it last turned on (the sleep waits for it, and falls back to the
kiosk's black without it); `brightness` the backlight to come back to (0-255), carried by the
house's sleep and wake (set_black_screen). Turned off by the page when a tap wakes it."""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any


@dataclass
class Black:
    on: bool = False
    brightness: int | None = None
    confirmed: bool = False

    def set(self, on: bool) -> None:
        """Turned on or off: a change waits for the page to confirm again."""
        if on != self.on:
            self.confirmed = False
        self.on = on

    def page_says(self, black: bool) -> bool:
        """The page: black now (confirms it), or woken by a tap (off). Whether that changed it."""
        if black:
            if self.on and not self.confirmed:
                self.confirmed = True
                return True
            return False
        if self.on:
            self.set(False)
            return True
        return False

    def restore(self, state: str, attributes: Mapping[str, Any]) -> None:
        """Its last state across a restart. A page that reloads while black says so again, so
        it is not confirmed."""
        self.on = state == "on"
        b = attributes.get("brightness")
        self.brightness = int(b) if isinstance(b, (int, float)) else None
        self.confirmed = False

    def attributes(self, board: Mapping[str, Any]) -> dict[str, Any]:
        """black_screen (the tablet's setting: kiosk or hk -- the house's scripts branch on it),
        brightness, confirmed."""
        return {"black_screen": board.get("black_screen", "kiosk"),
                "brightness": self.brightness, "confirmed": self.on and self.confirmed}
