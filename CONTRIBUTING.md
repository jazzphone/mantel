# Contributing to Mantel

Thanks for helping. Bug reports, fixes, docs and screenshots are all welcome.

## Before you start

- **Read the rules**: [docs/development/Rules.md](docs/development/Rules.md). The short version: Home Assistant's object stays in the host adapters, feature decisions live in `hk_core`, commands are off by default, secrets are files, Apple's fonts never ship, and nothing personal goes in the repository.
- **For anything bigger than a small fix**, open an issue first so the approach can be agreed before you build it.
- **Security problems** go to [SECURITY.md](SECURITY.md), not an issue.

## Set up and run the tests

```bash
python3.12 -m venv .venv
.venv/bin/pip install -e '.[dev]'
npm ci --prefix tools          # esbuild, pinned: the builds minify the web app with it (Node.js 18 or later)
.venv/bin/python -m pytest -q
```

That's the main suite, offline, no Home Assistant needed. [Building and Testing](docs/development/Building-and-Testing.md) covers the rest: the Home Assistant suites, the frontend suites, the headless browser checks and the scratch Home Assistant.

## Keep personal details out

`tools/check_private.py` refuses words you list, such as your name, your domain or your home's network, in tracked files and commit messages. The list stays outside the repository. Install it as a pre-commit hook:

```bash
printf '%s\n' 'your-surname' 'yourdomain\.com' '192\.168\.1\.' > ~/.config/mantel/private-words
cat > .git/hooks/pre-commit <<'HOOK'
#!/bin/sh
HK_PRIVATE_FILE=~/.config/mantel/private-words exec python3 tools/check_private.py
HOOK
chmod +x .git/hooks/pre-commit
```

Use made-up names and the documentation address ranges (`192.0.2.x`, `example.com`) in tests, docs and screenshots.

## Pull requests

- One change per pull request, with tests for behavior changes.
- Run the main suite, `python tools/check_links.py` and `python tools/package_check.py` before you push.
- Changing a page? Regenerate the docs screenshots it appears in: `python tools/headless/gallery.py --only <name>` ([Screenshots](docs/development/Screenshots.md)).
- Add a line to [CHANGELOG.md](CHANGELOG.md) under **Unreleased** for anything a user would notice.

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE).
