# Wall-tablet kiosk apps, direct: Kiosk Satellite and Fully Kiosk (design, 2026-10-19)

**Status: design agreed with Avery (his answers, 2026-10-19, are in section 10). Slice 1 is built** (section 11):
pairing and status for Kiosk Satellite and Fully, with no commands. It is on branch `kiosk-direct`, tested against
fake tablets only, not merged and not in an App release. Nothing was sent to a real tablet, and the only thing run
against the house was the read-only reach check in section 7.

The ask: put Kiosk Satellite and Fully Kiosk Browser support into Mantel, added to Connections, so that Mantel
talks to the tablets itself instead of through Home Assistant.

## 1. Recommendation, in short

1. **Kiosk Satellite first.** All five of the house's tablets run it, it is the only app Sleep Screen drives, and its
   remote API is a better fit than Fully's. It has a REST and WebSocket API on the tablet at `:2324`. Mantel
   trades the admin password once for a long-lived token, so no password is kept. Its WebSocket pushes the
   screen and screensaver state, so there is nothing to poll.
2. **Fully later, on the same plumbing, and only if needed.** Fully's API is plain GET with the password in the
   query string, its state has to be polled, and it needs a **Fully PLUS** licence, which the house does not have.
   The client is prototyped here.
3. **One entry per HK tablet. It is set up on the tablet's own page (Mantel Settings → Wall Tablets → the
   tablet → Direct Connection), and Connections → Wall Tablets lists every tablet's entry.** Each entry has the
   tablet's app, its address and its secret. The secret is sealed like the Music Assistant token, tested before saving, never shown again and
   never logged. Saving a connection gives Mantel **status only**. Commands are a second, separate switch on the
   tablet: "Mantel sends commands itself".
4. **Commands go through the command gateway as a new audit kind, `tablet`.** They are checked against roles,
   they need `commands_enabled`, the audit row is written first, and the command list is closed. The Sleep engine
   uses this path as the `mantel:features` Service actor, and Owners and Admins use it from the tablet's page.
   Mantel decides only what Sleep Screen already decides today. The direct path removes the HA hop; it adds no
   new logic.
5. **The black screen stays in the page.** `set_black_screen` in `hk` mode is already HA-free on the tablet side:
   the page covers itself and lowers the backlight through `window.kioskSatellite.setBrightness`. Direct commands
   are only the fallback, for `kiosk` mode and for the backlight backstop.
6. **Coexistence is per tablet, and reversible.** HK in HA keeps working unchanged. A tablet uses the direct path
   only if three things are all true: Mantel owns it (linked ownership), its Sleep Screen is Decided By HK in
   Mantel, and "Mantel sends commands itself" is on. Turning that switch off puts the tablet back on HA's
   entities, with nothing to change on the tablet.

Build it in four slices (section 9). Slice 1 has no commands at all, so it can ship while the house runs with
commands on.

## 2. What exists today

**Kiosk Satellite** (`me.jxl.kiosk_satellite`, github.com/jxlarrea/kiosk-satellite, CC BY-NC-ND) is a third-party
app, not HK's own. It talks to HA in two ways:

- **ESPHome entities.** HA finds it as an ESPHome device on `:6053`. HK finds the tablet's parts by the endings of
  their entity ids, in `hk_core/tablets/kiosk.py` `PARTS` and `hk_core/sleep/engine.py` `KIOSK_PARTS`:
  - `light.*_screen` (on/off and brightness 0–255);
  - `switch.*_screensaver` (enabled) and `switch.*_screensaver_active` (showing);
  - `select.*_screensaver_mode` (set to "Black") and `number.*_screensaver_timeout` (one day);
  - `button.*_bring_to_front`, `_reload_page`, `_clear_cache`, `_restart_app`, `_restart_device`;
  - sensors `_foreground_app`, `_last_interaction`, `_ipv4_address`, `_battery` and others.
- **A JavaScript API in its WebView.** HK's page calls `window.kioskSatellite.setBrightness` and `getBrightness`,
  and listens for `kiosksatellite:screen*` and `screensaver*` events (`web/hk/modules/hk-saver.js`).

**Fully Kiosk** is reached only through HA's `fully_kiosk` entities, `PARTS["fully"]`:
- `switch.*_screen` and `number.*_screen_brightness`;
- buttons for reload, clear cache, restart and bring to foreground;
- status sensors.

