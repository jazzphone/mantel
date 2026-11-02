# Architecture

This page is the big picture: what the pieces are, how they talk, and which boundaries the tests hold you to.
Each section links the design note that has the detail.

## The pieces

| Piece | Where | What it does |
|---|---|---|
| **HK web app** | `web/` | HK's frontend, written once: cards, modules, the view host, HK Settings. It talks only to `HKClient` and the host shell, so the same code runs in Mantel and inside Home Assistant. |
| **Mantel Server** | `hosts/server/mantel_server/` | A Python (aiohttp) service. It keeps one read connection to Home Assistant, serves the HK web app without Lovelace, and adds accounts, roles, wall-tablet devices, a command gateway with an audit log, a settings store with history, and connectors for Music Assistant and cameras. Run as `mantel-server`. |
| **`hk_core`** | `hk_core/` | Every feature's decisions (notifications, music, the screensaver, tablets, settings, the Sleep Screen, Clean Areas, Energy, the Live TV guide) in plain Python, shared by both hosts. |
| **HK Frontend** | `hosts/ha/custom_components/hk_frontend/`, `hosts/ha/frontend/` | The Home Assistant integration installed from HACS. `tools/build_ha.py` composes it from this component, `web/`, `hk_core/` and the HA adapters. |
| **Mantel Link** | `hosts/ha/custom_components/mantel/` | Home Assistant's side of Mantel: one authenticated link to Mantel Server, the wall tablets' entities, and the actions automations call. It replaces HK Frontend's linked mode. |
| **Packaging** | `packaging/` | One image, run three ways: Docker Compose, an LXC, or a Home Assistant App. Plus Mantel Connect, which puts a Mantel that runs elsewhere into Home Assistant's sidebar. |
| **Apple apps** | `apple/` | SwiftUI apps for iPhone, iPad and the Mac: a native shell around Mantel's own pages. The server decides everything; the apps ask. See [apple/README.md](../../apple/README.md). |

## How they talk

```text
              browsers, wall tablets, Apple apps
                              |
          HTTPS + WebSocket (sign-in, then the hub socket)
                              |
+-----------------------------v-------------------------------------+
| Mantel Server                                                     |
|                                                                   |
|  serves web/ (the HK web app) with web/shim/ (Mantel's adapter)   |
|                                                                   |
|  state hub                    command gateway                     |
|  StateStore + Registry        classify -> RBAC -> audit -> send   |
|  filtered diffs per client          ^                             |
|                                     | (feature calls, too)        |
|  hk_core features (MantelHouse) ----+                             |
|  settings store, accounts, devices, audit   (SQLite)              |
|  connectors: Music Assistant, cameras, read proxies               |
|  linked endpoint /linked/ws                                       |
+-------|-------------------|--------------------|------------------+
        | one read-only     | HaCommander        | Music Assistant's
        | subscribe_entities| (only while house  | own WebSocket API
        | connection        | commands are on)   |
        v                   v                    v
+----------------------------------+     +-----------------+
| Home Assistant                   |     | Music Assistant |
|                                  |     +-----------------+
|  Mantel Link ---- one WebSocket ----> Mantel's /linked/ws
|  (tablet entities, actions,      |
|   Mantel screens in the sidebar) |
|                                  |
|  HK Frontend (HACS build; runs   |
|   the same web/ and hk_core)     |
+----------------------------------+
```

- **Reads.** Mantel Server holds one `subscribe_entities` connection to Home Assistant and keeps every state in
  memory (`state.py`) with the area, device and entity registries (`registry.py`). Each client gets only what its
  role may see, as coalesced diffs (`view.py`). `HaClient`, the state connection, cannot call a service.
