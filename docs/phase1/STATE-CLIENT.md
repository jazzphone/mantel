# Phase 1, second slice: shared card state and current Mantel assets

Built and validated locally. Production HK has not been deployed or edited.

Follow-on completed: client subscriptions/settings discovery and update listeners; see
[`SUBSCRIPTIONS.md`](SUBSCRIPTIONS.md) for current evidence and the next continuation point.

## What changed

`web/client/hk-card-state.js` now owns the common state lookup, entity/group dependency
signature, render gate and forced-redraw bookkeeping. `HkBase` delegates to that helper
through `client`, while retaining its existing material, DOM lifecycle and action bridge.
Both Lovelace's existing input setter and explicit client injection use the same gate.
A forced statistics/module wake remembers its signature, so the next unchanged snapshot
is gated. Module readiness also wakes connected client-only cards; detached cards catch
up on their next update. Config changes still rebuild immediately.

The first-slice metric-specific client/state overrides were removed. The metric now uses
its shared base's state lifecycle, rather than a separate metric-only path. The HA port
preserves the legacy input API; Mantel has its own port in `web/shim/mantel-client.js`.
The Mantel port binds only state data to icons and does not load the HA port.
Definitions announce readiness, including the shared base's prerequisites, so a late
client/controller/host module does not leave a half-initialized card family.

Mantel Server's default frontend source is now `web/hk`, not the frozen Phase 0 snapshot.
`web/shared-assets.json` is the common composition map used by the HA publisher/build
and Mantel's `/hk/` asset serving. User overrides still win, and mapped assets remain
restricted to the web directory and authenticated sessions. Home imports shared modules
from the web source directly, which remains compatible with the old prototype's static
route while its backend awaits a restart. Restart an already-running Mantel prototype
to apply the new server default/composition routes; no HA restart or deployment was done.

The frozen snapshot directory still holds the existing private fixture feeds and user-
supplied font/glyph files. Those inputs remain local and untracked; it is no longer the
frontend code source for a newly started Mantel Server.

`setCardHost` explicitly supplies the metric's client in Mantel, including nested card
wrappers. Its local compatibility snapshot is retained for the inherited action bridge,
which refuses writes. Other card families still use compatibility input while their
individual methods migrate. This does not yet migrate the shared action layer or every
HA DOM hook. `hkCards.hass()/onHass`, settings connections and subscriptions are next.

Current Home exposed a compatibility issue in the old proof stub: it advertised a fake
shadow root, causing current menu code to attempt a mount into a plain object. The stub
now correctly reports no HA shadow root. Shell modules therefore defer. Menu/tab bar,
background shell and camera-video work are still outside this slice.

## Evidence

- **112 JavaScript suites passed**, including 20 new client-state assertions. Existing
  metric, actions, subscription, render and CSS snapshot suites remain green.
- **665 HA Python tests passed, 1 skipped**, against a temporary composed HA build.
- **147 Mantel tests passed**, including four authenticated current-asset/override/path
  confinement cases. There are 14 existing aiohttp fixture deprecation warnings.
- Legacy raw-host symbol budgets tightened: base 89→83, stat family 18→17, Home 14→12.
  These are lexical migration budgets, not performance measurements.
- Offline Chrome loaded the real current Home page, then instantiated the real metric
  using the same card factory/host bridge as Home's cards. A fictional state changed
  from **21.4 °C to 22.8 °C** through the server's actual local WebSocket and client port.
  The metric's client was the Host's Mantel client; the HA adapter was absent.
- A service-message attempt returned `commands_disabled` before transport. The browser
  made **zero external requests** and reported **zero uncaught exceptions**.

The browser run used a temporary database, fictional user/state/settings, no production
credentials or captured personal fixtures, a fresh Chrome profile and a local-only
request policy. A WebSocket guard was installed before navigation. HA was not connected.
This is transport/render integration evidence, not a new household-dashboard screenshot
comparison or an A/B performance result.

One existing chip signature test borrowed a prototype method with a plain `_hass`-only
mock. Its mock now supplies the client contract used by the shared base; the existing
palette-load signature assertion is unchanged.

## Reproduce

Build and run the same frontend/HA suites as `RESULTS.md`, then:

```bash
~/.venvs/mantel/bin/python -m pytest -q
~/.venvs/mantel/bin/python tools/headless/client_smoke.py
# Optional screenshot, containing only fictional smoke-test data:
~/.venvs/mantel/bin/python tools/headless/client_smoke.py --shot /tmp/mantel-client.png
```

Expected smoke result:

```json
{
  "home_ready": true,
  "client": "mantel",
  "initial": "21.4 °C",
  "updated": "22.8 °C",
  "commands": "commands_disabled",
  "external_requests": 0,
  "browser_exceptions": 0
}
```
