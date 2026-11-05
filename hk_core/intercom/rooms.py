"""WHICH ROOMS A BROADCAST PLAYS IN, and why the others are left out (docs/phase17/INTERCOM.md "Rooms").

``decide`` is pure: it reads the house (states, the clock), the music configuration (rooms, floors, pairs), the
Intercom's settings and Music Assistant's own player list, and returns a ``Plan``: every room picked, with its state
(``ok``: it plays, live in Live when ``live``; ``after``: in Live it gets the Message when the talker finishes;
``skipped``: left out, with ``why`` and words for the sheet), and the CALLS: the Music Assistant players to announce
to, each with its volume. The host only acts on it.

The checks, in order, for each room picked:

1. enabled (in the Intercom's rooms and on), else dropped silently (it was never offered);
2. allowed for the sender (``allowed(room)``: the host's RBAC), else dropped silently;
3. available (not ``unavailable``/``unknown``), else ``skipped: unavailable``;
4. quiet hours (the room's own, else the house default), else ``skipped: quiet`` unless ``override`` (Send Anyway);
5. Live only: the sender's own room (``here``), ``skipped: here`` (echo); a Message keeps it;
6. THE GROUP CHECK, below;
7. Live only: ``live`` when idle now, its Live flag is on and Live health hasn't demoted it; else ``after``.

THE GROUP CHECK (2026-11-02: a bedtime announcement to a sync group's leader played in every room). Music Assistant
(2.10.9) plays an announcement sent to an ad-hoc sync group's LEADER on its whole group, and one sent to a GROUP PLAYER
(a sync group or universal group, type "group") on every one of its members -- and a member that leads an ad-hoc group
of its own then covers that whole session too. So for each player a broadcast would call, its REACH is worked out:
itself, every player it leads (Home Assistant's ``group_members`` leader first, on its own state or on any other's;
Music Assistant's ``group_members`` in any order and every player ``synced_to`` it), a group player's members, and,
again, whatever those lead. Every player in the reach must belong to a room of THIS broadcast: a room's own players, or
a group player room's parts that are no other room's. A player that belongs to no room, or also to a room left out
(not picked, quiet, here, unavailable), skips the room (``skipped: leads <names>``). A player covered by another call's
reach gets no call of its own (it would hear it twice). A MEMBER of a group is sent to alone: Music Assistant
announces to it alone, natively, or ungroups it and groups it back. If Music Assistant's player list can't be read, or
doesn't list a room's player, nothing is guessed: the room is skipped (``unavailable``). A stereo pair (one room that
is a Music Assistant group of two players) is announced to through its group player. A virtual pair is announced to on
both of its players.
"""
from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from ..house import House
from ..music import engine as E
from ..music.config import MusicConfig
from ..notifications.dnd import dnd_on
from . import config as C

OK, AFTER, SKIPPED = "ok", "after", "skipped"
WHY_UNAVAILABLE, WHY_QUIET, WHY_HERE, WHY_LEADS = "unavailable", "quiet", "here", "leads"
IDLE_NOT = ("playing", "paused")
MAX_ROOMS = 64


@dataclass
class Call:
    """One ``players/cmd/play_announcement``: a media_player entity (its Music Assistant id is the host's to look up),
    its volume (None: Music Assistant's own), the room it is for, and whether it can be live."""
    player: str
    room: str
    volume: int | None
    live: bool = False
    covers: list[str] = field(default_factory=list)     # other players its group plays the broadcast on


@dataclass
class Plan:
    rooms: list[dict[str, Any]] = field(default_factory=list)
    calls: list[Call] = field(default_factory=list)

    @property
    def playing(self) -> list[dict[str, Any]]:
        return [r for r in self.rooms if r["state"] != SKIPPED]

    @property
    def skipped(self) -> list[dict[str, Any]]:
        return [r for r in self.rooms if r["state"] == SKIPPED]

    def names(self, state: str) -> list[str]:
        return [r["name"] for r in self.rooms if r["state"] == state]

    def nothing_reason(self) -> str:
        """The sheet's words when no room is left."""
        if not self.rooms:
            return "Nothing to send to: pick a room."
        return "Nothing to send to: " + "; ".join(r["reason"] for r in self.skipped)


def ma_view(raw: Any) -> dict[str, dict[str, Any]] | None:
    """Music Assistant's ``players/all`` -> {player id: {"members": [ids, itself first], "synced_to": id|None,
    "group": bool}}; None when there is no list (unreadable: the check then skips every room)."""
    if not isinstance(raw, (list, tuple)):
        return None
    out: dict[str, dict[str, Any]] = {}
    for p in raw:
        if not isinstance(p, Mapping) or not isinstance(p.get("player_id"), str):
            continue
        members = [m for key in ("group_members", "group_childs", "static_group_members")
                   if isinstance(p.get(key), (list, tuple)) for m in p[key] if isinstance(m, str)]
        out[p["player_id"]] = {
            "members": list(dict.fromkeys(members)),
            "synced_to": p.get("synced_to") if isinstance(p.get("synced_to"), str) else None,
            "group": p.get("type") == "group",
        }
    return out


