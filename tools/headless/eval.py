"""Run a JS expression in the loaded /home page and print the JSON result.  python tools/headless/eval.py 'js'"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from cdp import Browser  # noqa: E402

COOKIE = Path("~/.local/share/mantel/measure.cookie").expanduser()


async def main():
    async with Browser() as b:
        await b.open("http://127.0.0.1:8765/home", COOKIE.read_text().strip())
        await b.wait("window.__mantelReady === true", 90)
        print(json.dumps(await b.eval(sys.argv[1]), indent=1)[:6000])


asyncio.run(main())
