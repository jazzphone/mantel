"""Capture HK's own read-only feeds from HA into spikes/hk-snapshot/fixtures/ (git-ignored: personal data).

SAFETY: this tool can send ONLY the messages in CAPTURE_ALLOWED (subscriptions to HK's read-only
feeds), after `auth`. Anything else raises before it is sent. The list is pinned by
tests/test_proof1_guards.py: nothing that writes, ever (set, save, remove, delete, add, update,
order, favorite, touch, black, seen, mute, test, sign, queue, play, transfer ...).

    HA_URL=http://homeassistant.local:8123 python hosts/server/tools/capture_fixtures.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

import aiohttp

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "hosts" / "server"))
from mantel_server.ha.ha_client import read_token  # noqa: E402

OUT = ROOT / "spikes" / "hk-snapshot" / "fixtures"

# message type -> fixture file name. Exactly these; each is a `subscribe` (read-only) feed.
CAPTURE_ALLOWED = {
    "hk_frontend/settings/subscribe": "settings.json",
    "hk_frontend/page_headers/subscribe": "page_headers.json",
    "hk_frontend/snooze/subscribe": "snooze.json",
    "hk_music/subscribe": "music.json",
}


class CaptureBlocked(Exception):
    pass


def check_capture(message: dict) -> None:
    if message.get("type") == "auth":
        return
    if message.get("type") not in CAPTURE_ALLOWED or set(message) - {"id", "type"}:
        raise CaptureBlocked(f"capture tool may not send {message!r}")


async def main() -> None:
    token = read_token(Path("~/.config/mantel/ha_token"))
    ws_url = os.environ.get("HA_URL", "http://homeassistant.local:8123").rstrip("/").replace("http", "ws", 1)
    OUT.mkdir(parents=True, exist_ok=True)
    async with aiohttp.ClientSession() as s, s.ws_connect(f"{ws_url}/api/websocket", max_msg_size=0) as ws:
        await ws.receive_json()
        auth = {"type": "auth", "access_token": token}
        check_capture(auth)
        await ws.send_json(auth)
        if (await ws.receive_json()).get("type") != "auth_ok":
            raise SystemExit("HA rejected the token")
        ids = {}
        for i, kind in enumerate(CAPTURE_ALLOWED, start=1):
            msg = {"id": i, "type": kind}
            check_capture(msg)
            ids[i] = kind
            await ws.send_json(msg)
        got: dict[str, object] = {}
        deadline = asyncio.get_running_loop().time() + 10
        while len(got) < len(ids) and asyncio.get_running_loop().time() < deadline:
            try:
                m = await asyncio.wait_for(ws.receive_json(), 3)
            except asyncio.TimeoutError:
                break
            if m.get("type") == "event" and m["id"] in ids:
                got[ids[m["id"]]] = m["event"]
            elif m.get("type") == "result" and not m.get("success"):
                print("not available:", ids.get(m["id"]), (m.get("error") or {}).get("code"))
    for kind, event in got.items():
        (OUT / CAPTURE_ALLOWED[kind]).write_text(json.dumps(event, indent=1))
        print(f"{kind}: {len(json.dumps(event)):,} bytes -> {CAPTURE_ALLOWED[kind]}")


if __name__ == "__main__":
    asyncio.run(main())
