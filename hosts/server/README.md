# hosts/server/

Mantel Server. Today it holds the Phase 0 state hub prototype (`mantel_server/`): one read-only upstream `subscribe_entities` connection to Home Assistant, an in-memory copy of every state, and a loopback client WebSocket that serves filtered, coalesced diffs. Live commands are disabled. The isolated Proof 2 HTTP endpoint evaluates one fictional light command in dry-run mode and records its decision; see `docs/proof2/RESULTS.md` for the offline demo and limits. See the top of `mantel_server/server.py` for the client protocol and the repo README for how to run it.

- `mantel_server/state.py` store + HA compressed-diff handling
- `mantel_server/registry.py` area/device/entity registry index
- `mantel_server/view.py` per-client selection, diffing and coalescing (the part with the tests)
- `mantel_server/ha_client.py` the HA connection (can only send read messages)
- `tools/measure.py` upstream-vs-downstream traffic measurement

Mantel Connect has a separate TLS identity-only proof receiver (`mantel-server connect-proof`), which takes no HA token and never exposes the state hub. Its HA App and deployment steps are in `packaging/mantel-connect/README.md`; live installation remains pending.
