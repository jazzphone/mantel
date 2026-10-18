# Home Assistant host

Phase 1 source now lives here; the running Home Assistant integration is an installed
copy and is not edited by Mantel's build tools.

- `custom_components/hk_frontend/`: imported HA backend, tests, public docs and tools.
- `frontend/hk-ha-client.js`: the first HKClient HA port.
- `../../web/hk/`: existing frontend, kept once and composed into the HA artifact.
- `../../web/client/` and `../../web/cards/`: extracted host-independent source.

Build a new staging directory with `python tools/build_ha.py /tmp/new-ha-build` from the
repository root. Run the JavaScript and HA Python suites in that output. Do not run the
component source directly: it intentionally contains no second frontend copy.

The source publisher under `custom_components/hk_frontend/tools/publish/` uses the same
composition plan. Local staging does not publish, change HACS, or write to production HA.
See `docs/phase1/RESULTS.md` for current scope, validation and remaining migration work.
