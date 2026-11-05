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
7. Live only: ``live`` when idle now, its Live flag is on and Live health hasn't demoted it; else ``after``. A group
   left from music is live only if all of it can be.

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

ROOMS IN STEP (docs/phase17/INTERCOM-SYNC.md part B). A Message's calls all start at once, but each idle HomePod opens an
AirPlay session of its own and starts when it's ready, a fraction of a second to a second from the next. Grouped music
plays on one clock, so ``sync_sets`` finds the calls that can be played the same way: a temporary group of two or more
speakers, idle, on their own and able to group, announced to once through its leader. Everything else keeps its own
call: a room playing music is already in step with the others playing music (Music Assistant mixes it in and arms one
shared instant), and a room holding paused music is left alone. Music Assistant gives a group one announcement volume,
so rooms at different volumes make separate groups. In Live the groups are made from the rooms that are live now.

A GROUP LEFT FROM MUSIC (2026-11-05: whole-house music stopped and left every HomePod grouped under the Master Bedroom, so
the Master Bedroom alone could only "play together with" eight other rooms). Music Assistant keeps a group after its music
stops, so the next Play is still whole-house. When a picked room leads such a group, all of it idle, and not every one of its
rooms is picked (or other rooms are, which then play in step with it), or a room inside it is, the broadcast BORROWS the group (``leftovers``, ``Plan.loose``): the host takes its members out first,
checked, and puts them back afterward, in their order. Everything here is then decided as if they were apart. Not a group
with a group player in it, a speaker playing, paused or holding paused music, or a room the sender may not reach.
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
MEMBER_KEYS = ("group_members", "group_childs", "static_group_members")     # where Music Assistant lists a group
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
class SyncSet:
    """Calls played as one temporary group: ``leader`` is announced to, ``members`` join it first."""
    leader: Call
    members: list[Call]

    @property
    def calls(self) -> list[Call]:
        return [self.leader, *self.members]


@dataclass
class Loose:
    """A group left from music that a broadcast borrows: Music Assistant ids, ``members`` in the group's own order."""
    leader: str
    members: list[str]


@dataclass
class Plan:
    rooms: list[dict[str, Any]] = field(default_factory=list)
    calls: list[Call] = field(default_factory=list)
    sync: list[SyncSet] = field(default_factory=list)      # rooms in step (sync_sets)
    loose: list[Loose] = field(default_factory=list)       # groups left from music, apart while it plays (leftovers)

    @property
    def solo(self) -> list[Call]:
        """The calls that aren't part of a temporary group."""
        grouped = {id(c) for s in self.sync for c in s.calls}
        return [c for c in self.calls if id(c) not in grouped]

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
        members = [m for key in MEMBER_KEYS
                   if isinstance(p.get(key), (list, tuple)) for m in p[key] if isinstance(m, str)]
        out[p["player_id"]] = {
            "members": list(dict.fromkeys(members)),
            "synced_to": p.get("synced_to") if isinstance(p.get("synced_to"), str) else None,
            "group": p.get("type") == "group",
        }
    return out


def _quiet_now(house: House, doc: Mapping[str, Any], room: str, now: datetime | None) -> bool:
    return dnd_on(house, C.quiet_of(doc, room), now)


def reach(house: House, ma: Mapping[str, dict[str, Any]], pids: Mapping[str, str], player: str,
          apart: Iterable[str] = ()) -> set[str]:
    """Every player (Music Assistant ids; a Home Assistant entity with no id stays an entity) an announcement to
    ``player`` can play on, from both sources, the wider winning: itself, what it leads, a group player's members, and
    whatever they lead in turn. A player that only FOLLOWS a leader, or is listed by a group player, adds nothing:
    Music Assistant announces to it alone (``_live_members``: "A synced member announced individually is just
    itself"). Music Assistant's ``group_members`` puts the player itself first, but any order counts here. ``apart``:
    speakers of a borrowed group (``leftovers``), whose Home Assistant lists don't count."""
    apart = set(apart)
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
            if not apart.intersection(pids.get(m, m) for m in gm if isinstance(m, str)):
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


def groupable(p: Any) -> bool:
    """A speaker in Music Assistant's ``players/all`` that can join a temporary group and be put back as it was: a plain
    player, on, reachable, idle, in no group of any kind. (A speaker that is off stays out: joining would turn it on.)"""
    if not isinstance(p, Mapping):
        return False
    return (p.get("type") == "player" and p.get("available") is True and p.get("powered") is not False
            and (p.get("playback_state") or p.get("state")) not in IDLE_NOT
            and "set_members" in (p.get("supported_features") or ())
            and not p.get("synced_to") and not p.get("active_group") and len(p.get("group_members") or ()) <= 1)


