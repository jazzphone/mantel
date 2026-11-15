"""AirPlay Groups' status page, as Mantel's Connections screen reads it: the rules with no host in them.

ma-airplay-groups is an add-on to Music Assistant that plays one group to several HomePods. Its server serves a
read-only status page for the home network (``http://<host>:54398/``) and the same facts as ``GET /status.json``:
``version``, ``uptime``, ``addon`` (active, reason, addon_version, cli_version, ma_version, seen), ``speakers`` (name,
online, available, state, group, asks_password, password_stored, locked_out, needs_setup (null, or what it needs:
"password_required", "pairing_required"), monitoring_off, ip),
``groups`` and ``alerts`` (active, recent: {at, title, active}). It takes no token. The page also has a box that
stores an AirPlay password; Mantel never uses it, and only ever reads ``/status.json``.

* WHAT THE ROW SAYS (``read``): the add-on on or off and its version, how many speakers it sees (and how many are
  online), the speakers locked out (a HomePod that refused the password too often), and the page's own active alerts.
  A body that isn't the status page's is ``None``: the address answered, but not as AirPlay Groups does.
* "UNAVAILABLE", AFTER A FAILED LOOK: the page is looked at every POLL_EVERY seconds; the first failed look makes it
  unavailable, and after ALERT_AFTER unavailable an alert goes out (``alert_due``). A locked-out speaker is an alert at
  once (``locked_out``): it stays locked out until someone fixes it.
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

PORT = 54398            # the status page's port on the Music Assistant computer
STATUS_PATH = "/status.json"
POLL_EVERY = 60.0       # seconds between two looks at the page
ALERT_AFTER = 600.0     # seconds unavailable before the alert is sent
MAX_TEXT = 80
MAX_NAMES = 24


def _text(v: Any) -> str | None:
    if not isinstance(v, (str, int, float)) or isinstance(v, bool):
        return None
    s = " ".join(str(v).split())[:MAX_TEXT]
    return s or None


def _names(speakers: list, flag: str) -> list[str]:
    out = []
    for s in speakers:
        # (locked_out is true or false; needs_setup is null or what it needs: "password_required", "pairing_required")
        v = s.get(flag) if isinstance(s, Mapping) else None
        if isinstance(s, Mapping) and (v is True or (isinstance(v, str) and v.strip())):
            name = _text(s.get("name")) or _text(s.get("ip")) or "A speaker"
            if name not in out:
                out.append(name)
    return sorted(out)[:MAX_NAMES]


def read(body: Any) -> dict[str, Any] | None:
    """What the Connections screen shows of one ``/status.json``, or None when ``body`` isn't the status page's.

    {version, addon: {on, version, reason, cli_version, ma_version}, speakers, online, locked_out: [names],
     needs_setup: [names], groups, alerts: [titles of the page's active alerts]}"""
    if not isinstance(body, Mapping) or not isinstance(body.get("addon"), Mapping) or not isinstance(body.get("speakers"), list):
        return None
    addon: Mapping[str, Any] = body["addon"]
    speakers: list[Any] = body["speakers"]
    alerts_v = body.get("alerts")
    alerts: Mapping[str, Any] = alerts_v if isinstance(alerts_v, Mapping) else {}
    active_v = alerts.get("active")
    active: list[Any] = active_v if isinstance(active_v, list) else []
    groups_v = body.get("groups")
    groups: list[Any] = groups_v if isinstance(groups_v, list) else []
    titles: list[str] = []
    for a in active:
        t = _text(a.get("title")) if isinstance(a, Mapping) else None
        if t and t not in titles:
            titles.append(t)
    return {
        "version": _text(body.get("version")),
        "addon": {"on": addon.get("active") is True, "version": _text(addon.get("addon_version")) or _text(body.get("version")),
                  "reason": _text(addon.get("reason")), "cli_version": _text(addon.get("cli_version")),
                  "ma_version": _text(addon.get("ma_version"))},
        "speakers": sum(1 for s in speakers if isinstance(s, Mapping)),
        "online": sum(1 for s in speakers if isinstance(s, Mapping) and s.get("online") is True),
        "locked_out": _names(speakers, "locked_out"),
        "needs_setup": _names(speakers, "needs_setup"),
        "groups": sum(1 for g in groups if isinstance(g, Mapping)),
        "alerts": titles[:MAX_NAMES],
    }


def healthy(summary: Mapping[str, Any] | None) -> bool:
    """Nothing to look at: the add-on is on, no speaker is locked out, and the page has no active alert."""
    return summary is not None and bool(summary) and summary["addon"]["on"] is True and not summary["locked_out"] and not summary["alerts"]


def alert_due(down_since: float | None, now: float) -> bool:
    return down_since is not None and now - down_since >= ALERT_AFTER


def locked_out(summary: Mapping[str, Any] | None) -> str:
    """The locked-out speakers' names for the alert ('' when none): "Den HomePod" or "Den HomePod and Loft HomePod"."""
    names = list((summary or {}).get("locked_out") or [])
    if len(names) <= 2:
        return " and ".join(names)
    return ", ".join(names[:-1]) + " and " + names[-1]

