"""End-to-end: doorbell talk-back (the recorded clip) through Mantel's command gateway, against the
SCRATCH Home Assistant (tools/testha/), whose built hk_frontend registers the real talk view (talk.py).

    ~/.venvs/mantel/bin/python tools/e2e/talk_e2e.py [--keep-up]

The scratch HA has no doorbell, so a demo media player that plays URLs stands in for the speaker
(talk.py only asks the speaker to play_media the clip's signed URL). The clip is fictional bytes.

Checks: the Owner's clip goes through the gateway and HA's talk view answers; the demo speaker was
told to play HA's signed clip URL; fetching that URL from HA (as the speaker's ffmpeg would) gives back
exactly the bytes sent, as audio; the audit row was written (allowed, sensitive camera, result ok); a
Child is refused (cameras) and nothing is sent; a Kitchen wall tablet is refused the speaker until
HK's doorbell pop-up names it (then talks, clip and live, with no PIN on the LAN), and an Owner's deny
grant turns that off; an Adult on the tunnel with a stale factor talks with no step-up (decision 25);
a binary body to any other path is refused.

LIVE TALK (talk_relay.py): the Owner's `talk_live` command is audited and answered with a one-time
ticket; HK's own talk Worker (the exact TALK_WORKER source of hk-cameras.js, run in node by
tests/talk_worker_harness.mjs with the page's cookies and Origin) opens Mantel's /ws/talk with it, and
Mantel asks for Mantel Link's `mantel/talk/live` first; this scratch HA has no Mantel Link set up, so it
answers unknown_command and Mantel subscribes the scratch HA's REAL `hk_frontend/talk/live` (the built
talk_live.py) on the same socket of its own. The demo has no UniFi Protect speaker, so HA's real handler refuses (`not_supported`): that
proves HA's own schema took Mantel's subscription, the refusal reaches the Worker (the card then sends
the clip, checked again) and the row records it. The STREAMING itself (binary frames, handler ids,
letting go) cannot run on a demo player, so it is checked against a loopback stand-in for HA's side of
talk_live (the boundary faked: auth, the subscription, a handler id, the frames, unsubscribe), with
the same Worker, ticket path and relay. A spent ticket is refused.

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
from aiohttp import WSMsgType, web  # noqa: E402
from aiohttp.test_utils import TestServer  # noqa: E402
from yarl import URL  # noqa: E402

SCRATCH_URL = g.SCRATCH_URL
PLAY_MEDIA = 512                        # MediaPlayerEntityFeature.PLAY_MEDIA
CLIP = b"\x1aE\xdf\xa3" + secrets.token_bytes(4000)      # fictional, webm-looking


def talk(speaker: str, clip: bytes = CLIP, path: str | None = None) -> dict:
    return {"kind": "http", "method": "POST", "path": path or f"/api/hk_frontend/talk?entity_id={speaker}",
            "content_type": "audio/webm;codecs=opus", "body_b64": base64.b64encode(clip).decode()}


async def worker(b, base: str, ticket: str, speaker: str, frames: int = 5, rate: int = 48000) -> dict:
    """HK's talk Worker (tests/talk_worker_harness.mjs) against Mantel's /ws/talk, with b's cookies."""
    jar = b.http.cookie_jar.filter_cookies(URL(base + "/"))
    cookie = "; ".join(f"{k}={v.value}" for k, v in jar.items())
    proc = await asyncio.create_subprocess_exec(
        "node", str(ROOT / "tests/talk_worker_harness.mjs"), str(ROOT / "web/hk/cards/hk-cameras.js"),
        base.replace("http", "ws", 1) + "/ws/talk", ticket, cookie, base, speaker, str(rate), str(frames),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, err = await asyncio.wait_for(proc.communicate(), 60)
    if proc.returncode != 0:
        raise g.Fail(f"the worker harness failed: {err.decode()[-500:]}")
    return json.loads(out.decode().strip().splitlines()[-1])


class StandInTalkLive:
    """A loopback stand-in for Home Assistant's side of hk_frontend/talk/live (talk_live.py's protocol:
    auth, the subscription answered by a result and {handler_id, rate, codec}, binary frames,
    unsubscribe), recording every frame. Used ONLY where the demo cannot stream (no Protect speaker)."""
    HID = 9
    TOKEN = "fictional-stand-in-token"

    def __init__(self):
        self.frames: list = []

    async def handler(self, request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        await ws.send_json({"type": "auth_required"})
        auth = await ws.receive_json()
        self.frames.append(auth)
        await ws.send_json({"type": "auth_ok" if auth.get("access_token") == self.TOKEN else "auth_invalid"})
        async for m in ws:
            if m.type == WSMsgType.BINARY:
                self.frames.append(bytes(m.data))
                continue
            msg = json.loads(m.data)
            self.frames.append(msg)
            await ws.send_json({"id": msg["id"], "type": "result", "success": True, "result": None})
            if msg.get("type") in ("mantel/talk/live", "hk_frontend/talk/live"):     # Mantel Link's or HK's
                await ws.send_json({"id": msg["id"], "type": "event",
                                    "event": {"handler_id": self.HID, "rate": 24000, "codec": "opus"}})
        return ws


async def wait_result(app, aid, timeout=10.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        r = app["audit"].rows(id=aid)[0]["result"]
        if r is not None:
            return r
        await asyncio.sleep(0.1)
    return None


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
            # this scratch HA has HK Frontend and no Mantel Link set up: Mantel Link's view answers 404 (nothing
            # played), then HK Frontend's takes the clip, once
            check(app["commander"].sent == ["POST /api/mantel/talk", "POST /api/hk_frontend/talk"],
                  "the clip was played once: Mantel Link's view first (none here), then HK Frontend's")
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

            # -- LIVE TALK: the ticket, HK's Worker, the scratch HA's real talk_live --------------------
            sent = list(app["commander"].sent)
            reply = await owner.command(kind="talk_live", speaker=speaker)
            tk = (reply.get("result") or {}).get("ticket")
            row = app["audit"].rows(id=reply.get("audit_id", 0))[0] if reply.get("audit_id") else {}
            check(bool(tk) and (row.get("kind"), row.get("action"), row.get("decision"), row.get("result")) ==
                  ("ws", "hk_frontend/talk/live", "allowed", None) and app["commander"].sent == sent,
                  "the Owner's talk_live is audited first and answered with a one-time ticket; nothing sent to HA yet")
            got = await worker(owner, base, tk, speaker)
            err = (got["said"] or [{}])[0].get("error", "")
            check(got["sent"] == 0 and "is not a UniFi Protect speaker" in err,
                  f"HK's Worker opened /ws/talk; Mantel subscribed the scratch HA's real talk_live, whose schema "
                  f"took it and which refused the demo player ({err!r}): the card falls back to the clip")
            check(await wait_result(app, reply["audit_id"]) == "error:not_supported"
                  and app["commander"].sent[-1] == f"hk_frontend/talk/live {speaker}",
                  "the row's result is HA's refusal (error:not_supported); one talk link was opened")
            again = await owner.command(**talk(speaker))
            check(again.get("result") == {"ok": True, "bytes": len(CLIP)}, "the clip that follows goes through")
            got = await worker(owner, base, tk, speaker)
            check(got["sent"] == 0 and "error" in (got["said"] or [{}])[0], "the spent ticket is refused (auth_invalid)")
            # the streaming itself, against a stand-in for HA's side (no Protect speaker in the demo)
            from mantel_server.config import Config as _Cfg
            from mantel_server.ha.gateway import load_writes
            from mantel_server.ha.ha_client import HaCommander
            stand = StandInTalkLive()
            sapp = web.Application()
            sapp.router.add_get("/api/websocket", stand.handler)
            async with TestServer(sapp, host="127.0.0.1") as sserver:
                scmd = HaCommander(_Cfg(commands_enabled=True, ha_url=str(sserver.make_url("")).rstrip("/")),
                                   StandInTalkLive.TOKEN, load_writes())
                real_link = app["commander"].talk_link
                app["commander"].talk_link = scmd.talk_link
                try:
                    reply = await owner.command(kind="talk_live", speaker=speaker)
                    got = await worker(owner, base, reply["result"]["ticket"], speaker, frames=10)
                finally:
                    app["commander"].talk_link = real_link
                    await scmd.close()
                bins = [f for f in stand.frames if isinstance(f, bytes)]
                texts = [f for f in stand.frames if not isinstance(f, bytes)]
                check(got["said"] == [{"id": 1, "ready": True, "warm": False}] and got["sent"] == 10 and len(bins) == 10
                      and all(b_[0] == StandInTalkLive.HID and len(b_) == 1 + 1920 * 2 for b_ in bins)
                      and texts == [{"type": "auth", "access_token": StandInTalkLive.TOKEN},
                                    {"id": 1, "type": "mantel/talk/live", "entity_id": speaker, "rate": 48000},
                                    {"id": 2, "type": "unsubscribe_events", "subscription": 1}],
                      "streaming (HA's side stood in): the Worker went live, 10 frames of 40 ms PCM reached HA "
                      "with HA's own handler id, then one unsubscribe; nothing else was sent")
                check(await wait_result(app, reply["audit_id"]) == "ok", "the streamed talk's row: ok")

            # -- a Child: cameras are off ---------------------------------------------------------
            child = new("child")
            st, _ = await child.post("/api/auth/password", {"username": "e2e-child", "password": pw["child"]})
            assert st == 200
            await child.connect()
            sent = list(app["commander"].sent)
            reply = await child.command(**talk(speaker))
            live = await child.command(kind="talk_live", speaker=speaker)
            check(reply.get("error", {}).get("code") == "forbidden" and live.get("error", {}).get("code") == "forbidden"
                  and app["commander"].sent == sent and not app["talk"].tickets,
                  f"a Child is refused clip and live ({reply.get('error', {}).get('reason')}); nothing is sent, no ticket")

            # -- a wall tablet: the speaker from HK's doorbell pop-up, then no PIN on the LAN ---------
            tablet = new("tablet")
            st, _ = await tablet.post("/api/auth/password", {"username": "e2e-owner", "password": pw["owner"]})
            st, body = await tablet.post("/api/devices/enroll", {"name": "Fictional kitchen tablet", "room": "Kitchen"})
            assert st == 201, body
            await tablet.connect()
            reply = await tablet.command(**talk(speaker))
            check(reply.get("error", {}).get("reason") == "no_grant" and reply["error"].get("target") == speaker,
                  "a Kitchen tablet is refused the speaker (no_grant) while no pop-up names it")
            from mantel_server.settings_store import Actor
            app["settings"].store.write([("house", "popups", {"items": [
                {"name": "Doorbell", "kind": "camera", "hash": "doorbell", "entity": "camera.demo_camera",
                 "speaker": speaker}]})], actor=Actor(label="e2e"))       # as HK's settings import keeps it
            reply = await tablet.command(**talk(speaker))
            live = await tablet.command(kind="talk_live", speaker=speaker)
            check(reply.get("result", {}).get("ok") is True and "ticket" in (live.get("result") or {}),
                  "once HK's doorbell pop-up names the speaker the tablet talks (clip and live), with no PIN (LAN)")
            st, _ = await owner.post("/api/rbac/grants", {"effect": "deny", "actions": ["control"], "resource_kind": "entity",
                                                         "resource": speaker, "roles": ["wall_tablet"]})
            assert st == 201
            reply = await tablet.command(**talk(speaker))
            check(reply.get("error", {}).get("reason") == "explicit_deny", "an Owner's deny grant on the speaker wins")

            # -- an Adult on the tunnel with a stale factor ---------------------------------------
            from mantel_server.identity.accounts import totp
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
            check(reply.get("type") == "command_result" and "result" in reply
                  and app["commander"].sent[len(sent):] == ["POST /api/mantel/talk", "POST /api/hk_frontend/talk"],
                  "an Adult on the tunnel with a stale factor talks with no step-up (decision 25; the role decides)")
            sent = list(app["commander"].sent)
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
