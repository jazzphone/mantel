"""The Home Grid render audit (docs/phase11/HOME-GRID.md, G2): every catalog card at every size it has, in the four
looks, on a 6-column grid at 1280 x 800 -- nothing clipped, checked by measured geometry.

    python tools/headless/home_grid_audit.py [--only KEY ...] [--looks flat_light ...] [--shots DIR] [--json FILE]
                                             [--cell square] [--homeview]

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
* DESIGN.md, what can be measured: no text under the smallest type role (11 px), every control at least 44 px,
  every painted box's corner on the scale (23.5, 22, 20, 12, 8, a capsule, square) and the block's plate 23.5;
* no page scroll, and no script error.

Square cells (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md Phase A): `--cell square` lays the same blocks on 196 x 196
cells (S 196 x 196, W 402 x 196, T 196 x 402, L 402 x 402, XL 608 x 402), where every block's plate corner is
HomeView's 34; `--homeview` also makes the tiles Centred, the thermostat Big Number and the clock Analog Numbers.

Text scale: HK draws its type roles in px (hk-base.js TYPE) and a wall tablet's text size setting never reaches
them (the Mantel app's web view sets -webkit-text-size-adjust:100%), so the one scale is the largest. The `long`
pass instead names every thing at twice its usual length, which is what a larger text would do to a card.

Stood in: the house's forecast (two forecast sensors), a family calendar's events, running timers, and the Energy
feature's plan (on the page: the test server's feed has no Energy feature), so every block is measured full.
"""
from __future__ import annotations

