"""A small Chrome DevTools driver for headless checks of Mantel pages (no Playwright needed).

    Browser(width, height) as b: await b.open(url, cookie) ; await b.wait('window.__mantelReady') ; ...

Drives only pages served by Mantel on 127.0.0.1 with a Mantel session cookie; it never touches HA's frontend.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from urllib.parse import urlsplit

import aiohttp

MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def split_card_tags() -> list[str]:
    """The elements defined by the card files tools/split_js.py cut into parts (tools/split_manifests/): their shell
    registers them once its parts have loaded, a beat after the page says it is ready (Part B, phase 18)."""
    tags: set[str] = set()
    folder = os.path.join(ROOT, "tools", "split_manifests")
    for name in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        if not name.endswith(".json"):
            continue
        shell = json.load(open(os.path.join(folder, name))).get("shell", "")
        if shell.startswith("web/hk/cards/"):
            text = open(os.path.join(ROOT, shell), encoding="utf-8").read()
            tags.update(re.findall(r"(?:\bregister|customElements\.define)\(\s*['\"](hk-[a-z0-9-]+)['\"]", text))
    return sorted(tags)


# true once no element of a split card file is on the page (shadow roots too) waiting to be defined; a check that reads a
# card right after __mantelReady waits for this as well (Browser.wait adds it)
CARDS_UPGRADED = ("((tags) => { const walk = (root) => { for (const e of root.querySelectorAll('*')) {"
                  " if (tags.includes(e.localName) && !customElements.get(e.localName)) return false;"
                  " if (e.shadowRoot && !walk(e.shadowRoot)) return false; } return true; };"
                  " return walk(document); })(%s)")


def find_chrome() -> str:
    """Chrome or Chromium: $CHROME, else macOS's Google Chrome, else the first one on PATH (Linux, CI)."""
    if os.environ.get("CHROME"):
        return os.environ["CHROME"]
    if os.path.exists(MAC_CHROME):
        return MAC_CHROME
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        if found := shutil.which(name):
            return found
    return MAC_CHROME                                    # none: the launch fails and says so


CHROME = find_chrome()
# Chrome refuses its sandbox as root (a container or a CI runner); the pages are Mantel's own, on loopback
ROOT_FLAGS = ["--no-sandbox"] if hasattr(os, "geteuid") and os.geteuid() == 0 else []


def free_port(port: int) -> int:
    """`port` when nothing listens on it, else one the system has free: two checks (two sessions, two
    worktrees) on one Mac no longer meet on a fixed DevTools port."""
    import socket
    with socket.socket() as s:
        try:
            s.bind(("127.0.0.1", port))
            return port
        except OSError:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]


