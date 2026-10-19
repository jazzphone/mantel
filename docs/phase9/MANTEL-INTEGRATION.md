# Phase 9: the Mantel integration for Home Assistant (decision 28)

**Status: plan, for Avery's sign-off (2026-10-19). Nothing here is built yet.**

## Why

HK Frontend in Home Assistant has quietly become two things:

1. **HK's dashboards inside HA**: Lovelace cards and strategy, HK Settings, and HK's features running in HA (music,
   Live TV, energy, notifications, sleep screen, tablets). This is the product HACS users install.
2. **Mantel's bridge into HA** (linked mode, docs/phase5/LINKED-MODE.md):
   - the tablets' and the house's entities, mirrored with the same entity ids;
   - the `hk_frontend.*` actions forwarded to Mantel;
   - per-tablet ownership.

   Next on the list for the bridge:
   - kiosk for Mantel's HA dashboards;
   - Mantel notifications through the Companion app;
   - one-click setup from the Mantel App.

Avery (2026-10-19): "HK Frontend and Mantel should work together with HK Frontend bridging the gap between HA and
Mantel… we should do A and B… build it all at once with a solid plan from start to finish." Nothing in it may be
specific to one house.

**Decision 28:**
- **A:** HK Frontend says it is linked to Mantel, and the Mantel App sets the link up itself (Supervisor discovery).
- **B:** the bridge moves into its own small integration, **Mantel** (domain `mantel`). It carries the bridge's
  entities and the `hk_frontend.*` actions, so a Mantel house can later run without HK Frontend in HA at all.
- HK Frontend stays the standalone HA dashboard product for houses without Mantel.

## The end state

| | Mantel integration (`mantel`) | HK Frontend (`hk_frontend`) |
|---|---|---|
| Who installs it | Every Mantel house that has HA | Houses that want HK dashboards inside HA, Mantel or not |
| What it does | **The bridge only**: the link to Mantel; the mirrored entities; the actions (`mantel.*`, plus `hk_frontend.*` while HK Frontend is not loaded); kiosk on Mantel's HA dashboards; the Companion-app notifications relay; diagnostics | HK's dashboards, HK Settings and HK's features in HA. No bridge code |
| Set up by | **Discovery from the Mantel App** (one click: "Discovered: Mantel"), or by hand with an address and a Service credential (Docker/LXC) | Its config flow, as today |
| Entities | The tablets' four, Seasonal decorations, the Alarm PIN panel and Live TV's, **under their existing entity ids** (registry migration, below) | Its own, for tablets and houses Mantel does not own |

## How the pieces work

### Discovery: the App sets the link up (A, then B)

- The App's config.yaml gets `discovery: [<domain>]` and `hassio_api: true` (needed to post discovery; role `default`).
- On start, the App asks the Supervisor to announce itself (`POST /discovery`):
  `{service: <domain>, config: {url: "http://<app hostname>:8099", token: <a Service credential minted for HA>}}`.
  - The address is the App's own hostname (`local-mantel` or `<repo hash>-mantel`), never a typed one.
  - The credential is a `linked`-scope Service account made for it, rotated when the discovery is redone. It is
    shown to HA admins only: the Supervisor's discovery store, and HA's discovery API is `require_admin`.
- HA starts the integration's `async_step_hassio` flow. The admin sees "Discovered: Mantel" and confirms once.
  - HK Frontend (A): its Configure → Linked page is filled in from the discovery.
  - The Mantel integration (B): the flow creates its entry.
- HA re-discovers after the entry is removed (hassio/discovery.py `async_rediscover`). The App withdraws the
  discovery when it is uninstalled.
- Docker/LXC (no Supervisor): unchanged; address and Service credential typed in the flow, `https://` only.

### The Mantel integration's code

