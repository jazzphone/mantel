# The Mantel push relay

A Cloudflare Worker that delivers Mantel's notifications to the iPhone/iPad app for every Mantel house, holding the
APNs key so that no house has to (docs/phase10/APPLE-APPS.md §13). Free tier: 100,000 requests a day.

Houses never see Apple's device tokens: a phone registers with the relay for one house and gives that house an
opaque handle. Houses sign every request with their identity key. Notifications are sealed to each phone's own key
before they leave the house, tag included, so the relay and Apple see only ciphertext, the generic alert, the
interruption level and an opaque `collapse_id`: a keyed hash of the tag (`apns.collapse_id`), different for each
phone, that lets a newer notification replace an older one. The relay stores none of it.

## Deploy (once; needs a Cloudflare API token as a file)

The token (Workers Scripts: Edit, D1: Edit, Account Settings: Read) lives in `~/.config/mantel/secrets/cloudflare_token`.
`tools/deploy_push_relay.sh` does the steps: create the D1 database and its tables, put the APNs key in as a Worker
secret (read from its file, never printed), deploy, and check `/v1/health`. The relay's address is then set as
`apns.DEFAULT_RELAY` (every house's default), or per house by an Owner in **Mantel Settings → Connections →
Notifications to the App** (Default Relay, Your Own Relay with its `https://` address, or Off; stored as
`push_relay` in `app_settings`, set through `PUT /api/app/push-relay`). Changing it makes the house forget its phones'
handles at the old relay; the apps register again with the new one.

## Tests

`node packaging/push-relay/test/relay.test.mjs` (the Worker alone, node:sqlite for D1, Apple faked) and
`tests/test_push_relay.py` (a Mantel house talking to the Worker served locally).
