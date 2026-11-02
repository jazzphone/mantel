# Phase 14: system alerts and the update check (plan, 2026-11-02)

**Status: plan. Nothing built; the decisions below are open.**

## The ask (the owner, 2026-11-02)

- Mantel should tell someone when something goes wrong: a service or connection drops, and even routine news like a
  backup finishing. "Lots of options we could set a notification up for."
- Where it goes: **email (SMTP)**, **Notifiarr**, **Discord**, **Telegram**, the **Mantel apps on the phone and the
  Mac**, and **Apprise** (one library behind a URL, for every other service: ntfy, Pushover, Gotify, Slack, Matrix
  and about a hundred more).
- **An update check.** Mantel can't install its own updates, but it can notice a new release and say so, in
  Settings and through the same alerts.

## The answer, in short

One **alert center** on the server. Each part of Mantel reports what it sees (`raise` and `clear`). The center
waits out short blips, pairs every "lost" with a "back", drops alerts caused by an alert already up, and sends what's
left to the **channels** the owner set up. Each channel picks its own events, a minimum level and quiet hours.

Most of the parts already exist:

- **The model for an alert.** The tablets' alerts in `hk_core/tablets/alerts.py` already raise and clear: offline,
  not charging, not back after a restart. They're held for ten minutes and checked once a minute by
  `feature_watch.py`'s `TabletWatch`.
- **Backups.** `Backups.status` in `backup.py` keeps `last_ok`, `last_error` and `last_file`.
- **The connections.** `ha_client.py` keeps `connected` and `connected_since` and calls `on_disconnect`.
  `connectors/ma.py` keeps `connected` and sends `mantel_reconnected`.
- **Push to people's devices.** `push.py` sends Web Push, `apns.py` sends to the apps through the relay, sealed end
  to end, and Mantel Link carries the Companion app's. Pushes go only to the known push hosts (`PUSH_HOSTS`).
- **Secrets at rest.** `atrest.SecretBox` seals values the way `connections.py` seals the HA and MA tokens, and
  those sealed values are inside every backup.
- **Quiet hours.** `hk_core/notifications/dnd.py`.

What's new: the event catalog, the center, five senders (Discord, Notifiarr, Telegram, email, Apprise), a
Settings page, system alerts in the apps, notifications on the Mac at all, and the update check.

**Where it runs:** the server, in all three installs (HA App, LXC, Docker). HK Frontend inside Home Assistant
doesn't get it, because Home Assistant has its own `notify`. The alerts must not depend on Home Assistant either,
since "Home Assistant is down" is one of the main things to report.

## What it doesn't do

- **Tell you Mantel itself is down.** A server that's off sends nothing. The **heartbeat** covers that (slice
  14.7): Mantel calls a URL every few minutes, and an outside service such as healthchecks.io, Uptime Kuma's push
  monitor or Notifiarr alerts when the calls stop.
- **Install updates.** The check only reports. How to update is different in each install, and the message says how
  for this one.
- **Replace accessory notifications.** The doorbell, doors and leaks stay with the Notifier
  (`features/notify.py`) and its rules. System alerts are about Mantel and its connections, not the house's
  accessories.

## The design

### The event catalog (`mantel_server/alerts/catalog.py`)

Each kind has a group, a level (Info, Warning or Critical), a hold (how long the condition must last before it's
sent), whether a clear is sent, and whether it's on by default for a new channel.

