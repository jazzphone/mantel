"""UniFi Protect's public API client (protect_api.py) against a fictional console.

The console here is a local aiohttp server over HTTPS with a self-signed certificate made in the test
(cryptography), serving payloads RECORDED from a real console (Protect 7.3.70, UNVR G2 Pro) and sanitized into
tests/fixtures/protect/: every MAC, id, guid and token replaced by a fake that stays the same across the files, so
a camera's id in v1_cameras.json is the `device` of its events. The camera names, models and feature flags are the
recorded ones. No real console is contacted and no real key appears: the key below is made up.

What the recordings could not give is made up here and says so: a camera with no smart detection, a console that
answers 429, a certificate that changes, a socket that drops.
"""
from __future__ import annotations

import asyncio
import contextlib
import datetime
import hashlib
import ipaddress
import json
import logging
import socket
import ssl
from pathlib import Path

import aiohttp
import pytest
from aiohttp import web
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

from mantel_server.cameras import protect_api as pa

FIXTURES = Path(__file__).parent / "fixtures" / "protect"
KEY = "test-api-key-0123456789abcdef"
ROOT = pa.API_ROOT


def fixture(name: str):
    return json.loads((FIXTURES / name).read_text())


def event_messages(name: str) -> list[str]:
    """The recorded websocket messages, as the console sent them (text frames)."""
    return [json.dumps(json.loads(line)["msg"]) for line in (FIXTURES / name).read_text().splitlines() if line.strip()]


def recorded_ratelimit() -> dict[str, str]:
    """The ratelimit headers the console really sent with a still."""
    out = {}
    for line in (FIXTURES / "snapshot_headers.txt").read_text().splitlines():
        name, _, value = line.partition(": ")
        if name.lower() in ("ratelimit", "ratelimit-policy"):
            out[name] = value
    return out


# -- the fictional console ---------------------------------------------------------------------------------
def make_cert(tmp_path: Path, name: str) -> tuple[ssl.SSLContext, str]:
    """A self-signed certificate for 127.0.0.1: (the server's TLS context, its SHA-256 fingerprint)."""
    key = ec.generate_private_key(ec.SECP256R1())
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, f"console-{name}")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=30))
            .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]), critical=False)
            .sign(key, hashes.SHA256()))
    cert_file, key_file = tmp_path / f"{name}.crt", tmp_path / f"{name}.pem"
    cert_file.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_file.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                           serialization.NoEncryption()))
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert_file, key_file)
    return ctx, hashlib.sha256(cert.public_bytes(serialization.Encoding.DER)).hexdigest()


