# Security policy

Mantel holds the keys to a home: it signs people in, decides who may unlock a door or disarm an alarm, and keeps a Home Assistant token. Please report security problems privately, so they can be fixed before they are known.

## Reporting a vulnerability

Use GitHub's private reporting: on this repository, open **Security** → **Report a vulnerability**. Please include:

- what an attacker can do, and from where (the home network, the internet through a tunnel, a wall tablet, a signed-in person with a lower role);
- the steps or a proof of concept;
- the version (Mantel Settings → **About**) and how Mantel runs (Home Assistant App, Docker, LXC).

Don't open a public issue, and don't test against a home that isn't yours.

You'll get an answer as soon as the maintainer can look at it. A fix ships as a new release, with credit in the [changelog](CHANGELOG.md) unless you'd rather not be named.

## In scope

- Mantel Server (`hosts/server/`), its sign-in, sessions, wall-tablet credentials, roles and grants, the command gateway and its audit log.
- The packaging in `packaging/` (the Home Assistant App, Docker images, the LXC script, the push relay).
- Mantel Link and HK Frontend's Home Assistant integrations (`hosts/ha/`).
- The iPhone, iPad and Mac apps (their own repositories since 2026-11-08: `jazzphone/mantel-ios` and `jazzphone/mantel-mac`).

Problems in Home Assistant, Music Assistant or a browser itself belong to those projects.

## How Mantel is meant to be safe

[Security Model](docs/guide/Security-Model.md) describes what Mantel protects and how: commands off until an Owner turns them on (and a server-side kill switch that keeps them off), every command checked against roles and written to the audit log first, secrets read from files only, and passwords hashed with Argon2id.
