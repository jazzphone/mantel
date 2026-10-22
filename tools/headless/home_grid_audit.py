"""The Home Grid render audit (docs/phase11/HOME-GRID.md, G2): every catalog card at every size it has, in the four
looks, on a 6-column grid at 1280 x 800 -- nothing clipped, checked by measured geometry.

    python tools/headless/home_grid_audit.py [--only KEY ...] [--looks flat_light ...] [--shots DIR] [--json FILE]

A real Mantel Server and the gallery's fictional house (tools/headless/gallery.py), headless Chrome, no network
beyond 127.0.0.1. Each card gets one screen per look, its Home a Home Grid holding the card once per size (XL, L
and T across the top, W and S below: every class fits a 6 x 4 grid at once). The four looks: Flat Light, Flat Dark,
and Blur (glass: blur) under a day sky and a night one -- on HK's own screens a card is white on the sky, never
light (hk-base.js tone()), so Blur's light and dark are the sky's.

What it measures, in each block's cell (the view's `.cell`, which clips):

* every text node's box: inside the cell, and not cut off by a box inside the card unless that box ends it with an
  ellipsis (the Risks: "cards end with an ellipsis");
* every icon, picture, button and control: inside the cell;
* the card says the size it was given (`size` on its host) and has no scroll of its own;
* no page scroll, and no script error.

Text scale: HK draws its type roles in px (hk-base.js TYPE) and a wall tablet's text size setting never reaches
them (the Mantel app's web view sets -webkit-text-size-adjust:100%), so the one scale is the largest. The `long`
pass instead names every thing at twice its usual length, which is what a larger text would do to a card.
"""
from __future__ import annotations

import argparse
import asyncio
import copy
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(ROOT))

import gallery  # noqa: E402
from aiohttp.test_utils import TestServer  # noqa: E402
from cdp import Browser  # noqa: E402
from hk_core.settings import home_grid as HG  # noqa: E402

# each size's place on a 6 x 4 grid, all at once
PLACES = {"XL": [0, 0], "L": [3, 0], "T": [5, 0], "W": [0, 2], "S": [2, 2]}
LOOKS = {
    "flat_light": {"flat": True, "flat_theme": "light", "glass": "house"},
    "flat_dark": {"flat": True, "flat_theme": "dark", "glass": "house"},
    "blur_day": {"flat": False, "glass": "blur"},
    "blur_night": {"flat": False, "glass": "blur"},
}
SUN = {"blur_night": -20.0}            # the sun's elevation for a look (else the day's)

# the house the gallery has, and what its cards need besides
EXTRA = {
    "sun.sun": (None, ("above_horizon", {"friendly_name": "Sun", "elevation": 40.0, "azimuth": 180.0})),
    "vacuum.downstairs": ("living_room", ("docked", {"friendly_name": "Downstairs Vacuum", "battery_level": 92,
                                                     "supported_features": 16383})),
    "calendar.family": (None, ("off", {"friendly_name": "Family", "message": "Piano Lesson",
                                       "start_time": "2026-10-23 16:00:00", "end_time": "2026-10-23 17:00:00"})),
    "sensor.running_quick_timers": (None, ("2", {"friendly_name": "Running Quick Timers", "timers": [
        {"name": "Pasta", "remaining": 420, "duration": 600, "state": "active"},
        {"name": "Laundry", "remaining": 1800, "duration": 3600, "state": "active"}]})),
}
# what each block names (a block that names nothing takes the house's: its cameras, weather, vacuum)
OPTS = {"accessory": {"entity": "light.living_room_lamps"}, "scene": {"scene": "scene.movie_night"},
        "now_playing": {"speaker": "media_player.living_room"}, "thermostat": {"entity": "climate.main_floor"}}
LONG = " and the Long Way Round"       # the `long` pass: every name this much longer


def screen(key: str, look: str) -> str:
    return f"grid-{key.replace('_', '-')}-{look.replace('_', '-')}"


