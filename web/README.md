# web/

The HK web app: cards, modules and the shell. One copy, talking only to `HKClient` — never to `hass`.
Empty until Phase 1 (PLAN §9), when it moves in from `custom_components/hk_frontend`.
`tests/test_boundaries.py` fails if anything here references `hass.`.
