"""YOUR FILES FROM MANTEL SERVER (linked mode, 2026-11-07): the home's SF Pro and glyph file, taken from Mantel.

A linked HK Frontend whose house is Mantel's hides "Your files" (Configure), yet Home Assistant's own HK
dashboards still draw from /hk/ here and still need SF Pro and the SF Symbols glyph data. A home that uploaded
them to Mantel and never put them in Home Assistant's folder had no way left to add them. So the link carries
them (Mantel's linked_files.py):

    Mantel -> here   files {files: [{path, size, sha256}, ...]}     what Mantel has (a notice)
    here -> Mantel   file_chunk {path, offset}  -> {path, offset, size, sha256, data}

On a ``files`` frame this side decides, file by file (only hk_core.your_files.LICENSED):

* MISSING here, or the copy this side wrote earlier and Mantel's has changed since: fetched a piece at a time,
  put together, its digest compared with what Mantel announced, CHECKED BY ITS BYTES (hk_core/your_files.py,
  the same checks Mantel's upload runs), and written into Your files' folder (files.py; made if missing).
  The glyph file is written from the parsed data by this side's own writer (render_glyphs): what /hk/ serves
  as script here is never the bytes that arrived.
* A COPY SOMEONE PUT HERE THEMSELVES (not one this side wrote) is never replaced: Setup check says Mantel has a
  different one. One identical to Mantel's is simply adopted.
* Nothing is ever deleted: a file Mantel no longer has stays here.

What this side wrote is remembered in a Store (each file's digest as Mantel had it and as written here), so a
restart or a reconnect does not fetch again. Mantel never asks Home Assistant to do anything: the frame is a
notice, and this side asks for what it wants.
"""
from __future__ import annotations

import asyncio
import base64
import binascii
import contextlib
import hashlib
import logging
import os
import re
import secrets
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.storage import Store

from . import files
from .const import CONF_FILES_FOLDER, DEFAULT_FILES_FOLDER, DOMAIN
from .hk_core.your_files import FONT_MAX, LICENSED, AssetError, checked
from .mantel_link import LinkError

_LOGGER = logging.getLogger(__name__)

STORE = f"{DOMAIN}.files_from_mantel"
STORE_VERSION = 1
STATE = "files_from_mantel"          # hass.data[DOMAIN][STATE]: path -> "mantel" | "kept" | "failed"
WRITER = "HK Frontend, from Mantel Server"
CHUNK_TIMEOUT = 20.0
_SHA = re.compile(r"^[0-9a-f]{64}$")


def state(hass: HomeAssistant) -> dict[str, str]:
    """Each file's word for Setup check: "mantel" (taken from Mantel), "kept" (a copy put here is kept;
    Mantel has another), "failed" (the last try did not work)."""
    return dict(hass.data.get(DOMAIN, {}).get(STATE) or {})


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _file_sha(p: Path) -> str | None:
    try:
        if p.is_symlink() or not p.is_file():
            return None
        h = hashlib.sha256()
        with p.open("rb") as f:
            for block in iter(lambda: f.read(1 << 20), b""):
                h.update(block)
        return h.hexdigest()
    except OSError:
        return None


def _folder(config_dir: str, option: str | None) -> Path | None:
    """Your files' folder, made if it isn't there yet; None when the option names an unsafe one."""
    folder = files.normalize(config_dir, option) or DEFAULT_FILES_FOLDER
    if files.validate_folder(config_dir, folder):
        return None
    path = Path(config_dir) / folder
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None
    return path.resolve()


def _target(root: Path, rel: str) -> Path | None:
    """<root>/<rel>, its parent made, never a symlink or outside the folder."""
    p = root / rel
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.parent.resolve().relative_to(root)
    except (OSError, ValueError):
        return None
    return None if p.is_symlink() else p


def _write(p: Path, data: bytes) -> None:
    tmp = p.with_name(f".{p.name}.{secrets.token_hex(4)}.tmp")
    try:
        with open(tmp, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, 0o644)
        os.replace(tmp, p)
    finally:
        with contextlib.suppress(OSError):
            tmp.unlink()


def announced(msg: Mapping[str, Any]) -> list[dict[str, Any]]:
    """A ``files`` frame's list, only the well-formed entries for files this side takes."""
    out, seen = [], set()
    raw = msg.get("files")
    for f in raw if isinstance(raw, list) else []:
        if not isinstance(f, Mapping):
            continue
        rel, size, sha = f.get("path"), f.get("size"), f.get("sha256")
        if rel not in LICENSED or rel in seen or not isinstance(sha, str) or not _SHA.match(sha) \
                or isinstance(size, bool) or not isinstance(size, int) or not 0 < size <= FONT_MAX:
            continue
        seen.add(rel)
        out.append({"path": rel, "size": size, "sha256": sha})
    return out