def layout(key: str) -> dict:
    sizes = HG.CATALOG[key]["sizes"]
    items = [{"id": f"{key[:3]}{s.lower()}", "card": key, "size": s, "at": PLACES[s], **({"opts": OPTS[key]} if key in OPTS else {})}
             for s in sizes]
    return {"v": 1, "cols": 6, "rows": 4, "frame": [1280, 800], "band": True, "items": items}


def settings(keys: list[str], looks: list[str]) -> dict:
    s = copy.deepcopy(gallery.SETTINGS)
    for key in keys:
        for look in looks:
            s["boards"][screen(key, look)] = dict(gallery.SETTINGS["boards"][gallery.SCREEN], home_style="grid",
                                                  home_grid=layout(key), **LOOKS[look])
    return s


# ---- the measuring, in the page
MEASURE = r"""(() => {
  const deep = (root, sel, out) => { for (const el of root.querySelectorAll('*')) {
    if (el.matches(sel)) out.push(el); if (el.shadowRoot) deep(el.shadowRoot, sel, out); } return out; };
  const view = deep(document, 'hk-home-grid-view', [])[0];
  if (!view) return { error: 'no hk-home-grid-view' };
  const se = document.scrollingElement;
  const out = { page_scroll: se.scrollHeight > se.clientHeight + 1 || se.scrollWidth > se.clientWidth + 1,
                view_scroll: view.scrollHeight > view.clientHeight + 1, cells: [] };
  const box = r => [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10];
  const shown = el => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  // the boxes between a node and the cell that clip, with whether they end text with an ellipsis
  const clippers = (node, cell) => { const out = []; let n = node.nodeType === 1 ? node : node.parentNode;
    while (n && n !== cell) {
      if (n.nodeType === 1) { const cs = getComputedStyle(n);
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || cs.clipPath !== 'none')
          out.push({ el: n, ellipsis: cs.textOverflow === 'ellipsis' || +cs.webkitLineClamp > 0 || cs.webkitLineClamp !== 'none' && cs.webkitLineClamp !== undefined && cs.webkitLineClamp !== '' }); }
      n = n.assignedSlot || n.parentNode || (n.host || null);
      if (n && n.nodeType === 11) n = n.host;
    } return out; };
  const name = el => { let s = el.localName; if (el.id) s += '#' + el.id; if (el.classList && el.classList.length) s += '.' + [...el.classList].slice(0, 2).join('.'); return s; };
  for (const cell of view.shadowRoot.querySelectorAll('.cell')) {
    const card = cell.firstElementChild, c = cell.getBoundingClientRect();
    const rec = { id: cell.getAttribute('data-id'), size: cell.getAttribute('size'), cell: box(c),
                  card: card ? card.localName : null, card_size: card && card.getAttribute('size'), issues: [] };
    out.cells.push(rec);
    if (!card) { rec.issues.push('no card'); continue; }
    const inside = (r, slack = 0.75) => r.left >= c.left - slack && r.top >= c.top - slack && r.right <= c.right + slack && r.bottom <= c.bottom + slack;
    const walk = (root, fn) => { for (const el of root.querySelectorAll('*')) { fn(el); if (el.shadowRoot) walk(el.shadowRoot, fn); } };
    const all = [card]; walk(card.shadowRoot || card, el => all.push(el)); if (card.shadowRoot) walk(card, el => all.push(el));
    let texts = 0, things = 0;
    for (const el of all) {
      if (!shown(el)) continue;
      // text: every non-blank text node
      for (const t of el.childNodes) {
        if (t.nodeType !== 3 || !t.data.trim()) continue;
        const rg = document.createRange(); rg.selectNodeContents(t);
        const rs = [...rg.getClientRects()].filter(r => r.width > 0.5 && r.height > 0.5);
        if (!rs.length) continue;
        texts++;
        const cl = clippers(t, cell);
        for (const r of rs) {
          let vis = { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, cut = null;
          for (const k of cl) { const b = k.el.getBoundingClientRect();
            const nv = { left: Math.max(vis.left, b.left), top: Math.max(vis.top, b.top), right: Math.min(vis.right, b.right), bottom: Math.min(vis.bottom, b.bottom) };
            const lost = (vis.right - vis.left) - Math.max(0, nv.right - nv.left) + (vis.bottom - vis.top) - Math.max(0, nv.bottom - nv.top);
            if (lost > 1.5 && !k.ellipsis && !cut) cut = name(k.el);
            vis = nv; }
          const txt = t.data.trim().slice(0, 30);
          if (vis.right - vis.left <= 0.5 || vis.bottom - vis.top <= 0.5) { rec.issues.push('text hidden by ' + (cut || 'a box') + ': "' + txt + '"'); break; }
          if (cut) { rec.issues.push('text cut by ' + cut + ': "' + txt + '"'); break; }
          if (!inside(vis)) { rec.issues.push('text outside the cell: "' + txt + '" ' + JSON.stringify(box(r))); break; }
        }
      }
      // things you see or touch
      const tag = el.localName;
      if (/^(hk-icon|hk-state-icon|ha-icon|svg|img|button|input|canvas|video)$/.test(tag) || el.getAttribute('role') === 'button' || el.getAttribute('role') === 'slider') {
        if (tag !== 'svg' && el.closest && el.parentNode && el.parentNode.closest && el.parentNode.closest('svg')) continue;
        const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
        things++;
        let vis = r; for (const k of clippers(el, cell)) { const b = k.el.getBoundingClientRect();
          vis = { left: Math.max(vis.left, b.left), top: Math.max(vis.top, b.top), right: Math.min(vis.right, b.right), bottom: Math.min(vis.bottom, b.bottom) }; }
        if (vis.right - vis.left < 1 || vis.bottom - vis.top < 1) continue;           // inside a box that scrolls it away on purpose (a strip)
        if (!inside(vis)) rec.issues.push(tag + ' outside the cell: ' + name(el) + ' ' + JSON.stringify(box(r)));
      }
    }
    rec.texts = texts; rec.things = things;
    if (card.getAttribute('size') !== cell.getAttribute('size')) rec.issues.push('the card does not say its size');
    // the card's plates -- every painted box of a fair size, one plate or a block of tiles -- cover the block
    let u = null;
    for (const el of all) { if (!shown(el)) continue; const cs = getComputedStyle(el);
      const painted = (cs.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor)) || cs.backgroundImage !== 'none' ||
                      (cs.backdropFilter && cs.backdropFilter !== 'none') || /^(img|video|canvas)$/.test(el.localName);
      if (!painted) continue; const r = el.getBoundingClientRect();
      if (Math.min(r.width, c.width) * Math.min(r.height, c.height) < 0.08 * c.width * c.height) continue;
      u = u ? { left: Math.min(u.left, r.left), top: Math.min(u.top, r.top), right: Math.max(u.right, r.right), bottom: Math.max(u.bottom, r.bottom) }
            : { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }
    rec.plate = u ? box({ left: u.left, top: u.top, width: u.right - u.left, height: u.bottom - u.top }) : null;
    if (!u) rec.issues.push('no plate');
    else if (u.left > c.left + 2 || u.top > c.top + 2 || u.right < c.right - 2 || u.bottom < c.bottom - 2)
      rec.issues.push('the plate does not fill the block: ' + Math.round(u.right - u.left) + 'x' + Math.round(u.bottom - u.top));
    if (!texts && !things) rec.issues.push('nothing drawn');
    rec.issues = [...new Set(rec.issues)].slice(0, 12);
  }
  return out;
})()"""


