# Developing Mantel

These pages are for people who want to change Mantel's code: Mantel Server, the HK web app, the shared feature
logic, the Home Assistant integrations, the packaging or the Apple apps. If you only want to run Mantel, start with
[Operations](../OPERATIONS.md) instead.

| Page | Read it when you want to |
|---|---|
| [Architecture](Architecture.md) | understand the pieces, how they talk, and the boundaries the tests enforce |
| [Building and testing](Building-and-Testing.md) | set up a virtualenv, run the test suites and checks, run Mantel Server by hand |
| [Rules](Rules.md) | know the project rules every change has to follow |
| [Releasing](Releasing.md) | publish a version: the images, the Home Assistant add-on repository, and what to check |
| [Screenshots](Screenshots.md) | regenerate or add the screenshots in `docs/images/` |
| [Design notes](Design-Notes.md) | find the detailed design note or build record behind a part of the code |
| [Engineering audit](Audit-2026-10.md), [second pass](Audit-2026-10-second-pass.md) | see what the audits found and fixed, what was deferred and why, and the checks they ran |

## The short version

```bash
python3.12 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/python -m pytest -q
```

That runs Mantel's main suite offline, with no Home Assistant needed. Everything else (the Home Assistant
package's own suites, the headless browser checks, the scratch Home Assistant, the end-to-end runs) is in
[Building and testing](Building-and-Testing.md).

Before you send a change, read the [Rules](Rules.md). The most important ones are enforced by tests, so a green
main suite already covers most of them.