| Piece | From | Change |
|---|---|---|
| `link.py` (client, ws rules, reconnect) | HK `mantel_link.py` (no HA imports today) | Moved as is; one copy, imported by both until HK's bridge is removed |
| `bridge.py` (Linked: owners, hello, mirroring, forwarding) | HK `linked_mode.py` | Domain `mantel`; its own config entry and devices; no HK subentries (one entry, a device per tablet) |
| Entity classes (switch, sensor, binary_sensor, camera, alarm panel) | HK `linked_mode.py` 492-674 | Unchanged behaviour |
| Actions | HK `__init__.py`, `switch.py`, `features/notifications` | `mantel.set_black_screen`, `mantel.show_popup`, `mantel.close_popup`, `mantel.notify`, same schemas (services.yaml). **Also `hk_frontend.*` under the same names, registered only when no `hk_frontend` entry is loaded**, so existing automations keep working |
| `kiosk.js` (frontend module) | new | On Mantel's own Webpage dashboards only (the integration knows their url_paths and Mantel's origin from the link): hide HA's header and sidebar per that screen's "Home Assistant Header & Sidebar" setting; accept "open HA's sidebar" / "go home" postMessages **only from Mantel's exact origin** |
| Notifications relay | new | Mantel → HA `call` of `notify.mobile_app_*` for the people Mantel names; the Companion app's lock screen, actionable buttons back to Mantel |
| Discovery and manual config flow, diagnostics, repairs | new / HK's | Diagnostics never show the credential |

**Mantel Server** changes little:
- linked_house.py reads registry entries of `platform in ("mantel", "hk_frontend")`;
- error texts name the actual domain;
- `features.linked.entry_id` is the Mantel entry's;
- unique ids are kept exactly as today's strings (`{old entry}_{uid}_{key}` etc.): a unique id is only a string,
  so the migration does not have to rename them.
- The hello gains `domain` (protocol 2, backwards compatible), so one Mantel serves either side during the move.

### Moving the bridge from HK Frontend to Mantel (per house, reversible)

HA keeps an entity's id, history and customisations when its registry entry moves between integrations
(`entity_registry.async_update_entity_platform`; the entity must not be loaded at that moment).

1. **Install the Mantel integration** (how: decision M1 below) and confirm the discovery. It starts **dormant**:
   linked, mirroring nothing, while HK Frontend's linked mode keeps the house as it is.
