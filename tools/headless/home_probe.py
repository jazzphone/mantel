"""Load /home headlessly, print what the page did, take a screenshot.

    python tools/headless/home_probe.py [--shot docs/proof1/kitchen-home.png] [--url ...]
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from cdp import Browser  # noqa: E402

COOKIE = Path("~/.local/share/mantel/measure.cookie").expanduser()


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8765/home")
    ap.add_argument("--shot")
    ap.add_argument("--wait", type=float, default=8)
    a = ap.parse_args()
    async with Browser() as b:
        await b.open(a.url, COOKIE.read_text().strip())
        ok = await b.wait("window.__mantelReady === true", 90)
        await asyncio.sleep(a.wait)
        print("ready:", ok)
        print("marks:", json.dumps(await b.eval("window.__mantelMarks")))
        print("calls:", json.dumps(await b.eval("Object.fromEntries(window.__mantel ? window.__mantel.calls : [])")))
        print("refused:", json.dumps(await b.eval("window.__mantel ? window.__mantel.refused : []")))
        print("narrowed:", await b.eval("window.__mantelNarrow"))
        print("elements:", json.dumps(await b.eval("""(() => { const n = {}; const walk = (r) => { for (const e of r.querySelectorAll('*')) {
            n[e.localName] = (n[e.localName] || 0) + 1; if (e.shadowRoot) walk(e.shadowRoot); } }; walk(document); return n; })()""")))
        print("console:")
        for line in b.console[:60]:
            print("  ", line)
        if a.shot:
            await b.screenshot(a.shot)
            print("screenshot:", a.shot)


asyncio.run(main())
