"""The page kinds a host's HK Settings offers (hk_core; every host).

HOST_PAGES are pages only some hosts serve (hkShell.hostPage): Mantel's House Timeline. Home Assistant's HK Settings
never offers them (it has no such page); Mantel's offers them beside the kinds its catalog was imported with, a list
taken from HK Frontend before a kind existed (the owner, 2026-11-04: a screen whose Pages were its own had no way to
add the Timeline).
"""
from __future__ import annotations

from collections.abc import Iterable

from .model import PAGE_ORDER, SCENE_PAGES

HOST_PAGES = ("timeline",)


def page_kinds_with(have: Iterable[str] | None, host_pages: Iterable[str] = HOST_PAGES) -> list[str]:
    """An imported list of page kinds, with the kinds the model knows and it lacks added in the model's own order (a
    host's own pages only if it serves them)."""
    out = [k for k in (have or ()) if isinstance(k, str)]
    served = tuple(host_pages)
    known = [k for k in PAGE_ORDER if k not in HOST_PAGES or k in served]
    for i, k in enumerate(known):
        if k in out:
            continue
        before = next((out.index(n) for n in known[i + 1:] if n in out), len(out))
        out.insert(before, k)
    return out


def ha_kinds() -> tuple[list[str], list[str]]:
    """(page kinds, scene pages) for Home Assistant's HK Settings: never a host's own page."""
    return [k for k in PAGE_ORDER if k not in HOST_PAGES], [k for k in SCENE_PAGES if k not in HOST_PAGES]
