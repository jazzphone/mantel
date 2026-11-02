"""The alert center (docs/phase14/SYSTEM-ALERTS.md "The alert center").

Sources call :meth:`Center.raise_` and :meth:`Center.clear` with a kind (catalog.py), a key (which tablet, which
connection) and short facts, never a secret. The center:

* **Holds.** A raise waits out its kind's hold (``holds`` under Advanced change a group's). If it clears during the
  hold nothing is sent; a clear is sent only when its raise was.
* **Flapping.** One alert sends at most three times an hour. The fourth time it says "keeps dropping (4 times in an
  hour)" once, then holds until it stays clear for 15 minutes, and says it's back.
* **Causes.** An alert whose kind ``needs`` another (the tablets and Mantel Link need Home Assistant) is held while
  that one is up and for CAUSE_GRACE after it clears, and is dropped if it clears in that time: one cause, one message.
* **A quiet start.** Kinds with ``start_grace`` aren't sent in the first START_GRACE after a start.
* **Batching.** What reaches a channel within BATCH of the first goes as one message ("3 alerts").
* **Quiet hours** (per channel, the house's time): Info and Warning wait and go out as one message when they end,
  leaving out whatever cleared meanwhile; Critical goes through when the channel's ``critical`` switch is on.
* **Delivery.** Each channel has its own outbox and its own task: a failed send is retried after RETRIES, then
  given up (``Channels.failed``); three given up in a row raise ``channel.failing``, which that channel never gets.
* **The log** (store.Log): every raise and clear sent, and the channels that took it.

Everything is decided on the center's clock in :meth:`tick` (the server calls it every TICK seconds), so the tests
run it on a fake clock.
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Awaitable, Callable

from . import catalog
from .catalog import Kind

log = logging.getLogger("mantel.alerts")

TICK = 5.0
BATCH = 20.0
START_GRACE = 180.0
CAUSE_GRACE = 180.0
FLAP_WINDOW = 3600.0
FLAP_MAX = 3
FLAP_QUIET = 900.0
RETRIES = (10.0, 60.0, 300.0)
RETRY_AFTER_MAX = 120.0
FAILING_AFTER = 3
APP = "app"                    # the Mantel apps' outbox (not a channel row: nothing to set up)


class ChannelError(Exception):
    """A send that didn't work. ``message`` is for the page ("Discord said 401: the webhook was deleted"), never a
    secret; ``retry_after`` a server's own wait (429); ``permanent`` a refusal no retry fixes."""

    def __init__(self, message: str, *, retry_after: float | None = None, permanent: bool = False) -> None:
        super().__init__(message)
        self.message = message
        self.retry_after = retry_after
        self.permanent = permanent


@dataclass(frozen=True)
class Item:
    """One raise or clear on its way to a channel."""
    log_id: int
    kind: str
    key: str
    level: str
    up: bool
    title: str
    body: str
    at: float
    page: str = ""

    @property
    def ident(self) -> tuple[str, str]:
        return (self.kind, self.key)


@dataclass(frozen=True)
class Message:
    """What a sender sends: "Mantel · Home Assistant disconnected", a line or two, the level, a link, a tag."""
    title: str
    body: str
    level: str
    link: str | None = None
    tag: str = "system"
    items: tuple[Item, ...] = ()
    house: str = ""

    @property
    def subject(self) -> str:
        """The title without the "Mantel · " prefix (Discord's embed, Telegram's bold line)."""
        return self.title.removeprefix("Mantel · ")


@dataclass
class Instance:
    kind: Kind
    key: str
    facts: dict
    since: float
    up: bool = True
    sent: bool = False
    sent_to: set = field(default_factory=set)
    flapping: bool = False
    flaps: int = 0
    cleared_at: float | None = None


@dataclass
class Outbox:
    items: list = field(default_factory=list)
    batch_until: float = 0.0
    held: list = field(default_factory=list)
    task: asyncio.Task | None = None


def worst(levels) -> str:
    got = [lv for lv in levels if lv in catalog.LEVELS]
    return max(got, key=catalog.LEVELS.index) if got else "info"


def drop_cleared(items: list[Item]) -> list[Item]:
    """A raise and its clear both still waiting (quiet hours, one batch): neither is worth sending."""
    ups = {it.ident for it in items if it.up}
    paired = {it.ident for it in items if not it.up and it.ident in ups}
    return [it for it in items if it.ident not in paired]


