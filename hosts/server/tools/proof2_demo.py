"""Repeatable offline Proof 2 evidence. No listener, HA token, or upstream client.

Run from the repository root:
  PYTHONPATH=hosts/server python hosts/server/tools/proof2_demo.py
"""
import asyncio
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import AsyncMock

from aiohttp import web
from aiohttp.test_utils import make_mocked_request

from mantel_server.auth import SESSION_COOKIE
from mantel_server.proof2 import COMMAND, PATH, command
from mantel_server.store import Store


async def main():
    with TemporaryDirectory(prefix="mantel-proof2-") as folder:
        store = Store(Path(folder) / "proof.db")
        try:
            app = web.Application()
            app["store"] = store
            app["clock"] = lambda: 1000.0
            for actor, role in (("fictional-owner", "owner"), ("fictional-child", "child")):
                store.link(actor, role, now=1000.0)
                sid = store.create_session(actor, 60, now=1000.0)
                request = make_mocked_request("POST", PATH, headers={
                    "Host": "127.0.0.1", "Origin": "http://127.0.0.1",
                    "Cookie": f"{SESSION_COOKIE}={sid}",
                }, app=app)
                request.json = AsyncMock(return_value=COMMAND)
                response = await command(request)
                print(json.dumps({"actor": actor, "http_status": response.status, **json.loads(response.text)}))
            print("Audit (temporary database; simulated request has no source IP):")
            for row in store.db.execute("SELECT * FROM command_audit ORDER BY id"):
                print(json.dumps(dict(row), sort_keys=True))
        finally:
            store.db.close()


if __name__ == "__main__":
    asyncio.run(main())
