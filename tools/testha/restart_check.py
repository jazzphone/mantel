"""An UPGRADE WITH A SCREEN LEFT OPEN, in the scratch HA (never the house).

A wall tablet keeps its page open for days, and some must not be touched (the Master Bedroom's).
So before installing a build on the house, this checks what such a page does when HK is replaced
and Home Assistant restarts under it, without anyone reloading it:

  1. the scratch HA must be running the OLD build (`TESTHA_REPO=<old tree> testha.py up --fresh`);
  2. this opens /hk-wall (a wall tablet's dashboard) and waits until it has drawn;
  3. it runs `testha.py up` with TESTHA_REPO=<new tree>: HK is rebuilt into the scratch config and
     HA stops and starts again (the socket drops, as on a restart);
  4. once HA answers, it waits for the page to reconnect, then checks the SAME page: no uncaught
     errors or failed modules since the swap, the cards still drawn, and a state change still
     reaching a tile.

    TESTHA_REPO=<old> ~/.venvs/mantel/bin/python tools/testha/testha.py up --fresh
    ~/.venvs/mantel/bin/python tools/testha/restart_check.py --new <new tree>
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import aiohttp

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "headless"))
sys.path.insert(0, str(HERE))
import testha                       # noqa: E402
import check                        # noqa: E402
from cdp import Browser             # noqa: E402

BASE = testha.BASE
DRAWN = ("__deep(document, n=>/^hk-(light|cover|fan|climate-tall|tile|status-chip|header)-card$/.test(n.localName)"
         " && !!n.shadowRoot && n.shadowRoot.childElementCount>0).length")


async def login(b: Browser) -> str:
    c = testha.creds()
    async with aiohttp.ClientSession() as h:
        token = await testha.access_token(h)
        async with h.post(BASE + "/auth/token", data={"grant_type": "refresh_token", "client_id": BASE + "/",
                                                      "refresh_token": c["refresh_token"]}) as resp:
            tok = await resp.json()
    tok.update(hassUrl=BASE, clientId=BASE + "/", refresh_token=c["refresh_token"],
               expires=int(time.time() * 1000) + tok["expires_in"] * 1000)
    await b.send("Page.addScriptToEvaluateOnNewDocument", source=check.HELPERS)
    await b.open(BASE + "/manifest.json")
    await asyncio.sleep(1)
    await b.eval("localStorage.setItem('hassTokens', %s)" % json.dumps(json.dumps(tok)))
    return token


async def light_state(token: str, entity: str) -> str | None:
    async with aiohttp.ClientSession() as h:
        async with h.get(f"{BASE}/api/states/{entity}", headers={"Authorization": "Bearer " + token}) as r:
            return (await r.json()).get("state") if r.status == 200 else None


async def toggle(token: str, entity: str) -> None:
    async with aiohttp.ClientSession() as h:
        await h.post(f"{BASE}/api/services/light/toggle", json={"entity_id": entity},
                     headers={"Authorization": "Bearer " + token})


async def run(new_tree: str, page: str, out: Path) -> dict:
    if not testha.ready():
        raise SystemExit("the scratch HA is not running the old build: run testha.py up --fresh with TESTHA_REPO=<old> first")
    async with Browser(1280, 800, port=9334) as b:
        await b.send("Log.enable")
        await login(b)
        await b.open(BASE + page)
        await b.wait("window.__tag('hk-grid-view').length>0", 60)
        await asyncio.sleep(5)
        before = await b.eval(DRAWN)
        mark = len(b.console)
        # 3: swap HK and restart HA under the open page
        env = dict(os.environ, TESTHA_REPO=new_tree)
        swap = subprocess.run([sys.executable, str(HERE / "testha.py"), "up"], env=env, capture_output=True, text=True)
        if swap.returncode:
            return {"ok": False, "why": "testha up failed", "stderr": swap.stderr[-2000:]}
        async with aiohttp.ClientSession() as h:
            token = await testha.access_token(h)
        await asyncio.sleep(45)                       # the frontend reconnects (and reloads resources) on its own
        after = await b.eval(DRAWN)
        grid = await b.eval("window.__tag('hk-grid-view').length")
        # a state change still reaches the open page
        lights = await b.eval("JSON.stringify(__deep(document, n=>n.localName==='hk-light-card' && n._config && n._config.entity)"
                              ".map(n=>n._config.entity).slice(0,1))")
        lights = json.loads(lights or "[]")
        follows = None
        if lights:
            ent = lights[0]
            was = await light_state(token, ent)
            await toggle(token, ent)
            await asyncio.sleep(3)
            seen = await b.eval("(()=>{const n=__deep(document, n=>n.localName==='hk-light-card' && n._config && n._config.entity===%s)[0];"
                                "return n && n.client && n.client.states[%s] ? n.client.states[%s].state : null})()"
                                % (json.dumps(ent), json.dumps(ent), json.dumps(ent)))
            now = await light_state(token, ent)
            follows = {"entity": ent, "was": was, "now": now, "card_sees": seen, "ok": bool(now and seen == now and now != was)}
            await toggle(token, ent)                  # put it back (a fictional demo light)
        since = b.console[mark:]
        bad = [m for m in since if m.startswith("EXCEPTION") or "Failed to load extra module" in m
               or "is not a function" in m or "has not loaded" in m]
        shot = out / "restart-after.png"
        try:
            await b.screenshot(str(shot))
        except Exception:                             # noqa: BLE001 -- a screenshot is a bonus
            shot = None
        ok = bool(grid) and after >= max(1, before - 1) and not bad and (follows is None or follows["ok"])
        return {"ok": ok, "page": page, "drawn_before": before, "drawn_after": after, "grid_after": grid,
                "follows_state": follows, "errors_since_swap": bad[:20], "console_since_swap": len(since),
                "screenshot": str(shot) if shot else None}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--new", required=True, help="the tree to build the NEW HK from")
    ap.add_argument("--page", default="/hk-wall")
    a = ap.parse_args()
    out = testha.SCRATCH / "shots-restart"
    out.mkdir(parents=True, exist_ok=True)
    res = asyncio.run(run(a.new, a.page, out))
    (out / "restart.json").write_text(json.dumps(res, indent=1))
    print(json.dumps(res, indent=1))
    sys.exit(0 if res.get("ok") else 1)


if __name__ == "__main__":
    main()
