# Rules

Every change to Mantel follows these rules. Where a rule can be checked, a test or tool checks it, and a change
that breaks it fails the main suite. [Architecture](Architecture.md) explains the design behind them.

## 1. `hass` stays in the host adapters

The shared frontend talks only to `HKClient` and the host shell. Nothing in `web/` names Home Assistant's object
(`hass`) outside `web/shim/` (Mantel's adapter) and `hosts/ha/frontend/` (Home Assistant's). Home Assistant's
element names and frontend events appear only in the host-shell adapters. `hk_core/` never imports
`homeassistant`, and imports only itself, relatively.

**Checked by** `tests/test_boundaries.py` and `tests/test_shell_boundary.py`.

If you need something from the host that the contract doesn't offer, add it to `HKClient`, `hkShell` or the
`House` port and implement it in both hosts.

## 2. `hk_core` owns feature decisions

A feature's decisions live in `hk_core/` and nowhere else. A feature moves in three steps: extract its logic into
`hk_core` behind the `House` port; run it in Home Assistant through the HA adapter (`HaHouse`); only then wire
Mantel's own adapter (`MantelHouse`). The hosts keep only their own steps: following states, timers, sequences of
service calls, storage. Test the decisions once, in `tests/test_hk_core_*.py`.

## 3. Commands are off by default

Mantel Server sends a command to the house only while house commands are on. They start off; an Owner turns them on
in Mantel Settings (General → Allow Control of the House, `server_settings.py`) after a fresh sign-in, and the change
is audited before it is applied. `--commands-enabled` is only the value for the very first start. The kill switch
(`--read-only`, `MANTEL_READ_ONLY`, the App's `read_only`) is a start-up option no client message, REST call or
setting can override: with it, the house stays read-only. Every command is classified, checked against the person's and
the device's role, refused where roles deny, and written to the audit log **before** anything is sent. The only
code a house command asks for is the house Alarm PIN, and only for the alarm.

Tests and checks run with commands off, or against a fake connection that sends nothing anywhere. The one
exception is the end-to-end run against the scratch Home Assistant (`tools/e2e/gateway_e2e.py`), which refuses
any other Home Assistant.

## 4. Secrets are files

Home Assistant and Music Assistant tokens, the at-rest key and tunnel tokens are read from files (Docker secrets,
or a folder such as `~/.config/mantel/`), never from environment variables, command-line arguments, the image
or the repository. `*.token`, `.env` and `secrets/` are git-ignored. Don't paste a token into an issue, a pull
request or a chat.

## 5. Apple's fonts and glyphs never ship

SF Pro and SF Symbols are Apple's and licensed. They stay out of the repository, out of every build and package,
and out of every image, including the docs' screenshots. Each home supplies its own copy. Git ignores them, and
`tests/test_proof1_guards.py` checks that none is tracked.

## 6. Nothing personal in the repository

Code, tests, fixtures, docs, screenshots and commit messages use invented homes, people and devices only: no real
names, addresses, domains, network addresses or pictures of a home. Tests and checks use fictional users and the
scratch Home Assistant (`tools/testha/`), never a real one.

**Checked by** `tools/check_private.py`, with your own list of words kept outside the repository
(`HK_PRIVATE` or `HK_PRIVATE_FILE`). Run it as a pre-commit hook; see
[Building and testing](Building-and-Testing.md#private-words). `tools/build_ha.py` and the publishers also refuse
to build when they find private network addresses, keys or tokens.

## 7. Every route declares its guard

Every route Mantel Server serves says who may call it with `@guard(...)` (`guards.py`): who (a session, a person, an
Owner or Admin, an Owner), whether a wall tablet's session may, from which door, and how fresh the sign-in must be.
A route with its own check (sign-in, the app's DPoP routes, `/linked/*`, the media proxy, static files, health) is
on the test's short list instead, with its reason. Every route that changes something names the audit action it
writes, or says why it writes none. The row goes through `audit.config`, before the change: no row, no change
(503 `audit_unavailable`).

**Checked by** `tests/test_route_guards.py`, which builds the whole app and walks its router.

Write a new route's guard first, as strict as the route allows; a check only the handler can make (an Admin never
manages an Owner, say) stays in the handler as well. See [Architecture](Architecture.md#route-guards-and-the-audit-of-changes).
