"""Live TV's constants."""

# hass.data's key: Live TV's own prefix, so it cannot collide with
# hass.data["hk_frontend"], which is the house's entry's
DATA = "hk_tv"
SIGNAL_VIEWERS = "hk_tv_viewers"   # who is watching changed: sensor.tv_viewers writes

CONF_HOST = "host"            # the HDHomeRun
CONF_GUIDE_URL = "guide_url"  # an XMLTV file (optional)
CONF_CHANNELS = "channels"    # [{"number": "4.1", "name": "NBC"}, ...] -- in OPTIONS
CONF_QUALITY = "quality"      # "720" | "1080"

DEFAULT_QUALITY = "720"
GUIDE_REFRESH_MIN = 30
VIEWER_TTL_S = 150            # a screen that stops sending heartbeats stops counting
