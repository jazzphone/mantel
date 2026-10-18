"""Notifications' constants live in hk_core (hk_core/notifications/const.py); the feature keeps
importing them here. DATA is HA's own: where the feature keeps its things in hass.data."""
from ...hk_core.notifications.const import *  # noqa: F401,F403

DATA = "hk_notifications"          # hass.data: the snapshots, the last times, the mutes
