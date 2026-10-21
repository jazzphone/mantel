# HK Frontend and Mantel: two products (decision 29, 2026-10-21)

**Status (2026-10-21): settled by Avery. It revises decision 28 (docs/phase9/MANTEL-LINK.md) and replaces its M3.**

## The decision

Decision 28 made Mantel plus Mantel Link the one product and planned a final HK Frontend release that pointed to
Mantel (M3: "replaced and retired"). Avery (2026-10-21), after weighing it again:

> "Ok, yes I think we should keep both products alive! It seems like the shared code should make this easier, we
> just need to add notes about each product in both so there is understanding."

**Decision 29.** There are **two products**, built from this one repository:

| Product | What it is | Installed as |
|---|---|---|
| **HK Frontend** | HK inside Home Assistant: HK's dashboards, generated pages and cards on Home Assistant's own dashboards, HK Settings, and HK's features (Sleep Screen, screensaver, kiosk, pop-ups, notifications, music) running in Home Assistant | HACS, `jazzphone/hk-frontend` |
| **Mantel** + **Mantel Link** | HK's screens as their own server: accounts and roles, wall tablets that sign themselves in, the audit log, remote access, and screens with no Home Assistant page around them. Mantel Link is Home Assistant's side of it | The Mantel App, Docker or the LXC; Mantel Link from HACS |

A house installs either one, or both. With both, they run together as they already do:

- **The bridge:** one integration shows Mantel's entities in Home Assistant, never both. Mantel Link is
  recommended; a linked HK Frontend can hold it instead. The entity ids stay the same either way (the hand-over,
  docs/phase9/MANTEL-LINK.md 9.3).
- **Each wall tablet has one engine.** Mantel Settings → Connections → Home Assistant Link → Who Runs Each Wall
  Tablet: Mantel, or HK Frontend for a tablet that shows HK Frontend's dashboards. Never both on one tablet: two
  engines on one screen is how a tablet wakes in the night.
- **The house** (Seasonal Decorations, the Alarm PIN keypad, Live TV's sensors and channels): run by Mantel, or by
  HK Frontend, on the same page.
- **The settings** (as decided; since revised, see "One copy of the settings when linked" below): **separate.** HK Frontend keeps HK's settings in Home Assistant and Mantel keeps its own. Mantel's
  import from HK Frontend runs once, one way. A house that edits both sees them drift apart; a sync is not built
  and is not promised.

## What changes

- **No retirement.** HK Frontend gets no final release and no "HK Frontend is now Mantel" repair: `retire.py`, its
  test, `tools/publish/final/README.md` and `publish.py --final` are removed, and so is the scratch HA's
  `TESTHA_HK_FINAL`. Mantel's `tests/test_mantel_link.py::test_hk_frontend_has_no_retirement` keeps it that way.
- **Protocol 1 stays.** HK Frontend's linked mode (docs/phase5/LINKED-MODE.md) is a supported way to link, not old
  code waiting to be deleted. Mantel keeps answering protocol 1, and each release is tested with both linked.
- **Wording.** Mantel Settings' Home Assistant Link page, HK Frontend's Configure → Linked to Mantel, and the
  docs say the products run together, rather than "while a house moves" or "HK Frontend's successor". Removing HK
  Frontend (docs/phase9/NO-HK-FRONTEND.md) stays possible, as a choice and not the plan.
- **Notes in both products.** Each one has a page that explains both: Mantel's
  `docs/guide/HK-Frontend-and-Mantel.md`, HK Frontend's `docs/HK-Frontend-and-Mantel.md` (its wiki), and a short
  section in each README and in Mantel Link's.
- **HK Frontend releases again.** It is published from this repository as before
  (`hosts/ha/custom_components/hk_frontend/tools/publish/publish.py` into a clone of `jazzphone/hk-frontend`). Its
  next release, 1.10.0, is an ordinary feature release carrying the shared code since 1.9.0.

## What does not change

- Mantel Link is still Mantel's integration in Home Assistant (decision 28's M1, M2, M4 to M6 stand).
- The shared code stays shared: `web/hk` (the page code), `hk_core` (the features), with each host's thin shell
  (`hosts/ha/frontend/hk-ha-*.js`, `web/shim/mantel-*.js`). A feature lands in both products unless it needs what
  only one of them has. Decision 27's rule still holds: HK's build never names Mantel outside comments.