class FilesSync:
    """Follows Mantel's ``files`` frames for one linked entry."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, link: Any) -> None:
        self.hass, self.entry, self.link = hass, entry, link
        self._store: Store = Store(hass, STORE_VERSION, STORE)
        self._written: dict[str, dict[str, str]] | None = None    # path -> {"source", "written"}
        self._wanted: list[dict[str, Any]] = []
        self._task: asyncio.Task | None = None
        self._again = False

    @callback
    def on_files(self, msg: dict[str, Any]) -> None:
        """Mantel's list (a ``files`` frame): looked at in the background, one pass at a time."""
        self._wanted = announced(msg)
        if self._task is not None and not self._task.done():
            self._again = True
            return
        self._task = self.entry.async_create_background_task(self.hass, self._run(),
                                                             "hk_frontend: your files from Mantel Server")

    async def _run(self) -> None:
        self._again = True
        while self._again:
            self._again = False
            try:
                await self._pass(list(self._wanted))
            except Exception:  # noqa: BLE001 -- the next frame tries again
                _LOGGER.exception("hk_frontend: your files from Mantel Server were not taken")

    async def _load(self) -> dict[str, dict[str, str]]:
        if self._written is None:
            got = None
            with contextlib.suppress(Exception):
                got = await self._store.async_load()
            self._written = {str(k): {"source": str(v.get("source")), "written": str(v.get("written"))}
                             for k, v in (got or {}).items()
                             if k in LICENSED and isinstance(v, Mapping)} if isinstance(got, Mapping) else {}
        return self._written

    async def _pass(self, wanted: list[dict[str, Any]]) -> None:
        if not wanted:
            return
        written = await self._load()
        option = self.entry.options.get(CONF_FILES_FOLDER)
        root = await self.hass.async_add_executor_job(_folder, self.hass.config.config_dir, option)
        if root is None:
            _LOGGER.warning("hk_frontend: Your files' folder (%s) is not one HK Frontend may write to; SF Pro and "
                            "the glyphs from Mantel Server were not taken", option or DEFAULT_FILES_FOLDER)
            return
        st = self.hass.data.setdefault(DOMAIN, {}).setdefault(STATE, {})
        took = False
        for item in wanted:
            rel = item["path"]
            target = await self.hass.async_add_executor_job(_target, root, rel)
            if target is None:
                st[rel] = "failed"
                continue
            here = await self.hass.async_add_executor_job(_file_sha, target)
            mine = written.get(rel)
            if here is not None:
                if mine is not None and mine["written"] == here:
                    if mine["source"] == item["sha256"]:
                        st[rel] = "mantel"
                        continue                          # ours, and Mantel's has not changed
                elif here == item["sha256"]:
                    written[rel] = {"source": here, "written": here}       # put here by hand, the same file
                    st[rel] = "mantel"
                    await self._store.async_save(written)
                    continue
                else:
                    st[rel] = "kept"                      # someone's own copy: never replaced
                    continue
            try:
                data = await self._fetch(item)
                out = checked(rel, data, WRITER)
            except (LinkError, AssetError, ValueError) as err:
                st[rel] = "failed"
                _LOGGER.warning("hk_frontend: %s from Mantel Server was not taken: %s", rel,
                                getattr(err, "message", None) or str(err))
                continue
            try:
                await self.hass.async_add_executor_job(_write, target, out)
            except OSError as err:
                st[rel] = "failed"
                _LOGGER.warning("hk_frontend: %s from Mantel Server could not be written (%s)", rel,
                                type(err).__name__)
                continue
            written[rel] = {"source": item["sha256"], "written": _sha(out)}
            st[rel] = "mantel"
            took = True
            await self._store.async_save(written)
            _LOGGER.info("hk_frontend: took %s from Mantel Server (%d bytes)", rel, len(out))
        if took:
            await self._refresh(option)

    async def _fetch(self, item: dict[str, Any]) -> bytes:
        """The whole file, a piece at a time; ValueError when it is not the file Mantel announced."""
        rel, size, sha = item["path"], item["size"], item["sha256"]
        buf = bytearray()
        while len(buf) < size:
            res = await self.link.request("file_chunk", {"path": rel, "offset": len(buf)}, timeout=CHUNK_TIMEOUT)
            if not isinstance(res, Mapping) or res.get("path") != rel or res.get("offset") != len(buf):
                raise ValueError("Mantel Server answered for another piece")
            if res.get("size") != size or res.get("sha256") != sha:
                raise ValueError("Mantel Server's copy changed meanwhile (its next list says so)")
            try:
                piece = base64.b64decode(str(res.get("data") or ""), validate=True)
            except (binascii.Error, ValueError):
                raise ValueError("Mantel Server sent a piece that is not base64") from None
            if not piece or len(buf) + len(piece) > size:
                raise ValueError("Mantel Server's pieces do not add up to the file")
            buf += piece
        data = bytes(buf)
        if _sha(data) != sha:
            raise ValueError("the file put together is not the one Mantel Server announced")
        return data

    async def _refresh(self, option: str | None) -> None:
        """/hk/ serves the new files at once, and the Repairs entries for missing ones go."""
        await self.hass.async_add_executor_job(files.set_folder, self.hass, option)
        st = await self.hass.async_add_executor_job(files.status, self.hass)
        files.raise_issues(self.hass, st, option)


__all__ = ["FilesSync", "STATE", "announced", "state"]
