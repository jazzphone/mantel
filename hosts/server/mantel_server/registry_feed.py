"""Registry changes reach open pages (Phase 6).

A page reads /api/registry once as it loads (hass.entities / devices / areas / floors). Before this, an area renamed
in Home Assistant stayed as it was on every open screen until someone reloaded it.

- **Which registry a session sees** (`RegistryBodies.get`): the registry cut down by the session's RBAC gate
  (`view.filter_registry`), serialized once, and its digest is the SHA-256 of those bytes. So a Child's digest moves
  only when something it may see moves. The work is memoized by `Registry.digest` (the whole registry's, made once
  per load) and the set of entity ids the gate lets through -- `filter_registry` builds the devices, areas and
  floors from exactly those two -- so a repeat costs one pass of `gate.visible` and no serialization.
- **The snapshot frame** carries it (`registry`). When the registries reload, or what sessions may see changes
  (a grant edit, the minute's policy tick), `RegistryFeed.changed()` waits `Hub.registry_push_delay` (a burst of
  reloads is one check) and sends `{"type": "registry", "digest"}` to each session whose digest moved. The page then
  reads /api/registry again (web/shim/registry-sync.js), and that body is already built.
- **/api/registry** answers from the same bodies (raw, and gzipped once), with the digest as its ETag. A repeat
  (every preview frame of the Home Grid editor) serializes and hashes nothing; a matching If-None-Match is a 304.
"""
from __future__ import annotations

import asyncio
import gzip
import hashlib
import json
import logging
from collections import OrderedDict
from typing import Any

from .view import filter_registry

log = logging.getLogger("mantel.registry_feed")

PUSH_DELAY = 0.5        # seconds: reloads (Home Assistant's, Live TV's channels) within this are one check
KEEP_BODIES = 16        # bodies kept: the people and tablets of a house see a handful of different registries


class _Visible:
    """A gate that is a set of entity ids (filter_registry's hook)."""

    def __init__(self, ids: frozenset[str]) -> None:
        self.ids = ids

    def visible(self, entity_id: str) -> bool:
        return entity_id in self.ids


class RegistryBodies:
    """The filtered registry bodies, by digest, and which digest a (registry, visible set) makes."""

    def __init__(self, keep: int = KEEP_BODIES) -> None:
        self.keep = keep
        self._bodies: OrderedDict[str, dict] = OrderedDict()           # digest -> {"raw", "gzip"}
        self._digests: OrderedDict[tuple, str] = OrderedDict()         # (registry digest, ids) -> digest
        self.serialized = 0                                             # bodies built

    def get(self, registry: Any, gate: Any) -> tuple[str, dict]:
        """(digest, {"raw": bytes, "gzip": bytes | None}) of the registry as this gate may see it."""
        shapes = registry.frontend_shapes()
        ids = None if gate is None else frozenset(eid for eid in shapes["entities"] if gate.visible(eid))
        key = (registry.digest, ids)
        digest = self._digests.get(key)
        got = self._bodies.get(digest) if digest is not None else None
        if got is None:
            body = shapes if ids is None else filter_registry(shapes, _Visible(ids))
            raw = json.dumps(body, separators=(",", ":")).encode()
            self.serialized += 1
            digest = hashlib.sha256(raw).hexdigest()[:32]
            got = self._bodies.get(digest) or {"raw": raw, "gzip": None}
            self._bodies[digest] = got
        self._digests[key] = digest
        self._digests.move_to_end(key)
        self._bodies.move_to_end(digest)
        while len(self._bodies) > self.keep:
            self._bodies.popitem(last=False)
        while len(self._digests) > self.keep * 2:
            self._digests.popitem(last=False)
        return digest, got

    def digest(self, registry: Any, gate: Any) -> str:
        return self.get(registry, gate)[0]

    @staticmethod
    def gzipped(got: dict) -> bytes:
        if got["gzip"] is None:
            got["gzip"] = gzip.compress(got["raw"], compresslevel=6, mtime=0)
        return got["gzip"]


class RegistryFeed:
    """The `registry` frames: one debounced check of every session after a change."""

    def __init__(self, hub: Any) -> None:
        self.hub = hub
        self._timer: asyncio.TimerHandle | None = None

    def digest_for(self, session: Any) -> str:
        """The digest a session's snapshot carries; remembered as what that page holds."""
        d = self.hub.registry_bodies.digest(self.hub.registry, session.view.gate)
        session.registry_digest = d
        return d

    def changed(self) -> None:
        """The registries reloaded, or what sessions may see did: check every session soon."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:                 # no loop (built before the server runs): no session to tell
            return
        if self._timer is not None:
            return
        self._timer = loop.call_later(getattr(self.hub, "registry_push_delay", PUSH_DELAY), self._check)

    def _check(self) -> None:
        self._timer = None
        for s in list(self.hub.sessions):
            held = getattr(s, "registry_digest", None)
            if held is None:                 # no snapshot yet: its snapshot will say
                continue
            try:
                d = self.hub.registry_bodies.digest(self.hub.registry, s.view.gate)
            except Exception:  # noqa: BLE001 -- one session's gate failing never stops the others' frames
                log.exception("registry digest failed for a session")
                continue
            if d != held:
                s.registry_digest = d
                s.spawn(s.send_quiet({"type": "registry", "digest": d}))
