"""A dry run: every check a change makes, and nothing written (docs/phase12/MCP-SERVER.md "Changing things safely").

An assistant plans before it changes anything (mcp/plans.py). A planned save runs exactly as a real one: the same
handler, the same checks (hk_core's, RBAC's, ``expect_version``), up to the one place every settings change ends,
``SettingsStore.write`` / ``remove``. There, inside :func:`planning`, the store works out the new versions and their
diffs, writes nothing, and raises :class:`Planned` with them, so nothing after it runs either (no publish, no feed).
``audit.config`` writes no row inside a plan: there is no change for it to be the record of.

A change that would touch the database any other way is not one an assistant may plan (mcp/tools/: an allowlist,
and a test that a plan leaves the database byte-for-byte as it was).
"""
from __future__ import annotations

import contextlib
import contextvars
from dataclasses import dataclass, field
from typing import Any, Iterator

_PLANNING: contextvars.ContextVar[bool] = contextvars.ContextVar("mantel_planning", default=False)


@dataclass
class Planned(Exception):
    """What a planned change would have written: one entry per document, in order."""
    docs: list[dict] = field(default_factory=list)   # {scope, key, version (now), next, diff, removed}

    def __str__(self) -> str:
        return f"planned: {len(self.docs)} document(s)"


def active() -> bool:
    return _PLANNING.get()


@contextlib.contextmanager
def planning() -> Iterator[None]:
    token = _PLANNING.set(True)
    try:
        yield
    finally:
        _PLANNING.reset(token)


def raise_planned(docs: list[dict[str, Any]]) -> None:
    raise Planned(docs)