| Group | Kind | Level | Hold | Clear message | On by default |
|---|---|---|---|---|---|
| Connections | `ha.lost`: Home Assistant not connected | Critical | 2 min | Yes: "Home Assistant is back" | Yes |
| Connections | `ma.lost`: Music Assistant not connected | Warning | 5 min | Yes | Yes |
| Connections | `protect.lost`: UniFi Protect's events not connected (after phase 13) | Warning | 5 min | Yes | Yes |
| Connections | `protect.cert`: Protect's certificate changed, connection stopped (phase 13) | Critical | none | When it's trusted again | Yes |
| Connections | `link.lost`: Mantel Link not answering while HA is connected | Warning | 5 min | Yes | Yes |
| Connections | `token.expiring`: a connection's credential expires within 14 days (MA's tokens last a year) | Warning | none | When it's replaced | Yes |
| Backups | `backup.ok`: a backup finished (name, size) | Info | none | n/a | No |
| Backups | `backup.failed`: a backup failed (the error, never a path outside the folder) | Critical | none | At the next good one | Yes |
| Backups | `backup.stale`: no good backup in 48 h | Warning | none | Yes | Yes |
| Backups | `backup.target`: the backup folder is missing or read-only | Critical | 10 min | Yes | Yes |
| Tablets | `tablet.offline`, `tablet.charging`, `tablet.restart`: today's three tablet alerts | Warning | as today (10 / 10 / 3 min) | Yes | Yes |
| Mantel | `mantel.started`: Mantel started (version) | Info | none | n/a | No |
| Mantel | `mantel.crashed`: started again after stopping unexpectedly (a marker file in the data folder) | Warning | none | n/a | Yes |
| Mantel | `disk.low`: under 5% or 1 GB free for the data or backup folder | Warning | 10 min | Yes | Yes |
| Mantel | `push.failing`: the push relay or APNs refused five in a row | Warning | none | Yes | Yes |
| Mantel | `channel.failing`: another alert channel failed three times (never sent to that channel) | Warning | none | Yes | Yes |
| Updates | `update.mantel`, `update.link`, `update.hk_frontend`: a new release (see "The update check") | Info | none | When it's installed | Yes |
| Security | `signin.failures`: 10 failed sign-ins in 10 minutes | Warning | none | n/a | No |
| Security | `config.changed`: a connection, a role or the Owner changed (from the audit's `config` rows) | Info | none | n/a | No |

The kinds marked "after phase 13" wait for that phase's Protect connector. The table is the start; adding a kind
is one entry and one `raise` call.

### The alert center (`mantel_server/alerts/center.py`)

- **The API.** Sources call `alerts.raise_(kind, key, facts)` and `alerts.clear(kind, key)`. The key tells
  instances apart (which tablet, which connection), and the facts are short words, never secrets.
- **Holds.** A raise waits out its hold. If it clears during the hold, nothing is sent. A clear is sent only if
  its raise was.
- **Flapping.** One alert sends at most three times an hour. After that it sends "keeps dropping (5 times in an
  hour)" once and holds until it stays clear for 15 minutes.
- **Causes.** While `ha.lost` is up, alerts that read through Home Assistant are held and dropped if they clear
  when HA comes back: the tablets, `link.lost`. Each catalog entry names what it `needs`. One cause, one message.
- **A quiet start.** For three minutes after a start, connection alerts wait (connecting takes a moment), then fire
  only if still down.
- **Batching.** Alerts within 20 seconds of each other go to a channel as one message ("3 alerts").
- **Quiet hours** (per channel, with `dnd.hhmm`): Info and Warning wait and go out as one message when quiet hours
  end, leaving out whatever cleared in the meantime. Critical always goes through.
- **Delivery.** Each channel has its own queue on the server's loop. A failed send retries after 10 s, 1 min and
  5 min, then gives up and counts toward `channel.failing`. A slow or failing channel never holds up another.
- **The log.** The last 30 days of raises, clears and which channels took them, in `alert_log`, shown in
  Settings → Alerts → History.

### The channels (`mantel_server/alerts/channels/`)

Each sender takes a rendered message (title, body, level, a link, a tag) and an injectable transport for tests.
Secrets are sealed with `SecretBox` (associated data `alert-channel:<id>`). After saving, they're never shown,
returned, logged or audited: the page shows only the last four characters.

| Channel | Setup | Sends to | Notes |
|---|---|---|---|
| **Discord** | A channel's webhook URL | `https://discord.com/api/webhooks/<id>/<token>` (also `discordapp.com`, `ptb.`, `canary.`), checked at save and before each send | An embed colored by level. `allowed_mentions: {parse: []}`, so a device named `@everyone` pings nobody. Honors 429 `retry_after` (30 a minute per webhook). |
| **Notifiarr** | The **global** API key, plus the numeric Discord channel ID it posts to | `notifiarr.com` only (the passthrough API, `X-api-Key`) | Integration keys don't work for passthrough. Confirm the payload (`notification`, `discord.ids.channel`, `discord.text`) against Notifiarr's docs while building. |
| **Telegram** | A bot token from @BotFather, then **Find My Chat**: you send the bot `/start`, Mantel reads `getUpdates` and lists the chats it sees, and you pick one (a group works) | `api.telegram.org` only (`sendMessage`, `parse_mode: HTML`, escaped) | The bot only speaks when spoken to first, which the setup handles. |
| **Email** | Server, port (587 STARTTLS, 465 TLS, 25 or 2525), user, password, From, one or more To | Any server the Owner types | Standard library `smtplib` in a thread, no new dependency. The certificate is verified. "None" (no TLS) only for a server on the LAN, with a warning. Plain text. The page notes Gmail and iCloud need an app password. |
| **Apprise** | One or more Apprise URLs | Anywhere the URL says | Owner only, under Advanced. The optional extra `mantel[apprise]`. Without it the choice says it isn't installed (decision 3). |
| **Mantel apps** | Nothing to set up: see below | The relay and APNs, Web Push, the Companion app | End to end for the Mantel app. Lists who gets them. |

