"""The home's own SF Pro and SF Symbols glyph file, for a linked HK Frontend (2026-11-07).

Apple's license makes each home supply its own copies (user_files.py), and a home that moved to Mantel uploads
them to Mantel. Home Assistant's own HK dashboards still draw, from /hk/ on Home Assistant, and need the same
two files there -- yet a linked HK Frontend whose house is Mantel's hides its "Your files" page, so a home that
skipped that step before linking had no way left to add them. Now Mantel offers its copies and HK Frontend
takes them:

    Mantel -> HK Frontend   files {files: [{path, size, sha256}, ...]}
    HK Frontend -> Mantel   file_chunk {id, path, offset}  -> result {path, offset, size, sha256, data}

* Only to and from a client that asked (``features=files`` in its ``X-Mantel-Link`` header).
* ``files`` names only ``hk_core.your_files.LICENSED`` (fonts/SF-Pro.woff2, fonts/SF-Pro.ttf,
  iconset/hk-glyphs.js) that Mantel has, with each one's size and digest. Sent right after hello, and again
  when an Owner or Admin uploads or deletes one (``changed``, debounced). It is a notice: Mantel never asks Home
  Assistant to do anything, and HK Frontend decides whether it wants a file (files_sync.py there).
* ``file_chunk`` answers up to ``CHUNK`` bytes of one announced file from ``offset``, base64, with the whole
  file's size and digest, so the side that puts the pieces together knows it has the file it was told about.
  A path Mantel does not have, or an offset past the end, is refused.
* HK Frontend checks what arrives by its bytes, as Mantel did (hk_core/your_files.py), and writes the glyph
  file itself from the data: the bytes it serves as script are its own, never Mantel's.

The files never leave the home: they go from one of its servers to the other, over the link's own
credential and connection.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
from pathlib import Path
from typing import Any

from hk_core.your_files import LICENSED

log = logging.getLogger("mantel.linked_files")

FEATURE = "files"
CHUNK = 1 << 20                 # raw bytes per piece (~1.4 MB as base64, under HK Frontend's 4 MB frame limit)
DEBOUNCE_S = 0.25


def wants(client: Any) -> bool:
    return client.domain == "hk_frontend" and FEATURE in client.features and not client.ws.closed


class LinkedFiles:
    """Tells every linked HK Frontend that asked which of the home's files Mantel has, and hands them out."""

    def __init__(self, linked: Any, store: Any, debounce: float = DEBOUNCE_S) -> None:
        self.linked, self.store, self.debounce = linked, store, debounce
        self._digests: dict[str, tuple[int, int, str]] = {}    # path -> (mtime_ns, size, sha256)
        self._task: asyncio.Task | None = None
        self.sent = 0                                         # frames sent (the tests read it)

    # -- what Mantel has (blocking: in the executor) ------------------------------------------------------
    def _path(self, rel: str) -> Path | None:
        if rel not in LICENSED:
            return None
        p = self.store.hk / rel
        return p if p.is_file() and not p.is_symlink() else None

    def _digest(self, rel: str, p: Path) -> tuple[int, str]:
        st = p.stat()
        hit = self._digests.get(rel)
        if hit is not None and hit[:2] == (st.st_mtime_ns, st.st_size):
            return hit[1], hit[2]
        h = hashlib.sha256()
        with p.open("rb") as f:
            for block in iter(lambda: f.read(1 << 20), b""):
                h.update(block)
        self._digests[rel] = (st.st_mtime_ns, st.st_size, h.hexdigest())
        return st.st_size, h.hexdigest()

    def listing(self) -> list[dict[str, Any]]:
        out = []
        for rel in LICENSED:
            p = self._path(rel)
            if p is None:
                continue
            try:
                size, sha = self._digest(rel, p)
            except OSError:
                continue
            out.append({"path": rel, "size": size, "sha256": sha})
        return out

    def _piece(self, rel: str, offset: int) -> dict[str, Any]:
        from .linked import LinkedError
        p = self._path(rel)
        if p is None:
            raise LinkedError("not_found", f"Mantel has no {rel}")
        size, sha = self._digest(rel, p)
        if offset > size:
            raise LinkedError("invalid", "offset: past the end of the file")
        with p.open("rb") as f:
            f.seek(offset)
            data = f.read(CHUNK)
        return {"path": rel, "offset": offset, "size": size, "sha256": sha,
                "data": base64.b64encode(data).decode("ascii")}

    # -- the link --------------------------------------------------------------------------------------
    async def chunk(self, client: Any, msg: dict[str, Any]) -> dict[str, Any]:
        """One ``file_chunk``. Raises LinkedError to refuse."""
        from .linked import LinkedError
        if not wants(client):
            raise LinkedError("not_set_up", "only a linked HK Frontend that asked for the files gets them")
        rel, offset = msg.get("path"), msg.get("offset")
        if not isinstance(rel, str) or rel not in LICENSED:
            raise LinkedError("invalid", "path: one of " + ", ".join(LICENSED))
        if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
            raise LinkedError("invalid", "offset: a whole number of bytes")
        return await asyncio.get_running_loop().run_in_executor(None, self._piece, rel, offset)

    def clients(self) -> list[Any]:
        return [c for c in list(self.linked.registry.clients) if wants(c)]

    async def frame(self) -> dict[str, Any]:
        files = await asyncio.get_running_loop().run_in_executor(None, self.listing)
        return {"type": "files", "files": files}

    async def on_connect(self, client: Any) -> None:
        if wants(client):
            await self._send([client], await self.frame())

    def changed(self, kind: str | None = None) -> None:
        """A font or the glyph file was uploaded or deleted: tell the HK Frontends soon, once for a burst."""
        if kind not in (None, "font", "glyphs") or not self.clients():
            return
        if self._task is not None and not self._task.done():
            return
        try:
            self._task = asyncio.get_running_loop().create_task(self._later())
        except RuntimeError:                # no loop: nothing linked to tell
            self._task = None

    async def _later(self) -> None:
        await asyncio.sleep(self.debounce)
        clients = self.clients()
        if clients:
            await self._send(clients, await self.frame())

    async def _send(self, clients: list[Any], frame: dict[str, Any]) -> None:
        text = json.dumps(frame)
        for client in clients:
            if await client.send_text(text):
                self.sent += 1
            else:
                log.info("linked files: a client went away before it was told")


def register(app: Any) -> LinkedFiles:
    """After linked.register and user_files.register."""
    lf = LinkedFiles(app["linked"], app["user_files"])
    app["linked"].on_connect.append(lf.on_connect)
    app["linked"].file_chunk = lf.chunk
    app["user_files"].watchers.append(lf.changed)
    app["linked_files"] = lf
    return lf
