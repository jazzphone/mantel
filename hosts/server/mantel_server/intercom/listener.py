"""The Intercom's stream listener: a second, tiny aiohttp application on its own port, so Music Assistant can fetch
one broadcast's audio without going near Mantel's main port (sessions, door checks, a proxy).
(docs/phase17/INTERCOM.md "Getting the audio to MA: the stream listener and the one-time link")

It serves exactly one thing: GET and HEAD of ``/s/<token>.wav``, through ``Links.claim``. No ``/api``, no
sessions, no static files, no WebSocket, no access log (the token is in the path). Every other path or method, and
every refused link, answers the same bare 404: empty body, ``Cache-Control: no-store``, no ``Server`` header, no
cookie, no CORS header, no redirect. That includes a request aiohttp's parser refuses (``_QuietHandler``: never its
400 page, which echoes the request line, and never a log of that line). A connection with no whole request after
IDLE_CLOSE seconds is closed, and so is one past MAX_CONNECTIONS (MAX_PER_PEER from one address).

* A Message (``link.finite``) is served whole: ``audio/wav`` with a real Content-Length and ``Accept-Ranges: none``.
* Live is chunked: the open-ended header, then the spool as it fills. It ends when the talker ends, after
  LIVE_IDLE seconds of no audio, or when the link is killed. If it ends before the spool is finished (MA hung up, or
  the audio stopped) ``link.ended_early`` is set; the driver turns that into a fallback to Message.

``link.fetch_started`` is set at the first byte and ``link.fetch_ended`` when the response ends, however it ends.
The listener is meant to run through ``StreamListener`` (the runner cancels a handler whose client has gone, so a
hang-up is noticed at once rather than at the next chunk).
"""
from __future__ import annotations

import asyncio
import contextlib
import logging

from aiohttp import web
from aiohttp.web_protocol import RequestHandler

from .links import Links
from .spool import streaming_wav_header

log = logging.getLogger("mantel.intercom")

LIVE_IDLE = 10.0        # seconds of no audio that end a Live stream
MAX_LINE = 65536        # a long junk path still gets the bare 404 (the parser's own 400 would name aiohttp)
AUDIO_HEADERS = {"Content-Type": "audio/wav", "Cache-Control": "no-store", "Accept-Ranges": "none"}
IDLE_CLOSE = 10.0       # a connection with no whole request this long after it opened (or after its last answer) is
                        # closed: a slow-header client can't hold the port (aiohttp's own default is an hour)
MAX_CONNECTIONS = 64    # open connections on the listener (Music Assistant needs one or two)
MAX_PER_PEER = 8        # from one address; more are closed at once, so one LAN host can't use up the process's files


class _Bare(web.Response):
    """A response aiohttp can't add its ``Server`` header to (its parser's error answers skip on_response_prepare)."""

    async def _prepare_headers(self) -> None:
        await super()._prepare_headers()
        self.headers.popall("Server", None)


def _refuse() -> web.Response:
    return _Bare(status=404, headers={"Cache-Control": "no-store", "Content-Length": "0"})


class _QuietHandler(RequestHandler):
    """aiohttp's connection handler, with two changes for this port only:

    * a malformed request (a bad request line, header or version; a request the parser refuses; an error in the
      handler) gets the same bare 404 as everything else, never aiohttp's 400 page (its body echoes the request line,
      with any token in it, and names aiohttp in a ``Server`` header), and is never logged with its request line;
    * too many connections, in all or from one address, are closed as they open.
    """

    def connection_made(self, transport) -> None:  # type: ignore[override]
        super().connection_made(transport)
        peer = transport.get_extra_info("peername")
        who = peer[0] if isinstance(peer, tuple) and peer else None
        conns = self._manager.connections if self._manager is not None else []
        same = sum(1 for c in conns if c.transport is not None
                   and (c.transport.get_extra_info("peername") or (None,))[0] == who)
        if len(conns) > MAX_CONNECTIONS or same > MAX_PER_PEER:
            self.force_close()

    def handle_error(self, request, status: int = 500, exc=None, message=None):  # type: ignore[override]
        log.debug("intercom listener: a request was refused (%s)", type(exc).__name__ if exc is not None else status)
        if request.writer.output_size > 0:
            raise ConnectionError("the answer had already started")
        resp = _refuse()
        resp.force_close()
        return resp