HK has never called Fully's REST API or any `fully_kiosk.*` service. Sleep Screen cannot drive a Fully tablet:
`sleep.kiosk` is set only for Kiosk Satellite (`hk_core/settings/model.py`). For Fully, HK offers status,
brightness, reload and restart.

**`hk_frontend.set_black_screen`** is an entity service on `switch.<tablet>_black_screen` that takes `black` and
`brightness` (0–255). It changes HK's per-tablet state only (`hk_core/screensaver/black.py`). The tablet's own
page does the rest: it draws the curtain, sets the backlight to 0 through the JS API, and reports `confirmed`.
In Mantel, `features.set_black` does the same for Mantel's screens, and linked mode forwards HA's calls to it.

**Sleep Screen**, `hk_core/sleep`, makes the decisions. It runs in HA (`sleep_engine.py`) and in Mantel
(`features.MantelSleep`).
- Sleep:
  1. photos on;
  2. HK black, waiting up to 4 s for `confirmed`;
  3. if black is not confirmed: Kiosk Satellite screensaver mode Black, the screensaver switches on, and the
     backlight set;
  4. optionally, the screen off.
- Wake:
  1. the screen on at the target brightness;
  2. black off;
  3. the screensaver off;
  4. the backlight backstop;
  5. bring to front.
- Loop guard: 6 actions a minute.
- In Mantel every call goes through `MantelHouse.call_service`, so through the gateway, as `mantel:features`. With
  commands off it records `would`.

**Mantel already has:**
- enrolled devices, each with a room and a default screen;
- `ha_tablet_links` (an HA user that is a tablet);
- linked ownership per tablet;
- `TabletWatch`, for alerts and the scheduled restart;
- `screen_report`;
- Connections (`connections.py`). Its pattern is the one to follow: test live, seal with `atrest.SecretBox`, audit
  first, Owner only, never echo the secret.

## 3. Connections: one entry per tablet

**Where the password goes (Avery: "either on the Wall Tablet screens or in the Connection screen").** It goes in
both places, as one entry:
- **The tablet's own page in Mantel Settings** (Wall Tablets → the tablet) gets a **Direct Connection** group with
  the address, the password field and Test & Save. That is where the tablet's app, device, room and Sleep Screen
  already are.