- **Registry changes reach open pages** (`registry_feed.py`). A page reads `/api/registry` (hass.entities, devices,
  areas, floors) as it loads. Its ETag is the digest of the registry that person or tablet may see: the registry cut
  down by their RBAC gate, serialized once. The same digest is in every `snapshot` frame (`registry`). When the
  registries reload (`Hub.on_registry`, a reconnect to HA's first load), or a grant or schedule changes what a
  session may see, the hub waits `PUSH_DELAY` (0.5 s), then sends `{type: "registry", digest}` to each session
  whose digest moved, and only those. A Child hears nothing of a room it can't see. The page
  (`web/shim/registry-sync.js`) reads `/api/registry` again with `If-None-Match`, hands the host the new registries
  (`Host.applyRegistry`, a new hass so HK redraws) and bumps `registryRefreshed()`. After a reconnect, the new
  socket's snapshot carries the digest, so a registry that changed while the socket was down is read once, and one
  that didn't isn't read. `/api/registry` answers from `RegistryBodies`: raw and gzipped bodies kept by digest (the
  last 16), with the work memoized by `Registry.digest` (made once per load) and the visible entity ids. A repeat,
  such as each preview frame of the Home Grid editor, serializes and hashes nothing; a matching ETag gets a 304.
- **The page's socket** (`web/shim/hub.js`) reconnects by itself after a drop, backing off from 2 to 30 s, and
  asks again for its subscription and every live feed (`_resume`), then calls `hub.onReconnect`. A tablet that
  slept can wake with a half-open socket, so the hub also pings the server (`{type: ping}`, 3 s) on
  `visibilitychange`, `pageshow` (from the back-forward cache), `online` and `focus`, and every 45 s while the page
  is visible: one check at a time, none within 10 s of the last, none while the socket isn't open. No pong and it
  lets the socket go (`hub.cycle()`, which a kiosk app's nudge through `mantel-host.js` also uses). A page whose
  start fails (`home.js`, `settings-page.js`) starts again, 2 to 30 s later (`web/shim/boot-retry.js`).
- **Commands** take a separate path, the command gateway, described below.
- **Music Assistant** is reached over its own WebSocket API, not through Home Assistant's `media_player` services.
- **Home Assistant reaches Mantel** through Mantel Link, which opens one authenticated WebSocket to Mantel's linked
  endpoint, forwards the actions automations call, and publishes the entities Mantel owns.

## The HKClient and host-shell contract

The shared frontend never sees a host's raw object. It reaches its host through two small contracts in
`web/client/`:

- **`HKClient`** (`web/client/hk-client.js`): the read surface (`states`, `entities`, `devices`, `areas`,
  `floors`, `config`, formatting, read-only `callWS`), a limited **subscription port** (`client.subscriptions`),
  and one **action port** (`client.actions`) for everything that changes something. Every write message is
  listed in `WRITES`; the read path refuses them before they reach the host.
- **The host shell** (`web/client/hk-host-shell.js`, `window.hkShell`): where overlays mount, the view
  container, navigation, detail sheets, toasts. A host installs its implementation with `hkShell.use(impl)`.

Each host supplies both:

| | Client | Shell |
|---|---|---|
| Mantel | `web/shim/mantel-client.js` | `web/shim/mantel-shell.js` |
| Home Assistant | `hosts/ha/frontend/hk-ha-client.js` | `hosts/ha/frontend/hk-ha-shell.js` |

On top of these, HK draws its own dashboards with its own view host (`web/hk/shell/hk-view-host.js`): views by
address, HK's own card factory and containers, and routing, with no Lovelace or host element.

Detail: [HOST-SHELL.md](../phase1/HOST-SHELL.md), [ACTIONS.md](../phase1/ACTIONS.md),
[SUBSCRIPTIONS.md](../phase1/SUBSCRIPTIONS.md), [VIEW-HOST.md](../phase2/VIEW-HOST.md),
[ELEMENTS.md](../phase2/ELEMENTS.md).

## `hk_core` and the House port

A feature's decisions live in `hk_core/` once. `hk_core` talks to the house only through the **`House` port**
(`hk_core/house.py`): state and registry reads, area and floor names, local time, and `call_service`. Each host
implements it:

- **Home Assistant:** `HaHouse` in `hosts/ha/custom_components/hk_frontend/house.py`. The HACS build vendors
  `hk_core` as `custom_components/hk_frontend/hk_core/`.
- **Mantel Server:** `MantelHouse` in `hosts/server/mantel_server/house.py`. Reads come from the hub's copies;
  `call_service` goes through the command gateway (so it is refused while commands are off).
  `hosts/server/mantel_server/features/` runs the features, each off until Mantel's feature settings turn it on.

A feature moves in three steps: its logic into `hk_core` behind the port, run in Home Assistant through `HaHouse`,
then run in Mantel through `MantelHouse`. The host keeps only its own steps (following states, timers, service
call sequences, stored options). Because `hk_core` is imported two ways (as `hk_core` by Mantel, as a vendored
package by Home Assistant), it imports only itself, and only relatively.

Detail: [hk_core/README.md](../../hk_core/README.md), [MANTEL-FEATURES.md](../phase4/MANTEL-FEATURES.md).

## The boundary rules

Two test files keep the shared code honest. Both run in the main suite.

`tests/test_boundaries.py`:

- `hk_core/` never imports `homeassistant`, and never imports `hk_core`, `custom_components` or `mantel_server`
  absolutely.
- Nothing in `web/` names `hass` or `_hass`, except Mantel's adapter in `web/shim/`. (Home Assistant's adapter
  lives outside `web/`, in `hosts/ha/frontend/`.)
- Every service call in `web/hk/` goes through the action port (`….actions.callService`), every known write
  message through `….actions.callWS`, and every HTTP write through `….actions.request`; nothing calls the host's
  own `fetchWithAuth`.
- Mantel's client port (`web/shim/mantel-client.js`) sends commands only when the server says commands are on;
  with commands off, its only action is HK's own settings save.

`tests/test_shell_boundary.py`:

- Home Assistant's element names (`home-assistant`, `hui-root`, `ha-panel-lovelace`, …) and frontend events
  (`location-changed`, `hass-more-info`, …) appear in shared code only inside the host-shell adapters. Comments
  are ignored; lookups and events are not.
- Shared code makes no HA icon, card, dialog or form element; the view host and toast layer name no host element.

If one of these fails, the fix is almost always to add what you need to `HKClient`, `hkShell` or the `House` port
and implement it in both hosts, not to reach around the boundary.

## The command gateway

Commands are **off by default**. The command path is not even built while they are off. An Owner turns them on in
Mantel Settings (General → Allow Control of the House, `server_settings.py`), after a fresh sign-in and an audit row;
`server.apply_commands` then builds the gateway and its connection, or removes them when turned off, and every page
socket reconnects to learn which. `--commands-enabled` is only the first start's value. The kill switch
(`--read-only`, `MANTEL_READ_ONLY`, the App's `read_only`) keeps the path unbuilt whatever is stored, and no client
message, REST call or setting can override it.

With commands on, a command goes like this:

1. The page's action port sends a `command` message over the hub socket. (`web/shim/mantel-client.js` only has
   actions when the server's `capabilities` frame says commands are on.)
2. `Gateway.handle()` in `hosts/server/mantel_server/gateway.py` refreshes the subject (the person, or the wall
   tablet's device) from the database.
3. `classify()` works out what the command is: a service call, a WebSocket write, an HTTP write, or a Music
   Assistant command, and how sensitive it is.
4. RBAC decides (`rbac.py`, wired by `authz.py`): the person's role, the device's role, grants and denies, and
   the door the request came in on (LAN, tunnel, Home Assistant's sidebar).
5. The alarm is the one exception that asks for a code: the house Alarm PIN, checked after the roles.
6. An audit row is written to `action_audit` **before** anything is sent.
7. Only then is it forwarded: to Home Assistant by `HaCommander` (its own connection, separate from the read
   connection), or to Music Assistant.

Feature code in Mantel uses the same path: `MantelHouse.call_service` hands the call to the gateway as the server's
own Service actor, or as the person who triggered it.

Detail: [GATEWAY.md](../phase3/GATEWAY.md), [RBAC.md](../phase3/RBAC.md), [ACCOUNTS.md](../phase3/ACCOUNTS.md).
Note that RBAC.md and PINS-AUDIT.md describe a step-up PIN that was later removed; GATEWAY.md's first section
has today's rule.

## Route guards and the audit of changes

Commands go through the gateway; everything else a page changes (people, tablets, connections, settings, files)
goes through a REST route. Each of those routes declares who may call it with one decorator,
`@guard(...)` in `hosts/server/mantel_server/guards.py`:

```python
@guard("owner", door="home", audit="service_account.create")
async def api_create(request): ...
```

- `who`: `signed_in` (any session), `person`, `manager` (an Owner or Admin) or `owner`.
- `device_ok`: whether a wall tablet's session, or a person signed in at one, may call it. It is false by default:
  at a tablet, an Owner gets Me only.
- `door`: `any`, `home` (the LAN door, or Home Assistant's sidebar with the home rules: `authz.home_door`), or
  `lan`.
- `fresh`: `never`, `away` (a fresh factor unless on the LAN or a trusted sidebar: `connections.edit_rule`),
  `always` (`accounts.require_fresh`), or `add_factor` (`accounts.require_fresh_to_add_factor`).
- `audit`: the action names the handler writes, or `no_audit="why"` for a change that writes none.

The decorator runs those checks before the handler, using the same helpers the routes used by hand before, and
stores its spec on the handler (`handler.__guard__`). The handler reads the checked identity with
`guards.ident(request)`. A check that only the handler can make (an Admin never manages an Owner, a step-up only
when turning commands on) stays in the handler.

Every settings or account change writes its audit row through one helper, `audit.config(request, ident, action,
detail)` in `audit.py`. The row is written **before** the change, with the person, the tablet they are at, the
door and the source address. If it cannot be written the route answers 503 `audit_unavailable` and changes
nothing. Where a change is worked out inside a model (a passkey verified, a photo processed, a Service credential
named), the model takes a `before` callback that writes the row between the checks and the write.

`tests/test_route_guards.py` builds the whole app and walks its router: each route has a guard or is on a short
list with its reason (sign-in, the app's DPoP routes, `/linked/*`, the media proxy, static files, health). Each
guard on POST, PUT, PATCH or DELETE names its audit or says why it has none.

## Page health and the Performance page

Each page (the dashboard, `web/home.js`; Mantel Settings, `web/shim/settings-page.js`) tells its socket how it is doing
through `web/shim/page-health.js`: a `load` frame (how the page before it ended), a `beat` every minute, and one `draw`
frame with the time to first draw, each with the heap, the sockets reopened (`hub.reconnects`) and the registry
refreshes (`registryRefreshed()`, bumped by `registry-sync.js` each time the page reads the registry again). `page_health.py` logs them and keeps the last 24 hours
per tablet or person in `RING`: memory only, bounded (`PER_SCREEN` samples, `SCREENS` screens). `ClientSession.pump`
times each flush and send into `performance.STATS`, with the HA event rate; `GET /api/performance`
(`@guard("manager")`, so never a tablet's session) summarizes both for **About** → **Performance** (the `performance`
section of `/api/admin/overview`, `web/shim/settings/performance.js`).

The frame rate is sampled by HK's own `web/hk/modules/hk-fps.js` (the dashboard's one sampler, which HK Frontend uses
too); its `fps` frame names the screen, the style and a short signature of the settings the ladder below changes
(`hkSettings.ladderSignature()`, e.g. `blur:a1w1r1f0c1`). Each wall tablet's latest is kept in
`page_health.TABLETS`, and `GET /api/performance/tablets` (managers) hands it to HK Settings (the host's
`tabletHealth`), which recommends ONE change on a screen whose tablet draws under 45 frames a second: the settings panel's
ladder (`M.slowRecommend`, `M.LADDER`) goes style, Rain & Snow, Moving Things in front, Animations, a live camera, and
a sample counts only while the screen's settings still read as its signature, so each step waits for the next sample.

## Long-lived connections

A route is checked once, when it is called. A connection that stays open is checked again for as long as it is
open, and so is every subscription it opened. All of them are in one registry, `app["live"]`
(`hosts/server/mantel_server/live.py`): page sockets, a linked HK Frontend's relayed reads, live talks, the media
proxy's sockets, Mantel Link, and each subscription inside them (cameras, Live TV, Music Assistant's events, the
music, settings, user-data, event, Clean Areas, page-header and snooze feeds). An entry says what it is, who it is
open as, how to close it, an optional `recheck()` (is the feature, the speaker, the camera still theirs?) and
whether it needs house commands.

- **A revocation ends it at once.** Revoking a session, a wall tablet or a link credential (the managers'
  `revoke`), disabling a person or changing their role, and linking or unlinking a Home Assistant user (People,
  the Ingress people page, a tablet's HA user) call `live.revoke` with what changed (`user:`, `device:`,
  `session:`, `ha:`, `service:`). Each matching entry's principal is read again (`Authz.refresh`) and its
  `recheck` asked, on the next turn of the loop; only what is no longer allowed closes.
- **The policy tick** (once a minute) does the same over every entry: schedules, guest windows, a grant removed.
- **Commands turned off** end every entry that needs them (a live talk, the Music Assistant page signed in past
  the gateway); every page socket reconnects to learn which, as before. Stopping the server ends everything.

A subscription is registered by `Ctx.keep`; its unsubscribe may carry `recheck` and `needs_commands`. One link
relays the reads of at most 32 Home Assistant users at once. Music Assistant's listeners belong to the app, not
the client, so subscriptions go on when the connection is removed and set up again.

## The settings store

HK's settings in Home Assistant live in a config entry, with no history and no per-user scope. In Mantel they live
in SQLite (`hosts/server/mantel_server/settings_store/`): documents keyed by scope and key, where every change
is a new version with an append-only history row (who, which device, when, the diff). A restore makes a new version
from an old one; nothing is rewritten. The store answers the same message types and shapes HK's frontend already
uses, and the checks come from `hk_core/settings/` (the model the HA integration uses too). With commands off, the
page's one allowed write is its own settings save.

`mantel-server import-settings` reads HK's settings once from a Home Assistant that runs HK Frontend.

Detail: [SETTINGS.md](../phase3/SETTINGS.md), [phase8/SETTINGS.md](../phase8/SETTINGS.md).

## Connectors

Connectors live in `hosts/server/mantel_server/connectors/`: Music Assistant (`ma.py`), camera signaling
proxied to Home Assistant (`camera.py`, `camera_still.py`), media art and photos, and the wall-tablet kiosk apps
(`kiosk.py`, `kiosk_satellite.py`, `fully.py`). The read proxies, with RBAC applied, are in `readproxy.py`. Each
module registers WebSocket handlers and read routes through `register(app, hub, hooks)`; `server.py` wires them,
and command-shaped messages are refused by `classify()` before any handler sees them.

Detail: [CONNECTORS.md](../phase3/CONNECTORS.md), [KIOSK.md](../phase8/KIOSK.md).

## Linked mode and Mantel Link

A house's automations, scripts and history depend on actions and entities HK publishes in Home Assistant. Linked
mode keeps them, with the same unique ids and entity ids, after HK moves to Mantel: Home Assistant forwards the
actions to Mantel and Mantel pushes the entities' states back, over one authenticated WebSocket to
`/linked/ws` (`linked.py`, `linked_house.py`, `linked_owners.py`). Ownership moves one wall tablet at a time, and
linked mode is off by default.

The first version was a mode of HK Frontend ("Linked to Mantel Server", protocol 1). **Mantel Link**
(`hosts/ha/custom_components/mantel`, protocol 2) now does this job as its own integration, and also answers
HK Frontend's action names so existing automations keep working.

Detail: [LINKED-MODE.md](../phase5/LINKED-MODE.md), [MANTEL-LINK.md](../phase9/MANTEL-LINK.md),
[NO-HK-FRONTEND.md](../phase9/NO-HK-FRONTEND.md).

## Running Mantel

The same image runs as a Home Assistant App (through Ingress), in Docker Compose behind Caddy, or in an LXC.
Secrets are files, never environment variables. See [Operations](../OPERATIONS.md),
[PACKAGING.md](../phase3/PACKAGING.md) and [HA-APP.md](../phase3/HA-APP.md).

## Where next

- [Building and testing](Building-and-Testing.md): run all of the above locally.
- [Design notes](Design-Notes.md): every design note, one line each.
