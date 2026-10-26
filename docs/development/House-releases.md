# House releases

What `tools/release_house.py` put on the house, newest last, with the checks it made. Earlier releases are recorded in the audits' pages.

## Mantel 0.1.77 (2026-10-26)

- Phases 0-2, 4 and 10 of the improvement plan, plus the hk-detail.js split. Release commit `b4af1b0`; staged from `18e30fb` (the release tool's commit fix), build `8e5775c55ad90794`.
- Released by hand through the Home Assistant connection (the admin token for `tools/release_house.py` is not set up yet): store reload, update `local_mantel`.
- Before: `tools/ci.py full` green on `c2a3616` (14 passed; the Caddy image test skipped, Docker not running); the WebKit sheet review passed 272 sheets.
- After: `/api/version` answers the staged build; `/healthz?strict=1` ok, Home Assistant connected; Mantel Link and HK Frontend relinked within a second; no "ERROR" or "Traceback" in the App's log.
- The migration warning (DEP-3) is gone: "0015_person_phones, 0017_app: files differ from what was applied but the schema is identical; checksums refreshed".
