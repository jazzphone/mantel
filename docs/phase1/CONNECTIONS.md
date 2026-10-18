# Phase 1, seventh slice: raw connections onto the client's subscription port

Before this slice, cards reached for `hass.connection` themselves: to subscribe to forecasts,
schedules, snoozes and notifications, to signal a camera's WebRTC session, to hear `ready` on
reconnect, and (for the doorbell) to borrow HA's auth for a talk-back socket and an
authenticated POST. Now every subscription goes through `client.subscriptions`, which only
offers a read allowlist, and the doorbell's two writes go through `client.actions`. Mantel's
host refuses those writes, and nothing is sent.

Raw-host total 1,617 → **1,602** (−15). `hk-saver-weather.js` reached 0, so its budget was removed.

## The subscription port's allowlist (`web/client/hk-client.js`)

`hkClient.subscriptions(transport)` is still one frozen port per socket. Its
`subscribeMessage` now passes only these message types (`hkClient.SUBSCRIPTIONS`) and refuses
everything else with code `not_allowed`, without reaching the transport:

| Type | Who uses it |
|---|---|
| `weather/subscribe_forecast` | forecast band, weather page cards and sheet, header's Outside & Ahead, Climate header, menu's high/low, screensaver weather |
| `hk_frontend/settings/subscribe`, `hk_frontend/events/subscribe`, `hk_frontend/page_headers/subscribe`, `hk_frontend/snooze/subscribe`, `hk_music/subscribe` | HK's own feeds (settings, pop-up events, page-header schedule, snoozes, music) |
| `persistent_notification/subscribe` | media page's notifications, menu badge |
| `frontend/subscribe_user_data` | menu's sidebar data |
| `hk_clean_areas/subscribe` | home's cleaning rooms |
| `camera/webrtc/offer` | a camera's WebRTC offer: viewing signaling that starts a picture for this page and changes nothing in the house |
| `subscribe_events` | **only** `event_type: repairs_issue_registry_updated` (`hkClient.SUBSCRIBE_EVENTS`); the whole event bus is not offered |

No listed type is a write (`hkClient.isWrite`), and a test pins that.

## The action port grew two writes

| Action | HA adapter (`hosts/ha/frontend/hk-ha-client.js`) | Mantel / bare client |
|---|---|---|
| `request(path, init)` | `hass.fetchWithAuth(path, init)`: same receiver, path and init | refused, `commands_disabled`, nothing sent |
| `liveSocket()` | resolves `{url, token()}`: HA's websocket URL from `auth.data.hassUrl` (else the page origin), with the token read after an expired one is refreshed; with no `auth`, rejects "not available here", as before | refused, nothing opened |

`hkClient.ACTIONS` is now `callService, callWS, request, liveSocket`.

## What moved

| File | Before | After |
|---|---|---|
| `hk-cameras.js` WebRTC `_start` | `conn.sendMessagePromise` for client config and candidates, `conn.subscribeMessage` for the offer | `client.callWS` (read path, same frames) and `client.subscriptions.subscribeMessage` |
| `hk-cameras.js` `_watchConn` | `ready` on `hass.connection` | `ready` on the client's subscription port (same identity across snapshots) |
| `hk-cameras.js` `_liveStart` | built the websocket URL and token from `hass.auth` | `client.actions.liveSocket()` |
| `hk-cameras.js` `_talkSend` | `hass.fetchWithAuth` | `client.actions.request(url, init)` |
| `hk-weather.js` page cards and sheet `_fc` | `hkWxForecast.watch(hass.connection, …)` | `watch(client.subscriptions, …)`; a replaced port means a fresh watch |
| `hk-saver-weather.js` | the host's connection through `hkCards.hass()` | the client's port; a replaced port releases the old subscriptions and its `ready` listener, ignores their late answers, and keeps the forecast it has until the new one arrives |
| `hk-headers.js` | forecasts, schedule, snoozes on `h.connection` | `hkCards.subscriptions(h)` (new in `hk-base.js`: the given client's port, else the current client's) |
| `hk-home.js` cleaning areas, `hk-media.js` notifications | `hass.connection` | `this.client.subscriptions` |
| `hk-header.js` `now()/today()` | `conn` argument | `port` argument |
| `hk-menu.js` | `h.connection` for badges; `sendMessagePromise('repairs/list_issues')`; `subscribeEvents(cb, 'repairs_issue_registry_updated')` | the current client's port; `client.callWS`; `subscribeMessage({type:'subscribe_events', event_type:…})` (exactly the message `subscribeEvents` sends) |
| `hk-tabbar.js` sidebar prefs | `conn.sendMessagePromise('frontend/get_user_data')` | `client.callWS` |
| `hk-strategy.js` `musicConfigured` | `hass.connection` | the subscription port of `hkHostClient.from(hass)` (slice 10 converts the strategy at its entry) |