def sync_sets(house: House, music: MusicConfig, calls: list[Call], ma_raw: Any, pids: Mapping[str, str],
              held: Iterable[str] = ()) -> list[SyncSet]:
    """The temporary groups a broadcast's ``calls`` can play as (the module's notes). ``held``: rooms holding paused music.
    A group's leader is the one the music engine would pick (the house's preferred leaders, then not a room Home
    Assistant announces to: an announcement to a leader plays on its whole group), and every member is one it can
    group with."""
    players = {p["player_id"]: p for p in ma_raw if isinstance(p, Mapping) and "player_id" in p} if isinstance(
        ma_raw, (list, tuple)) else {}
    held = set(held)
    fit = [c for c in calls if not c.covers and c.room not in held and c.player not in held
           and E.state_of(house, c.room) not in IDLE_NOT and groupable(players.get(pids.get(c.player, "")))]
    by_volume: dict[int | None, list[Call]] = {}
    for c in fit:
        by_volume.setdefault(c.volume, []).append(c)
    out: list[SyncSet] = []
    for group in by_volume.values():
        while len(group) >= 2:
            room = music.leader_of(list(dict.fromkeys(c.room for c in group)))
            leader = next((c for c in group if c.room == room), group[0])
            can = players[pids[leader.player]].get("can_group_with") or ()
            members = [c for c in group if c is not leader and pids[c.player] in can]
            if members:
                out.append(SyncSet(leader, members))
            taken = {id(leader), *(id(c) for c in members)}
            group = [c for c in group if id(c) not in taken]
    return out


def leftovers(music: MusicConfig, ma_raw: Any, pids: Mapping[str, str], rooms: Iterable[str], *,
              allowed: Callable[[str], bool] = lambda r: True, held: Iterable[str] = ()) -> list[Loose]:
    """The groups left from music a broadcast to ``rooms`` borrows (the module's notes): an ad-hoc group with one of
    ``rooms`` in it, not exactly ``rooms``, every speaker of it a plain player that is
    available, on and idle, every one of its rooms the sender's and none holding paused music."""
    players = {p["player_id"]: p for p in ma_raw if isinstance(p, Mapping) and isinstance(p.get("player_id"), str)
               } if isinstance(ma_raw, (list, tuple)) else {}
    rooms, held = set(rooms), set(held)
    own = owners(music, ma_view(ma_raw) or {}, pids)
    by_pid: dict[str, set[str]] = {}
    for e, pid in pids.items():
        by_pid.setdefault(pid, set()).add(e)
    out: list[Loose] = []
    for lead, p in players.items():
        members = [m for m in dict.fromkeys(x for k in MEMBER_KEYS for x in (p.get(k) or ()))
                   if isinstance(m, str) and m != lead]
        if not members or p.get("synced_to"):
            continue
        group = [lead, *members]
        theirs = set().union(*(own.get(x, set()) for x in group))
        if not theirs & rooms:
            continue                        # none of it is picked
        # (a member picked counts too, 2026-11-05: the Office's two HomePods, both members, were each announced to alone,
        # which Music Assistant does by taking one out of the group, playing, putting it back, then the next: 12 s apart)
        if theirs == rooms:
            continue                        # all of it, and nothing else: the leader's call plays on it, as it is
        if not all(_lendable(players.get(x), x, lead) and own.get(x) and not own[x] & held
                   and not by_pid.get(x, set()) & held for x in group):
            continue
        if not all(allowed(r) for r in theirs) or any(
                w.get("synced_to") in members or (o not in group and w.get("synced_to") == lead)
                for o, w in players.items()):
            continue                        # someone the sender can't reach, or a group inside the group
        out.append(Loose(lead, members))
    return out


def _lendable(p: Any, pid: str, lead: str) -> bool:
    if not isinstance(p, Mapping):
        return False
    return (p.get("type") == "player" and p.get("available") is True and p.get("powered") is not False
            and (p.get("playback_state") or p.get("state")) not in IDLE_NOT and not p.get("active_group")
            and (pid == lead or (p.get("synced_to") in (None, lead) and len(p.get("group_members") or ()) <= 1)))


