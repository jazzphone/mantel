# Phase 9: Mantel Link replaces HK Frontend in Home Assistant (decision 28)

**Status (2026-10-19): being built on branch `claude/mantel-link-b012d1`, one slice at a time. Done: 9.1–9.9 (see "Build record" at the end). Nothing is on the house; 9.11 waits for Avery, step by step.**

## The decision

HK Frontend in Home Assistant had quietly become two things: HK's dashboards running *inside* HA, and Mantel's bridge
into HA (linked mode, docs/phase5/LINKED-MODE.md). Avery (2026-10-19):

> "HK Frontend and Mantel should work together with HK Frontend bridging the gap between HA and Mantel."
> "…what we can call Mantel Link to replace HK Frontend completely."
> "Container and Core users should be able to install Mantel Link through HACS to maintain the same functionality."
> "Build it all at once with a solid plan from start to finish."

Nothing in it may be specific to one house.

**Decision 28.** There is **one product**: **Mantel** (the server) plus **Mantel Link**, a Home Assistant integration
that connects HA and Mantel.
- **Mantel Link replaces HK Frontend completely.** HK Frontend gets a final HACS release that points to Mantel, and
  then it is retired. Its `hk_frontend.*` action names live on in Mantel Link, so nobody's automations break.
- **Mantel Link is installed from HACS on every HA install type** (OS, Supervised, Container, Core).
- **Mantel itself runs as:**
  - the HA App, on OS and Supervised;
  - Docker, or the Proxmox LXC, for Container and Core (packaging/compose, packaging/lxc);
  - or Docker anywhere, if an OS user prefers.
- **Setup is "Discovered: Mantel", one click, everywhere:**
  - from the App through the Supervisor;
  - from Docker/LXC through zeroconf, with a pairing code shown in Mantel Settings;
  - by hand as a fallback.

## The end state

| HA install | Mantel runs as | Mantel Link from | Setup |
|---|---|---|---|
| OS / Supervised | The Mantel App | HACS | "Discovered: Mantel" (Supervisor discovery, credential included), confirm once |
| Container / Core | Docker or LXC | HACS | "Discovered: Mantel" (zeroconf), confirm with the pairing code Mantel shows |
| Any | Anything | HACS | By hand: Mantel's address (https) and a pairing code, or a Service credential |

**What Mantel Link does** (the whole of HA's side; no screens of its own):

1. **The link:** one authenticated WebSocket to Mantel. Reconnects; plain `ws://` only to the App on HA's internal
   network.
2. **HA's entities for Mantel:** for every tablet, the four (photo screensaver, black screen, screen in use, sleep
   screen); for the house, Seasonal decorations, the Alarm PIN panel, and Live TV's viewers, now-on sensors and
   channel cameras. They keep the entity ids HK Frontend gave them (the registry migration, below).
3. **The actions:**
   - `mantel.set_black_screen`, `mantel.show_popup`, `mantel.close_popup` and `mantel.notify`;
   - the same actions under **`hk_frontend.*`** as permanent aliases;
   - the music, clean-areas and automation-snooze actions HK Frontend had, under both names too. Mantel runs them:
     its music engine, Clean Areas and the gateway;
   - HK's Python feature engines are not ported.
