"""LIVE TV SERVED BY MANTEL, END TO END against a REAL go2rtc (the compose stack's `transcode` image) and a
FAKE tuner that sends real MPEG-2 video and AC-3 audio, as an HDHomeRun does (docs/phase4/FEATURE-PARITY.md
"Live TV served by Mantel").

    ~/.venvs/mantel/bin/python tools/e2e/live_tv_e2e.py

Needs Docker (e.g. Docker Desktop) and the image `mantel-transcode:local` (PACKAGING.md); without
them it says SKIP and exits 0. Mantel Server runs in this process from the checkout (no Home Assistant: its
connection is not started), with the packaged go2rtc.yaml mounted into the go2rtc container exactly as
compose mounts it. The tuner is tools/e2e/fake_tuner.py on 127.0.0.1, reached by go2rtc as
host.docker.internal; its stream is made here with ffmpeg's test sources. Nothing touches the house, its
tuner or any camera.

Checks (through Mantel's own /ws, as HK's page sends them): the channel list and the channel entities
come from Mantel; the page's offer is answered by the real go2rtc (its SDP, its candidates); go2rtc set the
channel up on demand with Mantel's templates and its ffmpeg pulls the tuner; the transcode makes pictures
(a JPEG from go2rtc's own API, for this harness only); the viewer heartbeat makes sensor.tv_viewers;
closing the player removes the stream from go2rtc and frees the tuner; no frame the page received names
the tuner or go2rtc's API.
"""
from __future__ import annotations

import asyncio
import json
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "hosts/server"), str(ROOT), str(ROOT / "tools/e2e")]

import aiohttp  # noqa: E402
from aiohttp import web  # noqa: E402
from aiohttp.test_utils import TestServer  # noqa: E402

import fake_tuner  # noqa: E402

DOCKER = shutil.which("docker") or "/usr/local/bin/docker"
IMAGE = "mantel-transcode:local"
NAME = "mantel-live-tv-e2e-go2rtc"
PASSWORD = "fictional e2e password 42"
results: list[tuple[bool, str]] = []
XMLTV = b"""<?xml version="1.0"?><tv>
<channel id="c1"><display-name>4.1</display-name><display-name>NATIONAL BROADCASTING COMPANY</display-name></channel>
<programme channel="c1" start="20200101000000 +0000" stop="20991231000000 +0000"><title>The Endless Test Pattern</title></programme>
</tv>"""
# a browser-shaped offer (receive audio + video), as Chrome sends one; go2rtc 1.9.9 answers it
OFFER = "\r\n".join([
    "v=0", "o=- 4611731400430051336 2 IN IP4 127.0.0.1", "s=-", "t=0 0", "a=group:BUNDLE 0 1",
    "a=extmap-allow-mixed", "a=msid-semantic: WMS",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111", "c=IN IP4 0.0.0.0", "a=rtcp:9 IN IP4 0.0.0.0", "a=ice-ufrag:e2eA",
    "a=ice-pwd:e2eaaaaaaaaaaaaaaaaaaaaa", "a=ice-options:trickle", "a=fingerprint:sha-256 " + ":".join(["AB"] * 32),
    "a=setup:actpass", "a=mid:0", "a=recvonly", "a=rtcp-mux", "a=rtpmap:111 opus/48000/2",
    "a=fmtp:111 minptime=10;useinbandfec=1",
    "m=video 9 UDP/TLS/RTP/SAVPF 102", "c=IN IP4 0.0.0.0", "a=rtcp:9 IN IP4 0.0.0.0", "a=ice-ufrag:e2eA",
    "a=ice-pwd:e2eaaaaaaaaaaaaaaaaaaaaa", "a=ice-options:trickle", "a=fingerprint:sha-256 " + ":".join(["AB"] * 32),
    "a=setup:actpass", "a=mid:1", "a=recvonly", "a=rtcp-mux", "a=rtcp-rsize", "a=rtpmap:102 H264/90000",
    "a=rtcp-fb:102 nack", "a=rtcp-fb:102 nack pli",
    "a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f", ""])


def say(*a):
    print("[live-tv-e2e]", *a, flush=True)


def check(ok, what):
    results.append((bool(ok), what))
    say("PASS" if ok else "FAIL", what)
    return bool(ok)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def sh(*args, check_rc=True, timeout=300):
    p = subprocess.run(list(args), capture_output=True, text=True, timeout=timeout)
    if check_rc and p.returncode:
        raise SystemExit(f"{' '.join(args[:4])}... failed ({p.returncode}): {p.stderr[-800:]}")
    return p


def make_ts(work: Path) -> Path:
    """20 s of MPEG-2 video (interlaced-coded, 1280x720) + AC-3 audio in MPEG-TS, an HDHomeRun's kind."""
    out = work / "tuner.ts"
    args = ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30",
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "20", "-c:v", "mpeg2video",
            "-b:v", "4M", "-flags", "+ilme+ildct", "-c:a", "ac3", "-b:a", "192k", "-f", "mpegts"]
    if shutil.which("ffmpeg"):
        sh("ffmpeg", *args, str(out))
    else:
        sh(DOCKER, "run", "--rm", "-v", f"{work}:/w", "--entrypoint", "ffmpeg", IMAGE, *args, "/w/tuner.ts")
    return out