- What each product can do follows from where it runs. HK Frontend lives inside Home Assistant's page and keeps its
  limits (HA's frontend changes can break its kiosk, menu and view host). Mantel owns its whole page.

## One copy of the settings when linked (approved by Avery and built, 2026-10-21)

Avery approved the design below on 2026-10-21, with its three answers: HA's dashboards get the house's settings,
not each person's; the new grant is off by default and turned on during setup; features stay out of scope. It is
kept as proposed, followed by what was built ("As built").

### Proposed

Avery agreed in principle: when HK Frontend is linked, Mantel owns HK's settings. This is the design; nothing is
built until it is approved.

**Why now.** A linked HK Frontend whose house is Mantel's runs in *full* linked mode (`linked_mode.full`): nothing
local runs, "the settings are Mantel's". Yet `hk_frontend/settings/subscribe` is registered at domain level, so HK
Frontend's dashboards in Home Assistant are still answered from its own entry, frozen since the house moved. On a
house that runs both (the reference house today), HA's HK dashboards show stale settings.

### 1. The mirror (the read path)

- **A new linked frame**, `settings {version, payload}`, Mantel → HK Frontend, protocol 1 (a feature, `settings`, in
  HK Frontend's `X-Mantel-Link` header, so older HK Frontends are never sent it). Sent after `hello` and after every
  `publish()`. `payload` is Mantel's house feed, the shape HK's pages already read (`feed_payload` without a
  person's `look`/`sky`/`personal` overlay: HA's feed has always been the same for every user). `version` is a
  number made from the documents' versions, so a resend of the same thing is ignored.
- **Where HK Frontend keeps it:** a Store of its own, `hk_frontend.mantel_settings` (the last payload and its
  version), not its config entry. Writing the entry would run its update listener, migrations and subentry
  bookkeeping on every change; a Store is one file, written once per version.
- **Who reads it:** while linked with Mantel owning the settings, `hk_frontend/settings/subscribe` (and
  `hk_frontend/panel/get`, the HK Settings page's read) answer from the mirror, and resend on each new version.
  While Mantel can't be reached they keep answering from the last mirror: dashboards still draw; only saving waits.
- **Unlinking** keeps the last mirror as HK Frontend's own: a one-time conversion of the payload back into the entry
  (options `dashboard` and the `dashboard`/`tablet`/`popup`/`page`/`chip` subentries, the accessories Store), the
  reverse of Mantel's import (`docs_from_panel`). HK Frontend is then the editable owner again, with nothing lost.
- **First link:** the Owner picks once whose settings to keep. **Mantel's** (the default: the house has usually
  imported HK Frontend's already) or **HK Frontend's** (Mantel imports them again, a new version, with history).

### 2. Saves, as a person

- **A new linked frame,** `settings_write {id, ha_user, msg}`, HK Frontend → Mantel, for the save commands in
  `SETTINGS_SAVES` and `FEATURE_SAVES`; answered by `settings_result`. HK Frontend's own save handlers (panel.py,
  hiding.py, accessories.py, the features' settings_ws) forward instead of writing while linked. The new version
  then comes back as a `settings` frame, so HA's page and every dashboard see it.
- **The person:** Mantel maps `ha_user` (the HA user id of the connection that saved) to a person through
  `ha_links`, the same table Ingress and "Sign in with Home Assistant" use, and checks `configure` as that person
  (Owner and Admin by default). The audit row and the settings history say the person, "from Home Assistant".
- **Trust:** the linked Service credential is allowed to say which HA user is acting, as the Supervisor is for
  Ingress. That widens what the credential can do, so it needs its own grant on the Service account (`act for Home
  Assistant users`), off until the link is set up with it, and only for users linked in `ha_links`. A save from an
  unlinked HA user is refused in words: "Link your Home Assistant user to a person in Mantel to save settings."
  It can still read.

### 3. Setup that closes the gap

- **HK Frontend reports HA's users** (id, name, admin or not; never anything else) in a `report` frame, as Mantel
  Link already reports HK Frontend's state.
- **Mantel Settings → Connections → Home Assistant Link** gets "Who Saves from Home Assistant": each HA user, the
  person linked to them, and a picker for the rest (a JSON API for `ha_links`; today linking is only the Ingress
  form). Turning Linked to Mantel on in HK Frontend opens the same list.
- **A Repairs issue in HA** while an HA admin isn't linked to a person: "Some Home Assistant admins can't save HK
  settings", with the page to fix it.

### 4. Where each screen is drawn

- Screens are boards keyed by dashboard path in both products, so one screen can be drawn by Mantel, by HK Frontend
  in HA, or by both. HK Frontend **reports its HK dashboards** (the Lovelace dashboards using `custom:hk-dashboard`)
  in the same `report` frame.
- **Mantel Settings → Screens** says where each one is drawn ("Mantel", "Mantel · in Home Assistant's sidebar",
  "Home Assistant · HK Frontend") with an icon for each, and shows an HK Frontend screen only the options that work
  in HA (no Mantel-only kiosk, sleep or idle options).
- **In HA's sidebar,** the Webpage dashboards Mantel makes already default to `mdi:fireplace`. That becomes the rule
  (HK Frontend keeps its own icons), so a glance tells Mantel's screens from HK Frontend's.
- Creating an HK Frontend screen from Mantel ("New screen → where: Home Assistant") is later, not in this work.

### Order, tests

1. The mirror. 2. Saves and the person check. 3. The setup list and Repairs. 4. The screen markings. Each one has
its own tests on both sides; then the scratch HA proves it end to end: a linked HK Frontend's dashboard picks up a
change saved in Mantel; a save in HA's HK Settings reaches Mantel as the linked person and is refused for an
unlinked one; the dashboard still draws with Mantel stopped; unlinking leaves the settings in HK Frontend.

### Questions for Avery

- **HA's dashboards get the house's settings, not each person's** (no per-person look or sky in HA), as HK Frontend
  has always done. OK?
- **The new grant** (the linked credential may act for linked HA users), off by default and turned on during setup. OK?
- **Features stay Mantel's.** In full linked mode HK Frontend runs none of its feature engines in HA; this work
  changes only the settings. A linked HK Frontend dashboard's music, Live TV and the like are a separate question.

### As built (2026-10-21)

Where the build differs from the proposal, the build is what holds:

- **When Mantel owns the settings: while The House is "Run by Mantel"** (HK Frontend's full linked mode). The House
  switch is already the moment of handing over, so there is no separate first-link choice. Moving The House back
  to Home Assistant, or unlinking, hands the settings back (mirror.py), once.
- **Mantel** (`hosts/server/mantel_server/linked_settings.py`):
  - the `settings` frame (feature `settings` only) after hello and after every published change, coalesced;
    `payload` is `SettingsService.house_feed()` and `version` a digest of it; `setup` carries `{saves,
    unlinked_admins}`;
  - `settings_write`, answered as the person in `ha_links` (refused in words: `saves_off`, `not_linked`, RBAC's
    `forbidden`), with "Home Assistant" as the history's `source`;
  - the grant is the Service account scope `linked_saves`;
  - `GET/PUT /api/linked/ha-saves`: Saves from Home Assistant on or off, and each HA person's role. A person is
    linked by giving the HA user a role, as the Ingress People page does, with the same Owner rules. HA's users
    are read by Mantel's own connection (`ingress.HaDirectory`, made under the App or Mantel Connect), so HK
    Frontend never sends them;
  - HK Settings' screen list says where each screen is drawn (`where`: "Mantel", "Mantel · in Home Assistant's
    sidebar", "Mantel, and HK Frontend in Home Assistant"), from HK Frontend's `report {hk_dashboards}` and the
    sidebar dashboards as `ha_dashboards.py` last read them.
- **HK Frontend** (`linked_mode.py`, `mirror.py`):
  - the mirror (`hk_frontend.mantel_settings`, written at once when the link stops, so a reload never reads an
    older copy) answers `hk_frontend/settings/subscribe`;
  - the pages' settings saves (`linked_mode.SAVES`, kept equal to Mantel's `SETTINGS_SAVES` by a test) go to
    Mantel as `settings_write`, as the HA user who made them;
  - a Repairs issue (`mantel_admins_unlinked`) while saves are on and HA admins aren't linked;
  - its HK dashboards are reported on connect.
- **The HK Settings page stays off in Home Assistant** while Mantel runs the house, as before: settings are edited
  in Mantel Settings. The saves from HA are the ones HK's dashboards make (favorites, a calendar's color, an
  accessory's sheet). The features' saves aren't forwarded: their pages aren't in HA in full linked mode.
- **Not built:** creating an HK Frontend screen from Mantel ("New screen → where: Home Assistant"); a screen only
  HK Frontend has (no board in Mantel) isn't listed in Mantel's Screens.
- **Tests:**
  - Mantel's `tests/test_linked_settings.py`;
  - HK Frontend's `tests/py/test_linked_settings.py`;
  - the pinned link header in both hand-over suites;
  - the linked e2e (`tools/e2e/linked_e2e.py`, on the scratch HA): HA's feed is Mantel's and follows a change; a
    save from HA is refused while off and for an unlinked user, then made as the linked person and seen by HA's
    dashboards; moving The House back keeps Mantel's last settings in HK Frontend.


## Proposed: one place per screen, a clearer Home Assistant page, people in one list (for Avery's OK, 2026-10-21)

**Why.** Avery, looking at the result: the Screens list shows one row per screen, "Mantel, and HK Frontend in Home
Assistant", where two dashboards were expected; the Home Assistant Link page mixes switches that are always the
same; HA's people are listed apart from People, and tablet users exist both in Mantel and in HA. The cause: Mantel
imported HK Frontend's dashboards under their own addresses, so a Mantel screen and the old HA dashboard at the
same address are one screen with one set of settings. Avery (2026-10-21): "we can remove the tablet pages from Home
Assistant and keep them in Mantel. The Tesla and the Home Dashboards are the only ones that should be in
[Home Assistant] … rename the Mantel dashboard to Home-Mantel, because I use it for testing as well."

### Where the reference house ends up

| Screen | Drawn by | Address (key) | Notes |
|---|---|---|---|
| Home-Mantel | Mantel | `home-mantel` (new; was `dashboard-home`) | Mantel's Home, renamed; in HA's sidebar as today (`mantel-home`) |
| Kitchen, Living Room, Loft, Master Bathroom, Master Bedroom | Mantel | unchanged | the wall tablets' screens; their old HA dashboards are removed |
| Home | HK Frontend in HA | `dashboard-home` | HA's own, with its own settings (copied from Mantel's Home once) |
| Tesla | HK Frontend in HA | `dashboard-tesla` | HA's own; Mantel no longer draws it |

Each screen is drawn in **one** place. Settings stay one copy, in Mantel; an HA screen's settings are its own
entry in that copy.

### 1. Each screen says where it is drawn

- A screen's board gets `where`: `mantel` (default) or `ha`. Mantel serves only `mantel` screens; HK Frontend's
  dashboards in HA read `ha` ones through the mirror. Screens shows each with its own icon and label ("Mantel",
  "Mantel · in Home Assistant's sidebar", "Home Assistant"), and an HA screen shows only options that work in HA.
- **Add Screen** asks "Where: Mantel or Home Assistant" first. For Home Assistant, Mantel Link (or a linked HK
  Frontend) creates the generated dashboard in HA (`strategy: custom:hk-dashboard`), so nobody writes YAML.
- A screen at an address both have (today's case) is shown once with a warning and a choice: keep it Mantel's,
  make it Home Assistant's, or split it (Mantel's gets a new address, HA keeps this one, each starts with today's
  settings).

### 2. The reference house's screens (house changes, each with Avery's approval)

- **Split Home:** Mantel's becomes `home-mantel`, titled "Home-Mantel". Everything that names it moves with it
  (tablets, Default Screens, people's own start screen, the framed `mantel-home` dashboard's address in HA,
  favorites, history); the old address answers with a redirect. `dashboard-home` becomes an HA screen with a copy
  of today's settings.
- **Tesla:** `dashboard-tesla` becomes an HA screen. (Question: should Mantel keep a Tesla screen of its own too?)
- **Remove the old tablet dashboards from HA:** `dashboard-kitchen`, `dashboard-livingroom`, `dashboard-loft`,
  `dashboard-masterbathroom`, `hk-master-bedroom` (and HK Frontend's items for them). Their Lovelace files are
  copied to the Mac first. Mantel's screens of the same names are untouched.

### 3. The Home Assistant page

Renamed **Home Assistant** (was Home Assistant Link), grouped by product:

- **Mantel Link:** connected or not, its version; pairing.
- **HK Frontend** (only when it is installed): connected; "Settings: Mantel's" while Mantel runs the house;
  **Changes from Home Assistant: Saved / Refused** (today's Saves from Home Assistant), shown only then.
- **Wall Tablets:** who runs each (Mantel or HK Frontend).
- **Advanced** (collapsed): the bridge, and The House. Both are only changed during a move or to hand HK Frontend
  back its house; their words say so.

### 4. People in one list

- **People** shows each person's Home Assistant user, and links an HA user to an **existing** person (today's
  role-only link makes a separate Mantel account, so the same person can appear twice). Accounts made that way are
  offered a **Merge into…** an existing person (sessions, start screen and history kept, the extra account
  removed). The Home Assistant page's people list goes; it links to People.
- **Devices** shows a wall tablet's HA user beside it (the existing tablet link, `ha_tablet_links`), so HA's
  tablet users (kitchen, livingroom, …) are listed once, with their tablet. Since Mantel's tablets sign in with
  their own credential, those HA users are only needed if a tablet also opens HA; Devices says so, and deleting
  them stays Avery's step in HA.
- HA users that are neither (service accounts such as `mqtt-user`, `claude`, `Mantel`) go under "Other Home
  Assistant users", collapsed.

### Order

1. `where` on screens, Screens' labels, Add Screen's choice, the shared-address warning (tests, scratch HA).
2. The Home Assistant page regrouped and renamed.
3. People: link to an existing person, Merge, tablets' HA users in Devices.
4. The reference house, step by step with approval: split Home (Home-Mantel), Tesla to HA, remove the old tablet
   dashboards.

### Questions for Avery

- Does Mantel keep a Tesla screen too, or is Tesla only HA's?
- Master Bedroom's HA dashboard (`hk-master-bedroom`) is a tablet page: removed with the others?
- After the split, HA's Home starts as a copy of Mantel's Home: right, or start it from the defaults?
