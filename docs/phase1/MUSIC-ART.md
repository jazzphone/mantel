# Phase 1, fourth slice: artwork reconnect handling and music feeds

Completed locally. Production HK has not been edited or deployed.

Follows [`SUBSCRIPTIONS.md`](SUBSCRIPTIONS.md) and uses the same pattern: the host adapter
owns discovery, shared code attaches through the current client's stable
`HKClient.subscriptions` port, a replacement port ends the old subscriptions, and
generation guards ignore late callbacks.

## What moved behind the adapters (`web/hk/cards/hk-base.js`)

- **Artwork reconnect handling (`artWatch`).** It watches the client's subscription port,
  not `hass.connection`. `clientSeen` attaches it, so a legacy card snapshot, an explicitly
  injected client and Mantel's host updates all reach it. The old raw hook in `hubSeen` is gone.
  On `ready` it still clears every kept art signature, marks the states held at that moment
  as stale and increments `staleEpoch`. It now reads those states from `hkCards.client()`.
- **Artwork signing (`artSign`, `_artImage`, `hkCards.artUrl`).** They now sign through the
  client's `callWS`: `_artImage` passes `this.client`, and `artUrl` passes `hkCards.client()`.
  `artSign` still accepts a legacy host input and adapts it through `hkHostClient.from`.
  `hkClient.is()` (new, `web/client/hk-client.js`) prevents a client from being wrapped twice.
  Batching, the 20 h re-sign window, the 3,000-entry cap and direct-URL fallback are unchanged,
  as is the one-retry-per-image path.
- **Music feeds (`hkMusic.attach`).** `hk_music/subscribe` and the saved-focus
  `frontend/subscribe_user_data` now attach through the subscription port and still use
  `hkSettings.subscribe` for retry/backoff. Cards may pass either a legacy host input or a client.
  The focus write (`frontend/set_user_data`) uses the newest client's `callWS`, so it no longer
  depends on the raw `connection.sendMessagePromise`. In HA this is the same call. In Mantel
  it is refused as `commands_disabled`, as before.
- **Music self-attach.** Pages without a music card now find the client through
  `hkHostClient.current()`, not the `<home-assistant>` DOM. They also re-check on
  `hk-host-client-ready`/`hk-client-update`. The existing 200 ms × 300 poll remains.

## Preserved behavior, and the deliberate cleanups

Kept unchanged:
- retry/backoff: 1 s, doubling, capped at 30 s, and reset by a success
- our own resubscribe on `ready` with `resubscribe: false`
- one subscription pair per transport across state snapshots
- signature invalidation and stale marking on `ready`
- `staleEpoch` 0 until the first reconnect
- echo suppression while a focus write is in progress
- `_reset` semantics for tests

The settings migration established these cleanups. They now apply here too:
- A replacement port **closes the old music pair** and its reconnect listeners. Before this,
  the old pair stayed subscribed to a dead connection. Late callbacks from the old pair are ignored.
  This includes the fallback path without `hkSettings`.
- A replacement port **removes artwork's `ready` listener** from the old port. Before this, a
  late `ready` from a replaced socket could clear signatures and mark the *new* server's states stale.

## Tests

- New `tests/test_musicart.js`, **34 assertions**:
  - one artwork listener per transport
  - client-signed art and reuse of kept signatures
  - `ready` clears signatures, marks only states held at that moment, and bumps the epoch
  - a replacement moves the listener, and the old socket's `ready` marks nothing
  - `artUrl` uses the current client
  - one music pair per transport, with `resubscribe: false`
  - focus writes go through the newest client
  - `ready` resubscribes both feeds
  - a replacement closes the old pair and its listeners, and ignores stale callbacks
  - a refused focus write does not jam the model
  - backoff runs **1, 2, 4, 8, 16, 30, 30 s**, then resets to 1 s after a success
  - a retry due after replacement leaves the old transport alone
  - the fallback without `hkSettings` ignores stale callbacks
  - a late host adapter attaches music and artwork without a DOM query

  Checked against the previous `hk-base.js`: the backoff, `ready`, stale and invalidation
  assertions already passed there (they pin preserved behavior). The 8 replacement/client-port
  assertions failed there, as expected.
- Fixture shapes were updated because the port requires a real transport:
  - `test_art`/`test_mosaic` fake connections gained `subscribeMessage`.
  - `test_music`'s fake input gained `callWS`, which forwards to `sendMessagePromise` as HA does.
  - `test_art` calls `_artImage` with a client.
  - `test_clientsubscriptions` counts only settings feeds, because hkMusic now attaches
    through the same port.

## Validation

- **114 frontend JavaScript suites passed** (113 before, plus `test_musicart`), against a fresh composed HA build.
- **665 HA Python tests passed, 1 skipped.**
- **147 Mantel tests passed** (14 existing aiohttp fixture deprecation warnings).
- Isolated Chrome smoke (`tools/headless/client_smoke.py`) passed with fictional data:
  - The metric (21.4 → 22.8 °C) and settings (Offline before → after) updates still work.
  - The music configuration arrived through the Mantel client port. The update
    **Offline Office → Offline Den** came over the actual local WebSocket, with exactly one
    `hk_music/subscribe` subscription.
  - A focus write was refused locally and did not jam the model.
  - `artUrl` on an external URL came back unsigned (signing refused offline; the image was never loaded).
  - `staleEpoch` stayed 0.
  - Commands returned `commands_disabled`. There were zero blocked writes, zero external
    requests and zero browser exceptions. No HA connection, credentials or house commands were used.
- Raw-host budget for `web/hk/cards/hk-base.js` tightened **83 → 64**. No other budget changed.

## Exact continuation point

**Superseded:** the read-only detail/saver consumers are done; see [`DETAIL-SAVER.md`](DETAIL-SAVER.md)
for the current continuation point (slice 6, action paths).

This slice is complete. Next, move the read-only detail/saver consumers from
`hkCards.hass()/onHass` to `hkCards.client()/onClient`. Consumers include `hk-detail.js` sheets,
`hk-saver*.js` and `hk-saverclock.js`. Extract any missing client methods (read-only `callWS`
reads, formatting) before changing them. Their action paths (`callService`), `hk-cameras.js`'s own
`ready` listener and `hk-weather.js`/`hk-saver-weather.js`'s raw connection use need separate
host-adapter work. The legacy hub stays until those consumers move.