async def run(work: Path, g_port: int) -> None:
    from argon2 import PasswordHasher
    from mantel_server import features as F
    from mantel_server.config import Config
    from mantel_server.ha.ha_client import HaClient
    from mantel_server.server import build_app
    from mantel_server.settings_store import Actor
    from mantel_server.store import Store

    async def no_ha(*_a, **_k):
        return None
    HaClient.run = no_ha                                  # no Home Assistant in this test

    t_port = free_port()
    advertise = f"host.docker.internal:{t_port}"
    t_app = fake_tuner.make_app(make_ts(work), guide=XMLTV, advertise=advertise)
    t_runner = web.AppRunner(t_app)
    await t_runner.setup()
    await web.TCPSite(t_runner, "127.0.0.1", t_port).start()

    go2rtc = f"http://127.0.0.1:{g_port}"
    cfg = Config(data_dir=work / "data", secrets_dir=work / "secrets", port=0, go2rtc_url=go2rtc)
    store = Store(cfg.data_dir / "mantel.db")
    app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False)
    app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    settings = {"live_tv": {"enabled": True, "tuner": advertise, "guide_url": f"http://{advertise}/xmltv.xml",
                            "channels": ["4.1", "7.1"], "names": {"4.1": "NBC"}}}
    app["settings"].store.write([("house", F.FEATURES_DOC, F.check_settings(settings))], actor=Actor(label="e2e"))

    async def fetch(url):                       # Mantel runs on this machine: the tuner is on its loopback
        return await F.http_fetch(app, url.replace(advertise, f"127.0.0.1:{t_port}"))
    app["features"].hooks.fetch = fetch
    server = TestServer(app, host="127.0.0.1")
    await server.start_server()
    base = str(server.make_url("")).rstrip("/")
    tv = app["live_tv"]
    tv.tv_hooks.stop_grace = 2.0
    page_frames: list[dict] = []
    try:
        await app["features"].tv.refresh()
        await tv.sync()
        await app["accounts"].create_user("owner1", "Owner One", "owner", PASSWORD)
        jar = aiohttp.CookieJar(unsafe=True)
        async with aiohttp.ClientSession(cookie_jar=jar, headers={"Origin": base}) as s:
            r = await s.post(f"{base}/api/auth/password", json={"username": "owner1", "password": PASSWORD})
            check(r.status == 200, f"the Owner signs in to Mantel (HTTP {r.status})")
            ws = await s.ws_connect(f"{base}/ws")

            async def recv(pred, timeout=30.0):
                end = time.monotonic() + timeout
                while time.monotonic() < end:
                    m = await asyncio.wait_for(ws.receive_json(), max(0.1, end - time.monotonic()))
                    page_frames.append(m)
                    if pred(m):
                        return m
                raise TimeoutError

            await ws.send_json({"type": "read", "id": 1, "msg": {"type": "hk_tv/channels"}})
            got = (await recv(lambda m: m.get("id") == 1))["result"]
            check([c["camera"] for c in got["channels"]] == ["camera.tv_nbc", "camera.tv_wfak_dt"],
                  f"hk_tv/channels from Mantel: {[(c['number'], c['name']) for c in got['channels']]}")
            await ws.send_json({"type": "subscribe", "entity_ids": ["sensor.tv_nbc_now", "camera.tv_nbc", "sensor.tv_viewers"]})
            snap = await recv(lambda m: m.get("type") == "snapshot")
            check(snap["entities"].get("sensor.tv_nbc_now", {}).get("s") == "The Endless Test Pattern",
                  "the channel's now-playing sensor carries the guide's programme")
            await ws.send_json({"type": "read", "id": 2, "msg": {"type": "camera/webrtc/get_client_config",
                                                                "entity_id": "camera.tv_nbc"}})
            cfgm = await recv(lambda m: m.get("id") == 2)
            check("iceServers" in (cfgm.get("result") or {}).get("configuration", {}), "the ICE config comes from Mantel")
            await ws.send_json({"type": "read_subscribe", "id": 3,
                                "msg": {"type": "camera/webrtc/offer", "entity_id": "camera.tv_nbc", "offer": OFFER}})
            evs: list[dict] = []
            try:
                while not any(e.get("type") == "answer" for e in evs) or not any(e.get("type") == "candidate" for e in evs):
                    m = await recv(lambda m: m.get("id") == 3, timeout=60)
                    if m.get("type") == "read_event":
                        evs.append(m["event"])
                    elif m.get("error"):
                        evs.append({"type": "error", **m["error"]})
                        break
                    if any(e.get("type") == "error" for e in evs):
                        break
            except TimeoutError:
                pass
            ans = next((e for e in evs if e.get("type") == "answer"), {})
            check(evs and evs[0].get("type") == "session" and "a=fingerprint" in ans.get("answer", ""),
                  f"the page's offer is answered by the real go2rtc ({[e.get('type') for e in evs]})")
            cand = next((e for e in evs if e.get("type") == "candidate"), {})
            check(str(cand.get("candidate", {}).get("candidate", "")).startswith("candidate:"),
                  "go2rtc's candidates reach the page in HA's shape")
            async with aiohttp.ClientSession() as g:
                async with g.get(f"{go2rtc}/api/streams") as resp:
                    streams = await resp.json(content_type=None)
            src = json.dumps(streams.get("mantel_tv_4_1", {}))
            # once running, go2rtc shows the ffmpeg command its templates expanded to
            want = ("-probesize 1500000", "yadif=0:-1:0,scale=-2:720", "libx264", "libopus", f"{advertise}/auto/v4.1")
            check(all(w in src for w in want),
                  f"go2rtc has the channel, set up on demand with Mantel's templates ({[w for w in want if w not in src]} missing)")
            end = time.monotonic() + 45
            while time.monotonic() < end and "4.1" not in t_app["stats"]["streams"]:
                await asyncio.sleep(0.5)
            check("4.1" in t_app["stats"]["streams"], "go2rtc's ffmpeg is pulling channel 4.1 from the tuner")
            async with aiohttp.ClientSession() as g:
                async with g.get(f"{go2rtc}/api/frame.jpeg", params={"src": "mantel_tv_4_1"},
                                 timeout=aiohttp.ClientTimeout(total=90)) as resp:
                    jpeg = await resp.read()
            check(resp.status == 200 and jpeg[:2] == b"\xff\xd8" and len(jpeg) > 2000,
                  f"the transcode makes pictures (a {len(jpeg)}-byte JPEG of the H.264 stream)")
            await ws.send_json({"type": "tv_watching", "id": 4, "channel": "4.1"})
            w = await recv(lambda m: m.get("type") == "tv_watching_result")
            vstate = app["hub"].store.states.get("sensor.tv_viewers", {})
            check(w.get("result") == {"viewers": ["Owner One"], "ha": False} and vstate.get("s") == 1,
                  "the heartbeat is counted by Mantel: sensor.tv_viewers = 1 (Owner One)")
            # the player closes: the session ends, the stream goes from go2rtc, the tuner is free
            await ws.send_json({"type": "read_unsubscribe", "id": 3})
            await ws.send_json({"type": "tv_watching", "id": 5, "channel": None})
            end = time.monotonic() + 40
            gone = False
            while time.monotonic() < end:
                async with aiohttp.ClientSession() as g:
                    async with g.get(f"{go2rtc}/api/streams") as resp:
                        streams = await resp.json(content_type=None)
                gone = "mantel_tv_4_1" not in streams and not t_app["stats"]["streams"]
                if gone:
                    break
                await asyncio.sleep(1)
            check(gone, f"closing the player removes the stream from go2rtc and frees the tuner ({sorted(streams)})")
            text = json.dumps(page_frames)
            check(f"127.0.0.1:{g_port}" not in text and ":1984" not in text and f"{t_port}" not in text,
                  "no frame the page received names go2rtc's API or the tuner")
            await ws.close()
    finally:
        await server.close()
        await t_runner.cleanup()
        store.db.close()


