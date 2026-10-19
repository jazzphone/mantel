"""A fake Fully Kiosk Browser Remote Admin for tests/test_fully.py: ``GET /?cmd=...&password=...&type=json``
answered the way Fully answers it (deviceInfo, the commands Mantel may send, ``{"status": "Error"}`` for a wrong
password or an unknown command), with the tablet's screen, brightness, screensaver and page changed by each
command so tests can see it land. Every request is recorded (its parameters, the password replaced by whether
it matched). No real tablet is contacted; every name, id and password is fictional."""
from __future__ import annotations

import asyncio

from aiohttp import web

PASSWORD = "fictional-fully-password"


class FakeFully:
    def __init__(self, password: str = PASSWORD) -> None:
        self.password = password
        self.calls: list[dict] = []           # each request's parameters; "password" is True/False (matched)
        self.mode = "fully"                   # fully | html (a web page, not Fully) | http500 | slow | echo
        self.delay = 0.0
        self.state = {"screenOn": True, "screenBrightness": 180, "isInScreensaver": False,
                      "currentPage": "http://mantel.fake.test:8100/kitchen-home/home", "foreground": "de.ozerov.fully"}

    def app(self) -> web.Application:
        app = web.Application()
        app.router.add_get("/", self.root)
        return app

    def cmds(self) -> list[str]:
        return [c.get("cmd") for c in self.calls]

    async def root(self, request: web.Request) -> web.Response:
        q = dict(request.query)
        self.calls.append({**q, "password": q.get("password") == self.password} if "password" in q else q)
        if self.mode == "slow":
            await asyncio.sleep(self.delay)
        if self.mode == "html":
            return web.Response(text="<html><body>A router's page</body></html>", content_type="text/html")
        if self.mode == "http500":
            return web.Response(status=500, text="oops")
        if self.mode == "echo":                          # a refusal that repeats what it was sent
            return web.json_response({"status": "Error", "statustext": f"Bad value for {q.get('password')}"})
        if q.get("password") != self.password:
            return web.json_response({"status": "Error", "statustext": "Please login"})
        cmd, s = q.get("cmd"), self.state
        if cmd == "deviceInfo":
            return web.json_response({
                "deviceID": "f0e1d2c3-fictional", "deviceName": "Kitchen Tablet (fake)", "deviceModel": "Fake Tab 10",
                "appVersionName": "1.57.1", "batteryLevel": 88, "plugged": True, "kioskMode": True, "ip4": "192.0.2.31",
                "Mac": "02:00:00:00:00:31", "startUrl": "http://mantel.fake.test:8100/", **s})
        if cmd == "screenOn":
            s["screenOn"] = True
        elif cmd == "screenOff":
            s["screenOn"] = False
        elif cmd == "setStringSetting" and q.get("key") == "screenBrightness":
            s["screenBrightness"] = int(q["value"])
        elif cmd == "startScreensaver":
            s["isInScreensaver"] = True
        elif cmd == "stopScreensaver":
            s["isInScreensaver"] = False
        elif cmd == "loadUrl":
            s["currentPage"] = q["url"]
        elif cmd == "loadStartUrl":
            s["currentPage"] = "http://mantel.fake.test:8100/"
        elif cmd == "toForeground":
            s["foreground"] = "de.ozerov.fully"
        else:
            return web.json_response({"status": "Error", "statustext": f"Unknown command {cmd}"})
        return web.json_response({"status": "OK", "statustext": f"{cmd} done"})