class Console:
    """Serves the recorded payloads the way the console does, and notes what reached it."""

    def __init__(self, tmp_path: Path):
        self.tmp_path = tmp_path
        self.cameras: list[dict] = fixture("v1_cameras.json")
        self.version = fixture("v1_meta_info.json")["applicationVersion"]
        self.hits: list[dict] = []                     # every request: method, path, query, key_sent, body
        self.throttle: list[dict] = []                 # answers to give INSTEAD of serving: {"status", "headers"}
        self.rate_left = 9                             # the `r=` of the ratelimit header
        self.streams: dict[str, dict[str, str]] = {}   # camera id -> the RTSPS streams that exist
        self.plans: list[tuple[list[str], bool]] = []  # per socket: the messages to send, then hold open (or close)
        self.nvrs_as_list = False                      # a later Protect might answer /v1/nvrs with a list
        self.snapshot_html = False                     # a still that is not a picture
        self.sockets = 0
        self.rotations = 0
        self.runner: web.AppRunner | None = None
        self.site: web.TCPSite | None = None
        self.port = 0
        self.fingerprint = ""

    # -- lifecycle
    async def start(self) -> "Console":
        ctx, self.fingerprint = make_cert(self.tmp_path, "console0")
        self.runner = web.AppRunner(self.app(), handle_signals=False)
        await self.runner.setup()
        self.site = web.TCPSite(self.runner, "127.0.0.1", 0, ssl_context=ctx)
        await self.site.start()
        self.port = self.runner.addresses[0][1]
        return self

    async def rotate_cert(self) -> None:
        """A new certificate on the same address: the console was replaced or reset (or someone else answers)."""
        await self.site.stop()
        self.rotations += 1
        ctx, self.fingerprint = make_cert(self.tmp_path, f"console{self.rotations}")
        self.site = web.TCPSite(self.runner, "127.0.0.1", self.port, ssl_context=ctx)
        await self.site.start()

    async def stop(self) -> None:
        await self.runner.cleanup()

    @property
    def host(self) -> str:
        return f"127.0.0.1:{self.port}"

    def camera_id(self, name: str) -> str:
        return next(c["id"] for c in self.cameras if c["name"] == name)

    def writes(self) -> list[dict]:
        return [h for h in self.hits if h["method"] not in ("GET",)]

    # -- the API
    def app(self) -> web.Application:
        app = web.Application(middlewares=[self.guard])
        r = app.router
        r.add_get(f"{ROOT}/v1/meta/info", self.meta)
        r.add_get(f"{ROOT}/v1/nvrs", self.nvrs)
        r.add_get(f"{ROOT}/v1/cameras", self.camera_list)
        r.add_get(f"{ROOT}/v1/cameras/{{id}}", self.camera)
        r.add_patch(f"{ROOT}/v1/cameras/{{id}}", self.patch_camera)
        r.add_get(f"{ROOT}/v1/cameras/{{id}}/snapshot", self.snapshot)
        r.add_get(f"{ROOT}/v1/cameras/{{id}}/rtsps-stream", self.get_streams)
        r.add_post(f"{ROOT}/v1/cameras/{{id}}/rtsps-stream", self.post_streams)
        r.add_post(f"{ROOT}/v1/cameras/{{id}}/talkback-session", self.talkback)
        r.add_get(f"{ROOT}/v1/subscribe/events", self.events)
        return app

    @web.middleware
    async def guard(self, request: web.Request, handler):
        body = None
        if request.can_read_body:
            with contextlib.suppress(ValueError):
                body = await request.json()
        self.hits.append({"method": request.method, "path": request.path[len(ROOT):], "query": dict(request.query),
                          "key_sent": "X-API-KEY" in request.headers, "body": body})
        limit = {"ratelimit": f'"10-in-1sec"; r={self.rate_left}; t=1', **{"ratelimit-policy": '"10-in-1sec"; q=10; w=1'}}
        if request.headers.get("X-API-KEY") != KEY:
            return web.json_response({"error": {"code": 401, "message": "Unauthorized"}}, status=401, headers=limit)
        if self.throttle:
            t = self.throttle.pop(0)
            return web.json_response({"error": {"code": t["status"], "message": "Too Many Requests"}},
                                     status=t["status"], headers={**limit, **t.get("headers", {})})
        resp = await handler(request)
        resp.headers.update(limit)
        return resp

    async def meta(self, request):
        return web.json_response({"applicationVersion": self.version})

    async def nvrs(self, request):
        nvr = fixture("v1_nvrs.json")
        return web.json_response([nvr] if self.nvrs_as_list else nvr)

    async def camera_list(self, request):
        return web.json_response(self.cameras)

    def find(self, request) -> dict:
        for cam in self.cameras:
            if cam["id"] == request.match_info["id"]:
                return cam
        raise web.HTTPNotFound(text=json.dumps({"error": {"code": 404, "message": "Camera not found"}}),
                               content_type="application/json")

    async def camera(self, request):
        return web.json_response(self.find(request))

    async def patch_camera(self, request):
        cam = self.find(request)
        cam["smartDetectSettings"]["objectTypes"] = (await request.json())["smartDetectSettings"]["objectTypes"]
        return web.json_response(cam)

    async def snapshot(self, request):
        self.find(request)
        if self.snapshot_html:
            return web.Response(text="<html>", content_type="text/html")
        return web.Response(body=b"\xff\xd8\xff\xe0" + b"j" * 64 + (b"hq" if request.query.get("highQuality") else b"lq"),
                            content_type="image/jpeg")

    async def get_streams(self, request):
        return web.json_response(self.streams.get(self.find(request)["id"], {}))

    async def post_streams(self, request):
        cid = self.find(request)["id"]
        recorded = fixture("rtsps_stream.json")
        made = {q: recorded[q] for q in (await request.json())["qualities"]}
        self.streams.setdefault(cid, {}).update(made)
        return web.json_response(made)

    async def talkback(self, request):
        self.find(request)
        return web.json_response({"url": "rtp://192.0.2.20:7004", "codec": "opus", "samplingRate": 24000})

    async def events(self, request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self.sockets += 1
        messages, hold = self.plans.pop(0) if self.plans else ([], True)
        for m in messages:
            await ws.send_str(m)
        if hold:
            async for _ in ws:
                pass
        else:
            await ws.close()
        return ws


class FakeTime:
    """A clock that only moves when something sleeps, so pacing and backoff run in no real time."""

    def __init__(self):
        self.now = 1000.0
        self.slept: list[float] = []

    def clock(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += max(seconds, 0.0)
        await asyncio.sleep(0)


@pytest.fixture
async def console(tmp_path):
    c = await Console(tmp_path).start()
    yield c
    await c.stop()


@pytest.fixture
def ft():
    return FakeTime()


def make_client(console: Console, ft: FakeTime, *, pin="console", key=KEY) -> pa.ProtectClient:
    return pa.ProtectClient(console.host, key, lambda: aiohttp.ClientSession(),
                            console.fingerprint if pin == "console" else pin, clock=ft.clock, sleep=ft.sleep)


@pytest.fixture
async def client(console, ft):
    c = make_client(console, ft)
    yield c
    await c.close()


def closed_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# -- trust: pin on first connect, refuse a change ---------------------------------------------------------
async def test_fetch_certificate_is_the_leaf_fingerprint_in_hex_without_colons(console):
    fp = await pa.fetch_certificate(console.host)
    assert fp == console.fingerprint
    assert len(fp) == 64 and fp == fp.lower() and ":" not in fp


async def test_the_first_connect_pins_and_the_pin_is_kept_for_the_caller(console, ft):
    c = make_client(console, ft, pin=None)
    try:
        assert c.pinned_sha256 is None
        result = await c.check()
        assert c.pinned_sha256 == console.fingerprint == result["fingerprint"]
        # a later client, given the pin, is held to it and works
        again = make_client(console, ft)
        try:
            assert len(await again.cameras()) == 14
        finally:
            await again.close()
    finally:
        await c.close()


async def test_a_pin_may_be_given_with_colons_and_capitals(console, ft):
    pretty = ":".join(console.fingerprint[i:i + 2].upper() for i in range(0, 64, 2))
    c = make_client(console, ft, pin=pretty)
    try:
        assert c.pinned_sha256 == console.fingerprint
        assert len(await c.cameras()) == 14
    finally:
        await c.close()
    with pytest.raises(ValueError):
        pa.normalize_fingerprint("not a fingerprint")


async def test_a_changed_certificate_is_refused_before_the_key_is_sent(console, ft):
    c = make_client(console, ft)
    try:
        await c.cameras()
        await console.rotate_cert()
        await c.close()                                          # a fresh connection, as after any pause
        sent = len(console.hits)
        with pytest.raises(pa.CertificateChanged) as err:
            await c.cameras()
        assert err.value.kind == "certificate_changed"
        assert len(console.hits) == sent                         # nothing, key included, reached the new certificate
        with pytest.raises(pa.CertificateChanged):
            await c.check()
        with pytest.raises(pa.CertificateChanged):
            await c.connect_socket()
        assert KEY not in str(err.value)
    finally:
        await c.close()


# -- Connect's checks ---------------------------------------------------------------------------------------
async def test_check_reports_the_version_the_consoles_name_and_the_camera_count(client):
    assert await client.check() == {"version": "7.3.70", "console_name": "Home-Protect", "cameras": 14,
                                    "fingerprint": client.pinned_sha256}


async def test_check_runs_its_steps_in_order_probe_without_key_then_key_then_version_then_the_rest(console, client):
    await client.check()
    assert [(h["path"], h["key_sent"]) for h in console.hits] == [
        ("/v1/meta/info", False), ("/v1/meta/info", True), ("/v1/nvrs", True), ("/v1/cameras", True)]


async def test_a_console_name_that_is_a_list_is_tolerated(console, client):
    # 7.3.70 answers /v1/nvrs with ONE object; if a later Protect answers a list, the first is the console
    console.nvrs_as_list = True
    assert (await client.check())["console_name"] == "Home-Protect"


async def test_an_address_that_is_a_web_server_not_a_console_is_not_a_console_and_never_sees_the_key(tmp_path, ft):
    seen = []

    async def anything(request):
        seen.append(dict(request.headers))
        return web.Response(text="<html>a router's login page</html>", content_type="text/html", status=404)
    app = web.Application()
    app.router.add_route("*", "/{tail:.*}", anything)
    runner = web.AppRunner(app, handle_signals=False)
    await runner.setup()
    ctx, _ = make_cert(tmp_path, "webui")
    await web.TCPSite(runner, "127.0.0.1", 0, ssl_context=ctx).start()
    port = runner.addresses[0][1]
    c = pa.ProtectClient(f"127.0.0.1:{port}", KEY, lambda: aiohttp.ClientSession(), clock=ft.clock, sleep=ft.sleep)
    try:
        with pytest.raises(pa.NotAConsole) as err:
            await c.check()
        assert err.value.kind == "not_a_console"
        assert seen and all("X-API-KEY" not in h for h in seen)
        assert c.pinned_sha256 is None                      # a stranger's certificate is not kept
    finally:
        await c.close()
        await runner.cleanup()


async def test_plain_http_on_the_port_is_not_a_console(ft):
    async def hello(request):
        return web.Response(text="hello")
    app = web.Application()
    app.router.add_get("/", hello)
    runner = web.AppRunner(app, handle_signals=False)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", 0).start()
    c = pa.ProtectClient(f"127.0.0.1:{runner.addresses[0][1]}", KEY, lambda: aiohttp.ClientSession(),
                         clock=ft.clock, sleep=ft.sleep)
    try:
        with pytest.raises(pa.NotAConsole):
            await c.check()
    finally:
        await c.close()
        await runner.cleanup()


async def test_nothing_listening_is_unreachable(ft):
    c = pa.ProtectClient(f"127.0.0.1:{closed_port()}", KEY, lambda: aiohttp.ClientSession(), clock=ft.clock, sleep=ft.sleep)
    try:
        with pytest.raises(pa.Unreachable) as err:
            await c.check()
        assert err.value.kind == "unreachable"
        with pytest.raises(pa.Unreachable):
            await pa.fetch_certificate(f"127.0.0.1:{closed_port()}")
    finally:
        await c.close()


async def test_an_empty_address_is_refused_with_a_sentence():
    with pytest.raises(pa.NotAConsole, match="address"):
        pa.ProtectClient("  ", KEY, lambda: None)


@pytest.mark.parametrize("address, parsed", [
    ("192.168.1.1", ("192.168.1.1", 443)), ("console.lan:8443", ("console.lan", 8443)),
    ("https://192.168.1.1/", ("192.168.1.1", 443)), ("[fe80::1]:8443", ("fe80::1", 8443))])
def test_addresses_are_split_into_a_name_and_a_port(address, parsed):
    assert pa.split_host(address) == parsed


async def test_a_refused_key_is_key_refused_and_the_message_never_holds_the_key(console, ft):
    c = make_client(console, ft, key="wrong-key-value")
    try:
        with pytest.raises(pa.KeyRefused) as err:
            await c.check()
        assert err.value.kind == "key_refused"
        assert "wrong-key-value" not in str(err.value) and KEY not in str(err.value)
        with pytest.raises(pa.KeyRefused):
            await c.cameras()
        with pytest.raises(pa.KeyRefused):
            await c.connect_socket()
    finally:
        await c.close()


async def test_a_403_is_a_refused_key_too(console, ft, client):
    console.throttle.append({"status": 403})
    with pytest.raises(pa.KeyRefused):
        await client.cameras()


@pytest.mark.parametrize("version, ok", [("7.2.104", False), ("7.2.105", True), ("7.3.70", True), ("7.10.0", True),
                                         ("6.99.99", False), ("7.2", False), ("8.0.0-beta.2", True), ("", False)])
async def test_protect_must_be_7_2_105_or_later(console, client, version, ok):
    console.version = version
    if ok:
        assert (await client.check())["version"] == version
        return
    with pytest.raises(pa.ProtectTooOld) as err:
        await client.check()
    assert err.value.kind == "protect_too_old" and err.value.version == version
    assert "7.2.105" in str(err.value)


async def test_the_checks_name_the_first_thing_wrong(console, ft):
    console.version = "7.0.0"
    bad_key = make_client(console, ft, key="nope")
    try:
        with pytest.raises(pa.KeyRefused):                   # the key is checked before the version
            await bad_key.check()
    finally:
        await bad_key.close()
    wrong_pin = make_client(console, ft, pin="ab" * 32)
    try:
        with pytest.raises(pa.CertificateChanged):           # ...and the certificate before the key
            await wrong_pin.check()
    finally:
        await wrong_pin.close()


# -- pacing ------------------------------------------------------------------------------------------------
async def test_the_bucket_never_lets_ten_through_in_any_second(ft):
    bucket = pa.TokenBucket(clock=ft.clock, sleep=ft.sleep)
    stamps = []
    for _ in range(60):
        await bucket.acquire()
        stamps.append(ft.now)
    for i, t in enumerate(stamps):
        assert sum(1 for s in stamps if t - 1.0 < s <= t) <= 9, (i, t)
    assert stamps[-1] - stamps[0] >= (60 - pa.BURST) / pa.RATE_PER_S - 0.01        # and it did not stall either


async def test_a_burst_of_requests_is_spread_not_refused(console, client, ft):
    await asyncio.gather(*(client.camera(console.cameras[0]["id"]) for _ in range(20)))
    assert len(console.hits) == 20
    assert sum(ft.slept) >= (20 - pa.BURST) / pa.RATE_PER_S - 0.05


async def test_a_429_is_retried_once_after_the_wait_the_console_names(console, client, ft):
    console.throttle.append({"status": 429, "headers": {"Retry-After": "2"}})
    assert len(await client.cameras()) == 14
    assert [h["path"] for h in console.hits] == ["/v1/cameras", "/v1/cameras"]
    assert any(abs(s - 2.0) < 0.01 for s in ft.slept)


async def test_a_429_without_retry_after_waits_the_ratelimit_reset(console, client, ft):
    console.throttle.append({"status": 429})                  # the recorded header says `t=1`
    await client.cameras()
    assert any(abs(s - 1.0) < 0.01 for s in ft.slept)


async def test_a_second_429_is_rate_limited_and_stops(console, client):
    console.throttle.extend([{"status": 429}, {"status": 429}])
    with pytest.raises(pa.RateLimited) as err:
        await client.cameras()
    assert err.value.kind == "rate_limited" and len(console.hits) == 2


async def test_no_requests_left_in_the_window_pauses_until_it_resets(console, client, ft):
    console.rate_left = 0                                      # `ratelimit: "10-in-1sec"; r=0; t=1`
    await client.camera(console.cameras[0]["id"])
    before = ft.now
    await client.camera(console.cameras[0]["id"])
    assert ft.now - before >= 1.0 - 0.01


def test_the_recorded_ratelimit_header_is_what_the_pacing_was_written_for():
    assert recorded_ratelimit()["ratelimit-policy"].startswith('"10-in-1sec"')
    assert recorded_ratelimit()["ratelimit"] == '"10-in-1sec"; r=9; t=1'


async def test_other_refusals_are_api_errors_with_the_status_and_message(console, client):
    with pytest.raises(pa.ProtectApiError) as err:
        await client.camera("65a1b2c3d4e5f60718ffffff")
    assert err.value.status == 404 and err.value.kind == "api_error" and "Camera not found" in str(err.value)


# -- cameras -----------------------------------------------------------------------------------------------
async def test_every_recorded_camera_parses(console, client):
    cams = await client.cameras()
    assert len(cams) == 14 == len(console.cameras)
    by_name = {c.name: c for c in cams}
    assert len(by_name) == 14
    for raw, cam in zip(console.cameras, cams):
        assert cam.id == raw["id"] and cam.name == raw["name"] and cam.model == raw["type"] and cam.state == raw["state"]
        assert cam.mac == raw["mac"] and len(cam.mac) == 12
        assert cam.smart_types == tuple(raw["featureFlags"]["smartDetectTypes"])
        assert cam.smart_on == tuple(raw["smartDetectSettings"]["objectTypes"])
        assert cam.has_mic is True and cam.online
    # the doorbell is the one with the speaker, the screen and the package camera
    assert [c.name for c in cams if c.is_doorbell] == ["Front Door"]
    assert [c.name for c in cams if c.has_speaker] == ["Front Door"]
    door = by_name["Front Door"]
    assert door.model == "UVC G4 Doorbell Pro" and door.has_package_camera and door.full_hd_snapshot
    assert "package" in door.smart_types and "package" in door.smart_on
    assert door.kinds == ("ring", "person", "vehicle", "animal", "face", "license_plate", "package")
    assert door.kinds_on == door.kinds and door.smart_off == ()
    # the cameras whose model has no face or plate detection list only what they can do
    assert by_name["Office"].smart_types == ("person", "vehicle", "animal") and by_name["Office"].kinds == (
        "person", "vehicle", "animal")
    assert by_name["Crawl Space"].model == "UVC G4 Pro" and by_name["Crawl Space"].full_hd_snapshot
    assert not by_name["Loft"].full_hd_snapshot                 # a G5 Flex has no full-resolution still
    assert not by_name["Loft"].is_doorbell and not by_name["Loft"].motion_only


async def test_a_camera_without_smart_detection_reports_motion_only(console, client):
    cam = console.cameras[1]
    cam["featureFlags"]["smartDetectTypes"] = []
    cam["smartDetectSettings"]["objectTypes"] = []
    parsed = [c for c in await client.cameras() if c.id == cam["id"]][0]
    assert parsed.motion_only and parsed.kinds == ("motion",) and parsed.kinds_on == ("motion",)
    assert parsed.smart_off == ()


async def test_types_that_are_supported_but_off_are_what_turn_on_in_protect_offers(console, client):
    cam = console.cameras[1]
    cam["smartDetectSettings"]["objectTypes"] = ["person"]
    parsed = [c for c in await client.cameras() if c.id == cam["id"]][0]
    assert parsed.kinds_on == ("person",) and set(parsed.smart_off) == {"vehicle", "animal", "face", "licensePlate"}


# -- streams, stills, talk --------------------------------------------------------------------------------
def test_rtsps_becomes_rtspx_without_srtp_and_the_recorded_streams_all_convert():
    recorded = fixture("rtsps_stream.json")
    assert set(recorded) == {"high", "medium", "low", "package"}
    for url in recorded.values():
        out = pa.rtspx_url(url)
        assert out.startswith("rtspx://192.0.2.10:7441/") and "enableSrtp" not in out and "?" not in out
        assert out.split("/")[-1] == url.split("/")[-1].split("?")[0]            # the token is untouched
    assert pa.rtspx_url("rtsps://h:7441/tok?enableSrtp&x=1") == "rtspx://h:7441/tok?x=1"
    assert pa.rtspx_url("rtsp://h:554/tok") == "rtsp://h:554/tok"


async def test_missing_streams_are_created_and_only_the_missing_ones(console, client):
    cid = console.camera_id("Front Door")
    recorded = fixture("rtsps_stream.json")
    console.streams[cid] = {"high": recorded["high"]}
    streams = await client.rtsps_streams(cid)
    assert set(streams) == {"high", "low"}
    assert streams["high"] == pa.rtspx_url(recorded["high"]) and streams["low"] == pa.rtspx_url(recorded["low"])
    posts = [h for h in console.hits if h["method"] == "POST"]
    assert len(posts) == 1 and posts[0]["body"] == {"qualities": ["low"]}
    again = len(console.hits)
    assert set(await client.rtsps_streams(cid)) == {"high", "low"}
    assert [h["method"] for h in console.hits[again:]] == ["GET"]               # nothing left to create


async def test_create_false_only_reads_and_nothing_exists_means_nothing(console, client):
    cid = console.camera_id("Loft")
    assert await client.rtsps_streams(cid, create=False) == {}
    assert console.writes() == []
    made = await client.rtsps_streams(cid, qualities=("high", "medium", "low", "package"))
    assert set(made) == {"high", "medium", "low", "package"}
    assert console.writes()[0]["body"] == {"qualities": ["high", "medium", "low", "package"]}


async def test_stream_urls_hide_their_token_in_a_repr(console, client):
    streams = await client.rtsps_streams(console.camera_id("Front Door"))
    token = fixture("rtsps_stream.json")["high"].split("/")[-1].split("?")[0]
    assert token in str(streams["high"])                       # go2rtc gets the real address...
    assert token not in repr(streams) and "***" in repr(streams)                # ...a log line of the dict does not


async def test_a_still_is_jpeg_bytes_and_high_quality_is_asked_for(console, client):
    cid = console.camera_id("Front Door")
    low = await client.snapshot(cid)
    high = await client.snapshot(cid, high=True)
    assert low.startswith(b"\xff\xd8") and low.endswith(b"lq") and high.endswith(b"hq")
    assert [h["query"] for h in console.hits] == [{}, {"highQuality": "true"}]


async def test_a_still_that_is_not_a_picture_is_an_error(console, client):
    console.snapshot_html = True
    with pytest.raises(pa.ProtectApiError):
        await client.snapshot(console.camera_id("Loft"))


async def test_a_talkback_session_is_a_url_a_codec_and_a_rate(console, client):
    url, codec, rate = await client.talkback_session(console.camera_id("Front Door"))
    assert (url, codec, rate) == ("rtp://192.0.2.20:7004", "opus", 24000)
    assert client_hit(console, "POST", "/v1/cameras/%s/talkback-session" % console.camera_id("Front Door"))


def client_hit(console, method, path):
    return any(h["method"] == method and h["path"] == path for h in console.hits)


# -- turning smart detections on --------------------------------------------------------------------------
async def test_set_smart_types_sends_only_that_cameras_object_types(console, client):
    loft = console.camera_id("Loft")
    others = {c["id"]: list(c["smartDetectSettings"]["objectTypes"]) for c in console.cameras if c["id"] != loft}
    cam = await client.set_smart_types(loft, ["person", "vehicle"])
    patches = [h for h in console.hits if h["method"] == "PATCH"]
    assert len(patches) == 1 and patches[0]["path"] == f"/v1/cameras/{loft}"
    assert patches[0]["body"] == {"smartDetectSettings": {"objectTypes": ["person", "vehicle"]}}      # nothing else in it
    assert cam.smart_on == ("person", "vehicle") and cam.id == loft
    assert {c["id"]: c["smartDetectSettings"]["objectTypes"] for c in console.cameras if c["id"] != loft} == others


async def test_set_smart_types_refuses_what_the_model_cannot_detect_before_sending_anything(console, client):
    office = console.camera_id("Office")                       # person, vehicle, animal: no face, no plate, no package
    for bad in (["licensePlate"], ["license_plate"], ["person", "face"], ["package"], ["banana"]):
        with pytest.raises(pa.SmartTypeUnsupported) as err:
            await client.set_smart_types(office, bad)
        assert err.value.kind == "smart_type_unsupported" and isinstance(err.value, ValueError)
        assert "Office" in str(err.value)
    assert console.writes() == []


async def test_mantel_kind_names_are_accepted_and_sent_as_protects(console, client):
    loft = console.camera_id("Loft")
    await client.set_smart_types(loft, ["license_plate", "face"])
    assert [h for h in console.hits if h["method"] == "PATCH"][0]["body"] == {
        "smartDetectSettings": {"objectTypes": ["face", "licensePlate"]}}      # the model's own order


async def test_merge_adds_a_type_without_switching_the_others_off(console, client):
    loft = next(c for c in console.cameras if c["name"] == "Loft")
    loft["smartDetectSettings"]["objectTypes"] = ["person"]
    cam = await client.set_smart_types(loft["id"], ["animal"], merge=True)
    assert cam.smart_on == ("person", "animal")
    assert [h for h in console.hits if h["method"] == "PATCH"][0]["body"]["smartDetectSettings"]["objectTypes"] == [
        "person", "animal"]


# -- secrets stay out --------------------------------------------------------------------------------------
async def test_neither_the_repr_nor_the_logs_nor_the_errors_show_the_key(console, ft, caplog):
    caplog.set_level(logging.DEBUG)
    c = make_client(console, ft, pin=None)
    try:
        assert KEY not in repr(c) and KEY not in str(c)
        await c.check()
        await c.rtsps_streams(console.camera_id("Front Door"))
        console.throttle.append({"status": 429})
        await c.cameras()
        stream = pa.EventStream(c)
        assert KEY not in repr(stream)
    finally:
        await c.close()
    assert KEY not in caplog.text
    token = fixture("rtsps_stream.json")["high"].split("/")[-1].split("?")[0]
    assert token not in caplog.text


# -- the events ---------------------------------------------------------------------------------------------
def ingest_all(lines: list[str]) -> list[pa.ProtectEvent]:
    stream = pa.EventStream(None)
    return [e for line in lines for e in stream._ingest(line)]


async def collect(stream: pa.EventStream, n: int, timeout: float = 10.0):
    """The first ``n`` events, and the stream's health at the moment the last one arrived; then the stream is
    closed the way a consumer that stops iterating closes it."""
    out: list[pa.ProtectEvent] = []
    health: dict = {}
    async with asyncio.timeout(timeout):
        async with contextlib.aclosing(stream.events()) as events:
            async for event in events:
                out.append(event)
                if len(out) >= n:
                    health = {"connected": stream.connected, "last_message_at": stream.last_message_at}
                    break
    return out, health


def test_the_recorded_events_become_mantel_events_with_the_repeats_gone():
    events = ingest_all(event_messages("events.jsonl"))
    assert len(events) == 33                                    # 43 messages, 10 of them repeats
    kinds = [e.kind for e in events]
    assert {k: kinds.count(k) for k in set(kinds)} == {"motion": 24, "person": 4, "face": 4, "ring": 1}
    assert len({(e.event_id, e.kind, e.end, e.active) for e in events}) == 33          # never the same thing twice
    cameras = {c["id"]: c["name"] for c in fixture("v1_cameras.json")}
    assert all(e.camera_id in cameras for e in events)          # ids agree across the fixtures
    assert {cameras[e.camera_id] for e in events if e.kind == "ring"} == {"Front Door"}


def test_a_front_door_visit_is_motion_then_person_then_face_then_ring_then_everything_ending():
    cameras = {c["name"]: c["id"] for c in fixture("v1_cameras.json")}
    door = [e for e in ingest_all(event_messages("events.jsonl")) if e.camera_id == cameras["Front Door"]]
    visit = [(e.kind, e.active) for e in door][-7:]
    assert visit == [("motion", True), ("person", True), ("face", True), ("ring", True),
                     ("motion", False), ("person", False), ("face", False)]
    person_start = next(e for e in door if e.kind == "person" and e.active)
    person_end = next(e for e in door if e.kind == "person" and not e.active)
    face_start = next(e for e in door if e.kind == "face" and e.active)
    assert person_start.event_id == person_end.event_id == face_start.event_id         # one detection, two kinds
    assert person_start.end is None and person_end.end == 1793624203406
    assert person_start.start == person_end.start == 1793624182006
    ring = next(e for e in door if e.kind == "ring")
    assert (ring.start, ring.end, ring.active) == (1793624193885, 1793624203885, True)        # the tone's own length


def test_the_second_capture_which_begins_mid_event_still_makes_sense():
    events = ingest_all(event_messages("events2.jsonl"))
    assert len(events) == 12
    first = events[0]                                           # the first thing seen is a motion's ENDING update
    assert (first.kind, first.active, first.end) == ("motion", False, 1793624143107)
    assert sum(1 for e in events if e.kind == "ring") == 1


def test_updates_that_leave_fields_out_are_merged_into_the_event():
    add = {"type": "add", "item": {"id": "e1", "modelKey": "event", "type": "smartDetectZone", "start": 5000,
                                   "device": "cam1", "smartDetectTypes": ["person"]}}
    bare = {"type": "update", "item": {"id": "e1", "modelKey": "event", "end": 9000}}
    events = ingest_all([json.dumps(add), json.dumps(bare), json.dumps(bare)])
    assert events == [pa.ProtectEvent("person", "cam1", "e1", 5000, None, True),
                      pa.ProtectEvent("person", "cam1", "e1", 5000, 9000, False)]


def test_a_smart_detection_is_one_event_per_type_and_types_only_grow():
    def zone(kind, types, **extra):
        return json.dumps({"type": kind, "item": {"id": "z1", "modelKey": "event", "type": "smartDetectZone",
                                                  "start": 1, "device": "cam1", "smartDetectTypes": types, **extra}})
    events = ingest_all([zone("add", ["person"]), zone("update", ["face", "person"]),
                         zone("update", ["person"]),                     # a thinner list does not take face away
                         zone("update", ["licensePlate", "vehicle"]), zone("update", ["person"], end=7)])
    assert [(e.kind, e.active) for e in events] == [
        ("person", True), ("face", True), ("license_plate", True), ("vehicle", True),
        ("person", False), ("face", False), ("license_plate", False), ("vehicle", False)]


def test_unknown_event_types_are_ignored_and_logged_once(caplog):
    caplog.set_level(logging.INFO, logger="mantel.protect")

    def msg(item):
        return json.dumps({"type": "add", "item": {"modelKey": "event", "start": 1, "device": "cam1", **item}})
    stream = pa.EventStream(None)
    got = []
    for i in range(3):
        got += stream._ingest(msg({"id": f"s{i}", "type": "sensorMotion"}))
        got += stream._ingest(msg({"id": f"a{i}", "type": "smartAudioDetect", "smartDetectTypes": ["alrmSpeak"]}))
        got += stream._ingest(msg({"id": f"m{i}", "type": "smartDetectZone", "smartDetectTypes": ["alrmBark", "person"]}))
    assert [e.kind for e in got] == ["person"] * 3
    said = [r.getMessage() for r in caplog.records if "ignoring" in r.getMessage()]
    assert len(said) == 3 and len(set(said)) == 3               # sensorMotion, smartAudioDetect, smartDetectZone/alrmBark


def test_junk_on_the_socket_does_not_stop_the_stream(caplog):
    good = json.dumps({"type": "add", "item": {"id": "m1", "modelKey": "event", "type": "motion", "start": 1, "device": "c"}})
    junk = ["not json", "[]", "{}", '{"type": "add"}', '{"type": "remove", "item": {"id": "m1", "modelKey": "event"}}',
            '{"type": "add", "item": {"id": "x", "modelKey": "camera"}}',
            '{"type": "add", "item": {"id": "n", "modelKey": "event", "type": "motion", "start": 1}}']        # no camera
    assert [e.kind for e in ingest_all(junk + [good])] == ["motion"]


async def test_events_arrive_over_the_real_socket_with_health(console, client):
    console.plans = [(event_messages("events.jsonl"), True)]
    stream = pa.EventStream(client, clock=lambda: 1234.5)
    assert stream.last_message_at is None and not stream.connected
    got, health = await collect(stream, 33)
    assert len(got) == 33 and {e.kind for e in got} == {"motion", "person", "face", "ring"}
    assert health == {"connected": True, "last_message_at": 1234.5}
    assert not stream.connected                                  # the consumer stopped: the socket was closed
    assert client_hit(console, "GET", "/v1/subscribe/events")
    assert console.hits[-1]["key_sent"] is True


async def test_the_stream_redials_after_a_drop_with_the_backoff_and_loses_nothing(console, client):
    lines = event_messages("events.jsonl")[20:33]               # a Front Door visit and the other camera's
    first, second = lines[:5], lines[5:]
    console.plans = [([], False), ([], False), (first, False), (second, True)]
    naps = []

    async def nap(seconds):
        naps.append(seconds)
        await asyncio.sleep(0)
    stream = pa.EventStream(client, sleep=nap)
    expected = ingest_all(lines)
    got, _ = await collect(stream, len(expected))
    assert got == expected                                       # across two sockets, once each
    assert console.sockets == 4
    assert naps == [1.0, 2.0, 1.0]                               # two silent drops back off; one that spoke starts over
    assert stream.reconnects == 3


async def test_the_backoff_climbs_one_two_five_ten_thirty_and_stays(console, client):
    console.plans = [([], False)] * 7 + [(event_messages("events.jsonl")[:1], True)]
    naps = []

    async def nap(seconds):
        naps.append(seconds)
        await asyncio.sleep(0)
    stream = pa.EventStream(client, sleep=nap)
    await collect(stream, 1)
    assert naps == [1.0, 2.0, 5.0, 10.0, 30.0, 30.0, 30.0]


async def test_a_socket_that_lived_long_enough_starts_the_backoff_over(console, client):
    console.plans = [([], False)] * 3 + [(event_messages("events.jsonl")[:1], True)]
    naps = []

    async def nap(seconds):
        naps.append(seconds)
        await asyncio.sleep(0)
    stream = pa.EventStream(client, sleep=nap, stable_s=0.0)       # every socket that opened counts as a stable one
    await collect(stream, 1)
    assert naps == [1.0, 1.0, 1.0]


async def test_a_console_that_is_down_is_retried_not_given_up_on(console, ft):
    c = pa.ProtectClient(f"127.0.0.1:{closed_port()}", KEY, lambda: aiohttp.ClientSession(), "ab" * 32,
                         clock=ft.clock, sleep=ft.sleep)
    naps = []

    async def nap(seconds):
        naps.append(seconds)
        if len(naps) == 3:
            await stream.close()
        await asyncio.sleep(0)
    stream = pa.EventStream(c, sleep=nap)
    try:
        assert [e async for e in stream.events()] == []          # close() ended it quietly
        assert naps == [1.0, 2.0, 5.0] and "lost the connection" in (stream.last_error or "")
    finally:
        await c.close()


async def test_a_changed_certificate_ends_the_stream_by_raising_instead_of_retrying(console, ft):
    c = make_client(console, ft)
    try:
        await console.rotate_cert()
        stream = pa.EventStream(c, sleep=ft.sleep)
        with pytest.raises(pa.CertificateChanged):
            async for _ in stream.events():
                pass
        assert "certificate" in stream.last_error and not stream.connected and stream.reconnects == 0
        assert console.sockets == 0
    finally:
        await c.close()


async def test_a_refused_key_ends_the_stream_by_raising_instead_of_retrying(console, ft):
    c = make_client(console, ft, key="revoked")
    try:
        stream = pa.EventStream(c, sleep=ft.sleep)
        with pytest.raises(pa.KeyRefused):
            async for _ in stream.events():
                pass
        assert stream.reconnects == 0 and "key" in stream.last_error
    finally:
        await c.close()


async def test_close_ends_a_running_stream_quietly(console, client):
    console.plans = [(event_messages("events.jsonl")[:1], True)]
    stream = pa.EventStream(client)
    got = []

    async def run():
        async for event in stream.events():
            got.append(event)
    task = asyncio.create_task(run())
    async with asyncio.timeout(10):
        while not got:
            await asyncio.sleep(0.01)
        await stream.close()
        await task
    assert [e.kind for e in got] == ["motion"] and not stream.connected