async def audit(keys: list[str], looks: list[str], shots: Path | None, long: bool) -> dict:
    gallery.HOUSE.update(EXTRA)
    if long:
        for eid, (area, (state, attrs)) in list(gallery.HOUSE.items()):
            if "friendly_name" in attrs and not eid.startswith("sun."):
                gallery.HOUSE[eid] = (area, (state, dict(attrs, friendly_name=attrs["friendly_name"] + LONG)))
    gallery.SETTINGS = settings(keys, looks)
    report: dict = {}
    with tempfile.TemporaryDirectory(prefix="mantel-grid-audit-") as folder:
        app, cookie = await gallery.build(Path(folder))
        hub = app["hub"]
        async with TestServer(app) as server:
            origin = str(server.make_url("")).rstrip("/")
            async with Browser(width=1280, height=800, port=9391) as b:
                await b.restrict_origin(origin)
                for look in looks:
                    elev = SUN.get(look, 40.0)
                    hub.store.apply_event({"a": {"sun.sun": {
                        "s": "above_horizon" if elev > 0 else "below_horizon", "lc": gallery.NOW, "lu": gallery.NOW,
                        "a": {"friendly_name": "Sun", "elevation": elev, "azimuth": 180.0}}}})
                    for key in keys:
                        name = screen(key, look)
                        mark = len(b.console)
                        await b.open(f"{origin}/{name}/home", cookie)
                        await b.wait("window.__mantelReady === true", 30)
                        await b.wait("""(() => { const d = (r) => { for (const e of r.querySelectorAll('*')) {
                            if (e.localName === 'hk-home-grid-view') return e; if (e.shadowRoot) { const f = d(e.shadowRoot); if (f) return f; } }
                            return null; }; const v = d(document); return v && v.shadowRoot.querySelectorAll('.cell').length > 0; })()""", 20)
                        await asyncio.sleep(2.0)            # pictures, fonts and the sky settle
                        got = await b.eval(MEASURE)
                        got["errors"] = [c for c in b.console[mark:] if c.startswith(("EXCEPTION", "error"))][:8]
                        report.setdefault(key, {})[look] = got
                        if shots:
                            await b.screenshot(shots / f"{name}{'-long' if long else ''}.png")
    return report


