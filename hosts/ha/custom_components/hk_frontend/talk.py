"""TALK: a short clip recorded on a screen, played on a speaker -- HK Frontend's
address for hk_core's (hk_core/link/talk.py, written once for HK Frontend and
Mantel Link; its docstring is the whole story):

    POST /api/hk_frontend/talk?entity_id=media_player....   the clip
    GET  /api/hk_frontend/talk/<id>?authSig=...             the speaker fetches it
"""
from .hk_core.link import talk as shared
from .hk_core.link.talk import (AUDIO_TYPES, KEEP, MAX_BYTES, SAFE_HEADERS, TTL_S, Clips,  # noqa: F401 -- re-exported
                                check_target, clip_type, read_limited)

URL = "/api/hk_frontend/talk"


async def async_play(hass, clips, entity_id, body, ctype, context=None, sign=None, base=None):
    """Keep the clip and have entity_id play it. Returns the clip id."""
    return await shared.async_play(hass, clips, entity_id, body, ctype, context, sign, base, url=URL)


def async_register(hass):
    return shared.async_register(hass, URL, "hk_frontend")
