"""model.py's side pane checks and the older shapes lifted to it (moved here by tools/split_py.py from hk_core/settings/model.py:
tools/split_py_manifests/model.json; `tools/split_py.py --find NAME` says which file holds a name)."""
from __future__ import annotations

from collections.abc import Mapping
import copy
from typing import Any
from .. import pane_status as PS
from .schema import _whole, CONF_DASHBOARD
from .defaults import (PANE_CHOICES, PANE_DIM_GLASS, PANE_DIM_MAX, PANE_DIM_WORDS, PANE_FLAGS_ON, PANE_GROUPS,
    PANE_MAX, PANE_OPTIONS, PANE_PLACES, PANE_SAVER_SHOWS, PANE_SECTIONS, PANE_SHOWS, PANE_SIDES, PANE_SIZES,
    PANE_TAPS, PANE_TAPS_OWN, PANE_WHEN, PANE_WIDTHS, SAVER_CAL_DAYS, SAVER_DEFAULTS, SIDE_PANE_DEFAULTS,)
from .pages_screen_rules import merged


def pane_section(v: Any, strict: bool = False) -> dict[str, Any] | None:
    """One section, as stored: {kind, size, when, its options}, with size More and when Always left out (they are what
    absent means). None when it is not a section; strict, also when any key or value is one it can't use (the form says
    so), where the tolerant read leaves that key out. A Status's own options: pane_status.py."""
    from .dashboard_rules import ENTITY_ID
    if not isinstance(v, Mapping) or v.get("kind") not in PANE_SECTIONS:
        return None
    kind = v["kind"]
    opts = PANE_OPTIONS.get(kind, {})
    out: dict[str, Any] = {"kind": kind}
    for k, val in v.items():
        if k == "kind":
            continue
        if k == "size" and val in PS.SIZES.get(kind, PANE_SIZES):
            if val != "more":
                out["size"] = val
        elif PS.option(kind, k, val) is not None:
            out[k] = PS.option(kind, k, val)
        elif k == "when" and val in PANE_WHEN:
            if val != "always":
                out["when"] = val
        elif k == "place" and val in PANE_PLACES:
            if val != "top":
                out["place"] = val
        elif k == "tap" and (val in PANE_TAPS or val in PANE_TAPS_OWN.get(kind, ())):
            if val != "auto":
                out["tap"] = val
        elif k in PANE_FLAGS_ON.get(kind, ()) and isinstance(val, bool):
            if not val:
                out[k] = False
        elif k in PANE_CHOICES.get(kind, {}) and val in PANE_CHOICES[kind][k]:
            if val != PANE_CHOICES[kind][k][0]:
                out[k] = val
        elif k in opts and opts[k] is bool and isinstance(val, bool):
            if val:
                out[k] = True
        elif k in opts and isinstance(opts[k], tuple) and _whole(val, *opts[k]) is not None:
            out[k] = _whole(val, *opts[k])
        elif k in opts and isinstance(opts[k], str) and isinstance(val, str) \
                and ENTITY_ID.match(val) and val.startswith(opts[k] + "."):
            out[k] = val
        elif strict:
            return None
    return out


def pane_sections(v: Any, strict: bool = False) -> list[dict[str, Any]] | None:
    """A group's sections, in order: at most PANE_MAX, one Full at most, no section twice (the same kind and entity, a
    Status's id: pane_status.key). Strict, any of that is None; read tolerantly, a section it can't use is left out, a
    second Full is More and the list is cut at PANE_MAX."""
    if not isinstance(v, list):
        return None
    out: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    full = False
    for x in v:
        s = pane_section(x, strict)
        key = PS.key(s) if s else None
        if s is None or key in seen:
            if strict:
                return None
            continue
        if s.get("size") == "full":
            if full:
                if strict:
                    return None
                s.pop("size")
            full = True
        seen.add(key)
        out.append(s)
    if len(out) > PANE_MAX:
        if strict:
            return None
        out = out[:PANE_MAX]
    return out


