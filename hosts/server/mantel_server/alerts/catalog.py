"""The system alerts' event catalog (docs/phase14/SYSTEM-ALERTS.md "The event catalog").

Each kind has a group, a level, a hold (how long the condition must last before it is sent), whether a clear is sent,
whether a new channel takes it, what it ``needs`` (an alert whose cause is another one: the tablets and Mantel Link
read through Home Assistant), and its words. A source raises a kind with a key (which tablet, which connection) and
short facts; the words are the kind's, filled from the facts (``{name}``, ``{error}``, ...). Adding a kind is one entry
here and one ``raise_`` call where it is seen.
"""
from __future__ import annotations

from dataclasses import dataclass

LEVELS = ("info", "warning", "critical")
GROUPS = ("connections", "backups", "tablets", "mantel", "updates", "security")
GROUP_NAMES = {"connections": "Connections", "backups": "Backups", "tablets": "Tablets", "mantel": "Mantel",
               "updates": "Updates", "security": "Security"}
MIN = 60.0


@dataclass(frozen=True)
class Kind:
    id: str
    group: str
    level: str
    title: str                     # raised: "Home Assistant disconnected"
    body: str = ""                 # raised: one or two lines
    back: str = ""                 # cleared: "Home Assistant is back" (empty: no clear is sent)
    back_body: str = ""
    hold: float = 0.0              # seconds the condition must last before the raise is sent
    default: bool = True           # on for a new channel
    needs: tuple[str, ...] = ()    # kinds that cause this one: held while one is up, dropped if it clears with it
    page: str = ""                 # Mantel Settings page the message links to ("connections", "backups", ...)
    start_grace: bool = False      # waits out the first minutes after a start (connecting takes a moment)
    once: bool = False             # an event, not a condition: sent and forgotten (no clear, never "up")

    @property
    def clears(self) -> bool:
        return bool(self.back) and not self.once

    def words(self, facts: dict, up: bool = True) -> tuple[str, str]:
        """The title and body for these facts (a fact a template names but the source didn't give is left blank)."""
        title, body = (self.title, self.body) if up else (self.back or self.title, self.back_body)
        return fill(title, facts), fill(body, facts)


class _Blank(dict):
    def __missing__(self, key: str) -> str:
        return ""


def fill(template: str, facts: dict) -> str:
    try:
        return template.format_map(_Blank({k: str(v) for k, v in (facts or {}).items()})).strip()
    except (ValueError, IndexError):
        return template


