"""Edit mode in the running fictional scratch HA (tools/testha/README.md), as an HA admin and as a plain user.

    PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core NODE=/path/to/node TESTHA_DIR=... \\
        python tools/testha/edit_check.py [--engine chromium|webkit] [--shots DIRECTORY]

On /hk-scratch (its Office has two lights): Edit Page offered to the admin in HK's menu, a room pill carried and
made Tall, a category moved in the menu and a room moved in the Room Order sheet, Done -- then panel/get (the
WebSocket) says the Office's Tile Order, the size, the screen's page order and All Screens' room order were
saved, each with the version it was read with. A user who is not an admin is offered no Edit. No page errors.

Uses the scratch harness only (testha.access_token; a second, non-admin user is signed in through the scratch
HA's trusted_networks, no password); never accepts an arbitrary HA address or credential. Skips (exit 0, saying
why) without PLAYWRIGHT_PATH or NODE, and stops with a message when the scratch HA is not running.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

import aiohttp

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'tools/testha')]
import testha  # noqa: E402

MEMBER = 'Edit Check Member'         # the scratch HA's plain user (made once, kept with the scratch config)
MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'


def missing() -> str | None:
    pw, node = os.environ.get('PLAYWRIGHT_PATH'), os.environ.get('NODE')
    if not pw or not Path(pw).exists():
        return 'set PLAYWRIGHT_PATH to an installed playwright-core'
    if not node or not Path(node).exists():
        return 'set NODE to a Node.js binary'
    return None


async def tokens_of(http: aiohttp.ClientSession, refresh: str) -> dict:
    """What HA's frontend keeps in localStorage (hassTokens) for a refresh token."""
    async with http.post(testha.BASE + '/auth/token', data={'grant_type': 'refresh_token', 'client_id': testha.CLIENT_ID,
                                                           'refresh_token': refresh}) as r:
        tok = await r.json()
    return {**tok, 'hassUrl': testha.BASE, 'clientId': testha.CLIENT_ID, 'refresh_token': refresh,
            'expires': int(time.time() * 1000) + tok['expires_in'] * 1000}


async def member_refresh(http: aiohttp.ClientSession, admin: str) -> str:
    """The plain user (system-users), made once; signed in through trusted_networks (the scratch HA's 127.0.0.1)."""
    async with http.ws_connect(testha.BASE + '/api/websocket') as raw:
        await raw.receive_json()
        await raw.send_json({'type': 'auth', 'access_token': admin})
        assert (await raw.receive_json())['type'] == 'auth_ok'
        ws = testha.WS(raw)
        users = await ws.call(type='config/auth/list')
        user = next((u for u in users if u['name'] == MEMBER), None)
        if user is None:
            user = (await ws.call(type='config/auth/create', name=MEMBER, group_ids=['system-users']))['user']
        assert not user.get('is_admin') and 'system-admin' not in (user.get('group_ids') or []), user
    async with http.post(testha.BASE + '/auth/login_flow', json={
            'client_id': testha.CLIENT_ID, 'handler': ['trusted_networks', None], 'redirect_uri': testha.CLIENT_ID}) as r:
        flow = await r.json()
    async with http.post(f"{testha.BASE}/auth/login_flow/{flow['flow_id']}",
                         json={'client_id': testha.CLIENT_ID, 'user': user['id']}) as r:
        done = await r.json()
    if done.get('type') != 'create_entry':
        raise SystemExit(f'trusted_networks sign-in for the plain user: {done}')
    async with http.post(testha.BASE + '/auth/token', data={'grant_type': 'authorization_code', 'code': done['result'],
                                                           'client_id': testha.CLIENT_ID}) as r:
        return (await r.json())['refresh_token']


async def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--engine', action='append', choices=('chromium', 'webkit'))
    ap.add_argument('--shots', type=Path, help='where the screenshots go (default <TESTHA_DIR>/shots)')
    args = ap.parse_args(argv)
    why = missing()
    if why:
        print(f'SKIPPED edit_check: {why}')
        return 0
    if not testha.ready():
        raise SystemExit('the scratch HA is not running: tools/testha/testha.py up --fresh first')
    shots = args.shots or (testha.SCRATCH / 'shots')
    shots.mkdir(parents=True, exist_ok=True)
    async with aiohttp.ClientSession() as http:
        admin = await testha.access_token(http)
        owner = await tokens_of(http, testha.creds()['refresh_token'])
        member = await tokens_of(http, await member_refresh(http, admin))
    failed = 0
    for engine in args.engine or ('chromium', 'webkit'):
        proc = await asyncio.create_subprocess_exec(os.environ['NODE'], str(Path(__file__).with_suffix('.cjs')),
                                                    stdin=asyncio.subprocess.PIPE)
        await proc.communicate(json.dumps({'base': testha.BASE, 'screen': testha.MAIN_SCREEN, 'owner': owner,
                                           'member': member, 'engine': engine, 'shots': str(shots),
                                           'chrome': os.environ.get('CHROME') or MAC_CHROME}).encode())
        failed += proc.returncode != 0
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