def apart(ma_raw: Any, loose: Iterable[Loose]) -> Any:
    """Music Assistant's list as it reads once ``loose`` is borrowed: every one of them on its own."""
    gone = {x for g in loose for x in [g.leader, *g.members]}
    if not gone or not isinstance(ma_raw, (list, tuple)):
        return ma_raw
    # who each can group with once it's on its own: a member of a group lists nobody (2026-11-05: the borrowed Kitchen and
    # Guest Bedroom, at one volume, each played alone), so a borrowed speaker gets its group's list, itself left out
    can: dict[str, set[str]] = {}
    for g in loose:
        group = {g.leader, *g.members}
        reach = set(group).union(*(set(p.get("can_group_with") or ()) for p in ma_raw
                                   if isinstance(p, Mapping) and p.get("player_id") in group))
        for x in group:
            can[x] = reach - {x}
    # every field a group is listed in (ma_view reads all three): 0.1.134 cleared group_members only, Music Assistant also
    # lists group_childs, so the leader still "covered" the speakers it had just let go and only it was called
    return [{**p, **{k: [] for k in MEMBER_KEYS}, "synced_to": None,
             "can_group_with": sorted(can[p["player_id"]] | set(p.get("can_group_with") or ()))}
            if isinstance(p, Mapping) and p.get("player_id") in gone else p for p in ma_raw]


def decide(house: House, music: MusicConfig, doc: Mapping[str, Any], picked: Iterable[str], *, mode: str,
           here: Iterable[str] = (), override: bool = False, allowed: Callable[[str], bool] = lambda r: True,
           ma_raw: Any = None, pids: Mapping[str, str] | None = None, now: datetime | None = None,
           held: Iterable[str] = (), borrow: bool = True) -> Plan:
    """The plan for a broadcast to ``picked`` (room entities; a preset or floor is the page's to expand). ``pids``:
    {media_player entity: Music Assistant player id}; ``ma_raw``: Music Assistant's ``players/all`` (None:
    unreadable); ``held``: rooms holding paused music, which stay out of the temporary groups; ``borrow``: False decides
    every group as it stands (the host can't take one apart at that point)."""
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

    # 5b. groups left from music that this broadcast borrows: decided from here on as if apart
    if borrow:
        plan.loose = leftovers(music, ma_raw, pids, {row["room"] for row in kept}, allowed=allowed, held=held)
    if plan.loose:
        ma_raw = apart(ma_raw, plan.loose)
        ma = ma_view(ma_raw)
    lent = {x for g in plan.loose for x in [g.leader, *g.members]}

    # 6. THE GROUP CHECK, to a fixpoint: a room skipped leaves its players out of every other room's reach
    own = owners(music, ma or {}, pids)
    by_pid: dict[str, str] = {}
    for e, pid in pids.items():
        by_pid.setdefault(pid, e)
    while True:
        in_rooms = {row["room"] for row in kept}
        players = {p: row for row in kept for p in music.players_of([row["room"]])}
        reaches = {p: reach(house, ma or {}, pids, p, lent) for p in players}
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

    def capable(row: dict[str, Any]) -> bool:
        rs = C.room(doc, row["room"])
        return E.state_of(house, row["room"]) not in IDLE_NOT and rs.get("live", True) and not rs.get("demoted")

    # a group left from music, idle: its leader's call plays on it as a temporary group's does, so it can be live. Not one
    # with a group player in it (a sync group): that's another path in Music Assistant, never tried live.
    grouped = {q for p, cov in calling.items() if cov for q in [p, *cov]
               if any((ma or {}).get(pids[x], {}).get("group") for x in [p, *cov])
               or not all(capable(players[x]) for x in [p, *cov])}
    for row in kept:
        r = row["room"]
        can_live = live_mode and capable(row) and not any(p in grouped for p in music.players_of([r]))
        row["live"] = bool(can_live)
        if live_mode and not can_live:
            row["state"] = AFTER
        for p in music.players_of([r]):
            if p in calling:
                plan.calls.append(Call(p, r, C.volume_of(doc, r), live=bool(can_live), covers=calling[p]))
    order = {r: i for i, r in enumerate(picked)}
    plan.rooms.sort(key=lambda x: order.get(x["room"], 0))
    plan.sync = sync_sets(house, music, [c for c in plan.calls if c.live or not live_mode], ma_raw, pids, held)
    return plan


def feed_rooms(house: House, music: MusicConfig, doc: Mapping[str, Any], *, allowed: Callable[[str], bool],
               here: Iterable[str] = (), ma_raw: Any = None, pids: Mapping[str, str] | None = None,
               now: datetime | None = None, held: Iterable[str] = ()) -> list[dict[str, Any]]:
    """Every Intercom room the sender may reach, as the sheet shows it before anything is sent: each room decided ALONE
    (would it play, live or after, or why not). The group check of a real pick may still skip a room whose group
    isn't all in it; the sheet shows ``leads`` when it would lead others even alone."""
    out = []
    for room in music.rooms:
        r = room.entity
        if not C.room(doc, r).get("enabled") or not allowed(r):
            continue
        p = decide(house, music, doc, [r], mode="live", here=here, ma_raw=ma_raw, pids=pids, now=now, allowed=allowed,
                   held=held)
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
