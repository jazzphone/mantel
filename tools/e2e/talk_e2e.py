"""End-to-end: doorbell talk-back (the recorded clip) through Mantel's command gateway, against the
SCRATCH Home Assistant (tools/testha/), whose built hk_frontend registers the real talk view (talk.py).

    ~/.venvs/mantel/bin/python tools/e2e/talk_e2e.py [--keep-up]

The scratch HA has no doorbell, so a demo media player that plays URLs stands in for the speaker
(talk.py only asks the speaker to play_media the clip's signed URL). The clip is fictional bytes.

Checks: the Owner's clip goes through the gateway and HA's talk view answers; the demo speaker was
told to play HA's signed clip URL; fetching that URL from HA (as the speaker's ffmpeg would) gives back
exactly the bytes sent, as audio; the audit row was written (allowed, sensitive camera, result ok); a
Child is refused (cameras) and nothing is sent; a Kitchen wall tablet is refused the speaker until
the Owner grants it, then talks with no PIN (LAN); an Adult on the tunnel with a stale factor is asked
to step up and nothing is sent; a binary body to any other path is refused.

SAFETY: as tools/e2e/gateway_e2e.py (scratch URL only; never reads ~/.config/mantel or touches
/Volumes/config or the house's HA; prints no credential).
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import importlib.util
import json
import secrets
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("gateway_e2e", ROOT / "tools/e2e/gateway_e2e.py")
g = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(g)

import aiohttp  # noqa: E402
from aiohttp.test_utils import TestServer  # noqa: E402

SCRATCH_URL = g.SCRATCH_URL
PLAY_MEDIA = 512                        # MediaPlayerEntityFeature.PLAY_MEDIA
CLIP = b"\x1aE\xdf\xa3" + secrets.token_bytes(4000)      # fictional, webm-looking


def talk(speaker: str, clip: bytes = CLIP, path: str | None = None) -> dict:
    return {"kind": "http", "method": "POST", "path": path or f"/api/hk_frontend/talk?entity_id={speaker}",
            "content_type": "audio/webm;codecs=opus", "body_b64": base64.b64encode(clip).decode()}


async def ha_get(http, token, path):
    async with http.get(SCRATCH_URL + path, headers={"Authorization": f"Bearer {token}"}) as r:
        return await r.json()


async def run(token: str) -> dict:
    from mantel_server.config import Config
    from mantel_server.server import build_app
    from mantel_server.store import Store

    check, say = g.check, g.say
    offset = [0.0]
    clock = lambda: time.time() + offset[0]  # noqa: E731
    with tempfile.TemporaryDirectory(prefix="mantel-talk-e2e-") as folder:
        base_dir = Path(folder)
        cfg = Config(ha_url=SCRATCH_URL, data_dir=base_dir / "data", secrets_dir=base_dir / "secrets", port=0,
                     commands_enabled=True)
        assert cfg.ha_url == SCRATCH_URL and "192.168." not in cfg.ha_url
        store = Store(cfg.data_dir / "mantel.db")
        app = build_app(cfg, token, store=store, connect_ha=True, clock=clock)
        hub = app["hub"]
        people = []
        async with TestServer(app, host="127.0.0.1") as server, aiohttp.ClientSession() as ha_http:
            base = str(server.make_url("")).rstrip("/")
            await asyncio.wait_for(hub.ha.ready.wait(), 60)
            states = await ha_get(ha_http, token, "/api/states")
            players = sorted(s["entity_id"] for s in states if s["entity_id"].startswith("media_player.")
                             and int(s["attributes"].get("supported_features") or 0) & PLAY_MEDIA)
            check(players, f"the scratch HA has demo media players that play URLs ({', '.join(players)})")
            speaker = players[0]
            say(f"Mantel on {base}; {speaker} stands in for the doorbell speaker")

            def new(label):
                b = g.Browser(base, label)
                people.append(b)
                return b

            pw = {k: secrets.token_urlsafe(18) for k in ("owner", "child", "adult")}
            owner = new("owner")
            st, body = await owner.post("/api/bootstrap", {"token": app["accounts"].issue_bootstrap_token(),
                                                          "username": "e2e-owner", "name": "Fictional Owner",
                                                          "password": pw["owner"]})
            assert st == 200, body
            for who in ("child", "adult"):
                st, body = await owner.post("/api/users", {"username": f"e2e-{who}", "name": f"Fictional {who.title()}",
                                                          "role": who, "password": pw[who]})
                assert st == 201, body
            await owner.connect()

            # -- the Owner's clip, all the way to the speaker ---------------------------------------
            reply = await owner.command(**talk(speaker))
            check(reply.get("result") == {"ok": True, "bytes": len(CLIP)},
                  f"the Owner's clip went through the gateway; HA's talk view answered {reply.get('result') or reply.get('error')}")
            row = app["audit"].rows(id=reply["audit_id"])[0]
            check((row["kind"], row["action"], row["decision"], row["sensitive"], row["result"]) ==
                  ("http", "POST /api/hk_frontend/talk", "allowed", "camera", "ok")
                  and json.loads(row["target"]) == [speaker, "feature:cameras"],
                  "its audit row: http POST /api/hk_frontend/talk, allowed, sensitive camera, result ok")
            check(app["commander"].sent == ["POST /api/hk_frontend/talk"], "exactly one upload was sent to HA")
            url = None
            for _ in range(40):
                st_ = await ha_get(ha_http, token, f"/api/states/{speaker}")
                url = st_["attributes"].get("media_content_id") or ""
                if "/api/hk_frontend/talk/" in url:
                    break
                await asyncio.sleep(0.25)
            check("/api/hk_frontend/talk/" in url and "authSig=" in url,
                  f"HA told {speaker} to play the clip's signed URL")
            path = "/" + url.split("/", 3)[3]
            async with ha_http.get(SCRATCH_URL + path) as r:           # as the speaker's ffmpeg: no token, the signature
                served, ctype = await r.read(), r.headers.get("Content-Type", "")
            check(r.status == 200 and served == CLIP and ctype.startswith("audio/webm"),
                  f"HA serves the clip back byte for byte as audio ({len(served)} bytes, {ctype})")

            # -- a Child: cameras are off ---------------------------------------------------------
            child = new("child")
            st, _ = await child.post("/api/auth/password", {"username": "e2e-child", "password": pw["child"]})
            assert st == 200
            await child.connect()
            reply = await child.command(**talk(speaker))
            check(reply.get("error", {}).get("code") == "forbidden" and app["commander"].sent == ["POST /api/hk_frontend/talk"],
                  f"a Child is refused ({reply.get('error', {}).get('reason')}) and nothing is sent")

            # -- a wall tablet: the speaker needs a grant, then no PIN on the LAN ---------------------
            tablet = new("tablet")
            st, _ = await tablet.post("/api/auth/password", {"username": "e2e-owner", "password": pw["owner"]})
            st, body = await tablet.post("/api/devices/enroll", {"name": "Fictional kitchen tablet", "room": "Kitchen"})
            assert st == 201, body
            await tablet.connect()
            reply = await tablet.command(**talk(speaker))
            check(reply.get("error", {}).get("reason") == "no_grant" and reply["error"].get("target") == speaker,
                  "a Kitchen tablet is refused the speaker (no_grant) before the Owner grants it")
            st, _ = await owner.post("/api/rbac/grants", {"effect": "allow", "actions": ["control"], "resource_kind": "entity",
                                                         "resource": speaker, "roles": ["wall_tablet"]})
            assert st == 201
            reply = await tablet.command(**talk(speaker))
            check(reply.get("result", {}).get("ok") is True, "after the Owner's grant the tablet talks, with no PIN (LAN)")

            # -- an Adult on the tunnel with a stale factor ---------------------------------------
            from mantel_server.accounts import totp
            adult = new("adult")
            st, _ = await adult.post("/api/auth/password", {"username": "e2e-adult", "password": pw["adult"]})
            assert st == 200
            st, body = await adult.post("/api/auth/totp/enroll")
            seed = g._seed(body["secret"])
            st, _ = await adult.post("/api/auth/totp/enroll/confirm", {"code": totp(seed, clock())})
            assert st == 200
            adult.http.cookie_jar.clear()
            offset[0] += 60                                  # a new TOTP time step
            st, body = await adult.post("/api/auth/password", {"username": "e2e-adult", "password": pw["adult"]}, tunnel=True)
            assert st == 200 and body.get("pending"), body
            st, _ = await adult.post("/api/auth/totp/verify", {"pending": body["pending"], "code": totp(seed, clock())},
                                     tunnel=True)
            assert st == 200
            offset[0] += 301                                 # the tunnel sign-in's factor is stale now
            await adult.connect(tunnel=True)
            sent = list(app["commander"].sent)
            reply = await adult.command(**talk(speaker))
            check(reply.get("type") == "step_up_required" and app["commander"].sent == sent,
                  "an Adult on the tunnel with a stale factor is asked to step up; nothing is sent")
            reply = await adult.command(**talk(speaker, path="/api/config/core/update"))
            check(reply.get("error", {}).get("code") == "unsupported_body" and app["commander"].sent == sent,
                  "a binary body to any other path is refused (unsupported_body)")

            rows = app["audit"].rows()
            evidence = {"speaker": speaker, "sent_to_ha": app["commander"].sent, "checks": g.RESULTS,
                        "audit": [{k: r[k] for k in ("id", "role", "device_role", "kind", "action", "target", "decision",
                                                      "reason", "sensitive", "door", "result")} for r in rows]}
            for b in people:
                await b.close()
        store.db.close()
    return evidence


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--keep-up", action="store_true")
    a = ap.parse_args()
    g.wait_for_free_harness()
    g.say("starting the scratch HA (testha.py up --fresh)")
    g.harness("up", "--fresh")
    try:
        token = asyncio.run(g.token_for_scratch())
        evidence = asyncio.run(run(token))
        del token
        out = Path(g.testha.SCRATCH) / "talk_e2e.json"
        out.write_text(json.dumps(evidence, indent=1))
        g.say(f"ALL {len(g.RESULTS)} CHECKS PASSED; evidence in {out}")
        return 0
    except g.Fail as exc:
        g.say("FAIL", exc)
        return 1
    finally:
        if not a.keep_up:
            g.harness("down")
            g.say("scratch HA stopped")


if __name__ == "__main__":
    sys.exit(main())
