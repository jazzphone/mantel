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

# ---- linked mode (linked_mode.py, mantel_link.py): "Linked to Mantel Server".
# Kept in the entry's DATA (not its options, which are the dashboard settings):
# {"url": Mantel Server's address, "token": a Service credential}. Absent = not
# linked, which is every house's default. Home Assistant writes entry data to
# .storage/core.config_entries in plain text, like every integration's secrets.
CONF_MANTEL_LINK = "mantel_link"
# Who owns which wall tablet while the house moves (linked_mode.py): the last
# ownership Mantel Server told this side, {"house": "ha"|"mantel", "tablets":
# [tablet ids Mantel owns]}, kept so a restart without Mantel keeps it. Absent:
# every tablet (and the rest of the entry) is Home Assistant's.
CONF_MANTEL_OWNERS = "mantel_owners"
# The addresses the "Linked to Mantel" step's texts show. They are placeholders,
# not words in translations/en.json: hassfest refuses a URL in a translation
# string ("please use description placeholders instead"), and the scheme
# alone ("https://") is as much of a URL as the page can show. The step passes
# them as description_placeholders, which the errors of that form use too.
LINKED_URL_PLACEHOLDERS = {
    "https": "https://", "http": "http://", "ws": "ws://", "wss": "wss://",
    "example_url": "https://mantel.example.lan",
    "app_url": "http://local-mantel:8099",     # the Mantel App on this machine (linked_mode.APP_ADDRESS)
}
