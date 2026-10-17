from __future__ import annotations

import logging
import sys

from aiohttp import web

from .config import parse_args
from .ha_client import TokenMissing, read_token
from .server import build_app


def main(argv: list[str] | None = None) -> int:
    cfg = parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        token = read_token(cfg.token_file)
    except TokenMissing as exc:
        print(f"mantel-server: {exc}\nCreate a long-lived access token in Home Assistant and save it there (chmod 600).",
              file=sys.stderr)
        return 2
    app = build_app(cfg, token)
    print(f"mantel-server: listening on http://{cfg.host}:{cfg.port}/dev (read-only; commands disabled)")
    web.run_app(app, host=cfg.host, port=cfg.port, print=None)
    return 0


if __name__ == "__main__":
    sys.exit(main())