def _quiet_now(house: House, doc: Mapping[str, Any], room: str, now: datetime | None) -> bool:
    return dnd_on(house, C.quiet_of(doc, room), now)


def reach(house: House, ma: Mapping[str, dict[str, Any]], pids: Mapping[str, str], player: str) -> set[str]:
    """Every player (Music Assistant ids; a Home Assistant entity with no id stays an entity) an announcement to
    ``player`` can play on, from both sources, the wider winning: itself, what it leads, a group player's members, and
    whatever they lead in turn. A player that only FOLLOWS a leader, or is listed by a group player, adds nothing:
    Music Assistant announces to it alone (``_live_members``: "A synced member announced individually is just
    itself"). Music Assistant's ``group_members`` puts the player itself first, but any order counts here."""
    # Home Assistant's groups, by their leader. Not a group player's: its list is its parts, which it doesn't lead, and
    # its first part leads nothing (2026-11-05: the house's sync group "HomePods" made its first part "lead" every
    # HomePod, so a whole-house message went to that one room only). A leader's or member's list names itself; a
    # group player's doesn't.
    ha_groups = []
    for st in house.states("media_player"):
        gm = st.attributes.get("group_members") or []
        if (isinstance(gm, (list, tuple)) and len(gm) > 1 and st.entity_id in gm
                and not (ma.get(pids.get(st.entity_id, "")) or {}).get("group")
                and not (ma.get(pids.get(gm[0], "")) or {}).get("group")):
            ha_groups.append([pids.get(m, m) for m in gm if isinstance(m, str)])
    me = pids[player]
    out, todo = {me}, [me]
    while todo:
        pid = todo.pop()
        v = ma.get(pid)
        found: set[str] = set()
        if v is not None and (v["group"] or len(v["members"]) > 1):
            found.update(v["members"])
        found.update(o for o, w in ma.items() if w.get("synced_to") == pid)
        for gm in ha_groups:
            if gm and gm[0] == pid:
                found.update(gm)
        for x in found - out:
            out.add(x)
            todo.append(x)
    return out


def owners(music: MusicConfig, ma: Mapping[str, dict[str, Any]], pids: Mapping[str, str]) -> dict[str, set[str]]:
    """{Music Assistant id: the rooms it belongs to}: a room's own players (a virtual pair's two), then a group player
    room's parts that are no room's own. Two entities naming one id make it both rooms'."""
    out: dict[str, set[str]] = {}
    for r in music.room_ids:
        for p in music.players_of([r]):
            if p in pids:
                out.setdefault(pids[p], set()).add(r)
    parts: dict[str, set[str]] = {}
    for r in music.room_ids:
        for p in music.players_of([r]):
            v = ma.get(pids.get(p, ""))
            if v is not None and v["group"]:
                for m in v["members"]:
                    if m not in out:
                        parts.setdefault(m, set()).add(r)
    out.update(parts)
    return out