4. **Mantel's screens in HA's sidebar:**
   - the Webpage dashboards Mantel makes (Show in Home Assistant);
   - **kiosk on them** (HA's header and sidebar per the screen's "Home Assistant Header & Sidebar" setting);
   - a **way back** (messages accepted only from Mantel's own address).
5. **The Companion app:** Mantel's notifications delivered through `notify.mobile_app_*` to the lock screen, with the
   tap or action reported back to Mantel. Each person's phones are picked in Mantel Settings → People.
6. **Setup, diagnostics and repairs:** discovery flows (Supervisor and zeroconf), a manual flow, re-pairing, and
   diagnostics that never show a credential.

**What goes away with HK Frontend:**
- HK's Lovelace dashboards inside HA. A screen in HA is now Mantel's, shown through Mantel Link.
- HK Settings as an HA panel. It lives in Mantel Settings.
- HK's feature engines in HA's Python: music, Live TV transcode, energy, notifications, the sleep engine and the
  tablets watch. Mantel has its own (docs/phase4/MANTEL-FEATURES.md); anything still missing is in the parity list
  below and must be done before a house drops HK Frontend.

## Discovery and pairing

**From the App (OS / Supervised):**
- config.yaml gets `discovery: [mantel]` and `hassio_api: true`.
- At start the App posts a Supervisor discovery `{service: "mantel", config: {url, token}}`:
  - `url` is the App's own internal address (`http://local-mantel:8099`, or `<repo hash>-mantel`);
  - `token` is a `linked`-scope Service credential minted for HA, rotated whenever the App re-announces.
- HA hands the discovery to Mantel Link's `async_step_hassio`. HA's discovery is admin-only.
- HA re-discovers after Mantel Link's entry is removed. The App withdraws the discovery when it is uninstalled.

**From Docker / LXC (Container / Core):**
- Mantel advertises `_mantel._tcp` by zeroconf, with its `https://` address and a non-secret instance id. Mantel
  Link's manifest declares that type.
- The announcement is unauthenticated, so it carries **no credential**. Mantel Link's confirm step asks for the
  **pairing code** shown in Mantel Settings → Connections → Home Assistant:
  - one-time, ten minutes, as Mantel Connect's codes are (connect_pairing.py);
  - the code is exchanged over https for a Service credential.
- The instance id is the config entry's unique id, so a second announcement does not make a second entry.

**By hand:** Settings → Devices & Services → Add → Mantel Link, with Mantel's address and a pairing code, or a Service
credential.

## Moving a house from HK Frontend to Mantel Link (per house, reversible until the last step)

HA keeps an entity's id, history and customisations when its registry entry moves to another integration
(`entity_registry.async_update_entity_platform`; the entity must not be loaded at that moment). Unique ids are kept as
today's strings (`{old entry}_{uid}_{key}` etc.), so nothing on Mantel's side is renamed.

1. **Install Mantel Link** from HACS and confirm the discovery. It starts **dormant**: linked, publishing nothing,
   while HK Frontend's linked mode keeps the house as it is.
2. **Hand over the bridge.** An Owner does this once in Mantel Settings, and it is audited.
   1. Mantel tells HK Frontend over HK's link: "Mantel Link takes the bridge". HK writes `mantel_owners.bridge =
      "mantel_link"`, reloads, and stops mirroring and registering the bridged entities.
   2. Mantel Link migrates each bridged registry entry (`hk_frontend` → `mantel`: same unique id, its config entry,
      a Mantel Link device) and adds the entities. Same entity ids; history continues.
   3. While HK Frontend is loaded, `hk_frontend.*` stays HK's and forwards to Mantel through Mantel Link, so
      `set_black_screen` never has a gap.
3. **Move the rest of the house to Mantel** as the cutover does today (CUTOVER.md, per tablet, then `house`). Each
   tablet's entities move to Mantel Link as it moves.
4. **Remove HK Frontend.** This needs Avery's approval and an HA backup first.
   - Before: the parity list below is all checked for this house, and every tablet and `house` is Mantel's.
   - Uninstall HK Frontend; its leftover registry entries for moved entities are already Mantel Link's.
   - Mantel Link registers `hk_frontend.*` itself as soon as no `hk_frontend` entry is loaded. Scripts and
     automations keep working unchanged.
   - Claude can prepare a diff moving them to `mantel.*`. That is cosmetic and optional.

**Rollback:**
- Up to step 3, in Mantel Settings, "give the bridge back to HK Frontend": Mantel Link migrates the entries back
  (same unique ids) and unloads; HK clears `bridge` and reloads into today's linked mode.
- After step 4, reinstall HK Frontend from its last release and do the same. Its settings are still in Mantel and can
  be exported back (settings_store's HK format).

## HK Frontend's retirement (the public project)

- **Last feature release:** the hand-over hooks (`bridge`), "Linked to Mantel" in its Configure page, and A's
  discovery fill-in, so houses mid-move are covered.
- **Final release:** a repair in HA, "HK Frontend is now Mantel", with a link to the move guide. The README and HACS
  description point to Mantel and Mantel Link. Security fixes only after that; the repository is archived a few
  months later.
- **Users who never ran Mantel:**
  1. install Mantel (the App, or Docker for Container/Core);
  2. install Mantel Link;
  3. Mantel's one-time import of HK's settings brings their screens, tablets, pop-ups and chips across (exists today).

  The move guide walks this.

## Parity: what must exist in Mantel before a house drops HK Frontend

From docs/phase4/FEATURE-PARITY.md, checked per house; anything unchecked keeps HK Frontend installed there.
- Sleep Screen and the tablets' sleep and wake in Mantel. The Loft runs it since 2026-10-19. Prove it on every
  tablet, a real night each.
- Pop-ups (doorbell, alarm) from HA automations through `hk_frontend.show_popup` / `mantel.show_popup`.
- Music: Mantel's MA engine. The `music_*` actions are forwarded.
- Live TV: Mantel's transcode and go2rtc, the viewers sensor, and the channel cameras.
- Energy, Clean Areas, notifications (with the Companion relay), Alarm PIN: in Mantel.
- Automation snooze (`pause_automation` / `resume_automation`): through the gateway.
- The tablets watch (offline / charging alerts, scheduled restart): Mantel's `tablets` piece, and Kiosk Satellite
  direct (phase 8).

## Build order (one plan, landed in slices, each tested end to end)

| Slice | What | Done when |
|---|---|---|
| 9.1 | Mantel Link skeleton in its own folder of this repo (`hosts/ha/custom_components/mantel/`): manifest (name "Mantel Link", domain `mantel`, `config_flow`, HACS metadata), manual flow (address + Service credential), the link client shared with HK's (`mantel_link.py` has no HA imports), diagnostics; its own pytest suite on the HA test harness | Connects to a local Mantel; HK's and Mantel's linked tests still pass |
| 9.2 | Mirroring and actions: the entities, `mantel.*`, and `hk_frontend.*` while no HK entry is loaded; protocol 2 (`domain` in hello; Mantel accepts both domains: linked_house reads `platform in ("mantel", "hk_frontend")`) | Scratch HA without HK Frontend: a Mantel-owned tablet's four entities live; both action names reach Mantel |
| 9.3 | Hand-over and rollback: HK's `bridge`, the registry migration both ways, Mantel Settings button, audit; an interrupted migration completes or reverts on the next start | Scratch HA with HK linked: hand over and back, entity ids and history unchanged, a waiting Sleep script never fails |
| 9.4 | Pairing codes for Mantel Link (Mantel side, reusing connect_pairing), the manual flow with a code | A code made in Mantel Settings pairs a scratch HA |
| 9.5 | Discovery: the App's Supervisor announcement and its credential (config.yaml `discovery`, `hassio_api`), Mantel's zeroconf `_mantel._tcp`, `async_step_hassio` and `async_step_zeroconf` | Flows tested with HA's discovery test helpers; the App's announcement against a fake Supervisor; zeroconf on the scratch HA with a local Docker Mantel |
| 9.6 | Kiosk on Mantel's HA dashboards + the way back (Mantel's menu → postMessage, accepted only from Mantel's origin) | Scratch HA: a framed screen with HA's chrome hidden per the screen's setting, at phone and desktop widths; other origins ignored |
| 9.7 | Companion notifications relay (Mantel → `notify.mobile_app_*`, actions back), people's phones in Mantel Settings | Scratch HA with a fake mobile_app notify: delivered with actions; a tap reaches Mantel |
| 9.8 | Forwarded `music_*`, `clean_areas`, `pause/resume_automation` under both names | Each reaches Mantel's engine on the scratch HA; commands off → refused in words |
| 9.9 | Packaging and docs: Mantel Link's own public repository for HACS (decision M1), the App and Docker docs, the move guide, LINKED-MODE.md → MANTEL-LINK.md, CUTOVER.md step for the move | A fresh scratch HA set up from the docs alone, both an App-like and a Docker-like path |
| 9.10 | HK Frontend's last feature release (hand-over hooks) and, once the house is moved, its final pointer release | Its tests green; the repair shows in a scratch HA |
| 9.11 | The house: install Mantel Link, discovery, hand-over, the rest of the cutover, then removing HK Frontend (approval for each, a backup before each) | The Loft and then every tablet sleeps and wakes across it; a night each; Avery signs off |

**Tests that stay green throughout:**
- HK's `test_linked_*` and Mantel's `test_linked*`;
- the linked e2e (`tests/test_linked_e2e.py`, `tools/e2e/linked_e2e.py`, for both domains while both exist);
- the full validate.sh.

**New:** Mantel Link's suite, and an e2e that installs Mantel Link alone on the scratch HA.

## Decisions (Avery)

- **M1, where Mantel Link is published:** **a public HACS repository** (e.g. `jazzphone/mantel-link`), built from this
  repo the way hk-frontend is published today. Settled (2026-10-19): HACS on every install type.
- **M2, the `hk_frontend.*` names:** kept as permanent aliases in Mantel Link (recommended); a diff to `mantel.*` is
  optional.
- **M3, HK Frontend:** replaced and retired (settled, 2026-10-19).
- **M4, names:** product "Mantel Link", domain `mantel` (actions read `mantel.set_black_screen`), devices "Mantel",
  model "Wall Tablet". Entity ids unchanged. If Avery prefers the domain `mantel_link`, change it before 9.1; after,
  it is another migration.

- **M5, announcing Mantel from Docker/LXC (open, 2026-10-19):** multicast never leaves Docker's bridge networks, so
  zeroconf needs either a process on the host's network or the host's own avahi. Built: Mantel writes a non-secret
  `announce.json`; the **opt-in** `compose.announce.yaml` runs the announcer (same image, user 10001, no
  capabilities, read-only, only the data volume read-only) on the host network, the one service anywhere that
  `package_check.py` lets do so; or `python -m mantel_server.announce --avahi` prints a service file for the
  host's avahi. Without either, Mantel Link is added by hand (address + pairing code). Avery: keep the overlay
  opt-in (recommended), make it default, or avahi only?

- **M6, what goes to phones (open, 2026-10-19):** built as a per-person choice in Mantel Settings → People → Phones:
  **Important only** (the default), every notification, or nothing; a notification for some screens only
  (`dashboards`) never goes to a phone, one naming people (`users`) only to theirs. The only action is Dismiss
  (it takes the banner down on every screen). Avery: keep Important only as the default?

## Risks

- **Registry migration needs the entities unloaded.** The hand-over reloads HK first, then migrates; 9.3 tests an
  interrupted move.
- **Two integrations must never publish one unique id.** HK skips its bridge as soon as `bridge` is set, before its
  platforms load; Mantel Link adds nothing until its migration is done.
- **Discovery and credentials.**
  - The Supervisor path carries a credential: HA admin only, rotated on re-announce, revocable in Mantel Settings →
    Service Accounts.
  - The zeroconf path carries none: the pairing code is the proof, one-time and short-lived.
- **Kiosk with the sidebar hidden:** the way back must work on a phone before it ships.
- **Retiring a public project:** existing HACS users need a clear path. The final release's repair and the move guide
  are part of 9.10, not an afterthought.

## Build record (kept as slices land)

### Protocol 2 (built in 9.1)

- **Who is calling.** The HA side says so on the upgrade request: `X-Mantel-Link: domain=mantel; protocol=2;
  features=bridge`. No header (HK Frontend before its last release, e.g. the house's eabb70a) is HK Frontend,
  protocol 1, no features, answered exactly as before (`linked.parse_link_header`). A newer protocol than Mantel's
  is answered with Mantel's newest; the client then says "update Mantel" (`ProtocolMismatch`, config flow
  `mantel_too_old`).
- **hello** (protocol 2) adds `instance`: Mantel's instance id (32 hex, random, made once, kept in `linked_house`
  under `instance`; `LinkedOwners.instance_id`). It is Mantel Link's config entry's unique id: one Mantel, one
  entry. Never a secret.
- **owners** gains `bridge`: `hk_frontend` (default) or `mantel` (Mantel Link). Kept as the `linked_owners` row
  `bridge` (owner `ha` = HK Frontend, `mantel` = Mantel Link): no migration; not a tablet anywhere.
- **report** (client → Mantel, protocol 2 only): `{"hk_frontend": {installed, loaded, linked}}`, sent on connect
  and whenever HK Frontend's entry changes. Mantel keeps it on the client (Mantel Settings shows it; the
  hand-over reads it). A protocol 1 client sending it gets `bad_request`.
- Refusals name the action as the caller knows it (`mantel.x` / `hk_frontend.x`: `CallCtx.domain`).
- **One link client, two integrations.** `mantel_link.py` is the same file in `hk_frontend/` and `mantel/`
  (domain, protocol, features and extra frame types are arguments; the log names the package). Mantel Link's
  `test_link_shared.py` fails if the copies differ. It gained `probe()` (connect once, read hello) for setup forms.

### 9.1 Mantel Link skeleton: done

`hosts/ha/custom_components/mantel/`: manifest (name "Mantel Link", domain `mantel`, `config_flow`,
`single_config_entry`, `after_dependencies` hk_frontend / hassio / mobile_app), the manual flow (address +
Service credential, tested with `probe` before saving; the address rules are linked mode's: https anywhere, plain
http only to loopback or the App network by resolution), reconfigure (an empty credential keeps the saved one; a
different Mantel is refused), diagnostics (no credential). Its own suite: `tests/py/` (run with `tests/py/run`;
Mantel's `tests/test_mantel_link.py` runs it inside the full validation with `MANTEL_ROOT` and a staged HK
Frontend). `test_e2e_mantel.py` links it to the real `mantel_server/linked.py`.

### 9.2 Mirroring and actions: done

- `bridge.py`: the listener (the same frames as HK's linked mode), entities (`entity.py`: the same classes, so a
  mirrored entity behaves the same; devices "Mantel", model as Mantel says; the house device named "Mantel"),
  forwarding, and **dormancy**: Mantel Link mirrors only while it holds the bridge, or while this Home Assistant
  has no HK Frontend entry at all (`active_for`). A change of either reloads the entry.
- `services.py`: `mantel.show_popup` / `close_popup` / `notify` (domain actions, HK's schemas; notify answers),
  `mantel.set_black_screen` (entity action on Mantel Link's switches). The **aliases** `hk_frontend.*` are
  registered only for names HK Frontend does not answer right now (checked at start, and whenever HK Frontend's
  entry or services change); HK Frontend registering its own takes the name back. The alias
  `hk_frontend.set_black_screen` targets Mantel Link's switches (unknown targets skipped, as HA skips them). The
  aliases carry descriptions for HA's action editor.
- **A house that never had HK Frontend:** Mantel's unique ids start with its instance id
  (`features.entry_id` falls back to it) and suggested entity ids use `mantel_`, not `hk_frontend_`.
- **Mantel's pages** see Mantel Link's registry entries as platform `hk_frontend` (`registry.frontend_shapes`), so
  HK's Cameras page still leaves Live TV's channels out. (Decision 27's rule forbids the word in HK's build, so
  this is Mantel's side, not `hk-strategy.js`.)
- **Checks:** Mantel Link's suite (16, plus the e2e against the real endpoint); `tests/test_mantel_link_server.py`
  (5); **scratch HA without HK Frontend** (`tools/testha/testha.py up --fresh --no-hk`, which now installs
  Mantel Link beside HK, not set up; `tools/e2e/mantel_link_e2e.py`): **25/25**: added through HA's own flow,
  the Hall tablet's four entities live and Mantel Link's, `mantel.set_black_screen` and
  `hk_frontend.set_black_screen` each reach Mantel with the `confirmed` handshake, `show_popup` under both names
  reaches a Mantel screen, an unknown pop-up is Mantel's validation error named `hk_frontend.show_popup`, the
  Owner hands over the bridge (audited), no credential in diagnostics, no household service called.

### 9.3 Hand-over and rollback: done

**How it works (deviations from the plan above, and why):**
- **The side that takes an entity moves it** (the plan had Mantel Link move entries both ways). Mantel Link moves
  HK Frontend's entries to itself (`bridge.Bridge._place` / `take`), and HK Frontend's release moves Mantel Link's
  back to itself (`hk_frontend/handover.py` `guarded`: every HK platform's adder takes back what Mantel Link holds
  before adding). Each waits until the other has unloaded the entity (`entity_sources`), up to 120 s. Why: both
  integrations hear the same `owners` frame and reload on their own; if Mantel Link moved entries back while HK
  Frontend was already re-adding them, HK Frontend would mint `switch.hall_black_screen_2`. The taker waiting for
  the giver has no such race, needs no journal, and finishes an interrupted move at the next start by itself.
- **Devices.** HA 2026.9 keeps identifiers per config entry ("a device belongs to one integration"), so Mantel Link
  cannot join HK Frontend's device (the plan's idea). It makes its own device per tablet and carries over what the
  person set on HK Frontend's: area, the name they gave it, labels. The entity keeps its room. Back with HK
  Frontend, the entity returns to HK Frontend's own device, which kept its area.
- **HK Frontend must be its new release to hand over.** Mantel refuses the hand-over (`bridge_check`) unless Mantel
  Link is connected, every HK Frontend link says feature `bridge`, and, if Mantel Link reports HK Frontend in its
  Home Assistant, that HK Frontend is linked. Giving back needs HK Frontend linked with `bridge`. On the house
  this makes HK Frontend's last feature release (9.10) a prerequisite of the hand-over (9.11).
- **`hk_frontend.set_black_screen` while HK Frontend is loaded and Mantel Link holds the bridge:** HK Frontend
  registers it as a domain action that runs its own switches as before and sends Mantel Link's to
  `mantel.set_black_screen` (`hk_frontend/switch.py`). Without this, HA's entity action would silently skip a
  switch now Mantel Link's.
- **Removing Mantel Link** while it holds entities hands them back to HK Frontend's entry first
  (`async_remove_entry` → `give_back`), so HA does not delete the house's entity ids with the entry.
- **Mantel Settings → Connections → Home Assistant Link** (`pLink`): what is linked (HK Frontend / Mantel Link,
  protocol, what Mantel Link reported), the bridge (Owner: Hand the Bridge to Mantel Link… / Give the Bridge Back
  to HK Frontend…, confirmed; refusals in words), and who runs each wall tablet (Owner toggles over the existing
  `PUT /api/linked/owners`; everyone else reads). Audited (`linked.bridge`, `linked.owner`).

**Checks:**
- Mantel Link's `test_handover_hk.py` with the real HK Frontend (4): hand over and back with the same registry
  entries (ids), entity ids, unique ids, area and user name carried over, no `_2` anywhere; a sleep script waiting
  on `confirmed` across the move ends well; `hk_frontend.set_black_screen` reaches the tablet through Mantel Link;
  a half-done move completes at the next start, both directions; removing Mantel Link keeps the entity ids.
- HK Frontend's `test_handover.py` (5); HK's linked suites updated for `bridge` in the owners (45 green).
- Mantel: `tests/test_mantel_link_server.py` (6: the header, protocol 2's hello and report, the bridge rules, the
  registry mapping, house entities held by Mantel Link, unique ids without HK Frontend);
  `tests/test_mantel_link_settings.py` (4, the page drawn with the kit's stand-in).
- **Scratch HA with HK Frontend linked** (`tools/e2e/mantel_link_e2e.py --phase handover`): **22/22**: HK mirrors the
  Hall; Mantel Link added stays dormant; a sleep script (HA's own `execute_script`) turns the Hall black through
  `hk_frontend.set_black_screen` and waits; the Owner hands the bridge over; the same four registry entries move
  to Mantel Link, on its own device in the area HK's device had; the page's confirm ends the script's wait;
  `hk_frontend.set_black_screen` still works; HA's history of the switch runs on across the move (`unavailable ->
  off -> on -> unavailable -> on -> off`: the switch is unavailable for a moment while it moves); given back, HK
  Frontend takes the same entries back; Mantel Link dormant again. HK's own `tools/e2e/linked_e2e.py`: 23/23.
- **Browser pane** (a local Mantel against the scratch HA, signed in through the scratch HA's trusted network):
  the Home Assistant Link page at desktop and phone width, the hand-over from its button. Found: the page showed
  the pre-hand-over read until reloaded; it now reads again 4 s after a hand-over.

### 9.4 Pairing codes: done

- **Mantel** (`mantel_server/linked_pairing.py`): an Owner's one-time code (`POST /api/linked/pair`, LAN or a
  trusted HA sidebar; Mantel Connect's code format: 20 characters, about 98 bits, ten minutes, one at a time, five
  wrong proofs burn it), **held in memory only**, traded once at `POST /linked/pair` (public to sessions; the LAN
  door, never a browser; the App's HA Core peer allowed as for `/linked/ws`) for a new Service account
  "Home Assistant - Mantel Link" (scope `linked`). Both sides prove they know the code: Mantel Link's HMAC over
  the code id, a nonce and its name; Mantel's over the nonce, its instance id and the credential's hash, checked
  by Mantel Link before it believes anything, so a look-alike answering a zeroconf announcement can't hand Home
  Assistant a credential. Rate limits as Mantel Connect's. Audited (`linked.pair_start`, `_cancel`, `_ok` with the
  account id, `_failed` with `burned`); never the code or the credential.
- **Deviation:** the plan said "reusing connect_pairing". The code format, the rate-limit windows and the
  burn rule are reused; the storage is not (Connect keeps its pending code's key in SQLite and allows one pending
  Connect code at a time), so Mantel Link's codes live in memory instead and never clash with Connect's.
- **Mantel Link** (`pairing.py`; the setup form): Mantel's address and a pairing code (any case, spaces or
  dashes), or a Service credential. Errors in words: `invalid_code`, `rate_limited`, `not_mantel`,
  `code_or_token`. Plain http only to the checked internal address, as the link.
- **Mantel Settings → Connections → Home Assistant Link → Pair Mantel Link** (Owner): Make a Pairing Code, the code
  shown once with Copy and Withdraw; the page notices when it is spent. Also fixed there: with no HK Frontend in
  Home Assistant the bridge reads "Shown By Mantel Link · Home Assistant has no HK Frontend" (it said HK
  Frontend).
- **Checks:** `tests/test_linked_pairing.py` (3), Mantel Link's `test_pairing.py` (2) and an end-to-end pairing
  against the real `linked_pairing.py` (`test_e2e_mantel.py`); the settings page in node (5). **Scratch HA
  without HK Frontend** (`mantel_link_e2e.py --phase alone`): **27/27**, now adding Mantel Link with a code the
  Owner made (spent, the credential made by Mantel). Browser pane: the page, Make a Pairing Code, the code held
  while pending, Withdraw.

### 9.5 Discovery: done

- **From the App** (`mantel_server/supervisor_discovery.py`; `config.yaml` `hassio_api: true` + `discovery:
  [mantel]`, the entrypoint's `--supervisor-url http://supervisor`): at every start Mantel revokes the credential
  it made last time, makes a new `linked` one ("Home Assistant - App discovery"), deletes its previous
  announcement and posts `{service: mantel, config: {url: http://<the App's hostname from /addons/self/info>:8099,
  token, instance}}` with the App's Supervisor credential. Remembers the account id and the discovery's uuid,
  never the credential; audited (`linked.app_discovery`); failure only logs.
- **From Docker/LXC** (`mantel_server/announce.py`): Mantel writes `announce.json` ({instance, https url,
  version}, `--announce-file`, on by default in the container, `MANTEL_ANNOUNCE=0` turns it off); the announcer
  (`python -m mantel_server.announce`) advertises `_mantel._tcp` with TXT `instance`, `url`, `path`, `version`.
  Packaging: `compose.announce.yaml` (opt-in, decision M5 above), `--avahi`, `--check` (its healthcheck),
  `zeroconf` added to Mantel's dependencies (Docker image; the App doesn't need it).