def pane_group(name: str, v: Any, strict: bool = False) -> Any:
    """One group's value (PANE_GROUPS), checked; None when it can't be used.
    A Dashboard or Screensaver group is whole: what it shows and its
    sections, a missing one (tolerantly) the default's."""
    if name == "side":
        return v if v in PANE_SIDES else None
    if name == "width":
        return v if v in PANE_WIDTHS else None
    if name == "dim":
        if v == PANE_DIM_GLASS:
            return v
        if isinstance(v, str):
            return PANE_DIM_WORDS.get(v)
        return _whole(v, 0, PANE_DIM_MAX)
    if name in ("doorbell", "headings"):
        return v if isinstance(v, bool) else None
    if name not in ("dashboard", "saver") or not isinstance(v, Mapping):
        return None
    shows = PANE_SHOWS if name == "dashboard" else PANE_SAVER_SHOWS
    if strict and (set(v) - {"show", "sections"} or "show" not in v or "sections" not in v):
        return None
    show = v.get("show") if v.get("show") in shows else (None if strict else SIDE_PANE_DEFAULTS[name]["show"])
    secs = pane_sections(v.get("sections"), strict) if "sections" in v else None
    if secs is None and not strict:
        secs = copy.deepcopy(SIDE_PANE_DEFAULTS[name]["sections"])
    if show is None or secs is None:
        return None
    return {"show": show, "sections": secs}


def side_pane(v: Any, strict: bool = False) -> dict[str, Any] | None:
    """All Screens' Side Pane, every group there (the defaults' where one is
    missing); strict, None when anything is one it can't use."""
    if not isinstance(v, Mapping) or (strict and set(v) - set(PANE_GROUPS)):
        return None
    out = copy.deepcopy(SIDE_PANE_DEFAULTS)
    for g in PANE_GROUPS:
        if g in v:
            got = pane_group(g, v[g], strict)
            if got is None and strict:
                return None
            if got is not None:
                out[g] = got
    return out


def side_pane_own(v: Any, strict: bool = False) -> dict[str, Any] | None:
    """A screen's own Side Pane: only the groups it sets, each checked; None
    (Same as All Screens in everything) when it sets none. Strict, an empty
    object is None as well, and anything it can't use is refused (raises
    ValueError)."""
    if v is None:
        return None
    if not isinstance(v, Mapping) or (strict and set(v) - set(PANE_GROUPS)):
        if strict:
            raise ValueError("side_pane")
        return None
    out = {}
    for g in PANE_GROUPS:
        if g in v and v[g] is not None:
            got = pane_group(g, v[g], strict)
            if got is None:
                if strict:
                    raise ValueError("side_pane")
                continue
            out[g] = got
    return out or None


def pane_resolved(house: Mapping[str, Any] | None, own: Mapping[str, Any] | None) -> dict[str, Any]:
    """A screen's Side Pane as read: each group its own when it sets it, else
    All Screens'. `own` (the groups it sets, in PANE_GROUPS order) says which,
    for the settings page's "Just This Screen"."""
    h = side_pane(house) or copy.deepcopy(SIDE_PANE_DEFAULTS)
    mine = own or {}
    out = {g: copy.deepcopy(mine[g] if g in mine else h[g]) for g in PANE_GROUPS}
    out["own"] = [g for g in PANE_GROUPS if g in mine]
    return out


