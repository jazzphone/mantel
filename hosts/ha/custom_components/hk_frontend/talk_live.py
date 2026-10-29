"""LIVE TALK: the screen's microphone, streamed to a doorbell as you speak --
HK Frontend's `hk_frontend/talk/live` for hk_core's (hk_core/link/talk_live.py, written
once for HK Frontend and Mantel Link; its docstring is the whole story).
"""
from .hk_core.link import talk_live as shared
from .hk_core.link.talk_live import (CODECS, FADE_MS, FRAME_MS, MAX_BUFFER_MS, MAX_SESSION_S,  # noqa: F401 -- re-exported
                                     PREBUFFER_MS, RATES, TARGET_TTL_S, LiveTalk, Pacer, Target,
                                     async_cached_target, async_target)


def async_register(hass) -> None:
    shared.async_register(hass, "hk_frontend")
