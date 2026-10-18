# Phase 2: HK's own shell — roadmap (drafted 2026-10-18)

PLAN.md §9, Phase 2: "Router, menu, tab bar, sheets, icons, `ha-card` replacement — HK no longer
needs Lovelace to draw. Still hostable as an HA `panel_custom`." Phase 1 left the frontend talking
only to HKClient and `hkShell`. Phase 2 removes the last thing HK borrows from HA's frontend:
**HA's elements and Lovelace's page machinery**.

## Where HK still draws with HA's elements (measured 2026-10-18, `web/hk`)

| Element | References | Files | Replaced by |
|---|---|---|---|
| `ha-icon` | 337 (markup, `createElement`, CSS selectors) | 29 | `hk-icon` |
| `ha-card` | 264 | 21 | `hk-plate` |
| `ha-state-icon` | 20 | 5 | `hk-state-icon` |
| `hui-view` / `hui-root` / `hui-card` | 21 / 6 / 16 | 7 / 3 / 6 | HK's view host (P2.3) |
| `ha-form` / `ha-yaml-editor` / `ha-entity-picker` | 12 / 3 / 1 | 4 / 1 / 1 | the HK settings kit (P2.4); the Lovelace card editors stay HA-only |
| `ha-svg-icon`, `ha-menu-button` | 1 / 1 | 1 / 1 | `hk-icon` / the shell's own button |

Mantel's proof-1 stand-ins (`web/shim/ha-elements.js`) already draw `ha-card`, `ha-icon` and
`ha-state-icon` well enough to match HA's Home page side by side. Phase 2 promotes them into
shared code under HK's own names, so both hosts draw with the same elements.

## Slices

| # | Slice | Scope | Risk / how it's checked |
|---|---|---|---|
| P2.1 ✅ | **HK's own elements** (done 2026-10-18) | `web/hk/elements/`: `hk-icon` (resolution: `hk:` glyphs → HK's committed MDI subset `web/mdi/` → the host's icon database through `hkShell.iconDatabase()`, which is HA's `/static/mdi` in HA, so any name a user configures still draws; Mantel: its subset now, a full MDI set when packaged), `hk-state-icon`, `hk-plate` (exactly the `:host` styles HA's `ha-card` applies, driven by the same `--ha-card-*` variables HK already sets). Additive only: nothing uses them yet. | Unit tests per element; zero change in the HA build. |
| P2.2 ✅ | **Cards draw with them** (done 2026-10-18 on its branch, `docs/phase2/ELEMENTS.md`: every page pixel- and geometry-identical in the scratch HA) | `<ha-icon` → `<hk-icon`, `ha-card` → `hk-plate` (markup, `createElement`, CSS selectors), `ha-state-icon` → `hk-state-icon` via `client.bindStateIcon`; in batches by card group like slice 9. | **Visible in the HA build.** Before/after screenshots in the scratch test HA (`tools/testha/`) for every page a batch touches; render audits; the `ha-card`-targeting user CSS (card-mod) caveat goes in the release notes. |
| P2.3 ✅ | **HK's view host** (done 2026-10-18, `docs/phase2/VIEW-HOST.md`) | One shared host that renders the strategy's output (views, sections, cards, `createCardElement` + `setConfig` + the client) without `hui-root`/`hui-view`/`hui-card`: Mantel's `web/home.js` + `cards-bridge.js` generalised into `web/hk/shell/`. HK's router (paths `/<dashboard>/<view>`, as today), the menu, tab bar and sky mount in it through `hkShell`. | Mantel draws every page with it (smoke per page). |
| P2.4 ✅ | **Settings without HA's forms** (done 2026-10-18, `docs/phase2/SETTINGS-FORMS.md`; visible in HA's YAML pages, held back from the house until Avery looks) | The HK Settings panel's `ha-form`/`ha-yaml-editor` → the HK settings kit (`hk-settings-kit.js`), so the panel draws in Mantel too. The Lovelace card editors (HA's "Edit card" dialog) keep `ha-form`: they exist only inside HA. | Settings suites; smoke opens the panel in Mantel. |
| P2.5 | **Sheets and dialogs** | The more-info fallback for entity types HK has no sheet for → HK's generic sheet + "Open in Home Assistant" for Admins (§10); toasts and confirmations in HK's own layer. | Detail suites; smoke. |
| P2.6 | **HK as an HA panel** | `hk_frontend` registers a `panel_custom` that loads the P2.3 view host: HK inside HA without Lovelace (no hui-root restyling, no Lovelace-wide state). Dashboards stay available as Lovelace dashboards until Avery switches. | Scratch HA first; a live switch only with Avery. |

## Order and parallelism

P2.1 first (small, additive). P2.2 batches can run in parallel once P2.1 lands, each with a
test-HA screenshot check. P2.3 and P2.4 are independent of P2.2 and of each other. P2.5 follows
P2.3. P2.6 needs P2.3.

## P2.1 result (2026-10-18)

- `web/hk/elements/hk-elements.js` defines `hk-icon` and `hk-plate`. `hk-icon` resolves names
  through `customIconsets[set]`, else `hkIcons.mdiPath`, which reads the host's own icon database
  at `/static/mdi` (HA's full database in HA, Mantel's committed subset in `web/mdi/`). So the
  separate `hkShell.iconDatabase()` the draft planned isn't needed. `hk-plate` has exactly
  `ha-card`'s rules from frontend 2026.9, with fallbacks for HA's design tokens.
- Each host defines `hk-state-icon`. HA's (`hosts/ha/frontend/hk-ha-elements.js`) wraps
  `ha-state-icon`; Mantel's is the stand-in in `web/shim/ha-elements.js`.
- Both are registered at HA's bootstrap (`__init__.py`, after the iconset) and in Mantel's
  `web/home.js`. The publish plan ships `hk-ha-elements.js`, and `tests/test_ha_build.py` pins it.
- `test_elements.js` covers glyph and MDI resolution, the plate's box, header and raised state,
  and HA's state icon getting HA's object and the state. 120 suites, 665 HA Python, 164 Mantel
  and the smoke all pass. No card uses the new elements yet, so the HA build is unchanged.

## Exact continuation point

P2.2: convert the cards to `hk-icon`, `hk-plate` and `hk-state-icon` in batches by card group:
markup, `createElement` calls and CSS selectors. Take before/after screenshots in the scratch
test HA (`tools/testha/`) for every page a batch touches. P2.3 (view host) and P2.4 (settings
forms) can run in parallel.