def main() -> int:
    if not Path(DOCKER).exists() or sh(DOCKER, "image", "inspect", IMAGE, check_rc=False).returncode:
        say(f"SKIP: needs Docker and the {IMAGE} image (docs/phase3/PACKAGING.md)")
        return 0
    work = Path(tempfile.mkdtemp(prefix="mantel-live-tv-e2e-"))
    g_port = free_port()
    sh(DOCKER, "rm", "-f", NAME, check_rc=False)
    sh(DOCKER, "run", "-d", "--rm", "--name", NAME, "-p", f"127.0.0.1:{g_port}:1984", "-e", "MANTEL_LAN_IP=127.0.0.1",
       "--read-only", "--tmpfs", "/tmp", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
       "-v", f"{ROOT / 'packaging/compose/go2rtc/go2rtc.yaml'}:/config/go2rtc.yaml:ro", IMAGE)
    try:
        end = time.time() + 60
        while time.time() < end:
            if sh("curl", "-fsS", "-o", "/dev/null", f"http://127.0.0.1:{g_port}/api", check_rc=False).returncode == 0:
                break
            time.sleep(1)
        asyncio.run(run(work, g_port))
    finally:
        logs = sh(DOCKER, "logs", NAME, check_rc=False)
        (work / "go2rtc.log").write_text(logs.stdout + logs.stderr)
        sh(DOCKER, "rm", "-f", NAME, check_rc=False)
        say("work folder:", work)
    failed = [w for ok, w in results if not ok]
    say(f"{len(results) - len(failed)}/{len(results)} checks passed")
    return 1 if failed or not results else 0


if __name__ == "__main__":
    sys.exit(main())