- **Connections → Wall Tablets** lists every tablet's entry with its status, and each row opens that page.
- The group shows only when Mantel hosts the shared panel. HK Settings inside Home Assistant never shows it
  (decision 27: HK on its own shows nothing of Mantel's).

The entry is keyed by the **HK tablet**: the tablet id from HK's settings, which the Sleep engine, `tablet_items`
and `?hk_tablet=` already use. Each row also names the Mantel
device that matches it (by Tablet User or room, as `ingress.tablet_start` does). Keying by Mantel device instead
would break for a tablet that comes through HA's sidebar. Merging Devices with Wall Tablets is already an open
Phase 8 item, and this row is where that merge would land.

Each row shows:
- the app (Kiosk Satellite or Fully, from HK's `tablet.app`);
- the address;
- **Connected as** (the tablet's own name, model and app version from the test) and since when;
- the live state (screen, brightness, screensaver, page, battery);
- **Mantel sends commands itself** (off by default);
- Replace and Disconnect.

| | Kiosk Satellite | Fully Kiosk |
|---|---|---|
| Address | `http://<ip>:2324` (port configurable on the tablet) | `http://<ip>:2323` |
| What the Owner types | the tablet's Remote Administration password, **once** | the Remote Admin password |
| What Mantel keeps | a token from `POST /api/login {password, ttl_days: 3650}` (ten years, Avery's choice); the password is used for that one exchange, as MA's sign-in is | the password itself (Fully has no tokens) |
| Test before saving | `GET /api/info` with the token, then `GET /api/commands` to check that every command Mantel needs exists in this app version | `cmd=deviceInfo` (`fully.test`) |
| Sealed as | `<data_dir>/connections/tablet-<tid>.connection`, associated data `connection:tablet:<tid>`, in encrypted backups | same |
| Expires | in ten years; the date is shown, and a token the tablet refuses means re-pairing | never |

The rules are those of `connections.py`, pinned the same way by tests:
- The secret is accepted from the page once and tested live.
- It is never in a response, a log line, an audit row, a `repr` or an exception's text or chain.
- Only an Owner changes a connection. Owners and Admins see the status (not from a wall tablet).
- Every change is audited first (`config`, `connection.tablet.<tid>.saved|disconnected`, with the address and the
  tablet's name, never the secret). If the audit row cannot be written, nothing changes.
- The address must be on the home network: an IP literal must be private, with no path, query or user info
  (`fully.clean_address`).

**What the person has to know**, shown on the page:
- **Kiosk Satellite:** its tokens are stateless. Changing the tablet's admin password does not revoke a token
  Mantel already holds. Disconnect deletes Mantel's copy only. To cut a token off for good, use Kiosk Satellite's
  own reset.
- **Fully:** the REST API needs a **Fully PLUS** licence, and Remote Administration must be on with "from local
  network" allowed.

## 4. Discovery and pairing

- **Kiosk Satellite can pair with Mantel directly.** The login above is the whole of it. No HA, no ESPHome and no
  app change are needed.
- **mDNS discovery (`_kiosk-satellite._tcp`) is not available from the App.** The App runs on the Supervisor's
  bridge network, and multicast does not cross it. Turning on `host_network` for this would also change what
  Ingress and the port rules rely on, so it is not proposed.
- **Mantel fills in the address from what it already knows:**
  - Kiosk Satellite's own `sensor.<kiosk>_ipv4_address`, already in Mantel's state copy while HA is connected.
    All five house tablets report one (`sensor.{kitchen,living_room,loft,master_bathroom,master_bedroom}_kiosk_ipv4_address`,
    all on `192.0.2.x`, read 2026-10-19);
  - else the matching Mantel device's last source IP, when the tablet opens Mantel at the direct address (behind
    NPM this is the real tablet only if NPM passes the client address and is trusted);
  - else the Owner types it.
- **Fully:** the same source IP, or typed. HA's integration finds Fully by DHCP; Mantel does not need to.
- **Optional, later: Kiosk Satellite over HTTPS with its certificate pinned.** At pairing Mantel reads the
  `tlsCertificate` command's SHA-256 and pins it (trust on first use). Kiosk Satellite's generated certificate is
  self-signed, so normal checking cannot be used. Plain HTTP on the house's tablet network is the starting point,
  the same as HA's ESPHome link today.

## 5. Commands: what Mantel sends

There is a closed list of verbs, each translated per app. Nothing else can be sent. In particular, none of these:
- Kiosk Satellite: settings import or export, files, APK upload, `launchApp`, `tts`, the camera, screenshots;
- Fully: `injectJavascript`, other settings, `startApplication`, the camera, reboot (for now).

| Verb | Kiosk Satellite (`POST /api/commands/<name>`) | Fully (`GET /?cmd=`) | Who uses it |
|---|---|---|---|
| `screen_on` / `screen_off` | `screenOn` / `screenOff` | `screenOn` / `screenOff` | Sleep (wake, dark display off) |
| `brightness {level 0–255}` | `setBrightness {level: round(level/2.55)}` (percent) | `setStringSetting screenBrightness` | Sleep (target, backstop), linked backlight |
| `screensaver_on` / `_off` | `startScreensaver` / `stopScreensaver` | `startScreensaver` / `stopScreensaver` | Sleep (kiosk-mode black) |
| `saver_black` | `PATCH /api/settings` screensaver mode Black, timeout one day (HK's `kiosk_saver` fix) | not applicable | Setup Check fix, Sleep |
| `to_front` | `bringToFront` | `toForeground` | Sleep (wake) |
| `load_url {url}` | `loadUrl` | `loadUrl` | the tablet's start screen, after a default-screen change; Mantel's own addresses only |
| `reload` | `reload` | `loadStartUrl` | the tablet page, TabletWatch |
| `restart_app` | `restartApp` | `restartApp` | the scheduled restart, the tablet page |

Notes on the table:
- **Brightness.** HK speaks 0–255 everywhere, and the client converts. `setBrightness` writes Kiosk Satellite's
  Default brightness. Before relying on it, check on a tablet that this is what its ESPHome `light.*_screen`
  does too.
- **Screensaver mode.** Its setting key is read from `GET /api/settings` at pairing, not hard-coded.
- **Wake on motion.** Mantel does not watch cameras. The tablet's own screensaver motion detection, in either
  app, keeps waking the tablet locally. Mantel's Sleep Screen keeps reading the presence sensors it is given.
- **Wake on the doorbell.** This path already exists: a notification that Wakes the Screen, or Wake For / Hold
  While on the doorbell, leads to the Sleep engine's wake. The direct path only removes the HA hop, so the screen
  lights about one round trip sooner.

**State.**
- Kiosk Satellite: one WebSocket per tablet (`/api/ws`, its `state` snapshot plus `events`) gives the screen,
  brightness, screensaver and current page as pushes.
- Fully: `deviceInfo` is polled every 30 s (HA's interval) while the tablet is Mantel-controlled, and once after
  each command.
- Slice 3 lays these over the kiosk part entity ids in `MantelHouse.state()` for direct tablets, so the Sleep
  engine's waits and `trusted()` check run unchanged and keep working when HA is down.

## 6. Who may trigger, and safety

- **A house command class.** The gateway gets a new kind, `tablet`. The audit table's `kind` CHECK means a 0015
  migration that rebuilds `action_audit` the way 0008 did. The action is `tablet.<verb>` and the target is
  `["tablet:<tid>"]`. As for every command, the audit row comes first and a failed insert refuses. The result is
  written once, and the data is never stored.
- **`commands_enabled` is required.** The house runs with it on, so the per-tablet **Mantel sends commands
  itself** switch (off by default, Owner only, audited) is the real gate. A connection without it is status only.
- **Who may send what:**

  | Actor | What it may do |
  |---|---|
  | `mantel:features` (Sleep, linked backlight, TabletWatch) | computed grants on exactly the direct tablets it acts for, as today's per-entity grants are |
  | Owner, Admin | from the tablet's page: Wake, Sleep, Reload, Restart app; on any door (decision 25: roles decide, no step-up) |
  | Other roles | nothing by default; Roles & Grants can grant `control` on `tablet:<tid>`; an explicit deny wins |
  | A wall tablet device | sends no tablet commands; it reports through `screen_report`, and its page drives its own backlight through the JS API |

- **Throttling.** One call at a time per tablet (the client's lock), each with a 10 s timeout. A per-tablet
  ceiling of 20 commands a minute sits above the Sleep engine's 6-a-minute loop guard and records `throttled`.
- **`load_url`** accepts only Mantel's own origins (`public_url` and the direct address), so a stored grant cannot
  send a tablet to some other site.
- **Tests and e2e** run only against fakes. The scratch HA stays at 127.0.0.1:8124 and nothing points at
  192.0.2.53 or a real tablet.
- **Fully's password travels in plain text.** Fully takes it in the query string over plain HTTP, exactly as HA's
  integration sends it today. Anything on the path that logs URLs sees it (the fake's own access log shows it in
  the tests). Mantel logs no URL. HA's library, `python-fullykiosk`, logs the parameters at debug level; Mantel's
  client does not.

## 7. Reach from the App

The house:
- HA is `192.0.2.53`, on the same `192.0.2.x` network as the tablets (also the HDHomeRun at
  `192.0.2.126` and NPM at `.254`).
- The App is not on the host network. Its traffic leaves through Docker's NAT on the HA host, so it should reach
  the tablets' `:2324` and `:2323` directly on that network, with no UniFi rule involved.

**Checked 2026-10-19, with Avery's OK, read-only, against one tablet.**
- `switch.kitchen_kiosk_remote_management` is on in HA, so the Kitchen tablet's API is running.
- `GET http://192.0.2.168:2324/api/health`, the one endpoint that needs no token and serves only hardware
  facts, answered **HTTP 200 in 0.04 s**: "Kitchen Kiosk", a Google Pixel Tablet on Android 17, Kiosk Satellite
  **2026.10.6**, on Wi-Fi, over plain HTTP. It reported the screen on and brightness 0.0 (a 0–1 fraction here),
  which looks like HK's black was up.
- **That request came from Avery's Mac on `192.168.2.x`, through the router**, not from the App. So it shows that
  the tablet's API answers and that the house's firewall lets the Mac's network reach the tablets. It does not yet
  show the App's own path.
- **Still to check: the App's own path** (the HA host's NAT onto its own `192.0.2.x` network, so it should be
  the easier path). Run the same read-only GET from HA's Terminal App, which sits on the same bridge network, or
  build it into slice 1 as a Setup Check line ("Wall tablets: reachable"), run only for tablets with a saved
  connection.
- For Fully, the same check would be a plain `GET http://<tablet>:2323/`, which answers the login page and runs no
  command.

**LXC or compose installs on the planned DMZ VLAN (PLAN §7)** need `Mantel → tablets :2324/:2323` added to the
egress allow-list. That is the only firewall change.

## 8. Coexistence

- **HK in HA is unchanged.** HA's ESPHome and `fully_kiosk` integrations, the tablets' entities, HA's Sleep
  engine and the house's automations keep working exactly as now. Kiosk Satellite's ESPHome link stays on, which
  CUTOVER.md already assumes. It is also how HA keeps its entities, and the way back.
- **One driver per tablet.** Linked ownership already says which host drives a tablet: HA's engines leave a
  Mantel-owned tablet alone, and Mantel never drives an HA-owned one. The direct path adds a third state for a
  Mantel-owned tablet:

  | | Who decides | How commands travel |
  |---|---|---|
  | HA owns | HA's HK | HA |
  | Mantel owns (today) | Mantel | the gateway → HA's entities |
  | Mantel owns, direct | Mantel | the gateway → the tablet |

  Going back is one switch.
- **House automations that drive a tablet still work.** For example, an automation that turns a tablet's
  `light.*_screen` off. That one can race Mantel, as it can race HA's engine today. Sleep Screen's
  `by_hand` / hand-wake rules read it as before, but only while HA is up.
- **`sensor.tv_viewers` for HA-owned tablets.** HA's sensor, and the template binary sensor in Keep Awake While
  (Sleep-Screen.md), stay as they are.
- **`sensor.tv_viewers` for Mantel-owned tablets** (slice 4). Mantel serves Live TV itself and knows its viewers
  (`live_tv.py`, mirrored to HA as `sensor.tv_viewers`). So Sleep Screen gets a built-in Keep Awake While input,
  "Live TV is playing on this tablet", fed from Mantel's own viewer list. It needs no template sensor in HA.
- **Stay-awake.** HK's `keepAwake` keeps the page's socket connected, so it is not a screen wake lock. It is not
  affected. Kiosk Satellite's "Keep screen on" should stay on: Mantel turns the screen off explicitly, never by
  letting Android time out.
- **The black screen** keeps HK's handshake in the page (section 1, item 5). Fully tablets can get the same
  in-page backlight later, through `window.fully.setScreenBrightness`, with no server command.

## 9. Slices

| # | What | Commands? |
|---|---|---|
| 1 | **Built (section 11).** Pairing on the tablet's page, the Wall Tablets list in Connections: test, seal, status, live state; Kiosk Satellite pairing; the Fully client wired in; Setup Check "reachable"; backups. | none |
| 2 | Gateway kind `tablet` (migration 0015); **Mantel sends commands itself**; Owner/Admin buttons on the tablet's page; TabletWatch's restart direct. | yes, opt-in per tablet |
| 3 | The Sleep engine on the direct path: kiosk part calls translated to verbs, and the tablet's pushed or polled state laid over the kiosk part entities. HA no longer needed for direct tablets. | yes |
| 4 | Sleep Screen for Fully tablets (hk_core: a kiosk that is not Kiosk Satellite); the built-in Live TV Keep Awake; optional Kiosk Satellite HTTPS with a pinned certificate. | yes |

Each slice ships behind its own switch. Every one is tested against fake tablets, and on a real tablet only with
Avery there.

## 10. Avery's answers (2026-10-19)

1. **Every tablet runs Kiosk Satellite.** Fully would need the PLUS licence. So Kiosk Satellite is the build, and
   Fully stays a prototype until a Fully tablet appears.
2. **The password can go "either on the Wall Tablet screens or in the Connection screen", and the plan makes
   sense.** It goes on the tablet's page, and Connections lists every tablet's entry (section 3).
3. **The read-only reach check: yes.** It was done against the Kitchen tablet (section 7). The App's own path is
   still to check.
4. **Kiosk Satellite's token: ten years** (`ttl_days: 3650`).
5. Remote Administration is already on, at least on the Kitchen tablet. Its password is Avery's, typed once on the
   tablet's page when slice 1 is built.

## 11. Slice 1, as built (2026-10-19)

**Where it is**
- On the tablet's own page in Mantel Settings (Wall Tablets → the tablet), after Setup, a **Direct Connection**
  group shows:
  - status, read live: "Connected", with the screen, brightness and battery;
  - the address;
  - **Paired As**: the tablet's own name, model and app version, when and by whom;
  - when the token expires (Kiosk Satellite);
  - the page it is showing.
- Below it is **Pair <the tablet>**: Address and Password with Test and Pair, or **Pair Again…** and **Disconnect…** once
  paired.
- **Connections** gets a **Wall Tablets** group: every Kiosk Satellite or Fully tablet, read live, each row opening
  that tablet's page.
- Owners pair; Admins see. A wall tablet, Adults, Children and Guests get nothing.
- The address is filled in from Kiosk Satellite's own `sensor.<kiosk>_ipv4_address` when HA has it.

**How the shared panel draws it.** The shared panel gained one generic host hook, `extend(where, c, ctx, panel)`.
It is documented at the top of `web/hk/panels/hk-settings.js`, and the panel calls it on a wall tablet's page with
`where: 'tablet'`. Home Assistant has no host, so nothing is drawn, read or said there. If a host throws, HK's page
is left whole (`test_settingshost.js`). Mantel's answer is in `web/shim/mantel-settings.js` (`drawDirect`,
`drawWallTablets`).

**Server**
- `tablet_links.py` holds the routes (`/api/connections/tablets`, `…/{id}`, `…/{id}/test`, `…/{id}/live`) and the
  sealed entries. They live in `<data_dir>/connections/tablet-<id>.connection`, sealed as connections.py seals HA's
  and MA's, so they are inside every encrypted backup. Every save and disconnect is audited first
  (`connection.tablet-<id>.saved|disconnected`).
- `connectors/kiosk_satellite.py` is a reads-only client: login, `/api/info`, `/api/commands`, `/api/health`.
  - It has no method that posts a command.
  - Test makes a token that lapses in a day, and drops it.
  - Pair makes the ten-year token.
  - The tablet's brightness (0–1) is shown as a percent, and the token's expiry is read from the token itself.
  - It says plainly when the password is wrong, when the tablet throttles (5 wrong passwords in 5 minutes), when
    a token is no longer accepted, and when something other than Kiosk Satellite answers.
- `connectors/fully.py` is wired in for Fully tablets. Its brightness (0–255) is now a percent; the first browser
  pass showed "180%", which is how that bug was caught.
- `connectors/kiosk.py` holds what both share: the home-network address check, the password check and
  `KioskFailed`.
- Setup Check gets a **Wall Tablets** line that reaches every paired tablet at once. For Kiosk Satellite it uses
  `/api/health`, which needs no token. When no tablet is paired there is no line.

**Tests**
- `tests/test_kiosk_satellite.py` and `tests/test_tablet_links.py`, against `tests/kiosk_satellite_fakes.py`, a fake
  built from the app's own server code. Among other things they pin:
  - roles;
  - test versus pair (the one-day versus the ten-year token);
  - sealing: neither the password nor the token is in the file;
  - no secret in any response, audit row or Mantel log line;
  - audit first;
  - a restart keeping the entry, and a damaged file reported;
  - a token the tablet refuses;
  - the Fully path;
  - Setup Check;
  - the address suggestion;
  - **no command ever posted to the tablet**.
- The one test seam is `connectors.kiosk.route`, which points a fictional address at a fake on loopback after the
  address was checked.

**Checked in a browser** on a local harness:
- the setup: Mantel from this branch, a fake HA, a fake Kiosk Satellite and a fake Fully, fictional tablets;
- pairing Kitchen with a wrong password, which was refused in plain words, then with the right one, which showed
  Connected with the screen, brightness, battery, Paired As and Token Expires;
- Connections → Wall Tablets showing it Connected;
- pairing Den (Fully);
- a phone-width pass, with no sideways scroll;
- Disconnect, through its confirmation.

No command reached either fake.

**Not done (slice 2 on):** commands, the live WebSocket from Kiosk Satellite (status is read when a page asks), the
App-side reach check on the house, and pairing a real tablet. Pairing a real tablet is Avery's to do: type the
Remote Administration password once on the tablet's page.

## Prototype: `connectors/fully.py`

- `FullyClient.of(http, address, password, allowed_origins)` builds a client. `info()` returns the trimmed
  `deviceInfo`. `send(verb, **args)` sends one of `COMMANDS`. `test(http, address, password)` is the Connections
  test.
- Failures come back as `KioskFailed(code, message)`, with codes `timeout`, `unreachable`, `not_fully`,
  `bad_password`, `refused`, `failed`, `address_invalid`, `address_not_home`, `password_missing` and
  `password_invalid`.
- An unknown verb or a bad value raises `ValueError` before anything is sent.
- The tests pin:
  - every command's exact Fully call and its effect;
  - the closed command list;
  - refusals before sending (an unknown verb, brightness out of range, a foreign or non-http page);
  - each failure in plain words;
  - the password never in a message, in Mantel's log, in an exception's chain or in a `repr`;
  - home-network addresses only.
- **Not done:** no Kiosk Satellite client yet, and nothing registered, stored, audited or shown.
