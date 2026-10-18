"""Sleep Screen's rules, re-exported: WHEN a wall tablet sleeps and wakes.

They are shared (hk_core/sleep/rules.py: the settings' shape, what counts as
"on", the schedule and decide()); this module keeps the name every caller and
test imports.
"""
from __future__ import annotations

from .hk_core.sleep.rules import *  # noqa: F401,F403 -- shared
from .hk_core.sleep.rules import _entity, _hhmm  # noqa: F401 -- shared