def summary(report: dict) -> tuple[int, list[str]]:
    lines, bad = [], 0
    for key, by_look in report.items():
        for look, got in by_look.items():
            if got.get("error"):
                bad += 1
                lines.append(f"FAIL {key:12} {look:10} {got['error']}")
                continue
            head = []
            if got["page_scroll"]:
                head.append("the page scrolls")
            if got["view_scroll"]:
                head.append("the view scrolls")
            head += [f"script error: {e}" for e in got.get("errors", [])]
            for cell in got["cells"]:
                issues = head + cell["issues"]
                head = []
                status = "FAIL" if issues else "ok  "
                bad += bool(issues)
                lines.append(f"{status} {key:12} {look:10} {cell['size']:2} {cell['card'] or '-':28} "
                              f"{cell['cell'][2]:.0f}x{cell['cell'][3]:.0f} texts {cell.get('texts', 0)}")
                lines += [f"       - {i}" for i in issues]
    return bad, lines


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    G2 = ["accessory", "scene", "scenes", "now_playing", "thermostat", "camera", "security", "timers", "weather",
          "calendar", "battery", "people", "vacuum", "clock"]
    ap.add_argument("--only", nargs="*", help="catalog keys (default: G2's fourteen)")
    ap.add_argument("--looks", nargs="*", choices=list(LOOKS), default=list(LOOKS))
    ap.add_argument("--shots", type=Path, help="a folder for one screenshot per card and look")
    ap.add_argument("--json", type=Path, help="write the measurements here")
    ap.add_argument("--long", action="store_true", help="every name twice as long")
    a = ap.parse_args(argv)
    keys = a.only or G2
    unknown = [k for k in keys if k not in HG.CATALOG]
    if unknown:
        ap.error(f"not in the catalog: {unknown}")
    if a.shots:
        a.shots.mkdir(parents=True, exist_ok=True)
    report = asyncio.run(audit(keys, a.looks, a.shots, a.long))
    if a.json:
        a.json.write_text(json.dumps(report, indent=1))
    bad, lines = summary(report)
    print("\n".join(lines))
    print(f"{'FAIL' if bad else 'ok'}: {bad} block(s) with a problem, {len(keys)} card(s) x {len(a.looks)} look(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
