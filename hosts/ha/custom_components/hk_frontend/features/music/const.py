"""Music's constants live in hk_core (hk_core/music/const.py); the feature keeps importing them
here. SIGNAL_CONFIG is HA's own: the dispatcher signal every screen's feed listens on."""
from ...hk_core.music.const import *  # noqa: F401,F403

# the configuration changed: every screen's feed re-sends
SIGNAL_CONFIG = "hk_music_config"