- **Mantel Link** (`config_flow.py`): `async_step_hassio` → one-click `hassio_confirm` (tested with a probe before
  it is saved); an entry set up from the App's announcement follows its new credential and address (the same
  instance id), an entry set up any other way is left alone. `async_step_zeroconf` (manifest `zeroconf:
  ["_mantel._tcp.local."]`) → `zeroconf_confirm` asking only for a pairing code, with Mantel's https address
  shown; a zeroconf entry follows Mantel's new address. Announcements that aren't Mantel's (no https, no
  32-hex instance) are refused. Brand icons (`brand/icon.png`, `icon@2x.png`: the App's fireplace, redrawn at
  256/512).
- **Deviation:** `single_config_entry` is dropped from the manifest. With it, HA aborts every flow, discovery
  included, while an entry exists, so the App's rotated credential could never reach the entry it set up. "One
  Mantel, one entry" is kept by the flow itself (a different instance id: `another_mantel_linked`; by hand while
  linked: `single_instance_allowed`).
- **Checks:** Mantel Link's `test_discovery.py` (8, HA's `HassioServiceInfo` / `ZeroconfServiceInfo`);
  `tests/test_mantel_link_discovery.py` (5: the App's announcement and rotation against a fake Supervisor, the
  file and its avahi form, the entrypoint's flags in both modes, the packaging rules). **Real HA, real
  announcer** (`mantel_link_e2e.py --phase zeroconf`, everything on loopback: the scratch HA does not load HA's
  own zeroconf, which would browse the home network; `testha.py --zeroconf-probe` adds a scratch-only component
  browsing `_mantel._tcp` on 127.0.0.1): **5/5**, one "Discovered: Mantel" flow keyed by the instance id, asking
  for the code, a repeat announcement no second flow. Browser pane: the Discovered card with the icon, the form's
  words. Not done here: the code exchange after a zeroconf discovery on a real HA needs Mantel's real https
  address (covered by the pairing tests and the alone phase); a real Supervisor (covered by the fake; on the
  house in 9.11).

### 9.6 Kiosk on Mantel's HA dashboards, and the way back: done

- **Mantel's screen, framed by HA** (`web/shim/ha-frame.js`, started by `home.js`; never under the App's Ingress
  sidebar, which has HA's own frame protocol, nor opened on its own): tells the page around it the screen's own
  "Home Assistant Header & Sidebar" setting (`{source: 'mantel', type: 'mantel/kiosk', header, sidebar, admins}`,
  HK's `fromBoard` rule), again on a settings change or when Mantel Link's script asks; its menu gains
  **Mantel → Home Assistant** (`mantel-shell.js` hostMenu), which sends `mantel/back`. HK's menu learned a
  generic host row that runs an action (`run`) instead of opening a link: no word of Mantel in HK's build.
- **Mantel Link** (`frontend.py`, `frontend/mantel-link.js`, served at `/mantel_link/` and added to HA's pages):
  believes a message only from one of Mantel's screen origins (Mantel says them in protocol 2's hello,
  `screen_origins`: its https address; none for an Ingress-only App) AND from an iframe on the dashboard shown
  now. It hides HA's header and sidebar the way HK's `hk-kiosk.js` did (one stylesheet per shadow root, applied
  only while its attribute is on, so leaving the screen puts everything back), honours `admins: false`, and
  `mantel/back` goes to `/` (HA's start page) and nowhere else. `mantel/frontend/config` (any signed-in user)
  answers `{origins, version}`.
- **Checks:** Mantel Link's `test_frontend.py` (2: served and added; the config names only Mantel's origins) and
  `test_frontend_js.py` (2, node, a stand-in for HA's page: other origins, frames not on the page and messages
  not Mantel's ignored; header only; admins; leaving; back only to `/`); Mantel's `test_ha_frame.py` (2) and HK's
  `test_menu.js` (a host row's `run`). **Scratch HA + a local Mantel, browser pane:** a Webpage dashboard framing
  the screen, whose setting hides both: desktop (1024 px: header and sidebar `display: none`, the frame
  1024×768) and phone (375 px: header and the pull-out drawer hidden, the screen full-screen); Mantel's menu in
  the frame shows Mantel → Home Assistant, and tapping it lands on HA's Overview with its header back; a forged
  message from HA's own page changes nothing. Finding: the pane draws a cross-origin frame scaled into a corner at
  desktop size (its capture only: the frame's rect and the page laid out at full size, as a direct load shows).

### 9.7 Companion-app notifications: done

- **Mantel Link** (`phones.py`): reports the phones this Home Assistant can notify (the Companion app's
  `notify.mobile_app_*` services, named from their mobile_app entries; again whenever one comes or goes); carries
  out Mantel's `phone_notify` only for such a service HA has, with the title, the message and known fields
  (`tag`, `group`, an https or relative `url`/`clickAction`, up to three `MANTEL_*` actions, iOS
  interruption-level up to time-sensitive, Android priority and `ttl: 0`; anything else dropped); sends a
  `MANTEL_*` action from `mobile_app_notification_action` back as `phone_action`.
- **Deviation (the plan implied it, the protocol said never):** `phone_notify` is the one server frame by which
  Mantel asks Home Assistant to do something. It is pinned (`linked.SERVER_TYPES_2`), protocol 2 only, and
  bounded on HA's side as above; `tests` prove a `call_service`-shaped frame still does nothing.
- **Mantel** (`mantel_server/phones.py`, migration `0015_person_phones.sql`): each person's phones and what goes
  there (Owner or Admin, an Admin never an Owner's, audited `phones.set` first); every notification Mantel shows
  (rules, calendars, `notify` forwarded) also goes to the phones of the people it is for, in the background;
  a phone's Dismiss sends `notification_dismiss` to the screens. HK's banners learned that event
  (`hk-notify.js` `dismissId`; generic, HK in HA never sends it). **Migration 0015**: renumber if another branch
  took it before this merges.
- **Mantel Settings → People → a person → Phones:** a switch per phone HA has, a "Gone" row for one HA no longer
  has, and Send (Important Only / Every Notification / Nothing); says when Mantel Link isn't linked or HA has no
  Companion-app phone.
- **Checks:** Mantel Link's `test_phones.py` (3); Mantel's `tests/test_phones.py` (5) and the page in node (2);
  HK's `test_notify.js`. **Scratch HA** (`mantel_link_e2e.py --phase phones`, a stand-in phone
  `notify.mobile_app_e2e_phone` from `testha.py --phone-probe`): **11/11**: reported, picked by the Owner,
  `mantel.notify` reaches a Mantel screen and the phone with Mantel's Dismiss and tag, the phone's Dismiss takes
  the banner down, another app's action does nothing, no household service called. Browser pane: the Phones
  group, a switch saved.

### 9.8 Forwarded music, Clean Areas and automation snooze: done

- **Mantel Link** registers `music_play`, `music_transfer`, `music_stop`, `music_transport`, `music_play_media`,
  `clean_areas`, `pause_automation` and `resume_automation` as `mantel.*` and, while HK Frontend doesn't answer
  them, `hk_frontend.*`, with HK Frontend's schemas (music and Clean Areas answer; `until` goes over the link as
  ISO text). Protocol 2 only (`linked.SERVICES_2`); HK Frontend's protocol 1 still forwards only its four.
- **Mantel** (`mantel_server/linked_actions.py`) runs them with its own engines and **never sends one back to HA's
  `hk_frontend`**, which may now be Mantel Link's own alias (a loop): music only on Mantel's engine (else
  `not_set_up` in words), Clean Areas with hk_core's plan and one vacuum call per robot (a dry run only plans),
  the snooze as `automation.turn_off` now and `turn_on` at `until` (default the next midnight, the house's time;
  resumed early on request; forgotten if someone turns it on; kept in `linked_house` across restarts; a 30 s
  tick). All through the command gateway as `mantel:linked`, audited first, refused in words with commands off.
- **Its grants** (computed, never stored): `control` on the vacuums Clean Areas uses, on `media_player` and the
  music feature, and `control` + `control.sensitive` on `automation` (turning one off or on is sensitive in
  Mantel's RBAC). An Owner's deny naming `mantel:linked` wins (tested).
- **Finding, for later (not changed here):** a page's own `hk_frontend.clean_areas` / `pause_automation` (Mantel's
  gateway, `service_command`) still goes to HA's `hk_frontend`. With HK Frontend there, that is HK's, as today;
  once it is removed it reaches Mantel Link's alias and comes back to `linked_actions` (the right engines, one hop
  longer). Moving those page calls straight onto Mantel's engines is a follow-up.
- **Checks:** Mantel's `tests/test_linked_actions.py` (6); Mantel Link's `test_more_actions.py` (3). **Scratch HA**
  (`mantel_link_e2e.py --phase actions`, no HK Frontend): **11/11**: commands off: a Clean Areas dry run answers its
  plan through `hk_frontend.clean_areas`, Clean Areas, pause and music refused in words, every attempt audited as
  `mantel:linked`, the robot untouched; commands on (fictional demo devices): `mantel.clean_areas` starts the
  demo robot in the Kitchen through Mantel's gateway, audited allowed and sent.

### 9.9 Packaging and docs: done (prepared locally; nothing published)

- **Mantel Link's public repository** is built by `hosts/ha/custom_components/mantel/tools/publish/publish.py REPO_DIR
  [--commit msg]`: `custom_components/mantel/` (what HACS installs), `tests/`, `docs/`, `README.md`, `LICENSE` (MIT,
  jazzphone), `hacs.json` ("Mantel Link", Home Assistant 2026.9.0), `.github/` (tests and HACS/hassfest validation, as
  HK Frontend's). Every file scanned with HK Frontend's private-data rules; the suite then runs in the built tree
  (34 passed, 1 skipped: the shared-client check needs HK Frontend beside it). **It has no push**: creating
  `jazzphone/mantel-link` and pushing is Avery's step. `tests/test_mantel_link.py` keeps the build clean.
- **Mantel Link's docs** (published with it): README, `docs/Setup.md` (from the App, on the network, by hand),
  `docs/Actions.md`, `docs/Moving-from-HK-Frontend.md` (**the move guide**), `docs/How-It-Works.md` (the link, the
  bridge, what Mantel can make HA do, discovery).
- **Mantel's docs:** LINKED-MODE.md now points to Mantel Link for the bridge; CUTOVER.md gains Step 9 (Mantel Link
  replaces HK Frontend, five sub-steps in the log); `packaging/ha-app/DOCS.md` (Mantel Link, the announcement and what
  `hassio_api` is for); `packaging/compose/README.md` (`compose.announce.yaml`, avahi, and that HA must trust Mantel's
  certificate: Caddy's own CA is refused until trusted where HA runs).
- **Deviation:** `hk_frontend` is no longer in Mantel Link's `after_dependencies` (hassfest knows core integrations
  only); the aliases are checked once HA has started, after HK Frontend has set up, so nothing depended on it.
- **Open, for Avery (not Mantel Link's to decide):** users who never ran Mantel can follow the move guide only once
  Mantel itself is installable outside this house (the App's distribution decision in PLAN.md, "Decisions waiting").
- **Checks:** a **fresh scratch HA set up from the docs** with Mantel Link installed from the **built repository**
  (`mantel_link_e2e.py --phase docs`): **11/11**: App-like (Mantel's real announcer, a stand-in Supervisor handing
  the announcement to HA's hassio discovery: Discovered: Mantel, Add, one click; the next start's new credential
  followed by itself, the old one revoked, no second card) and Docker-like by hand (address + pairing code), every
  action offered under both names. Browser pane: the by-hand form in HA (credential field masked).
  `tools/check_links.py` and `tools/package_check.py` clean.