2. **Hand over** (Owner, one action in Mantel Settings, audited; or automatic on first set-up when the house is linked):
   1. Mantel tells HK (over HK's link): "the Mantel integration takes the bridge".
   2. HK writes `mantel_owners.bridge = "mantel"`, reloads, and stops mirroring and stops registering the bridged
      entities. Its own entities for HA-owned tablets are untouched.
   3. The Mantel integration migrates each bridged registry entry (`hk_frontend` → `mantel`, same unique id, the new
      config entry, a Mantel device), then adds the entities. Same entity ids; history continues.
   4. While HK Frontend is loaded, `hk_frontend.*` stays HK's. Its forwarding goes to the Mantel integration, which
      is now the one link, so there is never a moment with no `set_black_screen`.
3. **Later, optional (Avery's call):** remove HK Frontend from HA when no tablet or dashboard needs it. The Mantel
   integration then registers `hk_frontend.*` itself, so scripts and automations keep working unchanged. Claude
   prepares a diff moving them to `mantel.*` for Avery's approval whenever he wants. It is cosmetic, not required.

**Rollback** (any time):
- In Mantel Settings, *give the bridge back to HK Frontend*, or remove the Mantel integration.
- The Mantel integration migrates the registry entries back to `hk_frontend` (same unique ids) and unloads.
- HK clears `bridge` and reloads into today's linked mode.
- Tablets keep their ownership throughout.

### HK Frontend's side (A, and what B removes)

- A: when linked, Configure and the entry title say "Linked to Mantel", the discovery fills the link, and diagnostics
  say who owns what.
- B: `bridge = "mantel"` makes HK skip its whole bridge (no Linked, no mirroring, no forwarding of its own). After
  every known house has moved, a later HK release deletes the bridge code (linked_mode.py, mantel_link.py's copy,
  the Linked Configure page), keeping only the hand-over/rollback hooks for one release more.
- Stays: HK's dashboards, Settings, features; HK's own entities for HA-owned tablets; the HACS product.

## Build order (all in one plan; landed in slices, each tested end to end)

| Slice | What | Done when |
|---|---|---|
| 9.1 | The `mantel` integration skeleton: manifest, manual config flow (https only), `link.py` shared with HK, diagnostics | Connects to a local Mantel; its tests and HK's linked tests pass |
| 9.2 | Mirroring and actions in the Mantel integration (`mantel.*`; `hk_frontend.*` when HK is absent), protocol 2 `domain` in hello | The scratch HA without HK Frontend: a Mantel-owned tablet's four entities live, `hk_frontend.set_black_screen` and `mantel.set_black_screen` both reach Mantel |
| 9.3 | Hand-over and rollback (HK `bridge`, registry migration both ways), Mantel Settings button, audit | Scratch HA with HK linked: hand over and back, entity ids and history unchanged, no gap in `set_black_screen` (tested with a waiting script) |
| 9.4 | Discovery: App config.yaml, the App's announcement and its Service credential; `async_step_hassio` in both integrations (A for HK) | A scratch Supervisor is not available: the flow tested with HA's discovery test helpers; the App's announcement against a fake Supervisor; one real check on the house at install time |
| 9.5 | Kiosk module on Mantel's dashboards + "back to HA" postMessage from Mantel's menu | Scratch HA: a framed Mantel screen with HA's chrome hidden per the screen's setting; messages from any other origin ignored |
| 9.6 | Companion notifications relay (Mantel → `notify.mobile_app_*`, actions back) | Scratch HA with a fake mobile_app notify service: Mantel's notification arrives with its actions; a tap's action reaches Mantel |
| 9.7 | Install path (decision M1), docs (App DOCS, OPERATIONS, LINKED-MODE → bridge), CUTOVER update | A fresh scratch HA set up from docs alone |
| 9.8 | House: install, discovery, hand-over (approval for each), then the soak | The Loft keeps sleeping and waking across the hand-over; one night |

**Tests that stay green throughout:**
- HK's `test_linked_*` and Mantel's `test_linked*`;
- the linked e2e (`tests/test_linked_e2e.py`, `tools/e2e/linked_e2e.py`, now for both domains);
- the full validate.sh suite.

**New:** the Mantel integration's own pytest suite (same harness as HK's, `~/.venvs/hk-ha-test`).

## Decisions for Avery before slice 9.1

- **M1. How the Mantel integration gets into HA.**
  - (a) A public HACS repository (e.g. `jazzphone/mantel-ha`).
  - (b) The Mantel App installs and updates it into `/config/custom_components/mantel` itself. This needs the App
    to map HA's config folder read-write, a large permission, and the files change under HA.
  - (c) Both.
  - Recommendation: **(a)**, with the App's docs and Setup Check pointing at it. (b) is convenient but gives the App
    write access to all of HA's configuration.
- **M2. `hk_frontend.*` action names.**
  - Kept as aliases forever (recommended: nothing to migrate, they are just names).
  - Or migrate the house's automations to `mantel.*`, with a diff for approval, and drop the aliases in a later release.
- **M3. Is hk-frontend still published?** It is an open question in PLAN.md. B works either way. If it is no longer
  published, HK Frontend's HA build becomes Mantel's "dashboards in HA" add-on.
- **M4. Names.**
  - The integration "Mantel" (domain `mantel`). Devices "Mantel", manufacturer "Mantel", model "Wall Tablet".
  - Entity ids unchanged (migration), so names change only in HA's device pages.

## Risks

- **Registry migration needs the entities unloaded.** The hand-over unloads HK's bridged entities first, by HK's
  reload, then migrates. The test in 9.3 covers a migration interrupted halfway (HA restarted in the middle): the next
  start completes or reverts it.
- **Two integrations must never both publish one unique id.** HK skips its bridge as soon as `bridge = "mantel"` is
  in its entry data, before the platforms load. Mantel's integration adds nothing until its migration finished.
- **Discovery carries a credential.** HA admin only; rotated when the App re-announces; revocable in Mantel Settings
  → Service Accounts like any other.
- **Kiosk with the sidebar hidden in the Companion app:** a way back is required (the postMessage), tested on a phone
  width before it ships.