`hk-radar.js` had no raw connection to move: it only hands `hass` states to `radarPlan`, which
is card-family work for slice 9.

## Left in place (recorded)

- `hk-skylab.js` `lockDown()` wraps HA's own socket (`sendMessage`/`sendMessagePromise`) and
  `fetch` to hold back writes in the lab. It is a host-side tool by nature, so it moves into
  the HA adapter in slice 12, not onto the client port.
- `hk-settings.js`: the panel's `this._hass.connection.subscribeMessage` and the image upload
  `fetchWithAuth` belong to slice 11, which converts the panel at its entry.

## Behavior

No change in the HA build: the same messages, options and frames go out on the same socket,
and the same `ready` reconnects fire. In two places the code is now more careful, and this
changes nothing visible:
- the screensaver's weather now drops its old subscriptions and listener when the socket is
  replaced. Before, it kept the first connection's `ready` listener for good.
- the menu's repairs subscription is now sent as the `subscribe_events` message itself.
  home-assistant-js-websocket's `subscribeEvents` sends that same message.

## Tests

- `test_clientsubscriptions.js`: every allowlisted type reaches the transport unchanged. Writes,
  unlisted reads, `subscribe_events` with no type or any other type (e.g. `state_changed`), and
  a null message are all refused `not_allowed`, and none reaches the transport. The HA adapter's
  `request` is `fetchWithAuth` with the same receiver, path and init. Its `liveSocket` gives
  `wss://…/api/websocket` and the refreshed token, or "not available here" without auth.
- `test_clientreads.js`: the screensaver weather's forecasts go over the client's port, and a
  host connection planted on `hkCards.hass()` is never touched.
- `test_doorbell.js`: live talk uses `act.liveSocket()` / `live.token()`, and the recorded
  clip uses `act.request(url, init)`.
- `test_tv.js`, `test_actionport.js`: their fakes and the `ACTIONS` list were updated for the port.
- Browser smoke (`tools/headless/client_smoke.py`): on Mantel, a `call_service` subscription
  and a `state_changed` bus subscription are refused `not_allowed`; the talk-back POST and the
  live socket are refused `commands_disabled`; 0 frames are sent.

**Clock fixes.** At 01:05 `test_headers`' "lit 3 h" fixture crossed midnight and failed. This is
the same family as `test_calendar`'s "30 minutes from now" case, which fails after 23:30.
`tests/fixed_clock.js` now pins `new Date()` / `Date.now()` to noon of today's date (dated
constructions are untouched), and both suites load it first. Proven: pinned at 23:45 the
calendar fails and at 01:00 the headers fail; pinned at noon both pass. Slice 8b's inline pin
in `test_weathersheet.js` can switch to the shared helper when it merges.

## Validation (2026-10-18, ~01:10 EDT)

| Check | Result |
|---|---|
| HA frontend suites | **117 suites, all green** (10,582 assertions) |
| HA Python | 665 passed, 1 skipped |
| Mantel | 155 passed |
| Browser smoke | passed: new `subscriptions` line, 0 external requests, 0 exceptions, 0 blocked writes |

## Exact continuation point

> **Superseded:** Phase 1 is complete. See [CARDS.md](CARDS.md#exact-continuation-point).

This slice is complete. Next:
1. ~~Merge slice 8b, switch `test_weathersheet.js` to `tests/fixed_clock.js`, revalidate.~~
   Done in the merge commit: 117 suites, 665 HA Python, 155 Mantel and the smoke all pass; raw-host total 1,600.
2. Slice 9: the card families read `client()`, HkBase owns the Lovelace `hass` entry, and the
   bridge goes away.

The settings panel's raw connection and saves stay in slice 11. `hk-skylab.js` moves into the
HA adapter in slice 12.
