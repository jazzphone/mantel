"""Mantel Settings on iPhone and iPad sizes (docs/phase10/APPLE-APPS.md §8, slice 10.1), in an isolated headless Chrome.

Run: .venv/bin/python tools/headless/settings_viewports.py [--shots DIR]
A fictional Owner on a temp database, no Home Assistant. For each size (an iPhone upright and on its side, an
11" iPad upright and on its side) the page is drawn as a touch device with the iPhone's safe areas, and checked:

* one column on the phone both ways; the list beside the page on the iPad both ways (iOS Settings' layout);
* nothing wider than the window (no sideways scroll), in the page or inside the panel;
* the panel keeps clear of the safe areas: its host is padded by the top/left/right insets, and the list's and
  the page's ends by the bottom inset (the home indicator);
* opening Me (a page) still works, and no script error.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "hosts/server"))
from aiohttp.test_utils import TestServer  # noqa: E402
from argon2 import PasswordHasher  # noqa: E402
from cdp import Browser  # noqa: E402
from mantel_server.config import Config  # noqa: E402
from mantel_server.server import build_app  # noqa: E402
from mantel_server.storage.store import Store  # noqa: E402

PASSWORD = "correct horse battery staple"
# (name, width, height, wide expected, safe-area insets top/right/bottom/left as an iPhone/iPad reports them)
SIZES = [
    ("iphone-upright", 390, 844, False, (47, 0, 34, 0)),
    ("iphone-side", 844, 390, False, (0, 47, 21, 47)),
    ("ipad-upright", 820, 1180, True, (24, 0, 20, 0)),
    ("ipad-side", 1180, 820, True, (24, 0, 20, 0)),
]

PROBE = """(() => {
  const el = document.getElementById('mantel-settings');
  const sr = el && el.shadowRoot;
  if (!sr) return null;
  const cs = getComputedStyle(el);
  const side = sr.querySelector('.side'), page = sr.querySelector('.page');
  const over = [...sr.querySelectorAll('*')].filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1; })
    .slice(0, 5).map((n) => n.tagName + '.' + (n.className && n.className.baseVal === undefined ? n.className : ''));
  return { wide: el.hasAttribute('wide'), view: sr.querySelector('.app') && sr.querySelector('.app').getAttribute('data-view'),
           pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(parseFloat),
           sideBottom: side ? parseFloat(getComputedStyle(side).paddingBottom) : null,
           pageBottom: page ? parseFloat(getComputedStyle(page).paddingBottom) : null,
           sideShown: !!side && getComputedStyle(side).display !== 'none',
           scrollW: document.documentElement.scrollWidth, over };
})()"""


async def check(shots: Path | None = None, port: int = 9351) -> list[dict]:
    tmp = Path(tempfile.mkdtemp(prefix="mantel-viewports-"))
    cfg = Config(data_dir=tmp / "data", secrets_dir=tmp / "secrets", port=0)
    store = Store(cfg.data_dir / "mantel.db")
    app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False)
    app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    results = []
    async with TestServer(app, host="127.0.0.1") as server:
        await app["accounts"].create_user("owner", "Fictional Owner", "owner", PASSWORD)
        base = str(server.make_url("")).rstrip("/")
        for i, (name, w, h, wide, insets) in enumerate(SIZES):
            async with Browser(w, h, port=port + i) as b:
                await b.send("Emulation.setDeviceMetricsOverride", width=w, height=h, deviceScaleFactor=2, mobile=True)
                await b.send("Emulation.setTouchEmulationEnabled", enabled=True, maxTouchPoints=5)
                emulated = True
                try:
                    t, r, bt, lf = insets
                    await b.send("Emulation.setSafeAreaInsetsOverride", insets={"top": t, "right": r, "bottom": bt, "left": lf})
                except RuntimeError:
                    emulated = False          # an older Chrome: the layout is still checked, the insets are not
                await b.send("Page.navigate", url=base + "/login")
                await b.wait("document.readyState === 'complete'")
                ok = await b.eval(f"""fetch('/api/auth/password', {{method: 'POST', headers: {{'Content-Type': 'application/json'}},
                    body: JSON.stringify({{username: 'owner', password: {json.dumps(PASSWORD)}}})}}).then((r) => r.ok)""")
                assert ok, "sign-in failed"
                await b.send("Page.navigate", url=base + "/settings#/")
                ready = await b.wait("!!window.__mantelReady && !!document.getElementById('mantel-settings').shadowRoot.querySelector('.side')", 60)   # cold, under the suite's load
                got = await b.eval(PROBE) if ready else None
                if got is not None:
                    await b.eval("location.hash = '#/mantel/me'")
                    await b.wait("document.getElementById('mantel-settings').shadowRoot.querySelector('.app').getAttribute('data-view') === 'detail'", 10)
                    got["me"] = await b.eval("document.getElementById('mantel-settings').shadowRoot.querySelector('.app').getAttribute('data-view')")
                    got["scrollW_me"] = await b.eval("document.documentElement.scrollWidth")
                if shots:
                    shots.mkdir(parents=True, exist_ok=True)
                    await b.screenshot(str(shots / f"settings-{name}.png"))
                errors = [c for c in b.console if c.startswith("EXCEPTION")]
                results.append({"name": name, "w": w, "h": h, "expect_wide": wide, "insets": insets,
                                "emulated_insets": emulated, "got": got, "errors": errors})
    store.db.close()
    return results


def problems(results: list[dict]) -> list[str]:
    out = []
    for r in results:
        g, name = r["got"], r["name"]
        if g is None:
            out.append(f"{name}: the page did not draw")
            continue
        if g["wide"] != r["expect_wide"]:
            out.append(f"{name}: wide={g['wide']}, expected {r['expect_wide']}")
        if g["scrollW"] > r["w"] or g.get("scrollW_me", 0) > r["w"]:
            out.append(f"{name}: wider than the window ({g['scrollW']}/{g.get('scrollW_me')} > {r['w']})")
        if g["over"]:
            out.append(f"{name}: past the right edge: {g['over']}")
        if g.get("me") != "detail":
            out.append(f"{name}: Me did not open")
        if r["emulated_insets"]:
            t, rt, bt, lf = r["insets"]
            if [round(x) for x in g["pad"]] != [t, rt, 0, lf]:
                out.append(f"{name}: host padding {g['pad']} != insets {[t, rt, 0, lf]}")
            if g["sideBottom"] is not None and g["sideBottom"] < 40 + bt:
                out.append(f"{name}: the list's end {g['sideBottom']} ignores the home indicator ({bt})")
        if r["errors"]:
            out.append(f"{name}: {r['errors'][:2]}")
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", type=Path)
    a = ap.parse_args()
    results = asyncio.run(check(a.shots))
    for r in results:
        print(r["name"], json.dumps(r["got"]), "insets emulated" if r["emulated_insets"] else "insets NOT emulated")
    bad = problems(results)
    print("\n".join(bad) if bad else "settings viewports: ok")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