def in_quiet(quiet: dict, local: datetime) -> bool:
    """A channel's quiet hours {on, from, to} ("HH:MM", may run past midnight; from == to is all day)."""
    from hk_core.notifications.dnd import hhmm
    if not isinstance(quiet, dict) or not quiet.get("on"):
        return False
    a, b = hhmm(quiet.get("from")) or "22:00", hhmm(quiet.get("to")) or "07:00"
    fa = int(a[:2]) * 60 + int(a[3:])
    fb = int(b[:2]) * 60 + int(b[3:])
    n = local.hour * 60 + local.minute
    return fa == fb or (fa <= n < fb if fa < fb else (n >= fa or n < fb))


def critical_through(quiet: dict) -> bool:
    """Critical Alerts Ignore Quiet Hours: on unless the channel turned it off."""
    return not isinstance(quiet, dict) or quiet.get("critical", True) is not False


Send = Callable[[dict, Message], Awaitable[Any]]


class Center:
    def __init__(self, *, channels, log_store, settings, send: Send, clock: Callable[[], float] = time.time,
                 tz: Callable[[], str] = lambda: "UTC", house: Callable[[], str] = lambda: "",
                 link: Callable[[str], str | None] = lambda page: None, app_sink: Send | None = None) -> None:
        self.channels = channels
        self.log = log_store
        self.settings = settings
        self.send = send
        self.clock = clock
        self.tz = tz
        self.house = house
        self.link = link
        self.app_sink = app_sink
        self.started = clock()
        self.alerts: dict[tuple[str, str], Instance] = {}
        self.history: dict[tuple[str, str], deque] = {}       # when each alert's raises were sent (flapping)
        self.cause_cleared: dict[str, float] = {}
        self.outboxes: dict[str, Outbox] = {}
        self.retries = RETRIES
        self.tasks: set[asyncio.Task] = set()
        self.listeners: list[Callable[[Item], None]] = []     # each raise and clear sent (the MCP's recent list)

    # -- the sources' side -------------------------------------------------------------------------------------
    def raise_(self, kind_id: str, key: str = "", facts: dict | None = None) -> None:
        k = catalog.kind(kind_id)
        if k is None:
            log.warning("alerts: unknown kind %s", kind_id)
            return
        now = self.clock()
        facts = {a: b for a, b in (facts or {}).items() if b is not None}
        if k.once:
            self._emit(k, key, facts, True, now)
            return
        inst = self.alerts.get((k.id, key))
        if inst is None:
            inst = self.alerts[(k.id, key)] = Instance(k, key, facts, now)
        else:
            inst.facts = {**inst.facts, **facts}
            if not inst.up:                         # back up while flapping, before its quiet 15 minutes ended
                inst.up, inst.cleared_at = True, None
                inst.flaps += 1
        self._check(inst, now)

    def clear(self, kind_id: str, key: str = "", facts: dict | None = None) -> None:
        inst = self.alerts.get((kind_id, key))
        if inst is None or not inst.up:
            return
        now = self.clock()
        if kind_id in {n for k in catalog.KINDS.values() for n in k.needs}:
            self.cause_cleared[kind_id] = now
        inst.facts = {**inst.facts, **{a: b for a, b in (facts or {}).items() if b is not None}}
        if not inst.sent:                            # cleared during its hold: nothing was said, nothing is
            del self.alerts[(kind_id, key)]
            return
        if inst.flapping:                            # back, but it has to stay back for FLAP_QUIET
            inst.up, inst.cleared_at = False, now
            return
        del self.alerts[(kind_id, key)]
        if inst.kind.clears:
            self._emit(inst.kind, key, inst.facts, False, now, to=inst.sent_to)

    def forget(self, kind_id: str, key: str = "") -> None:
        """Drop an alert without saying it cleared (an update superseded by a newer one)."""
        self.alerts.pop((kind_id, key), None)

    def is_up(self, kind_id: str, key: str | None = None) -> bool:
        return any(i.up for (k, kk), i in self.alerts.items() if k == kind_id and (key is None or kk == key))

    def active(self) -> list[dict]:
        """What is up now (raised, whether sent yet or still in its hold)."""
        return [{"kind": i.kind.id, "key": i.key, "level": i.kind.level, "group": i.kind.group,
                 "title": i.kind.words(i.facts)[0], "since": i.since, "sent": i.sent, "flapping": i.flapping}
                for i in self.alerts.values() if i.up]

    # -- deciding ----------------------------------------------------------------------------------------------
    def hold_of(self, k: Kind) -> float:
        if k.hold <= 0:
            return 0.0
        holds = self.settings.get("holds", {}) if self.settings is not None else {}
        got = holds.get(k.group) if isinstance(holds, dict) else None
        return float(got) if isinstance(got, (int, float)) and not isinstance(got, bool) and 0 <= got <= 3600 \
            else k.hold

    def blocked(self, k: Kind, now: float) -> bool:
        if k.start_grace and now < self.started + START_GRACE:
            return True
        for cause in k.needs:
            if self.is_up(cause) or now - self.cause_cleared.get(cause, -1e18) < CAUSE_GRACE:
                return True
        return False

    def _check(self, inst: Instance, now: float) -> None:
        if inst.sent or not inst.up:
            return
        if now - inst.since < self.hold_of(inst.kind) or self.blocked(inst.kind, now):
            return
        ident = (inst.kind.id, inst.key)
        sent = self.history.setdefault(ident, deque())
        while sent and now - sent[0] >= FLAP_WINDOW:
            sent.popleft()
        inst.sent = True
        if len(sent) >= FLAP_MAX:
            inst.flapping = True
            title, _ = inst.kind.words(inst.facts)
            times = len(sent) + 1
            inst.sent_to |= self._emit(inst.kind, inst.key, inst.facts, True, now,
                                       words=(f"{title} (keeps dropping)",
                                              f"It dropped {times} times in an hour. Mantel waits until it stays "
                                              "back for 15 minutes before saying more."))
            return
        sent.append(now)
        inst.sent_to |= self._emit(inst.kind, inst.key, inst.facts, True, now)

    def tick_alerts(self, now: float) -> None:
        for ident, inst in list(self.alerts.items()):
            if inst.flapping and not inst.up and inst.cleared_at is not None and now - inst.cleared_at >= FLAP_QUIET:
                del self.alerts[ident]
                self.history.pop(ident, None)
                if inst.kind.clears:
                    title, body = inst.kind.words(inst.facts, up=False)
                    self._emit(inst.kind, inst.key, inst.facts, False, now, to=inst.sent_to,
                               words=(title, (body + " " if body else "") + "It has stayed back for 15 minutes."))
            else:
                self._check(inst, now)

    # -- where it goes -----------------------------------------------------------------------------------------
    def wants(self, ch: dict, k: Kind, key: str) -> bool:
        if not ch.get("enabled") or k.id not in (ch.get("events") or ()):
            return False
        if k.id == "channel.failing" and key == ch["id"]:
            return False                            # never told about itself
        return catalog.level_at_least(k.level, ch.get("min_level") or "info")

    def _emit(self, k: Kind, key: str, facts: dict, up: bool, now: float, *, to: set | None = None,
              words: tuple[str, str] | None = None) -> set:
        """Log one raise or clear and queue it for its channels: a raise for every channel that wants it, a clear
        for the ones its raise went to. Returns the channel ids queued."""
        title, body = words or k.words(facts, up)
        log_id = self.log.add(now, k.id, key, k.level, up, title, body, []) if self.log is not None else 0
        item = Item(log_id, k.id, key, k.level, up, title, body, now, k.page)
        targets: set[str] = set()
        for ch in self.channels.all() if self.channels is not None else ():
            if (ch["id"] in to) if to is not None else self.wants(ch, k, key):
                targets.add(ch["id"])
        if self.app_sink is not None and ((APP in to) if to is not None else k.default):
            targets.add(APP)
        for cid in targets:
            box = self.outboxes.setdefault(cid, Outbox())
            if not box.items:
                box.batch_until = now + BATCH
            box.items.append(item)
        for cb in self.listeners:
            try:
                cb(item)
            except Exception:  # noqa: BLE001
                log.exception("alerts listener failed")
        return targets

    # -- delivering ----------------------------------------------------------------------------------------------
    def local(self, now: float) -> datetime:
        from zoneinfo import ZoneInfo
        try:
            return datetime.fromtimestamp(now, ZoneInfo(self.tz() or "UTC"))
        except Exception:  # noqa: BLE001 -- an unknown zone: UTC
            return datetime.fromtimestamp(now, ZoneInfo("UTC"))

    def render(self, items: list[Item], now: float) -> Message:
        house = self.house() or ""
        when = self.local(items[0].at).strftime("%-I:%M %p").lower()
        foot = " · ".join(x for x in (house, when) if x)
        page = items[0].page if all(it.page == items[0].page for it in items) else "alerts"
        link = self.link(page or "alerts")
        if len(items) == 1:
            it = items[0]
            body = "\n".join(x for x in (it.body, foot) if x)
            return Message(f"Mantel · {it.title}", body, it.level, link, f"system:{it.kind}:{it.key}"[:64],
                           tuple(items), house)
        lines = [f"• {it.title}" for it in items]
        return Message(f"Mantel · {len(items)} alerts", "\n".join(lines + ([foot] if foot else [])),
                       worst(it.level for it in items), link, "system:batch", tuple(items), house)

    def channel_of(self, cid: str) -> dict | None:
        if cid == APP:
            return {"id": APP, "kind": APP, "name": "Mantel apps", "enabled": True, "quiet": {}}
        return self.channels.get(cid) if self.channels is not None else None

    async def tick(self) -> None:
        now = self.clock()
        self.tick_alerts(now)
        for cid, box in list(self.outboxes.items()):
            ch = self.channel_of(cid)
            if ch is None or not ch.get("enabled"):
                del self.outboxes[cid]              # deleted or turned off: what waited for it goes
                continue
            quiet = in_quiet(ch.get("quiet") or {}, self.local(now))
            if box.held and not quiet:
                box.items = box.held + box.items
                box.held = []
                box.batch_until = min(box.batch_until, now) if box.items else now
            if box.task is not None and not box.task.done():
                continue
            if not box.items or now < box.batch_until:
                continue
            batch, box.items = drop_cleared(box.items), []
            if quiet:
                through = critical_through(ch.get("quiet") or {})
                box.held += [it for it in batch if not (through and it.level == "critical")]
                batch = [it for it in batch if through and it.level == "critical"]
            if not batch:
                continue
            box.task = self._spawn(self._deliver(ch, batch, now))

    def _spawn(self, coro) -> asyncio.Task:
        task = asyncio.get_running_loop().create_task(coro)
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return task

    async def _deliver(self, ch: dict, batch: list[Item], now: float) -> None:
        cid = ch["id"]
        if cid == APP:                              # each on its own: "back" replaces "lost" on the phone
            for it in batch:
                try:
                    got = await self.app_sink(ch, self.render([it], now))
                except Exception:  # noqa: BLE001 -- push.failing tells of the push service's refusals
                    log.exception("alerts: the Mantel apps' delivery failed")
                    continue
                if got:
                    self.log.add_sent(it.log_id, APP)
            return
        msg = self.render(batch, now)
        error = "not sent"
        for attempt in range(len(self.retries) + 1):
            try:
                await self.send(ch, msg)
            except ChannelError as exc:
                error = exc.message
                if exc.permanent or attempt == len(self.retries):
                    break
                wait = self.retries[attempt]
                if exc.retry_after is not None:
                    wait = min(max(wait, exc.retry_after), RETRY_AFTER_MAX)
                await asyncio.sleep(wait)
                continue
            except Exception as exc:  # noqa: BLE001 -- a sender's bug never stops the center
                log.exception("alerts: sending to channel %s failed", cid)
                error = f"Mantel couldn't send it ({type(exc).__name__})"
                break
            self.channels.sent(cid)
            for it in batch:
                self.log.add_sent(it.log_id, cid)
            if self.is_up("channel.failing", cid):
                self.clear("channel.failing", cid)
            return
        log.warning("alerts: gave up sending to %s channel %s: %s", ch.get("kind"), cid, error)
        fails = self.channels.failed(cid, error)
        if fails >= FAILING_AFTER:
            self.raise_("channel.failing", cid, {"name": ch.get("name"), "count": fails, "error": error})

    async def run(self, every: float = TICK) -> None:
        while True:
            try:
                await self.tick()
            except Exception:  # noqa: BLE001 -- the next tick tries again
                log.exception("alerts tick failed")
            await asyncio.sleep(every)

    async def close(self) -> None:
        for t in list(self.tasks):
            t.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