class Browser:
    def __init__(self, width=1280, height=800, port=9333):
        self.width, self.height, self.port = width, height, free_port(port)
        self.proc = None
        self.profile = tempfile.mkdtemp(prefix="mantel-chrome-")
        self.console: list[str] = []
        self._id = 0
        self._pending: dict[int, asyncio.Future] = {}
        self.events: list[dict] = []

    async def __aenter__(self):
        self.proc = subprocess.Popen(
            [CHROME, *ROOT_FLAGS, "--headless=new", f"--remote-debugging-port={self.port}", f"--user-data-dir={self.profile}",
             f"--window-size={self.width},{self.height}", "--no-first-run", "--no-default-browser-check",
             "--disable-background-timer-throttling", "--hide-scrollbars", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.http = aiohttp.ClientSession()
        for _ in range(150):                             # up to 30 s: a cold Chrome on a busy CI runner is slow
            try:
                async with self.http.get(f"http://127.0.0.1:{self.port}/json") as r:
                    tabs = [t for t in await r.json() if t["type"] == "page"]
                    if tabs:
                        break
            except aiohttp.ClientError:
                pass
            await asyncio.sleep(0.2)
        else:
            raise RuntimeError(f"Chrome did not start ({CHROME}); set CHROME to a Chrome or Chromium binary")
        self.ws = await self.http.ws_connect(tabs[0]["webSocketDebuggerUrl"], max_msg_size=0)
        self._reader = asyncio.create_task(self._read())
        await self.send("Page.enable")
        await self.send("Runtime.enable")
        await self.send("Network.enable")
        await self.send("Emulation.setDeviceMetricsOverride", width=self.width, height=self.height, deviceScaleFactor=1, mobile=False)
        return self

    async def __aexit__(self, *exc):
        self._reader.cancel()
        await self.ws.close()
        await self.http.close()
        self.proc.terminate()
        shutil.rmtree(self.profile, ignore_errors=True)

    async def _read(self):
        async for m in self.ws:
            d = json.loads(m.data)
            if "id" in d and d["id"] in self._pending:
                fut = self._pending.pop(d["id"])
                fut.set_exception(RuntimeError(d["error"]["message"])) if "error" in d else fut.set_result(d.get("result", {}))
            else:
                self.events.append(d)
                if d.get("method") == "Fetch.requestPaused":
                    asyncio.create_task(self._check_request(d["params"]))
                if d.get("method") == "Runtime.consoleAPICalled":
                    args = " ".join(str(a.get("value", a.get("description", ""))) for a in d["params"]["args"])
                    self.console.append(f"{d['params']['type']}: {args}"[:400])
                elif d.get("method") == "Runtime.exceptionThrown":
                    ex = d["params"]["exceptionDetails"]
                    exc = ex.get("exception", {})
                    what = str(exc.get("description") or ex.get("text"))
                    # a thrown plain object says only "Object": add its fields (e.g. a socket's {code, message})
                    props = (exc.get("preview") or {}).get("properties") or []
                    if props and what in ("Object", "Uncaught"):
                        what += " " + ", ".join(f"{q.get('name')}={q.get('value')}" for q in props[:6])
                    self.console.append("EXCEPTION: " + what[:400])

    async def restrict_origin(self, origin):
        """For offline smoke tests: allow HTTP requests only to their local fixture server."""
        self.allowed_origin = urlsplit(origin).netloc
        self.blocked_requests = []
        await self.send("Fetch.enable", patterns=[{"urlPattern": "*", "requestStage": "Request"}])

    async def _check_request(self, event):
        request_id = event["requestId"]
        url = event["request"]["url"]
        blocked = urlsplit(url).netloc != self.allowed_origin
        if blocked:
            self.blocked_requests.append(urlsplit(url).netloc)
        try:
            if blocked:
                await self.send("Fetch.failRequest", requestId=request_id, errorReason="BlockedByClient")
            else:
                await self.send("Fetch.continueRequest", requestId=request_id)
        except RuntimeError as exc:
            # the page let go of the request first (a navigation, a socket closed): nothing left to answer.
            # A blocked request is still counted above, so the check still fails on it.
            if "Invalid InterceptionId" not in str(exc):
                raise

    async def send(self, method, **params):
        self._id += 1
        fut = asyncio.get_running_loop().create_future()
        self._pending[self._id] = fut
        await self.ws.send_str(json.dumps({"id": self._id, "method": method, "params": params}))
        return await asyncio.wait_for(fut, 60)

    async def open(self, url, cookie_value=None):
        if cookie_value:
            await self.send("Network.setCookie", name="mantel_session", value=cookie_value, domain="127.0.0.1", path="/", httpOnly=True)
        await self.send("Page.navigate", url=url)

    async def eval(self, js):
        r = await self.send("Runtime.evaluate", expression=js, returnByValue=True, awaitPromise=True)
        if "exceptionDetails" in r:
            raise RuntimeError(r["exceptionDetails"].get("exception", {}).get("description", "eval failed"))
        return r["result"].get("value")

    async def wait(self, expr, timeout=60):
        """True once `expr` is truthy, within `timeout` seconds. An expression that waits for __mantelReady also waits for the
        cards of the split card files that are on the page to be defined (their parts load after the page is ready)."""
        end = time.time() + timeout
        if "__mantelReady" in expr:
            tags = split_card_tags()
            if tags:
                expr = f"({expr}) && " + CARDS_UPGRADED % json.dumps(tags)
        while time.time() < end:
            try:
                if await self.eval(expr):
                    return True
            except RuntimeError:
                pass
            await asyncio.sleep(0.25)
        return False

    async def screenshot(self, path, full=False):
        r = await self.send("Page.captureScreenshot", format="png", captureBeyondViewport=full)
        with open(path, "wb") as f:
            f.write(base64.b64decode(r["data"]))
