# Phase 9: Mantel Link replaces HK Frontend in Home Assistant (decision 28)

**Status: plan, for Avery's sign-off (2026-10-19, revised the same day). Nothing here is built yet.**

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