import argparse
import asyncio
import copy
import json
import sys
import tempfile
import time
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
    "sensor.running_quick_timers": (None, ("2", {"friendly_name": "Running Quick Timers", "running": [
        {"name": "Pasta", "entity_id": "timer.quick_1", "finishes_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(time.time() + 420))},
        {"name": "Laundry", "entity_id": "timer.quick_2", "finishes_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(time.time() + 1800))}]})),
}
# what each block names (a block that names nothing takes the house's: its cameras, weather, vacuum)
OPTS = {"accessory": {"entity": "light.living_room_lamps"}, "scene": {"scene": "scene.movie_night"},
        "now_playing": {"speaker": "media_player.living_room"}, "thermostat": {"entity": "climate.main_floor"},
        "room": {"area": "living_room"}}
# the forecast, as the forecast sensors Settings -> Weather can name
def _forecast(step: int, n: int, temps: list[int], conds: list[str]) -> list[dict]:
    t0 = int(time.time() // step * step) + step
    return [{"datetime": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(t0 + i * step)),
             "temperature": temps[i % len(temps)], "templow": temps[i % len(temps)] - 12,
             "condition": conds[i % len(conds)], "precipitation_probability": (i * 7) % 40} for i in range(n)]


EXTRA["sensor.forecast_hourly"] = (None, ("ok", {"friendly_name": "Hourly Forecast", "forecast": _forecast(
    3600, 24, [64, 65, 66, 66, 65, 63, 61, 59], ["partlycloudy", "partlycloudy", "sunny", "cloudy", "rainy", "cloudy"])}))
EXTRA["sensor.forecast_daily"] = (None, ("ok", {"friendly_name": "Daily Forecast", "forecast": _forecast(
    86400, 8, [70, 68, 72, 66], ["partlycloudy", "sunny", "rainy", "cloudy"])}))
# the family calendar's events (Home Assistant's REST shape), today and tomorrow
def _events() -> list[dict]:
    day = time.localtime()
    at = lambda d, h, m=0: time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(time.mktime(
        (day.tm_year, day.tm_mon, day.tm_mday + d, h, m, 0, 0, 0, -1))))
    date = lambda d: time.strftime("%Y-%m-%d", time.localtime(time.mktime((day.tm_year, day.tm_mon, day.tm_mday + d, 12, 0, 0, 0, 0, -1))))
    return [{"summary": "Recycling Day", "start": {"date": date(0)}, "end": {"date": date(1)}},
            {"summary": "Piano Lesson", "start": {"dateTime": at(0, 16)}, "end": {"dateTime": at(0, 17)}, "location": "Maple Street"},
            {"summary": "Dinner with the Parkers", "start": {"dateTime": at(0, 18, 30)}, "end": {"dateTime": at(0, 20)}},
            {"summary": "Dentist", "start": {"dateTime": at(1, 9)}, "end": {"dateTime": at(1, 10)}},
            {"summary": "Soccer Practice", "start": {"dateTime": at(1, 17)}, "end": {"dateTime": at(1, 18, 30)}}]


WEATHER = {"place": "Riverside", "forecast_hourly": "sensor.forecast_hourly", "forecast_daily": "sensor.forecast_daily"}
# the house battery, as the Energy feature's plan names it (power.battery)
BATTERY = {"level": "sensor.house_battery_level", "stored": "sensor.house_battery_stored",
           "backup": "sensor.house_battery_backup", "reserve": "sensor.house_battery_reserve",
           "charge": "sensor.house_battery_charging", "discharge": "sensor.house_battery_discharging"}
for _id, (_v, _u, _n) in {"level": ("82", "%", "Battery Level"), "stored": ("11.2", "kWh", "Stored Energy"),
                          "backup": ("9.5", "h", "Backup Time"), "reserve": ("20", "%", "Backup Reserve"),
                          "charge": ("1840", "W", "Charging Power"), "discharge": ("0", "W", "Discharging Power")}.items():
    EXTRA[BATTERY[_id]] = (None, (_v, {"friendly_name": _n, "unit_of_measurement": _u}))
LONG = " and the Long Way Round"       # the `long` pass: every name this much longer


def screen(key: str, look: str, bar: bool = True) -> str:
    return f"grid-{key.replace('_', '-').replace(':', '-').lower()}-{look.replace('_', '-')}{'' if bar else '-nobar'}"


# a card with a Full Width size (XXL, 6 x 2) has it on a screen of its own, "key:XXL": it can't share the 6 x 4
def parts(keys: list[str]) -> list[str]:
    return [p for k in keys for p in ([k, k + ":XXL"] if "XXL" in HG.CATALOG[k]["sizes"] else [k])]


# --cell square / --homeview (main): the grid's cells, and HomeView's tiles, thermostat and clock
CELL = {"cell": "tile", "homeview": False}
HOMEVIEW = {"thermostat": {"style": "big"}, "clock": {"clock_style": "numbers"}}


def layout(part: str) -> dict:
    key, _, only = part.partition(":")
    sizes = [s for s in HG.CATALOG[key]["sizes"] if (s == only if only else s in PLACES)]
    hv = CELL["homeview"]
    opts = {**OPTS.get(key, {}), **(HOMEVIEW.get(key, {}) if hv else {})}
    items = [{"id": f"{key[:3]}{s.lower()}", "card": key, "size": s, "at": PLACES.get(s, [0, 0]), **({"opts": opts} if opts else {}),
              **({"tile": "centred"} if hv and key in ("accessory", "scene", "action") else {})}
             for s in sizes]
    return {"v": 1, "cols": 6, "rows": 4, "frame": [1280, 800], "band": True, "items": items,
            **({"cell": "square"} if CELL["cell"] == "square" else {})}


def settings(passes: list[tuple[str, str, bool]]) -> dict:
    s = copy.deepcopy(gallery.SETTINGS)
    s["settings"]["weather"] = dict(s["settings"].get("weather") or {}, **WEATHER)
    for key, look, bar in passes:
        # the tab bar (menu "tabbar"): the usual case; without it, the side menu's button
        s["boards"][screen(key, look, bar)] = dict(gallery.SETTINGS["boards"][gallery.SCREEN], home_style="grid",
                                                   home_grid=layout(key), menu="tabbar" if bar else "auto",
                                                   **LOOKS[look])
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
  // the tab bar: nothing of the grid under it (docs/phase11/HOME-GRID.md, "The tab bar")
  const bar = document.querySelector('#hk-tabbar') || deep(document, '#hk-tabbar', [])[0];
  // (its plate: the lowest-starting visible box in it that is bar-shaped -- wide, under 120 px tall)
  let br = null;
  if (bar && bar.shadowRoot) for (const el of bar.shadowRoot.querySelectorAll('*')) {
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue; const r = el.getBoundingClientRect();
    if (r.width > 200 && r.height > 30 && r.height < 120 && (!br || r.top < br.top)) br = r; }
  out.bar = br && br.height > 0 ? [Math.round(br.top), Math.round(br.bottom), Math.round(br.left), Math.round(br.width)] : null;
  out.under_bar = [];
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
  // The band used to escape this audit entirely, allowing a clipped 72px clock
  // inside its 60px allocation. Measure the actual text, not just the wrapper.
  out.band_issues = [];
  const band = view.shadowRoot.querySelector('.band');
  if (band) {
    const bounds = band.getBoundingClientRect();
    for (const el of deep(band, '[data-hk-clock=time],[data-hk-clock=date],.band-weather,.band-security', [])) {
      if (!shown(el)) continue;
      const elements = [el, ...el.querySelectorAll('*')];
      for (const leaf of elements) for (const node of leaf.childNodes) {
        if (node.nodeType !== 3 || !node.data.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        const r = range.getBoundingClientRect();
        // Range includes the font's ascent/descent reserve, which may extend
        // above a line-height:1 clock without any visible ink being clipped.
        const cs = getComputedStyle(leaf), ctx = document.createElement('canvas').getContext('2d');
        ctx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
        const metrics = ctx.measureText(node.data);
        // (the font's metrics are the page's px; the range is on screen, the canvas scaled: square cells scale it more)
        const k = view._gridScale || 1;
        const baseline = r.top + (metrics.fontBoundingBoxAscent || parseFloat(cs.fontSize)) * k;
        const top = baseline - metrics.actualBoundingBoxAscent * k, bottom = baseline + metrics.actualBoundingBoxDescent * k;
        if (r.height > 0 && (top < bounds.top - 1 || bottom > bounds.bottom + 1)) out.band_issues.push('band text clipped: ' + node.data.trim());
      }
    }
  }
  for (const cell of view.shadowRoot.querySelectorAll('.cell')) {
    const card = cell.firstElementChild, c = cell.getBoundingClientRect();
    const rec = { id: cell.getAttribute('data-id'), size: cell.getAttribute('size'), cell: box(c),
                  card: card ? card.localName : null, card_size: card && card.getAttribute('size'), issues: [] };
    out.cells.push(rec);
    if (br && c.bottom > br.top + 0.5 && c.top < br.bottom) out.under_bar.push(rec.id + ' to ' + Math.round(c.bottom));
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
          // a word broken across lines ("Hea / t"): one word, more than one line box
          if (rs.length > 1 && !/\s/.test(t.data.trim()) && new Set(rs.map(q => Math.round(q.top))).size > 1) {
            rec.issues.push('a word broken across lines: "' + txt + '"'); break; }
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
    // DESIGN.md (/Volumes/config/hk_house/docs/DESIGN.md): no text under the smallest type role (11 px); every
    // control at least 44 px both ways; every painted box's corner on the scale (plate 23.5, card in a sheet 20,
    // big art 22, inner 12, small 8, a capsule, square), the block's own plate 23.5
    let small = null, minFont = 99;
    for (const el of all) {
      if (!shown(el)) continue;
      if ([...el.childNodes].some(t => t.nodeType === 3 && t.data.trim())) {
        const fs = parseFloat(getComputedStyle(el).fontSize); if (fs < minFont) { minFont = fs; small = el; } }
      const tag = el.localName, role = el.getAttribute('role');
      if (tag === 'button' || role === 'button' || role === 'slider' || tag === 'input' || tag === 'a') {
        // (a choice in a segmented control is measured by its track: DESIGN.md's 44 px control, 36 px choices)
        const r = el.getBoundingClientRect(), up = el.parentElement, t = up ? up.getBoundingClientRect() : r;
        let h = el.classList.contains('segment') && up ? Math.max(r.height, t.height) : r.height, w = r.width;
        // A transparent ::after may deliberately extend a visible label's hit target.
        const hit = getComputedStyle(el, '::after');
        if (hit.content !== 'none' && hit.content !== 'normal' && hit.position === 'absolute') {
          const top = parseFloat(hit.top), bottom = parseFloat(hit.bottom), left = parseFloat(hit.left), right = parseFloat(hit.right);
          if (Number.isFinite(top) && Number.isFinite(bottom)) h = Math.max(h, r.height - top - bottom);
          if (Number.isFinite(left) && Number.isFinite(right)) w = Math.max(w, r.width - left - right);
        }
        if (r.width >= 1 && r.height >= 1 && (w < 43.5 || h < 43.5))
          rec.issues.push('a control under 44 px: ' + name(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); }
    }
    // Dial text belongs inside its open centre, not across the track/knobs.
    const ring = card.shadowRoot && card.shadowRoot.querySelector('[data-ring]');
    if (ring) {
      const width = ring.getBoundingClientRect().width;
      for (const face of card.shadowRoot.querySelectorAll('.tstat-val,.tstat-cap')) {
        const range = document.createRange(); range.selectNodeContents(face);
        if (range.getBoundingClientRect().width > width * 0.62) rec.issues.push('thermostat text crosses the ring: ' + face.textContent);
      }
    }
    if (minFont < 11) rec.issues.push('text under the type roles: ' + minFont + ' px in ' + name(small));
    rec.min_font = minFont;
    // (square cells: HomeView's 34 on the block, as a corner of the scale)
    const SQUARE = view.getAttribute('cell') === 'square', PLATE = SQUARE ? 34 : 23.5;
    const SCALE = [23.5, 22, 20, 12, 8, 0].concat(SQUARE ? [34] : []);
    let outer = null, outerA = 0;
    for (const el of all) {
      if (!shown(el)) continue; const cs = getComputedStyle(el);
      const painted = (cs.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor)) || cs.backgroundImage !== 'none' ||
                      (cs.backdropFilter && cs.backdropFilter !== 'none');
      if (!painted) continue; const r = el.getBoundingClientRect(), rad = parseFloat(cs.borderTopLeftRadius) || 0;
      if (r.width < 24 || r.height < 24) continue;                         // dots, swatches, glyph circles
      const capsule = Math.abs(rad - Math.min(r.width, r.height) / 2) < 1 || /%/.test(cs.borderTopLeftRadius) || rad >= Math.min(r.width, r.height) / 2;
      if (!capsule && !SCALE.some(v => Math.abs(rad - v) < 0.6)) rec.issues.push('a corner off the scale: ' + rad + ' px on ' + name(el));
      const a = Math.min(r.width, c.width) * Math.min(r.height, c.height);
      if (a > outerA) { outerA = a; outer = { el, rad }; } }
    if (outer && outerA > 0.6 * c.width * c.height && Math.abs(outer.rad - PLATE) > 0.6)
      rec.issues.push("the block's plate corner is " + outer.rad + ' px, not ' + PLATE + ': ' + name(outer.el));
    // Check the material contract as well as geometry. Media may paint its
    // own image; every other plate must follow the active screen's material.
    const rendering = window.hkSettings && window.hkSettings.rendering();
    const media = ['hk-camera-mosaic-card', 'hk-scene-card', 'hk-suggested-scene-card', 'hk-now-playing-card'].includes(card.localName);
    if (outer && !media && rendering) {
      const material = getComputedStyle(outer.el), lookShadow = material.getPropertyValue('--hk-look-shadow').trim();
      rec.material = { flat: !!rendering.flat, marker: material.getPropertyValue('--hk-glass-surface').trim(),
        registered: !!(window.__hkGlassCards && window.__hkGlassCards.has(card)), shadow: material.boxShadow };
      if (rendering.flat) {
        if (material.backdropFilter && material.backdropFilter !== 'none') rec.issues.push('Flat plate has a backdrop filter');
      } else if (window.hkSettings.glass() === 'blur') {
        if (rec.material.marker !== '1' || !rec.material.registered) rec.issues.push('plate is missing its shared glass material');
      }
      if (lookShadow && lookShadow !== 'none' && material.boxShadow === 'none') rec.issues.push('plate is missing the look shadow');
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
    // Room and scene groups own a surrounding plate as well as their pills.
    if (!u) rec.issues.push('no plate');
    else if (u && (u.left > c.left + 2 || u.top > c.top + 2 || u.right < c.right - 2 || u.bottom < c.bottom - 2))
      rec.issues.push('the plate does not fill the block: ' + Math.round(u.right - u.left) + 'x' + Math.round(u.bottom - u.top));
    if (!texts && !things) rec.issues.push('nothing drawn');
    rec.issues = [...new Set(rec.issues)].slice(0, 12);
  }
  return out;
})()"""


async def audit(keys: list[str], looks: list[str], shots: Path | None, long: bool, nobar: list[str]) -> dict:
    gallery.HOUSE.update(EXTRA)
    if long:
        for eid, (area, (state, attrs)) in list(gallery.HOUSE.items()):
            if "friendly_name" in attrs and not eid.startswith("sun."):
                gallery.HOUSE[eid] = (area, (state, dict(attrs, friendly_name=attrs["friendly_name"] + LONG)))
    passes = [(k, lk, True) for lk in looks for k in keys] + [(k, lk, False) for lk in nobar for k in keys]
    gallery.SETTINGS = settings(passes)
    from client_smoke import OfflineReads

    async def calendar_events(self, entity_id, start, end):
        return _events() if entity_id == "calendar.family" else []
    OfflineReads.get_calendar_events = calendar_events
    report: dict = {}
    with tempfile.TemporaryDirectory(prefix="mantel-grid-audit-") as folder:
        app, cookie = await gallery.build(Path(folder))
        hub = app["hub"]
        async with TestServer(app) as server:
            origin = str(server.make_url("")).rstrip("/")
            async with Browser(width=1280, height=800, port=9391) as b:
                await b.restrict_origin(origin)
                # the page has the focus, as a wall tablet's does (cameras rest without it: cameras.focus_pause)
                await b.send("Emulation.setFocusEmulationEnabled", enabled=True)
                # THE ENERGY FEATURE, stood in on the page: its plan's house battery is what the `battery` block
                # shows, and the test server's settings feed has no Energy feature to send (hkSettings.get answers
                # `added` and `energy` as a house with it would)
                plan = json.dumps({"sections": [], "power": {"path": "power", "battery": BATTERY}})
                await b.send("Page.addScriptToEvaluateOnNewDocument", source="""(() => { let hs;
                  Object.defineProperty(window, 'hkSettings', { configurable: true, get() { return hs; }, set(v) {
                    hs = v; if (!v || !v.get || v.__audit) return; const get = v.get; v.__audit = true;
                    v.get = function (p, f) { if (p === 'added') return ['energy']; if (p === 'energy') return """ + plan + """;
                      return get.apply(this, arguments); }; } }); })()""")
                sun = None
                for key, look, bar in passes:
                    elev = SUN.get(look, 40.0)
                    if elev != sun:
                        sun = elev
                        hub.store.apply_event({"a": {"sun.sun": {
                            "s": "above_horizon" if elev > 0 else "below_horizon", "lc": gallery.NOW, "lu": gallery.NOW,
                            "a": {"friendly_name": "Sun", "elevation": elev, "azimuth": 180.0}}}})
                    name = screen(key, look, bar)
                    mark = len(b.console)
                    await b.open(f"{origin}/{name}/home", cookie)
                    await b.wait("window.__mantelReady === true", 30)
                    await b.wait("""(() => { const d = (r) => { for (const e of r.querySelectorAll('*')) {
                        if (e.localName === 'hk-home-grid-view') return e; if (e.shadowRoot) { const f = d(e.shadowRoot); if (f) return f; } }
                        return null; }; const v = d(document); return v && v.shadowRoot.querySelectorAll('.cell').length > 0; })()""", 20)
                    await asyncio.sleep(2.0)            # pictures, fonts and the sky settle
                    got = await b.eval(MEASURE)
                    got["errors"] = [c for c in b.console[mark:] if c.startswith(("EXCEPTION", "error"))][:8]
                    report.setdefault(key, {})[look + ("" if bar else " (no bar)")] = got
                    if shots:
                        await b.screenshot(shots / f"{name}{'-long' if long else ''}.png")
    return report


def summary(report: dict) -> tuple[int, list[str]]:
    """(problems, lines). A screen's own problems (the page scrolls, a block under the tab bar) are the view's,
    printed once as VIEW; each block's are its card's."""
    lines, bad = [], 0
    for key, by_look in report.items():
        for look, got in by_look.items():
            if got.get("error"):
                bad += 1
                lines.append(f"FAIL {key:12} {look:10} {got['error']}")
                continue
            view = []
            if got["page_scroll"]:
                view.append("the page scrolls")
            if got["view_scroll"]:
                view.append("the view scrolls")
            view += got.get("band_issues", [])
            view += [f"script error: {e}" for e in got.get("errors", [])]
            if got.get("under_bar"):
                view.append("under the tab bar: " + ", ".join(got["under_bar"]))
            if view:
                bad += 1
                lines.append(f"VIEW {key:12} {look:19} " + "; ".join(view))
            for cell in got["cells"]:
                issues = cell["issues"]
                status = "FAIL" if issues else "ok  "
                bad += bool(issues)
                lines.append(f"{status} {key:12} {look:19} {cell['size']:2} {cell['card'] or '-':28} "
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
    ap.add_argument("--no-bar", nargs="*", choices=list(LOOKS), default=["flat_dark"], dest="nobar",
                    help="looks to run once more with the tab bar hidden (default: Flat Dark)")
    ap.add_argument("--cell", choices=["tile", "square"], default="tile", help="the grid's cells (square: 196 x 196)")
    ap.add_argument("--homeview", action="store_true", help="square cells, Centred tiles, Big Number, Analog Numbers")
    a = ap.parse_args(argv)
    CELL.update(cell="square" if a.homeview else a.cell, homeview=a.homeview)
    keys = a.only or G2
    unknown = [k for k in keys if k not in HG.CATALOG]
    if unknown:
        ap.error(f"not in the catalog: {unknown}")
    if a.shots:
        a.shots.mkdir(parents=True, exist_ok=True)
    report = asyncio.run(audit(parts(keys), a.looks, a.shots, a.long, a.nobar))
    if a.json:
        a.json.write_text(json.dumps(report, indent=1))
    bad, lines = summary(report)
    print("\n".join(lines))
    print(f"{'FAIL' if bad else 'ok'}: {bad} block(s) with a problem, {len(keys)} card(s) x {len(a.looks)} look(s)"
          f" with the tab bar, x {len(a.nobar)} without")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
