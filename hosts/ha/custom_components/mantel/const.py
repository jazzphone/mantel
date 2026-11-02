"""Constants for Mantel Link (domain `mantel`): Home Assistant's side of Mantel.

docs/phase9/MANTEL-LINK.md in the Mantel repository is the whole story.
"""

DOMAIN = "mantel"
NAME = "Mantel Link"
# HK Frontend, the integration Mantel Link replaces: its actions live on here
# as aliases, and its entities move here with their entity ids (the bridge)
HK_DOMAIN = "hk_frontend"

# the link this side speaks (mantel_link.py: protocol 2, docs/phase9/MANTEL-LINK.md)
PROTOCOL = 2

# ---- the config entry's data (Home Assistant writes it to
# .storage/core.config_entries in plain text, like every integration's secrets)
CONF_URL = "url"          # Mantel's address: https://host[:port] (http only inside this machine / the App network)
CONF_TOKEN = "token"      # a Mantel Service credential (scope `linked`); never shown again, logged or in diagnostics
CONF_CA = "ca"            # Mantel's own CA certificate, pinned (pairing v3: Mantel by its address); not a secret
# who owns what, as Mantel last said: {"house": "ha"|"mantel", "tablets": [ids],
# "bridge": "hk_frontend"|"mantel"}; kept so a restart without Mantel keeps it
CONF_OWNERS = "owners"

# The addresses the config flow's texts show. They are placeholders, not words in
# strings.json / translations/en.json: hassfest refuses a URL in a translation
# string ("please use description placeholders instead"), and the scheme alone
# ("https://") is as much of a URL as the page can show. Every form passes them
# as description_placeholders, which its errors use too.
URL_PLACEHOLDERS = {
    "https": "https://", "http": "http://",
    "example_url": "https://mantel.example.com",
    "app_url": "http://local-mantel:8099",     # the Mantel App on this machine
}

# the actions Mantel Link forwards to Mantel (and nothing else)
SERVICES = ("set_black_screen", "show_popup", "close_popup", "notify")