_HA = ("ha.lost",)
KINDS: dict[str, Kind] = {k.id: k for k in (
    # -- Connections ---------------------------------------------------------------------------------------------
    Kind("ha.lost", "connections", "critical", "Home Assistant disconnected",
         "Mantel can't reach Home Assistant. The screens show what they had and can't control anything.",
         "Home Assistant is back", "Mantel is connected to Home Assistant again.", hold=5 * MIN, page="connections",
         start_grace=True),
    Kind("ma.lost", "connections", "warning", "Music Assistant disconnected",
         "Mantel can't reach Music Assistant. Music on the screens won't play or show what's on.",
         "Music Assistant is back", "Mantel is connected to Music Assistant again.", hold=5 * MIN,
         page="connections", start_grace=True),
    Kind("protect.lost", "connections", "warning", "UniFi Protect disconnected",
         "Mantel isn't getting Protect's events: no doorbell or motion notifications from its cameras.",
         "UniFi Protect is back", "Protect's events are coming in again.", hold=5 * MIN, page="cameras",
         start_grace=True),
    Kind("protect.cert", "connections", "critical", "UniFi Protect's certificate changed",
         "Mantel stopped talking to Protect because its certificate is not the one trusted. Check it in Mantel "
         "Settings → Cameras and trust the new one if it's expected.",
         "UniFi Protect is trusted again", "Mantel is talking to Protect again.", page="cameras"),
    Kind("link.lost", "connections", "warning", "Mantel Link isn't answering",
         "Home Assistant is connected, but Mantel Link isn't. Phones through the Companion app and HK Frontend's "
         "dashboards wait for it.", "Mantel Link is back", "Mantel Link is connected again.", hold=5 * MIN,
         needs=_HA, page="link", start_grace=True),
    Kind("token.expiring", "connections", "warning", "{name}'s credential expires {when}",
         "Replace it in Mantel Settings → Connections before then, or the connection stops.",
         "{name}'s credential was replaced", page="connections"),
    # -- Backups -------------------------------------------------------------------------------------------------
    Kind("backup.ok", "backups", "info", "Backup finished", "{file} ({size}).", default=False, page="backups",
         once=True),
    Kind("backup.failed", "backups", "critical", "Backup failed", "{error}", "Backups work again",
         "The next backup finished: {file}.", page="backups"),
    Kind("backup.stale", "backups", "warning", "No backup for two days",
         "The last good backup was {when}.", "Backups are current again", page="backups"),
    Kind("backup.target", "backups", "critical", "The backup folder isn't usable",
         "{problem} Nothing can be backed up until it's back.", "The backup folder is back", hold=10 * MIN,
         page="backups"),
    # -- Tablets (held by the tablets' own watch, as before: 10 / 10 / 3 minutes) --------------------------------
    Kind("tablet.offline", "tablets", "warning", "{name} tablet is offline",
         "Its kiosk app hasn't been heard from for 10 minutes. It may be off the Wi-Fi, or behind the lock screen "
         "after a restart.", "{name} tablet is back", needs=_HA, page="tablets"),
    Kind("tablet.charging", "tablets", "warning", "{name} tablet isn't charging",
         "Unplugged, or its charger isn't keeping up.", "{name} tablet is charging again", needs=_HA,
         page="tablets"),
    Kind("tablet.restart", "tablets", "warning", "{name} tablet didn't come back",
         "Its scheduled restart was 3 minutes ago and the kiosk app isn't in front. It may be on the lock screen.",
         "{name} tablet is back after its restart", needs=_HA, page="tablets"),
    # -- Mantel --------------------------------------------------------------------------------------------------
    Kind("mantel.started", "mantel", "info", "Mantel started", "Version {version}.", default=False, page="about",
         once=True),
    Kind("mantel.crashed", "mantel", "warning", "Mantel restarted after stopping unexpectedly",
         "It was last running {when}. Version {version}.", page="about", once=True),
    Kind("disk.low", "mantel", "warning", "Low disk space for {name}",
         "{free} free ({percent}% of the disk).", "There's enough disk space for {name} again", hold=10 * MIN,
         page="about"),
    Kind("push.failing", "mantel", "warning", "Notifications to the Mantel apps are failing",
         "The push service refused the last {count} notifications.", "Notifications to the Mantel apps work again",
         page="connections"),
    # features on by default (features/auto.py): at most four times in a house's life, and the screens change
    Kind("feature.enabled", "mantel", "info", "Mantel turned on {name}",
         "{why} Turn it off in Mantel Settings → Advanced → Features.", page="features", once=True),
    Kind("channel.failing", "mantel", "warning", "Alerts to {name} are failing",
         "Mantel gave up sending to this channel {count} times in a row. Last error: {error}",
         "Alerts to {name} work again", page="alerts"),
    # -- Updates -------------------------------------------------------------------------------------------------
    Kind("update.mantel", "updates", "info", "Mantel {version} is available", "{how}", "Mantel {version} is installed",
         page="about"),
    Kind("update.link", "updates", "info", "Mantel Link {version} is available", "{how}",
         "Mantel Link {version} is installed", page="about"),
    Kind("update.hk_frontend", "updates", "info", "HK Frontend {version} is available", "{how}",
         "HK Frontend {version} is installed", page="about"),
    # -- Security ------------------------------------------------------------------------------------------------
    Kind("signin.failures", "security", "warning", "{count} failed sign-ins in 10 minutes",
         "Someone is trying passwords or codes at Mantel's sign-in page.", default=False, page="audit", once=True),
    Kind("config.changed", "security", "info", "Mantel's setup changed: {what}", "By {who}.", default=False,
         page="audit", once=True),
)}

# what a "test" message says (Send Test)
TEST = Kind("test", "mantel", "info", "Test alert", "This channel works. Alerts from Mantel will look like this.",
            once=True)


def kind(kid: str) -> Kind | None:
    return KINDS.get(kid)


def defaults() -> list[str]:
    """The kinds a new channel takes."""
    return [k.id for k in KINDS.values() if k.default]


def level_at_least(level: str, minimum: str) -> bool:
    try:
        return LEVELS.index(level) >= LEVELS.index(minimum)
    except ValueError:
        return True


def as_json() -> list[dict]:
    """The catalog for the Settings page: every kind, by group."""
    return [{"id": k.id, "group": k.group, "level": k.level, "title": k.title, "default": k.default,
             "clears": k.clears, "hold": k.hold} for k in KINDS.values()]
