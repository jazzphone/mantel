# Phase 1, third slice: client subscriptions and settings discovery

Completed locally. Production HK has not been edited or deployed.

## Completed

`HKClient.subscriptions` is a frozen, limited subscription port. Its identity follows
its underlying transport, so new state snapshots do not create duplicate subscriptions.
It forwards message subscriptions and reconnect listeners with the correct receiver;
it does not expose the raw connection, socket, or host object. Both host adapters use
it, including when a connection changes on an otherwise cached snapshot.

The HA adapter owns current-client discovery from the HA root. Mantel explicitly
publishes its current client from its Host when a snapshot changes. Shared settings
no longer query the HA DOM or reach into a raw connection. Settings and house-event
subscriptions attach through the current client's port, including late adapter loading.
A replacement port closes both old subscriptions and removes their reconnect listeners.
Generation guards reject obsolete callbacks and clean up late subscription promises.
The existing retry/backoff and reconnect behavior remains in `hkSettings.subscribe`.

`hkCards.client()` and `hkCards.onClient(fn)` provide the client-based counterparts to
the legacy hub. Listeners receive one notification per new client snapshot and can
unsubscribe. Explicit client injection, legacy card inputs and Mantel's host updates
feed that hub. The legacy `hass()/onHass` API remains for unmigrated consumers.

Settings checks subscribe immediately on host-ready/update events, then also check
at a two-second interval to catch replacement connections on pages with no HK cards.
An initial fast check covers bootstrap ordering. Other settings helpers still accept
legacy inputs; this slice migrates discovery and feed attachment, not the settings UI
or all action methods. Mantel's popup/user-data stand-ins remain stand-ins.

## Validation

- **113 frontend JavaScript suites passed**, including **32 new subscription assertions**.
  These cover host discovery, private/stable transport ports, late adapter arrival,
  duplicate prevention, client notifications/unsubscribe, connection replacement,
  stale settings/events, ready reconnects, and lost-host subscription cleanup.
  Existing retry/backoff tests remain green; the new suite also checks cleanup of
  a subscription promise that resolves after teardown.
- **665 HA Python tests passed, 1 skipped.** The first run had three socket-permission
  failures; those three passed when rerun with localhost access. The frontend suite
  ran against the final composed artifact.
- **147 Mantel tests passed**, with 14 existing aiohttp fixture deprecation warnings.
- The real current Home page passed the isolated Chrome smoke test. A fictional metric
  changed **21.4 °C → 22.8 °C** through the actual local WebSocket, produced exactly one
  client notification, and retained the current host-client identity. A fictional
  settings subscription changed its place label from **Offline before → Offline after**.
- Commands returned `commands_disabled`; zero external requests and zero uncaught
  browser exceptions. No production credentials, fixtures, HA connection or house
  commands were used.
- Settings' lexical raw-host budget tightened **21 → 18**. Other legacy budgets did
  not grow. This is a source boundary measurement, not a performance claim.

Reproduce using the composed-build commands in `RESULTS.md` and:

```bash
~/.venvs/mantel/bin/python -m pytest -q
~/.venvs/mantel/bin/python tools/headless/client_smoke.py
```

## Exact continuation point

**Superseded:** artwork invalidation and music feeds are done; see [`MUSIC-ART.md`](MUSIC-ART.md)
for the current continuation point (read-only detail/saver consumers).

This slice is complete; no partial implementation is waiting on a usage reset.
Phase 1 remains in progress. Next migrate the remaining shared reconnect/subscription
users in `web/hk/cards/hk-base.js`: artwork invalidation (`artWatch`) and music feeds.
Use the stable client subscription port and preserve cleanup, retry and state-staleness
behavior. Then move the read-only detail/saver consumers from `hkCards.hass()/onHass`
to `client()/onClient`, extracting any missing client methods before changing them.
Their action paths and HA shell hooks require separate host-adapter work.

Keep the live HK installation unchanged until an explicit deployment. Guided production
installation/pairing, settings editing, commands, shell/menu and camera-video migration
remain later work. No prototype restart is required for backend changes in this slice;
reload its page to load the new frontend.