class _QuietServer(web.Server):
    def __call__(self) -> RequestHandler:
        return _QuietHandler(self, loop=self._loop, **self._kwargs)


class _Runner(web.AppRunner):
    async def _make_server(self) -> web.Server:
        server = await super()._make_server()
        server.__class__ = _QuietServer
        return server


@web.middleware
async def _bare_errors(request: web.Request, handler):
    """Any aiohttp error page (unknown path, wrong method, bad request) becomes the one bare 404."""
    try:
        return await handler(request)
    except web.HTTPException:
        return _refuse()


async def _strip(request: web.Request, response: web.StreamResponse) -> None:
    response.headers.popall("Server", None)
    response.headers["Cache-Control"] = "no-store"


STALL_S = 0.4      # a write the fetcher took longer than this to take is a stall (it hadn't pulled the audio yet)


def make_app(links: Links, *, idle: float | None = None) -> web.Application:
    """The listener's application: ONE route, GET/HEAD ``/s/{token}.wav``."""

    async def stream(request: web.Request) -> web.StreamResponse:
        link = links.claim(request.match_info["token"], request.remote, request.method)
        if link is None:
            return _refuse()
        spool = link.spool
        if request.method == "HEAD":
            head = dict(AUDIO_HEADERS)
            if link.finite:
                head["Content-Length"] = str(len(spool.to_wav()))
            return web.Response(headers=head)
        if link.finite:
            return await _message(request, link)
        return await _live(request, link, LIVE_IDLE if idle is None else idle)

    async def _message(request: web.Request, link) -> web.StreamResponse:
        body = link.spool.to_wav()
        resp = web.StreamResponse(headers=AUDIO_HEADERS)
        resp.content_length = len(body)
        try:
            await resp.prepare(request)
            link.fetch_started.set()
            await resp.write(body)
            await resp.write_eof()
        except (ConnectionResetError, ConnectionError):
            pass
        finally:
            link.fetch_ended.set()
        return resp

    async def _live(request: web.Request, link, idle_s: float) -> web.StreamResponse:
        spool = link.spool
        resp = web.StreamResponse(headers=AUDIO_HEADERS)
        resp.enable_chunked_encoding()
        try:
            await resp.prepare(request)
            await resp.write(streaming_wav_header(spool.rate))
            link.fetch_started.set()
            # a killed link stops the stream, except that a finished spool is let drain (it is all in memory)
            loop = asyncio.get_running_loop()
            async for chunk in spool.read(0, idle_s, halt=lambda: link.dead and not spool.finished):
                t0 = loop.time()
                await resp.write(chunk)
                if loop.time() - t0 > STALL_S:
                    link.stalls += 1
                link.served += len(chunk)
            await resp.write_eof()
        except (ConnectionResetError, ConnectionError):
            pass
        finally:
            # also runs when the runner cancels the handler because MA hung up
            if not (spool.finished or spool.dropped or link.dead):
                link.ended_early = True
            link.fetch_ended.set()
        return resp

    app = web.Application(middlewares=[_bare_errors], client_max_size=0)
    app.router.add_get(r"/s/{token:[A-Za-z0-9_-]{1,128}}.wav", stream)       # GET, and HEAD with it
    app.on_response_prepare.append(_strip)
    return app


class StreamListener:
    def __init__(self, links: Links, host: str, port: int):
        self.links = links
        self.host = host
        self.port = port            # 0 = pick one; after start() it is the bound port
        self._runner: web.AppRunner | None = None

    @property
    def running(self) -> bool:
        return self._runner is not None

    async def start(self) -> None:
        if self._runner is not None:
            return
        runner = _Runner(make_app(self.links), access_log=None, handler_cancellation=True,
                         max_line_size=MAX_LINE, keepalive_timeout=IDLE_CLOSE)
        await runner.setup()
        try:
            site = web.TCPSite(runner, self.host, self.port, reuse_address=True)
            await site.start()
        except BaseException:
            await runner.cleanup()
            raise
        self._runner = runner
        for sock in site._server.sockets:                       # noqa: SLF001 -- the only way to learn port 0
            self.port = sock.getsockname()[1]
            break
        log.info("intercom stream listener on %s:%s", self.host, self.port)

    async def stop(self) -> None:
        """Close the port and end every fetch in progress."""
        runner, self._runner = self._runner, None
        if runner is None:
            return
        self.links.kill_all()
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(runner.cleanup(), 5)
