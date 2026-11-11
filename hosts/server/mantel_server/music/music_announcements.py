"""Display-only announcement markers from HA's read-only service event feed, and the Intercom's.

The source player owns completion; native/MA twins match by physical identity,
never names, durations or application IDs. Event text is neither stored nor sent
on to screens. No commands or audio changes are made here.

The Intercom's messages don't go through HA, so no service event says they started. Mantel plays them itself and knows
exactly when each room starts and finishes: intercom/host.py calls ``mark`` before the first command and ``unmark`` when
the room's call returns. They are kept apart from HA's markers (``intercom_players``, the feed's ``intercom``) because
they don't follow the Ignore Announcements setting (a message is never music), and HA going away doesn't end them.
"""
from __future__ import annotations

import asyncio
import re
from collections.abc import Callable, Iterable
from typing import Any

from hk_core.music import announcements as A

START_TIMEOUT = 20
MAX_SECONDS = 120
END_GRACE = 2
INTERCOM_MAX_SECONDS = 300      # a backstop only: the host always unmarks (Live's limit, then its fallback, can reach 240 s)


class Announcements:
    def __init__(self, house: Any, registry: Any, config: Callable, notify: Callable) -> None:
        self.house, self.registry, self.config, self.notify = house, registry, config, notify
        self.pending: dict[str, dict] = {}
        self.intercom: dict[str, dict] = {}

    def players(self) -> list[str]:
        return sorted({p for row in self.pending.values() for p in row['players']})

    def intercom_players(self) -> list[str]:
        return sorted({p for row in self.intercom.values() for p in row['players']})

    def mark(self, key: str, sources: Iterable[str]) -> None:
        """The Intercom is about to play on ``sources``: the screens leave them as they were, until ``unmark(key)``."""
        cfg = self.config()
        players: set[str] = set()
        for source in sources:
            players.update(A.hidden(cfg, source, self.aliases(source)) or {source})
        self.unmark(key, notify=False)
        loop = asyncio.get_running_loop()
        self.intercom[key] = {'players': players, 'timers': [loop.call_later(INTERCOM_MAX_SECONDS, self.unmark, key)]}
        self.notify()

    def unmark(self, key: str, *, grace: float = 0, notify: bool = True) -> None:
        """That room is done. ``grace``: a moment for the player's own last updates to arrive (one that played); a room
        that never played is shown again at once."""
        row = self.intercom.get(key)
        if row is None:
            return
        if grace > 0:
            for timer in row['timers']:
                timer.cancel()
            row['timers'] = [asyncio.get_running_loop().call_later(grace, self.unmark, key)]
            row['ending'] = True
            return
        del self.intercom[key]
        for timer in row['timers']:
            timer.cancel()
        if notify:
            self.notify()

    def aliases(self, source: str) -> set[str]:
        result = {source}
        src = self.registry.entries.get(source)
        if not src:
            return result
        device = next((d for d in self.registry.device_entries if d['id'] == src.get('device_id')), {})
        macs = {v.replace(':', '').lower() for k, v in device.get('connections', []) if k == 'mac'}
        uid = src.get('unique_id') or ''
        if src.get('platform') == 'apple_tv' and re.fullmatch(r'(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}', uid):
            macs.add(uid.replace(':', '').lower())
        for eid in self.config().players():
            ent = self.registry.entries.get(eid) or {}
            if src.get('device_id') and ent.get('device_id') == src['device_id']:
                result.add(eid)
            elif ent.get('platform') == 'music_assistant' and (ent.get('unique_id') or '').lower() in {'ap' + m for m in macs}:
                result.add(eid)
        return result

    def ending(self, key: str) -> bool:
        """That room has already said it's done, and is only waiting out its grace."""
        return bool((self.intercom.get(key) or {}).get('ending'))

    def service(self, data: dict) -> None:
        domain, service = data.get('domain'), data.get('service', '')
        args = data.get('service_data') or {}
        if not isinstance(args, dict):
            return
        for source in A.released(domain, service, args):
            targets = self.aliases(source)
            for key, row in list(self.pending.items()):
                if row['players'] & targets:
                    self.clear(key)
        cfg = self.config()
        if not cfg.ignore_announcements:
            return
        changed = False
        for source in A.announced(domain, service, args):
            players = A.hidden(cfg, source, self.aliases(source))
            if players is None:
                continue
            self.clear(source, notify=False)
            row = {'players': players, 'started': False, 'timers': [],
                   'before': A.content(self.house.state(source)), 'departed': False}
            self.pending[source] = row
            loop = asyncio.get_running_loop()
            row['timers'] = [loop.call_later(MAX_SECONDS, self.clear, source),
                             loop.call_later(START_TIMEOUT, self.no_start, source, row)]
            changed = True
        if changed:
            self.notify()

    def no_start(self, source: str, row: dict) -> None:
        if self.pending.get(source) is row and not row['started']:
            self.clear(source)

    def state(self, changed: set[str]) -> None:
        for source, row in list(self.pending.items()):
            if source not in changed:
                continue
            new = self.house.state(source)
            if new is not None and new.state in A.LIVE:
                content = A.content(new)
                if row['departed'] and row['before'] and content == row['before']:
                    self.clear(source)
                    continue
                if content != row['before']:
                    row['departed'] = True
                row['started'] = True
                end = row.pop('end', None)
                if end:
                    end.cancel()
            elif row['started']:
                end = row.pop('end', None)
                if end:
                    end.cancel()
                row['end'] = asyncio.get_running_loop().call_later(END_GRACE, self.clear, source)
                row['timers'].append(row['end'])

    def clear(self, source: str, notify: bool = True) -> None:
        row = self.pending.pop(source, None)
        if row:
            for timer in row['timers']:
                timer.cancel()
            if notify:
                self.notify()

    def reset(self) -> None:
        changed = bool(self.pending)
        for source in list(self.pending):
            self.clear(source, notify=False)
        if changed:
            self.notify()
