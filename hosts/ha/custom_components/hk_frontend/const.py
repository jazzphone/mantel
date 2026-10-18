"""Constants for hk_frontend.

The component serves the dashboard frontend at /hk/ (async_setup) and holds
one config entry per house (async_setup_entry): the dashboard settings
(settings.py) and your files folder (files.py). See README.md.
"""

DOMAIN = "hk_frontend"

# Sent whenever the settings change: the settings feed re-sends, and the
# Seasonal decorations switch re-reads its state.
SIGNAL_CONFIG = f"{DOMAIN}_config"

# The Show pop-up action (hk_frontend.show_popup): sent to every screen's
# event subscription, which opens the pop-up where it applies.
SIGNAL_POPUP = f"{DOMAIN}_popup"

# ---- your files (files.py): a folder under /config served under /hk/ ahead of
# the bundle -- where the Apple font and glyphs go, since they cannot ship here.
CONF_FILES_FOLDER = "files_folder"
DEFAULT_FILES_FOLDER = "hk_local"
