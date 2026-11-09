"""The Timer slide's options (phase 21, docs/phase21/TIMER-SLIDE.md; web/hk/modules/hk-saver-timers.js): on unless turned off,
since it only comes while a timer runs; every other turn, or a turn like the rest. A timer's last minute holds it up either way."""
from __future__ import annotations

from typing import Any

DEFAULTS: dict[str, Any] = {"timer_slide": True, "timer_often": "more"}
CHOICES = {"timer_often": ("more", "same")}