def _saver_pane(saver: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """The screensaver's pane before the Side Pane (look.saver or a screen's
    own options): the calendar's events above, the music below while it
    plays -- as a Screensaver group; None when it had none."""
    s = saver or {}
    secs: list[dict[str, Any]] = []
    if s.get("calendar") is True:
        days = _whole(s.get("calendar_days"), *SAVER_CAL_DAYS) or SAVER_DEFAULTS["calendar_days"]
        secs.append({"kind": "calendar", "days": days})
    if s.get("music_pane") is True:
        secs.append({"kind": "now_playing", "when": "active"})
    return {"show": "own", "sections": secs} if secs else None


# a Dashboard group that is Now Playing's pane: the music, while it plays, on every page
NP_PANE = {"show": "all", "sections": [{"kind": "now_playing", "when": "active"}]}

_PANE_OLD_SAVER = ("calendar", "calendar_days", "music_pane")

_PANE_OLD_BOARD = ("np_style", "np_side")


def side_pane_lifted(options: Mapping[str, Any] | None, items: Mapping[str, Mapping[str, Any]],
                     clear: bool = False) -> tuple[dict[str, Any] | None, dict[str, dict[str, Any]]]:
    """THE SIDE PANE TAKES OVER (entry 1.18, 2026-10-30): the screensaver's
    pane and Now Playing's become Side Pane groups, so every screen looks as it
    did. All Screens': the screensaver's Calendar / Music (look.saver) its own
    sections in the screensaver -- the calendar (its days), then Now Playing
    when there's something; Now Playing's Show As: Side Pane the music, when
    there's something, on every page, on its Pane Side. A screen whose own
    screensaver options or Now Playing differ gets those groups of its own;
    one that showed the same follows All Screens. (One Pane Side for both now:
    where a screen had the music's pane on the left and the screensaver's on
    the right, the music's side is kept.) The older keys stay as they were for
    one release, read by nothing new; `clear` (Mantel, whose page and server
    are one release) also sets them back. A house already moved (a stored
    side_pane) and a screen already moved are left alone. Returns (new options
    or None: unchanged, {path: new item data})."""
    from .dashboard_rules import board
    from .stored_rules import house_stored
    stored = dict((options or {}).get(CONF_DASHBOARD) or {})
    m = merged(options)
    new_options = None
    if "side_pane" in stored:
        house = side_pane(stored["side_pane"]) or copy.deepcopy(SIDE_PANE_DEFAULTS)
    else:
        house = copy.deepcopy(SIDE_PANE_DEFAULTS)
        sv = _saver_pane(m["look"]["saver"])
        if sv:
            house["saver"] = sv
        if m["now_playing"]["style"] == "pane":
            house["dashboard"] = copy.deepcopy(NP_PANE)
            house["side"] = m["now_playing"]["side"]
        if house != SIDE_PANE_DEFAULTS:
            stored["side_pane"] = house_stored("side_pane", house)
            new_options = {**(options or {}), CONF_DASHBOARD: stored}
    np = m["now_playing"]
    out: dict[str, dict[str, Any]] = {}
    for p, d in items.items():
        data = dict(d)
        if "side_pane" in data:
            out[p] = data
            continue
        b = board(data)
        own: dict[str, Any] = {}
        mine = b.get("screensaver_options")
        saver = house["saver"]
        if isinstance(mine, dict):
            sv = _saver_pane(mine) or {"show": "off", "sections": copy.deepcopy(SIDE_PANE_DEFAULTS["saver"]["sections"])}
            if sv != house["saver"]:
                own["saver"] = saver = sv
        style = b.get("np_style") or np["style"]
        if b.get("np_style"):
            dash = copy.deepcopy(NP_PANE) if style == "pane" else \
                {"show": "off", "sections": copy.deepcopy(SIDE_PANE_DEFAULTS["dashboard"]["sections"])}
            if dash != house["dashboard"]:
                own["dashboard"] = dash
        # its side: the music's pane's, where it had one; else the right, the
        # screensaver's pane's only side, where it has one of those
        side = (b.get("np_side") or np["side"]) if style == "pane" else "right" if saver["show"] != "off" else None
        if side and side != house["side"]:
            own["side"] = side
        if own:
            data["side_pane"] = own
        if clear:
            for k in _PANE_OLD_BOARD:
                data.pop(k, None)
            so = data.get("screensaver_options")
            if isinstance(so, dict) and any(k in so for k in _PANE_OLD_SAVER):
                data["screensaver_options"] = {k: v for k, v in so.items() if k not in _PANE_OLD_SAVER}
        out[p] = data
    if clear:
        st = dict((new_options or options or {}).get(CONF_DASHBOARD) or {})
        changed = False
        lk = dict(st.get("look") or {})
        if isinstance(lk.get("saver"), dict) and any(k in lk["saver"] for k in _PANE_OLD_SAVER):
            lk["saver"] = {k: v for k, v in lk["saver"].items() if k not in _PANE_OLD_SAVER}
            if not lk["saver"]:
                lk.pop("saver")
            st["look"], changed = lk, True
            if not lk:
                st.pop("look")
        npo = dict(st.get("now_playing") or {})
        if any(k in npo for k in ("style", "side")):
            st["now_playing"] = {k: v for k, v in npo.items() if k not in ("style", "side")}
            if not st["now_playing"]:
                st.pop("now_playing")
            changed = True
        if changed:
            new_options = {**(new_options or options or {}), CONF_DASHBOARD: st}
    return new_options, out