def decide(house: House, music: MusicConfig, doc: Mapping[str, Any], picked: Iterable[str], *, mode: str,
           here: Iterable[str] = (), override: bool = False, allowed: Callable[[str], bool] = lambda r: True,
           ma_raw: Any = None, pids: Mapping[str, str] | None = None, now: datetime | None = None) -> Plan:
    """The plan for a broadcast to ``picked`` (room entities; a preset or floor is the page's to expand). ``pids``:
    {media_player entity: Music Assistant player id}; ``ma_raw``: Music Assistant's ``players/all`` (None:
    unreadable)."""
    live_mode = mode == "live"
    here = set(here)
    pids = dict(pids or {})
    ma = ma_view(ma_raw)
    plan = Plan()
    picked = [r for r in dict.fromkeys(p for p in picked if isinstance(p, str))][:MAX_ROOMS]
    rooms = set(music.room_ids)
    kept: list[dict[str, Any]] = []
    for r in picked:
        if r not in rooms or not C.room(doc, r).get("enabled"):
            continue                                    # 1. not an Intercom room
        if not allowed(r):
            continue                                    # 2. not this sender's
        row: dict[str, Any] = {"room": r, "name": music.name_of(r), "state": OK, "why": None, "reason": "", "live": False}
        plan.rooms.append(row)
        if ma is None:
            row.update(state=SKIPPED, why=WHY_UNAVAILABLE,
                       reason=f"{row['name']}: Music Assistant's speakers could not be read")
        elif not E.available(house, r) or any(pids.get(p) not in ma for p in music.players_of([r])):
            row.update(state=SKIPPED, why=WHY_UNAVAILABLE, reason=f"{row['name']}: Music Assistant can't reach it")
        if row["state"] == SKIPPED:
            continue                                    # 3. (and an unreadable list: nothing guessed)
        if _quiet_now(house, doc, r, now) and not override:
            row.update(state=SKIPPED, why=WHY_QUIET, reason=f"{row['name']}: quiet hours")
            continue                                    # 4.
        if live_mode and r in here:
            row.update(state=SKIPPED, why=WHY_HERE, reason=f"{row['name']}: you're here (left out in Live)")
            continue                                    # 5.
        kept.append(row)

    # 6. THE GROUP CHECK, to a fixpoint: a room skipped leaves its players out of every other room's reach
    own = owners(music, ma or {}, pids)
    by_pid: dict[str, str] = {}
    for e, pid in pids.items():
        by_pid.setdefault(pid, e)
    while True:
        in_rooms = {row["room"] for row in kept}
        players = {p: row for row in kept for p in music.players_of([row["room"]])}
        reaches = {p: reach(house, ma or {}, pids, p) for p in players}
        bad: list[tuple[dict[str, Any], set[str], set[str]]] = []
        for p, row in players.items():
            outside = {x for x in reaches[p] if not own.get(x) or not own[x] <= in_rooms}
            if outside:
                bad.append((row, outside, reaches[p]))
        if not bad:
            break
        for row, outside, _ in bad:
            names = sorted({music.name_of(o) for x in outside for o in (own.get(x) or set()) - in_rooms}
                           | {music.name_of(by_pid.get(x, x)) for x in outside if not own.get(x)})
            mine = {pids[p] for p in music.players_of([row["room"]])}
            reason = (f"{row['name']} shares its speaker with {', '.join(names)}; skipped" if mine & outside
                      else f"{row['name']} leads {', '.join(names)}; skipped")
            row.update(state=SKIPPED, why=WHY_LEADS, reason=reason)
        kept = [k for k in kept if not any(k is b[0] for b in bad)]

    # who calls: the widest reach first, so a leader's call covers its members (and, where the two sources name
    # different leaders, exactly one of them is called)
    order_p = sorted(players, key=lambda p: -len(reaches[p]))
    heard: set[str] = set()
    calling: dict[str, list[str]] = {}
    for p in order_p:
        if pids[p] in heard:
            continue
        calling[p] = sorted(q for q in players if q != p and pids[q] in reaches[p])
        heard |= reaches[p]
    grouped = {q for p, cov in calling.items() if cov for q in [p, *cov]}
    for row in kept:
        r = row["room"]
        idle = E.state_of(house, r) not in IDLE_NOT
        rs = C.room(doc, r)
        can_live = live_mode and idle and rs.get("live", True) and not rs.get("demoted") and not any(
            p in grouped for p in music.players_of([r]))
        row["live"] = bool(can_live)
        if live_mode and not can_live:
            row["state"] = AFTER
        for p in music.players_of([r]):
            if p in calling:
                plan.calls.append(Call(p, r, C.volume_of(doc, r), live=bool(can_live), covers=calling[p]))
    order = {r: i for i, r in enumerate(picked)}
    plan.rooms.sort(key=lambda x: order.get(x["room"], 0))
    return plan


def feed_rooms(house: House, music: MusicConfig, doc: Mapping[str, Any], *, allowed: Callable[[str], bool],
               here: Iterable[str] = (), ma_raw: Any = None, pids: Mapping[str, str] | None = None,
               now: datetime | None = None) -> list[dict[str, Any]]:
    """Every Intercom room the sender may reach, as the sheet shows it before anything is sent: each room decided ALONE
    (would it play, live or after, or why not). The group check of a real pick may still skip a room whose group
    isn't all in it; the sheet shows ``leads`` when it would lead others even alone."""
    out = []
    for room in music.rooms:
        r = room.entity
        if not C.room(doc, r).get("enabled") or not allowed(r):
            continue
        p = decide(house, music, doc, [r], mode="live", here=here, ma_raw=ma_raw, pids=pids, now=now)
        row = p.rooms[0] if p.rooms else None
        if row is None:
            continue
        if row["why"] == WHY_HERE:            # in Message it plays; the sheet marks it "you're here"
            row = {**row, "state": OK}
        elif row["why"] == WHY_LEADS:         # selectable: it plays when every room it leads is picked with it
            names = row["reason"].split(" leads ", 1)[-1].rsplit("; skipped", 1)[0]
            row = {**row, "state": OK, "reason": f"{row['name']} plays only together with {names}"}
        out.append({**row, "floor": room.floor, "state": OK if row["state"] == AFTER else row["state"]})
    return out


def expand(music: MusicConfig, picks: Iterable[str]) -> list[str]:
    """A page's pick (room entities, ``preset:<key>``, ``floor:<id>``, ``all``) as rooms. Only known ids count."""
    rooms = music.room_ids
    out: list[str] = []
    for p in picks:
        if p == "all":
            out += rooms
        elif isinstance(p, str) and p.startswith("floor:"):
            out += [r.entity for r in music.rooms if r.floor and _floor_id(r.floor) == p[6:]]
        elif isinstance(p, str) and p.startswith("preset:"):
            pr = next((x for x in music.presets if x.id == p), None)
            out += list(pr.members) if pr else []
        elif p in rooms:
            out.append(p)
    return list(dict.fromkeys(out))[:MAX_ROOMS]


def _floor_id(name: str) -> str:
    return "".join(ch if ch.isalnum() else "_" for ch in name.lower()).strip("_")
