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
- **The settings are separate.** HK Frontend keeps HK's settings in Home Assistant and Mantel keeps its own. Mantel's
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

## Not decided

- Whether HK Frontend's dashboards should ever read Mantel's settings when linked (one copy instead of two). Only
  worth building if houses want both and edit both.
