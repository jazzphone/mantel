# hosts/server/

Mantel Server: the `mantel_server` package (an aiohttp service, run as `mantel-server`) and `mantel_connect`
(the Mantel Connect App's side of the sidebar link). What the pieces are and how they talk is in
[docs/development/Architecture.md](../../docs/development/Architecture.md); how to run the suites and the server
by hand is in [Building and testing](../../docs/development/Building-and-Testing.md).

A few starting points in `mantel_server/`:

- `server.py`: the app, its middlewares, the hub socket (`/ws`) and its client protocol (at the top).
- `state.py`, `registry.py`, `view.py`: the copy of Home Assistant's states and registries, and each client's
  filtered, coalesced diffs.
- `ha_client.py`: the read connection to Home Assistant (it cannot call a service) and `HaCommander`, the
  separate command connection made only with `--commands-enabled`.
- `gateway.py`, `rbac.py`, `authz.py`: the command gateway, roles and grants.
- `settings_store.py`, `features.py`, `house.py`: HK's settings and the features, through `hk_core`.
- `tools/measure.py`: upstream-vs-downstream traffic measurement.
