"""Display-only announcement markers from HA's read-only service event feed.

The source player owns completion; native/MA twins match by physical identity,
never names, durations or application IDs. Event text is neither stored nor sent
on to screens. No commands or audio changes are made here.
"""
from __future__ import annotations

import asyncio
import re
from collections.abc import Callable
from typing import Any

from hk_core.music import announcements as A

START_TIMEOUT = 20
MAX_SECONDS = 120
END_GRACE = 2


class Announcements:
    def __init__(self, house: Any, registry: Any, config: Callable, notify: Callable) -> None:
        self.house, self.registry, self.config, self.notify = house, registry, config, notify
        self.pending: dict[str, dict] = {}

    def players(self) -> list[str]:
        return sorted({p for row in self.pending.values() for p in row['players']})

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
