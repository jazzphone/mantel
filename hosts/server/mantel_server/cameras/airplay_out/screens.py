"""THE PAIRED AIRPLAY SCREENS (phase 35): which screens Mantel may send Live TV to, their pairing keys, the screens on
the network, and pairing one (its code on its screen, typed in HK Settings).

* **Kept** sealed as one of Mantel's connections (connections.SealedFiles, kind ``airplay-screens``:
  ``<data_dir>/connections/airplay-screens.connection``, the at-rest key, every encrypted backup). A screen's key is
  only ever used here: never in an answer, a log line or an audit row.
* **Found** by the announcer, which runs on the host's network where mDNS reaches (network/announce.py writes
  ``airplay.json`` beside ``announce.json``: the ``_airplay._tcp`` receivers that play video). Read here, never trusted
  for more than a name and an address: pairing proves the screen.
* **Paired** in two steps a few minutes apart at most (``PAIR_TTL``): ``begin`` makes the screen show its code and keeps
  the attempt in memory, ``finish`` takes the code. Pairing the same screen again replaces its key.
"""
from __future__ import annotations

import json
import re
import secrets
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from . import hap
from .session import Pairing

KIND = "airplay-screens"
FOUND_FILE = "airplay.json"
PAIR_TTL = 300.0
MAX_SCREENS = 32
MAX_PENDING = 4
HOST = re.compile(r"^(?:\d{1,3}(?:\.\d{1,3}){3}|[A-Za-z0-9][A-Za-z0-9.-]{0,252})$")
NAME_MAX = 64


@dataclass
class ScreensFile:
    """What the sealed file holds (connections.SealedFiles' ``record``)."""
    kind: str = KIND
    screens: list = field(default_factory=list)


def clean_name(name: Any, fallback: str = "AirPlay Screen") -> str:
    text = re.sub(r"[\x00-\x1f\x7f]", "", str(name or "")).strip()
    return text[:NAME_MAX] or fallback


def valid_host(host: Any) -> bool:
    return isinstance(host, str) and bool(HOST.match(host)) and ".." not in host


class Screens:
    """``app["airplay_screens"]``. ``files``: a connections.SealedFiles (or anything with load/save); ``data_dir``:
    where the announcer writes what it found."""

    def __init__(self, files: Any, data_dir: Path | None, clock: Callable[[], float] = time.time,
                 begin: Callable[..., Any] = Pairing.begin) -> None:
        self.files, self.data_dir, self.clock, self._begin = files, data_dir, clock, begin
        self._pending: dict[str, tuple[float, dict, Pairing]] = {}

    # -- kept ----------------------------------------------------------------------------------------------
    def _all(self) -> list[dict]:
        got = self.files.load(KIND) if self.files is not None else None
        return list(getattr(got, "screens", None) or [])

    def _save(self, screens: list[dict]) -> None:
        self.files.save(ScreensFile(KIND, screens))

    def listed(self) -> list[dict]:
        """The paired screens as a page may see them: never a key."""
        return [{k: s.get(k) for k in ("id", "name", "host", "port", "model", "paired_at", "by")} for s in self._all()]

    def get(self, sid: str) -> dict | None:
        return next((s for s in self._all() if s.get("id") == sid), None)

    def credentials(self, sid: str) -> hap.Credentials | None:
        s = self.get(sid)
        return hap.Credentials.loads(s["creds"]) if s and s.get("creds") else None

    def remove(self, sid: str) -> dict | None:
        screens = self._all()
        gone = next((s for s in screens if s.get("id") == sid), None)
        if gone is not None:
            self._save([s for s in screens if s.get("id") != sid])
        return gone

    def rename(self, sid: str, name: str) -> dict | None:
        screens = self._all()
        for s in screens:
            if s.get("id") == sid:
                s["name"] = clean_name(name)
                self._save(screens)
                return s
        return None

    # -- found ---------------------------------------------------------------------------------------------
    def found(self) -> list[dict]:
        """What the announcer last saw (name, host, port, model, psi), the paired ones marked."""
        path = self.data_dir / FOUND_FILE if self.data_dir is not None else None
        try:
            raw = json.loads(path.read_text()) if path is not None and path.exists() else {}
        except (OSError, ValueError):
            raw = {}
        paired = {(s.get("psi") or s.get("host")) for s in self._all()}
        out = []
        for r in (raw.get("screens") or [])[:64] if isinstance(raw, dict) else []:
            if not isinstance(r, dict) or not valid_host(r.get("host")):
                continue
            port = r.get("port") if isinstance(r.get("port"), int) and 0 < r["port"] < 65536 else 7000
            psi = str(r.get("psi") or "")[:64]
            out.append({"name": clean_name(r.get("name")), "host": r["host"], "port": port,
                        "model": str(r.get("model") or "")[:40], "psi": psi,
                        "paired": (psi or r["host"]) in paired})
        return out

    # -- pairing -------------------------------------------------------------------------------------------
    async def begin(self, host: str, port: int = 7000, name: str = "", model: str = "", psi: str = "") -> str:
        """The screen shows its code; the attempt's id comes back, for ``finish``."""
        if not valid_host(host) or not (isinstance(port, int) and 0 < port < 65536):
            raise ValueError("not a screen's address")
        self._expire()
        while len(self._pending) >= MAX_PENDING:
            self._drop(next(iter(self._pending)))
        pairing = await self._begin(host, port)
        pid = secrets.token_urlsafe(12)
        self._pending[pid] = (self.clock() + PAIR_TTL, {"host": host, "port": port, "name": clean_name(name),
                                                        "model": str(model or "")[:40], "psi": str(psi or "")[:64]},
                              pairing)
        return pid

    async def finish(self, pid: str, code: str, by: str | None = None) -> dict:
        """The code the screen shows: the screen is kept (replacing an earlier pairing of it). A wrong code raises
        hap.PairingError(code=2), and the attempt is over (pair again: a new code)."""
        self._expire()
        got = self._pending.pop(pid, None) if isinstance(pid, str) else None
        if got is None:
            raise LookupError("that pairing is over: start again")
        if not (isinstance(code, str) and re.fullmatch(r"\d{4,8}", code.strip())):
            got[2].close()
            raise ValueError("the code is the digits on the screen")
        _, info, pairing = got
        creds = await pairing.finish(code.strip())
        if len(self._all()) >= MAX_SCREENS:
            raise ValueError("too many AirPlay screens")
        psi = info["psi"] or creds.atv_id.decode("utf-8", "replace")
        screens = [s for s in self._all() if (s.get("psi") or s.get("host")) != (psi or info["host"])]
        screen = {"id": "s" + secrets.token_hex(6), **info, "psi": psi, "creds": creds.dumps(),
                  "paired_at": self.clock(), "by": by}
        self._save(screens + [screen])
        return {k: v for k, v in screen.items() if k != "creds"}

    def cancel(self, pid: str) -> None:
        self._drop(pid)

    def _drop(self, pid: str) -> None:
        got = self._pending.pop(pid, None)
        if got is not None:
            got[2].close()

    def _expire(self) -> None:
        now = self.clock()
        for pid in [p for p, (until, _, _) in self._pending.items() if until <= now]:
            self._drop(pid)
