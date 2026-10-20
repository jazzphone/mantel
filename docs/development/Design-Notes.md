# Design notes

The folders `docs/phase1/` to `docs/phase10/`, `docs/proof1/`, `docs/proof2/` and `docs/MEASUREMENTS.md` are the
project's design notes and build records, kept for history. Each was written when its piece was built: what was
decided and why, what was built, how it was checked, and what was left. Later notes can supersede earlier ones;
where that happened, the older note says so at the top.

Read them as background, not as user documentation. They describe the state of things on the day they were
written, they may refer to "the house" (the author's own test home) and to its owner as "Avery", and some name
branches, dates and build numbers that no longer mean anything outside the project. For how Mantel works today,
start with [Architecture](Architecture.md); for running it, [Operations](../OPERATIONS.md).

## Proofs and measurements (before Phase 1)

| Note | Covers |
|---|---|
| [MEASUREMENTS.md](../MEASUREMENTS.md) | Phase 0: the state hub's traffic, upstream from Home Assistant against downstream to a filtered client. |
| [proof1/APPROACH.md](../proof1/APPROACH.md) | Proof 1: how HK built its Home page inside Lovelace, and the plan to draw it without Lovelace. |
| [proof1/RESULTS.md](../proof1/RESULTS.md) | Proof 1: HK's Home page drawn by Mantel with HK's unmodified cards, and the numbers. |
| [proof2/RESULTS.md](../proof2/RESULTS.md) | Proof 2: dry-run permissions and audit, an allowed and a denied command recorded before any reply. |

## Phase 1: the frontend talks only to HKClient

| Note | Covers |
|---|---|
| [phase1/RESULTS.md](../phase1/RESULTS.md) | Slice 1: the source boundary and the first card on the shared client. |
| [phase1/STATE-CLIENT.md](../phase1/STATE-CLIENT.md) | Slice 2: shared card state and update lifecycle; Mantel serving the current frontend assets. |
| [phase1/SUBSCRIPTIONS.md](../phase1/SUBSCRIPTIONS.md) | Slice 3: the client's subscription port and settings discovery. |
| [phase1/MUSIC-ART.md](../phase1/MUSIC-ART.md) | Slice 4: artwork reconnect handling and the music feeds through the client. |
| [phase1/DETAIL-SAVER.md](../phase1/DETAIL-SAVER.md) | Slice 5: the detail sheets and the screensaver read through HKClient. |
| [phase1/ACTIONS.md](../phase1/ACTIONS.md) | Slice 6: one action port for every service call and write message. |
| [phase1/CONNECTIONS.md](../phase1/CONNECTIONS.md) | Slice 7: raw connections (forecasts, cameras, talk-back) moved onto the subscription port. |
| [phase1/HOST-SHELL.md](../phase1/HOST-SHELL.md) | Slice 8: Home Assistant's page hooks behind one host-shell adapter (`hkShell`), with its API. |
| [phase1/CARDS.md](../phase1/CARDS.md) | Slice 9: every card family reads the client instead of Home Assistant's object. |
| [phase1/STRATEGY.md](../phase1/STRATEGY.md) | Slice 10: the dashboard strategy reads a client from its entry. |
| [phase1/SETTINGS-PANEL.md](../phase1/SETTINGS-PANEL.md) | Slice 11: the HK Settings panel reads a client and saves through the action port. |
| [phase1/TESTHA.md](../phase1/TESTHA.md) | Checkpoint: the HACS build inside a real, scratch Home Assistant, and the boot-order race it found. |

## Phase 2: HK draws without Lovelace

| Note | Covers |
|---|---|
| [phase2/ROADMAP.md](../phase2/ROADMAP.md) | The Phase 2 plan: HK's own shell, so it no longer needs Lovelace to draw. |
| [phase2/ELEMENTS.md](../phase2/ELEMENTS.md) | P2.2: cards draw with HK's own elements (`hk-icon`, `hk-plate`) instead of HA's. |
| [phase2/VIEW-HOST.md](../phase2/VIEW-HOST.md) | P2.3: HK's own view host: views by address, the card factory, routing. |
| [phase2/SETTINGS-FORMS.md](../phase2/SETTINGS-FORMS.md) | P2.4: the HK Settings panel draws with HK's own controls. |
| [phase2/SHEETS.md](../phase2/SHEETS.md) | P2.5: HK's own sheets and dialogs, replacing HA's more-info dialog. |
| [phase2/HA-PANEL.md](../phase2/HA-PANEL.md) | P2.6: HK as its own Home Assistant panel (opt-in). |

## Phase 3: Mantel Server's core

| Note | Covers |
|---|---|
| [phase3/ROADMAP.md](../phase3/ROADMAP.md) | The Phase 3 plan: database, accounts, roles, gateway, connectors, settings, packaging. |
| [phase3/ACCOUNTS.md](../phase3/ACCOUNTS.md) | P3.1: the SQLite layer, accounts (passwords, TOTP, passkeys), sessions, wall-tablet devices, the first-Owner bootstrap. |
| [phase3/RBAC.md](../phase3/RBAC.md) | P3.2: roles, grants and read filtering. Its step-up rules were later removed (see GATEWAY.md). |
| [phase3/GATEWAY.md](../phase3/GATEWAY.md) | P3.3: the command gateway, its audit, and the server wiring; its first section is today's rule. |
| [phase3/CONNECTORS.md](../phase3/CONNECTORS.md) | P3.4: Music Assistant, camera signaling and the read proxies, with RBAC applied. |
| [phase3/SETTINGS.md](../phase3/SETTINGS.md) | P3.5: HK's settings in Mantel's database, with versions, history and the import from HA. |
| [phase3/PACKAGING.md](../phase3/PACKAGING.md) | P3.6: one image, three ways to run it (Docker, LXC, HA App), and the static checks. |
| [phase3/PINS-AUDIT.md](../phase3/PINS-AUDIT.md) | Tablet PINs (since superseded), the audit API and retention, the trusted proxy, page settings saves. |
| [phase3/LOGIN-PAGE.md](../phase3/LOGIN-PAGE.md) | Mantel's own sign-in page (`/login`). |
| [phase3/ADMIN-PAGE.md](../phase3/ADMIN-PAGE.md) | The admin page (`/admin`): people, tablets, roles, credentials and the audit. |
| [phase3/BACKUP-FILES.md](../phase3/BACKUP-FILES.md) | Encrypted backups with a tested restore, and the "Your files" upload. |
| [phase3/HA-APP.md](../phase3/HA-APP.md) | Mantel as a Home Assistant App: Ingress identity, the path prefix, the Supervisor connection. |
| [phase3/CONNECT.md](../phase3/CONNECT.md) | Mantel Connect: putting a Mantel that runs outside Home Assistant into HA's sidebar. |
| [phase3/HA-SIDEBAR-SCREENS.md](../phase3/HA-SIDEBAR-SCREENS.md) | Mantel's screens added to Home Assistant's sidebar as dashboards. |

## Phase 4: features in Mantel

| Note | Covers |
|---|---|
| [phase4/MANTEL-FEATURES.md](../phase4/MANTEL-FEATURES.md) | Mantel's House adapter and the feature host: `hk_core` features running in Mantel Server. |
| [phase4/FEATURE-PARITY.md](../phase4/FEATURE-PARITY.md) | HK's feature pages on Mantel: Live TV, Energy, Power and Clean Areas. |
| [phase4/PHOTOS.md](../phase4/PHOTOS.md) | Mantel Photos: the screensavers' own photo library. |

## Phase 5: linked mode

| Note | Covers |
|---|---|
| [phase5/LINKED-MODE.md](../phase5/LINKED-MODE.md) | HK Frontend "Linked to Mantel Server": keeping HK's actions and entities in Home Assistant (protocol 1; the bridge has since moved to Mantel Link). |

## Phase 8: wall tablets and settings

| Note | Covers |
|---|---|
| [phase8/KIOSK.md](../phase8/KIOSK.md) | Wall-tablet kiosk apps (Kiosk Satellite, Fully Kiosk) talking to Mantel directly. |
| [phase8/SETTINGS.md](../phase8/SETTINGS.md) | One Mantel Settings page for HK Settings and Mantel's own settings. |

## Phase 9: Mantel Link

| Note | Covers |
|---|---|
| [phase9/MANTEL-LINK.md](../phase9/MANTEL-LINK.md) | Mantel Link replaces HK Frontend in Home Assistant: design, protocol 2, the hand-over and its checks. |
| [phase9/NO-HK-FRONTEND.md](../phase9/NO-HK-FRONTEND.md) | Everything Mantel still needed from HK Frontend, and what replaced each one. |

## Phase 10: the Apple apps

| Note | Covers |
|---|---|
| [phase10/APPLE-APPS.md](../phase10/APPLE-APPS.md) | Mantel for iPhone, iPad and the Mac: the plan and the slices built. |
| [phase10/NATIVE-FEEL.md](../phase10/NATIVE-FEEL.md) | What makes the iPhone app feel native rather than a website, and the order to build it. |
