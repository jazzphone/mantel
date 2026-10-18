# Phase 1, first slice: source boundary and metric client

Avery confirmed HK has no other feature work in flight and authorized Phase 1.
Phase 0 is preserved in commit `48fea33`, pushed to the private Mantel remote with his
explicit authorization. This slice is built and tested locally; it is **not deployed**. Follow-on work is recorded in [STATE-CLIENT.md](STATE-CLIENT.md).

## One development source, a separate HA build

Imported 3,172 tracked files from HK source revision
`38d841bfb01fda39784eab12a01f2d12c0fa1a09` without changing the live source:

- `web/hk/`: existing frontend and artwork, retaining existing paths within the HA artifact.
- `hosts/ha/custom_components/hk_frontend/`: existing HA backend, tests, docs and tools.
  Its frontend is composed into the artifact, not maintained as a second source copy.
- `web/client/hk-client.js`: the first small host-independent client surface.
- `hosts/ha/frontend/hk-ha-client.js`: HA implementation of that surface.
- `web/cards/hk-metric.js`: the existing metric card implementation, extracted rather
  than redesigned. Editor metadata, material/CSS and base action handling remain in the
  existing stat family while the migration proceeds.
- `docs/phase1/SOURCE.json`: original source/destination paths and SHA-256 import evidence.
  These hashes describe the initial import, before the client and packaging edits.

The Apple font and real glyph data are not imported. The original synthetic rectangle
fixture is renamed `glyph-rectangles.js` so it cannot be mistaken for licensed glyphs.
The existing `sf-pro.css` loader is included; it contains no font data. The first build
omitted it because the inherited ignore rule also matched CSS. A specific CSS exception
fixed that omission; real font files remain ignored and guarded.

The original public publisher's build plan now composes Mantel's frontend and HA port,
so the new safe local builder and the publishing source use the same mapping. Its
private-content scan is retained. `tools/build_ha.py` refuses existing output directories,
checks duplicate destinations and scans before writing. It never installs or publishes.
No source directory is moved out of the running HA installation. Do future feature work
in Mantel and install only tested output through the normal release/deployment process.

`hk_core/` still has no extracted backend features: the imported backend remains HA-bound.
The frozen `spikes/hk-snapshot` remains a git-ignored reference for the Phase 0 proof;
it is not the Phase 1 development source. The running Mantel Home prototype still uses
that frozen proof snapshot; switching it to composed current assets is a later integration
step, not something validated by this slice.

## First client contract

The shared metric uses `client.states`, `config`, `locale`, `language`, optional state
formatting, `callWS` for existing statistics helpers, and a host-provided state-icon binder.
The HA adapter preserves function receivers and caches one facade per HA snapshot using
WeakMap. Raw HA objects are bound only inside the HA icon adapter. The shared metric
contains no raw HA references and accepts a non-HA client directly.

The imported stat-family base provides a transitional client getter from the Lovelace
host object. The common base, action handling, statistics/chart helpers and remaining
cards are not fully migrated yet. Existing Lovelace render gating, card/editor registration,
CSS and tap behavior are preserved. Direct client injection demonstrates hostless display;
it is not yet a production Mantel transport or a migrated command/action layer.

Bootstrap definitions signal readiness; the stat family waits for all dependencies, so
parallel resource loading does not require a particular order. The new tests exercise
out-of-order arrival, a hostless metric, formatting fallback, missing states, unit systems,
state updates, host method binding and the icon boundary.

Imported raw-HA dependencies are tracked in `legacy-ha-access.json` with per-file budgets;
new shared code has zero allowance. Counts may decrease, never grow. This is an incremental
migration constraint, not a claim that the rest of the frontend is already independent.

## Validation

- Initial imported frontend: all 110 pre-existing JavaScript suites passed.
- Final frontend: all **111 JavaScript suites passed**, including **20 new HKClient assertions**.
  The existing 80 stat-card assertions and 153 CSS snapshot assertions remain green.
- Built HA artifact: **665 Python tests passed, 1 skipped**.
- Mantel: **143 tests passed** (14 existing aiohttp fixture deprecation warnings).
- Public-content scan and duplicate-destination checks pass.
- Live HK component has no tracked changes relative to its source revision.

Tests ran against temporary builds, with fictional fixtures and the local HA test harness.
No household service calls, live browser sessions or production deployment were used.
The browser/tablet side-by-side and explicit deployment remain pending.

## Reproduce

From the Mantel repository, use a new output directory:

```bash
build_dir=$(mktemp -d)
~/.venvs/mantel/bin/python tools/build_ha.py "$build_dir/ha"
sh "$build_dir/ha/tests/run"
(cd "$build_dir/ha/tests/py" && ~/.venvs/hk-ha-test/bin/pytest -q -p no:cacheprovider)
~/.venvs/mantel/bin/python -m pytest -q
```

Do not run the imported component's source test runner directly: its frontend exists only
in the composed artifact. The built runner points its suites at that same artifact.

## Next slice

Review this source/build boundary, then extract the shared base's client lifecycle and
state/signature access before migrating more card families. Adapt the Mantel prototype
loader to composed assets and verify the metric with its real read-only transport. Keep
HA DOM hooks and commands behind their host adapter as subsequent slices migrate them.