**What a message says:** "Mantel · Home Assistant disconnected", one or two lines of what and since when, the
house's name, and a link to the right Settings page when Mantel knows its outside address. No tokens, IP addresses
or entity attributes. Device and tablet names are included. The guide says that Discord, Telegram, Notifiarr and
your mail provider can read the text, while the Mantel app's alerts are sealed.

### The Mantel apps: system alerts on the phone, the iPad and the Mac

- **Who gets them.** Owners and Admins who turn on **System Alerts** in Mantel Settings → Me, a per-person switch,
  on by default for the Owner. A system alert goes to that person's targets through `Pusher.deliver`, with a new
  recipients rule beside today's "may see the accessory".
- **What's sent.** Today's `Message` with `category: "system"`. The tag is `system:<kind>:<key>`, so "back"
  replaces "lost" through the collapse id. Critical is `time-sensitive`; Info is `passive`. The extension groups
  them under one System thread, apart from the doorbell and leaks.
- **iPhone and iPad.** A small app change: the Notification Service Extension reads `category` and sets the thread
  and interruption level. It ships in the next TestFlight build.
- **The Mac.** Not wired today: `PushRegistrar` in `MantelMacApp.swift` is a stub ("Notifications on the Mac are
  optional (§9) and not wired yet"). It needs:
  - remote-notification registration;
  - the push entitlement in the Mac app's profile (Developer ID or App Store, whichever it ships as);
  - a Notification Service Extension for the Mac that opens the sealed `"m"` the way the iPhone's does (MantelKit
    already has `SealedNotification.swift`);
  - registration at `/api/app/push/register` like the phone.
- **Web Push and the Companion app** take system alerts the same way. The Companion app's go through Home
  Assistant, so they can't carry `ha.lost`. The page says so.

### The update check (`mantel_server/alerts/updates.py`)

- **What it checks.** Once a day at a random minute, plus once 10 minutes after a start, Mantel asks GitHub for the
  latest release of each product:
  - `jazzphone/mantel`, compared with `about.release()`;
  - Mantel Link (`jazzphone/mantel-link`) and HK Frontend (`jazzphone/hk-frontend`), compared with the versions About
    already reads from Home Assistant, when they're installed.

  The call is `GET https://api.github.com/repos/<repo>/releases/latest`: no token, a `User-Agent: Mantel`, nothing
  about the house. Three calls a day is far under GitHub's 60 an hour without a token. Drafts and pre-releases are
  ignored.
- **What it shows.** Mantel Settings → About gets "Mantel 0.1.115 is available", the release's date, a link to its
  notes, and **how to update this install**:
  - HA App: Settings → Add-ons → Mantel → Update. Home Assistant shows it too.
  - LXC: run `update` in the container's console.
  - Docker: `docker compose pull && docker compose up -d`.
  - Mantel Link and HK Frontend: through HACS.
- **The alert.** `update.<product>` is raised once per new version, not every day, and cleared when About reads the
  new version. It goes to the channels that have Updates turned on.
- **The switch.** Settings → About → **Check for Updates**, on by default (decision 6). Off means Mantel never
  calls GitHub. When the check fails, About says "Couldn't check (date)" and nothing is raised: an offline house
  isn't an alert.
- **Not covered:** the iPhone and Mac apps. TestFlight and the App Store tell people themselves.

### Mantel Settings → Alerts (`web/shim/settings/alerts.js`)

Built with the settings kit (`kit.js`) like Connections and Backups:

- **Channels.** A list with a status dot, the type, the name and "last sent 2 h ago" or the last error. **Add
  Channel** opens a sheet that asks for the type, then that type's fields.
- **A channel's page.**
  - Name and the switch.
  - **Events** by group (Connections, Backups, Tablets, Mantel, Updates, Security), each kind a switch with its
    default.
  - **Minimum level.**
  - **Quiet Hours.**
  - **Send Test**: a real message, with the server's answer on failure ("Discord said 401: the webhook was
    deleted").
  - **Delete.**
- **Mantel Apps.** Who gets system alerts now, and a link to Me.
- **History.** The log, newest first, filterable by group.
- **Advanced.** The holds per group, and Apprise.

### The API, roles and audit

- **Endpoints:**
  - `GET/POST /api/alerts/channels`
  - `PUT/DELETE /api/alerts/channels/{id}`
  - `POST …/{id}/test`
  - `POST /api/alerts/telegram/chats` (a token in, the chats it sees out; nothing saved)
  - `GET /api/alerts/log`
  - `GET /api/updates`
- **Roles.** Owner and Admin read; only the Owner changes a channel, as with Connections. On the `tunnel` door
  that takes a fresh factor (`step_up_required`). Never from a wall tablet. CSRF as every `/api/` write.
- **Audit.** Every change is audited before it applies (kind `config`, `alerts.channel.saved|deleted|tested`, with
  the type and name, never the secret). If the audit can't be written, nothing changes.
