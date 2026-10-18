"""A FAKE HDHOMERUN for Live TV tests: the two things Mantel and go2rtc ask a real one for.

    GET /lineup.json            the tuner's channels ([{GuideNumber, GuideName, HD, URL}])
    GET /auto/v<number>         the channel as MPEG-TS (a file played in a loop, paced at ~real time)
    GET /stats                  {"streams": [...open...], "served": n}: what was asked (tests check it)

It never touches a real tuner. The stream is any MPEG-TS file (e.g. MPEG-2 video + AC-3 audio made with
ffmpeg's test sources, as an HDHomeRun sends); without one it sends nothing but the lineup.

    python tools/e2e/fake_tuner.py --port 5004 --ts /path/to/tuner.ts [--bind 0.0.0.0]
"""
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from aiohttp import web

LINEUP = [
    {"GuideNumber": "4.1", "GuideName": "WTST-HD", "HD": 1},
    {"GuideNumber": "7.1", "GuideName": "WFAK-DT", "HD": 1},
    {"GuideNumber": "9.2", "GuideName": "WSUB", "HD": 0},
]
CHUNK = 188 * 348            # whole TS packets, ~64 KiB
RATE = 600_000               # bytes per second (~4.8 Mbit/s, an HD broadcast's order of magnitude)


def make_app(ts: Path | None = None, lineup: list[dict] | None = None, rate: int = RATE,
             guide: bytes | None = None, advertise: str | None = None) -> web.Application:
    """``guide``: an XMLTV file served at /xmltv.xml too (a real tuner has none; tests use one URL less).
    ``advertise``: the host[:port] the lineup's stream URLs name (default: the Host it was asked on), e.g.
    host.docker.internal:P so a go2rtc container reaches a tuner on this machine's loopback."""
    app = web.Application()
    app["stats"] = {"streams": [], "served": 0, "lineups": 0}
    channels = lineup or LINEUP
    if guide is not None:
        async def xmltv(_request: web.Request) -> web.Response:
            return web.Response(body=guide, content_type="application/xml")
        app.router.add_get("/xmltv.xml", xmltv)

    async def lineup_json(request: web.Request) -> web.Response:
        app["stats"]["lineups"] += 1
        host = advertise or request.host
        return web.json_response([{**c, "URL": f"http://{host}/auto/v{c['GuideNumber']}"} for c in channels])

    async def stream(request: web.Request) -> web.StreamResponse:
        number = request.match_info["number"]
        if number not in {c["GuideNumber"] for c in channels}:
            return web.Response(status=404)
        if ts is None or not ts.is_file():
            return web.Response(status=503, text="no tuner available")
        data = ts.read_bytes()
        resp = web.StreamResponse(headers={"Content-Type": "video/mp2t"})
        await resp.prepare(request)
        app["stats"]["streams"].append(number)
        app["stats"]["served"] += 1
        try:
            while True:
                for i in range(0, len(data), CHUNK):
                    await resp.write(data[i:i + CHUNK])
                    await asyncio.sleep(CHUNK / rate)
        except (ConnectionResetError, asyncio.CancelledError):
            pass
        finally:
            app["stats"]["streams"].remove(number)
        return resp

    async def stats(_request: web.Request) -> web.Response:
        return web.json_response(app["stats"])

    app.router.add_get("/lineup.json", lineup_json)
    app.router.add_get("/auto/v{number}", stream)
    app.router.add_get("/stats", stats)
    return app


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--port", type=int, default=5004)
    p.add_argument("--bind", default="127.0.0.1")
    p.add_argument("--ts", type=Path, default=None)
    p.add_argument("--lineup", type=Path, default=None, help="a JSON lineup instead of the built-in three")
    p.add_argument("--advertise", default=None, help="host[:port] the lineup's stream URLs name")
    a = p.parse_args()
    lineup = json.loads(a.lineup.read_text()) if a.lineup else None
    web.run_app(make_app(a.ts, lineup, advertise=a.advertise), host=a.bind, port=a.port, print=None)


if __name__ == "__main__":
    main()
