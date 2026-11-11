#!/usr/bin/env python3
"""Write RELEASE.json for a Docker image: the version, commit and build Mantel Settings -> About shows.

    python tools/write_release.py OUT.json --build-id-file BUILD_ID [--version X.Y.Z] [--commit SHA]
                                  [--config packaging/ha-app/config.yaml]

The same shape tools/stage_ha_app.py writes for the Home Assistant App (``{version, commit, build, staged}``;
hosts/server/mantel_server/pages/about.py reads it from the image root). Docker and the LXC build their image from the
Dockerfile, which runs this in its ``release`` stage: the version is the MANTEL_VERSION build argument
(.github/workflows/release.yml passes the release's own), or, when none is given (``docker compose build`` in the
LXC, a local build), the ``version:`` of packaging/ha-app/config.yaml, the one number every package shares.
``staged`` stays null: a build time in the image would make two builds of one commit differ.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

VERSION = re.compile(r'^version:\s*"?([0-9A-Za-z.+-]{1,32})"?\s*$', re.M)
SAFE = re.compile(r"^[0-9A-Za-z.+-]{1,32}$")


def write(out: Path, *, build_id: str, version: str = "", commit: str = "", config: Path | None = None) -> dict:
    version = (version or "").strip()
    if not version and config is not None and config.is_file():
        m = VERSION.search(config.read_text())
        version = m.group(1) if m else ""
    if not SAFE.match(version):
        raise SystemExit(f"write_release: no usable version (MANTEL_VERSION {version!r}, or {config}'s version: line)")
    commit = (commit or "").strip()
    doc = {"version": version, "commit": commit[:7] if re.fullmatch(r"[0-9a-f]{7,40}", commit) else "unknown",
           "build": build_id.strip(), "staged": None}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc) + "\n")
    return doc


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("out", type=Path)
    p.add_argument("--build-id-file", type=Path, required=True)
    p.add_argument("--version", default="")
    p.add_argument("--commit", default="")
    p.add_argument("--config", type=Path, default=Path("packaging/ha-app/config.yaml"))
    a = p.parse_args(argv)
    write(a.out, build_id=a.build_id_file.read_text(), version=a.version, commit=a.commit, config=a.config)
    return 0


if __name__ == "__main__":
    sys.exit(main())
