# Proof 2: dry-run permissions and audit — 2026-10-17

**Passed offline.** A fictional Owner's `light.turn_on` request for `light.proof2_demo`
is allowed; a fictional Child's identical request is denied. Both decisions are committed
to SQLite before the response. Every response says `dry_run: true` and `executed: false`.
No production credentials, database, Home Assistant connection or household actions were used.

## What was built

- `hosts/server/mantel_server/proof2.py`: separate `POST /api/proof2/command` endpoint,
  accepting exactly `{"dry_run":true,"cmd":"light.turn_on","target":"light.proof2_demo"}`.
  It has no HA/MA transport, service callback, or live-execution option.
- It resolves the session and current linked role itself, including authentication denials
  in the audit. The existing Host/Origin middleware still wraps it; an Origin is required.
  Requests rejected by that outer middleware never reach the evaluator or its audit.
- Only an exact proof-only Owner grant exists. No other role inherits permission. The
  evaluator supports explicit denies overriding allows; grant precedence is tested.
  Browser-supplied identities, roles, grants, devices, or service data are rejected.
- `Store.command_audit` records timestamp, server-resolved actor and role, device `unknown`,
  recognized action and target, decision/reason, dry-run flag and socket source IP. Unknown
  actions/targets are stored as null rather than persisting arbitrary client content.
  Authentication failures have a null actor/role. Audit failure returns 503, never an allow.
- Audit writes are append-only through the application; SQLite triggers reject ordinary
  UPDATE/DELETE. This does not protect against someone who can replace the database or schema.
- Existing WebSocket command messages still receive `commands_disabled`. The HA client's
  outbound allowlist and read proxies were not expanded.

## Evidence and reproduction

Run from `/Volumes/data/mantel`, using the existing development environment:

```bash
PYTHONPATH=hosts/server ~/.venvs/mantel/bin/python hosts/server/tools/proof2_demo.py
~/.venvs/mantel/bin/python -m pytest tests/test_proof2.py -q
```

The demo uses a temporary database, synthetic sessions and in-process requests; it starts
no listener and deletes the database when finished. Representative results:

| Actor | Role | HTTP | Decision | Reason | Executed | Audit id |
|---|---|---|---|---|---|---|
| fictional-owner | owner | 200 | allowed | granted | false | 1 |
| fictional-child | child | 403 | denied | no_grant | false | 2 |

Both audit rows contain action `light.turn_on`, target `light.proof2_demo`, device `unknown`
and `dry_run=1`. The demo uses timestamp 1000 and no socket source IP. HTTP integration
tests verify the socket IP is `127.0.0.1`, persistent rows survive reopening the DB, and
ordinary UPDATE/DELETE are refused.

**Validation:** 22 new tests; full suite **121 passed**. Coverage includes explicit-deny
precedence, malformed/unsupported requests, forged identity claims, role changes,
expired/unlinked/missing sessions, Origin checks, audit persistence, audit write failure,
and continued WebSocket command blocking. Upstream HA sends and proxy requests are
poisoned in these new integration tests. The full suite emitted 14 existing aiohttp
test-fixture deprecation warnings. Local test listeners required sandbox permission.

## Limits and next review

This proves a dry-run decision and durable audit record, not production RBAC or a live command.
Device enrollment/intersection, sensitive-action step-up, room/entity grants, schedules,
audit retention/UI, and permission filtering of reads remain later work. The fictional
light does not need to exist in HA and is never looked up there.

Proof 3's remaining Mantel Connect / Companion app test is next. Plan its authenticated
Ingress identity channel and installation separately; production HA installation needs
Avery present. Phase 1 still requires all four proofs and a quiet HK.