- **Storage.** A migration (`00NN_alerts.sql`, the next free number when built):
  - `alert_channels`: id, kind, name, enabled, events, min_level, quiet, sealed, created, last_ok, last_error,
    fails;
  - `alert_log`: at, kind, key, level, up, title, body, sent_to;
  - a `system_alerts` key in `user_data` for the Me switch.

  The channels ride in every backup. A restore with a different at-rest key leaves them saved but unusable, and
  the page asks for the secret again.
- **MCP** (phase 12). Read-only `alerts_recent` and `updates_status` tools. A `alerts_test` tool counts as a change
  under the MCP's rules.

## Slices

| Slice | What | Size | Needs |
|---|---|---|---|
| 14.0 | The catalog and the center (holds, flapping, causes, batching, quiet hours, the log); sources: HA, MA, backups, tablets, `mantel.started/crashed` | M | |
| 14.1 | Discord, the Settings → Alerts page, sealed secrets, Send Test, the API, roles and audit | M | 14.0 |
| 14.2 | The update check: About, the three repos, the alert | S | 14.0 (About alone works without it) |
| 14.3 | System alerts in the apps: the recipients rule, the Me switch, `category: "system"`, the iPhone extension change | S server + S app | 14.0; a TestFlight build |
| 14.4 | Telegram (with Find My Chat) and Notifiarr | S | 14.1 |
| 14.5 | Email (SMTP) | S–M | 14.1 |
| 14.6 | Apprise as the optional extra; in the images per decision 3 | S | 14.1 |
| 14.7 | More sources: `disk.low`, `token.expiring`, `push.failing`, `link.lost`, Security; the heartbeat URL | M | 14.0 |
| 14.8 | Notifications on the Mac app: registration, entitlement, extension | M | 14.3; the Mac app's signing |
| 14.9 | Protect's alerts | S | phase 13's connector |
| 14.10 | The guide (`docs/guide/Alerts.md`, Updates in About's page), screenshots, the MCP tools | S | all |

**The first release:** 14.0, 14.1 and 14.2 together: Discord with the main alerts and the update check. Every
later slice adds a channel or sources without changing what's already there.

**Tests:**

- `tests/test_alerts_center.py`, on the center's clock: holds, flapping, causes, batching, quiet hours and the
  start grace.
- `tests/test_alerts_channels.py`, each sender through an injected transport:
  - payload shape;
  - mentions and HTML escaped;
  - 429 and retry;
  - host checks at save and send;
  - secrets never in a response, log or audit row.
- `tests/test_alerts_api.py`: roles, step-up, audit-first and CSRF.
- `tests/test_updates.py`: version compare, pre-releases ignored, once per version, the switch off means no call.
- Run with `tools/ci.py` (quick while building, full before pushing).

## Decisions for the owner

| # | Question | Recommendation |
|---|---|---|
| 1 | Call it **Alerts**, as its own page in Mantel Settings, beside Connections and Backups? | Yes. "Notifications" stays the accessories' word. |
| 2 | Who gets system alerts in the apps: Owners and Admins who turn it on, on by default for the Owner? | Yes |
| 3 | Apprise: built into the LXC and Docker images, an optional extra for the HA App, or left out? | Built into all three: a few MB of pure Python, and the page keeps it under Advanced |
| 4 | "Backup finished" off by default (a daily message), with a failure or a stale backup always on? | Yes. Turn it on per channel if you want it. |
| 5 | The holds: 2 minutes for Home Assistant, 5 for the others? | Yes, adjustable under Advanced |
| 6 | The update check on by default (one GitHub call a day per product, nothing about the house sent)? | Yes, with the switch in About |
| 7 | Critical alerts break through quiet hours? | Yes |
| 8 | The heartbeat URL for "Mantel is down", in 14.7? | Yes: it's the only way to hear about Mantel itself |
| 9 | The Mac app's notifications (14.8) in this phase, or after the Mac app's distribution is settled? | In this phase, after 14.3, if the Mac app's profile can take the push entitlement |

## Sources

- Discord webhooks (`allowed_mentions`, rate limits): <https://docs.discord.com/developers/platform/webhooks>
- Telegram Bot API (`sendMessage`, `getUpdates`): <https://core.telegram.org/bots/api>
- Notifiarr through Apprise (global API key, numeric Discord channel ID, one mention per payload):
  <https://github.com/caronc/apprise/wiki/Notify_notifiarr>. Apprise's sender posts to
  `notifiarr.com/api/v1/notification/apprise` with `X-api-Key`:
  <https://github.com/caronc/apprise/blob/master/apprise/plugins/notifiarr.py>
- Apprise URLs: <https://github.com/caronc/apprise/wiki/URLBasics>
- GitHub's latest release: <https://docs.github.com/en/rest/releases/releases#get-the-latest-release>

## Build log

(empty)
