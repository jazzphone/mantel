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

Stood in: the house's forecast (two forecast sensors), a family calendar's events (today's, tomorrow's and the
month's), running timers (and the quick timers' lengths), a third person away at a zone, two
to-do lists and their items (the read the Side Pane makes, hk_frontend/todo/items:
the test server's house commands are off, so it would say so), the Energy feature's plan and Clean Areas' rooms (on the page: the test
server's feed has neither feature) with Home Assistant's Energy settings and the recorder's statistics for its
meters and a water meter (stat_rows), and Live TV -- added on the page, six channels in the hk_tv/channels answer,
each with its camera and what is on now -- so every block is measured full; the
weather's feels-like, UV and wind direction and the sun's next setting (the Weather block's Extra Large reads them),
and a thermostat on Heat (the house's two are on heat and cool): `--opts thermostat='{"entity": "climate.office"}'`
draws it, as `--opts` names anything else a block can take.
"""
from __future__ import annotations

import argparse
import asyncio
import copy
import json
import os
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
    # (the two quick timers themselves: their lengths draw the rings of time left)
    "timer.quick_1": (None, ("active", {"friendly_name": "Quick Timer 1", "duration": "0:12:00", "remaining": "0:12:00",
                                        "finishes_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(time.time() + 420))})),
    "timer.quick_2": (None, ("active", {"friendly_name": "Quick Timer 2", "duration": "0:45:00", "remaining": "0:45:00",
                                        "finishes_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(time.time() + 1800))})),
    # (a third person, out at a zone: Who's Home says who is where)
    "person.robin": (None, ("Work", {"friendly_name": "Robin"})),
}
# (a thermostat on Heat, one target: the gallery's two are on heat and cool; the weather's readings the house lacks)
EXTRA["climate.office"] = ("office", ("heat", {"friendly_name": "Heat Pump", "current_temperature": 66, "temperature": 68,
                                               "hvac_action": "heating", "hvac_modes": ["off", "heat", "cool", "heat_cool"],
                                               "min_temp": 50, "max_temp": 90, "supported_features": 25, "current_humidity": 41}))
EXTRA["weather.home"] = (None, ("partlycloudy", {"friendly_name": "Home", "temperature": 64, "temperature_unit": "°F",
                                                 "humidity": 52, "wind_speed": 6, "wind_speed_unit": "mph", "wind_bearing": 315,
                                                 "apparent_temperature": 62, "uv_index": 2, "pressure": 1015, "pressure_unit": "hPa",
                                                 "visibility": 10, "visibility_unit": "mi", "dew_point": 48}))
SUNSET = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(time.time() + 3 * 3600))
EXTRA["sun.sun"] = (None, ("above_horizon", {"friendly_name": "Sun", "elevation": 40.0, "azimuth": 180.0, "next_setting": SUNSET}))
# the rooms Clean Areas offers the vacuum's Large and Extra Large blocks (stood in on the page, below)
CLEAN_AREAS = ["kitchen", "living_room", "dining_room", "office", "bedroom", "guest_room"]
# what each block names (a block that names nothing takes the house's: its cameras, weather, vacuum)
OPTS = {"accessory": {"entity": "light.living_room_lamps"}, "scene": {"scene": "scene.movie_night"},
        "now_playing": {"speaker": "media_player.living_room"}, "thermostat": {"entity": "climate.main_floor"},
        "room": {"area": "living_room"}}
# ...and what a block names at each size (an Accessories block holds as many as its size's tiles: hk_core's capacity)
ACCESSORIES = ["light.living_room_lamps", "fan.bedroom_ceiling", "light.living_room_ceiling", "media_player.living_room",
               "lock.front_door", "light.kitchen_pendants", "cover.garage_door", "switch.garage_outlet", "light.office_desk",
               "light.porch", "light.bedroom_lamps", "light.backyard_string"]
SIZED = {"accessories": lambda s: {"accessories": [{"entity": e} for e in ACCESSORIES[:{"W": 2, "T": 2, "L": 4, "XL": 6, "XXL": 12}[s]]]}}
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
            {"summary": "Soccer Practice", "start": {"dateTime": at(1, 17)}, "end": {"dateTime": at(1, 18, 30)}}] + [
        # ...and the month around them: a dot under most days (the Calendar block's Extra Large)
        {"summary": name, "start": {"dateTime": at(d, hour)}, "end": {"dateTime": at(d, hour + 1)}}
        for d, name, hour in ((-20, "Book Club", 19), (-13, "Haircut", 10), (-9, "Parent Teacher Night", 18),
                              (-6, "Yoga", 8), (-2, "Farmers Market", 9), (3, "Piano Lesson", 16), (4, "Dentist", 11),
                              (6, "Movie Night", 19), (10, "Piano Lesson", 16), (13, "Car Service", 9),
                              (17, "Yoga", 8), (21, "Book Club", 19), (24, "Piano Lesson", 16))]


WEATHER = {"place": "Riverside", "forecast_hourly": "sensor.forecast_hourly", "forecast_daily": "sensor.forecast_daily"}
# the house battery, as the Energy feature's plan names it (power.battery)
BATTERY = {"level": "sensor.house_battery_level", "stored": "sensor.house_battery_stored",
           "backup": "sensor.house_battery_backup", "reserve": "sensor.house_battery_reserve",
           "charge": "sensor.house_battery_charging", "discharge": "sensor.house_battery_discharging"}
for _id, (_v, _u, _n) in {"level": ("82", "%", "Battery Level"), "stored": ("11.2", "kWh", "Stored Energy"),
                          "backup": ("9.5", "h", "Backup Time"), "reserve": ("20", "%", "Backup Reserve"),
                          "charge": ("1840", "W", "Charging Power"), "discharge": ("0", "W", "Discharging Power")}.items():
    EXTRA[BATTERY[_id]] = (None, (_v, {"friendly_name": _n, "unit_of_measurement": _u}))
# the house's to-do lists, and what is on them (hk_frontend/todo/items' answer)
TODO = {"todo.groceries": ("Groceries", ["Milk", "Eggs", "Coffee beans", "Lemons", "Paper towels", "Bread", "Apples",
                                         "Rice", "Olive oil", "Butter", "Basil", "Oat milk"]),
        "todo.household": ("Household", ["Replace filters", "Bins out", "Call the plumber", "Fix the gate",
                                         "Book the chimney sweep"])}
for _id, (_n, _items) in TODO.items():
    EXTRA[_id] = (None, (str(len(_items)), {"friendly_name": _n, "supported_features": 15}))
# LIVE TV's channels (hk_tv/channels): [number, name, what is on, minutes in, minutes long]
TV = [("4.1", "Channel 4", "Evening News", 37, 60), ("7.1", "Food", "Coastal Kitchens", 9, 30),
      ("9.1", "Comedy", "Night Owls", 24, 30), ("11.1", "Sports", "Evening Match", 54, 120),
      ("13.1", "Nature", "Wild Coasts", 12, 60), ("20.1", "Kids", "Story Time", 21, 30)]
# (what is on's art: `image` on the now sensor, as the Live TV page's tiles draw it behind the channel -- these stand-ins are the
# site's own landscapes; the audit's default house has it on four channels and not on two, Live TV's mixed state)
TV_ART = {"4.1": "/hk/landscapes/03.webp", "7.1": "/hk/landscapes/15.webp", "9.1": None, "11.1": "/hk/landscapes/42.webp",
          "13.1": "/hk/landscapes/39.webp", "20.1": None}


def _tv_now(no, name, on, mins_in, mins_long, image):
    attrs = {"friendly_name": f"{name} Now", "subtitle": "",
             "start": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(time.time() - mins_in * 60)),
             "end": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(time.time() + (mins_long - mins_in) * 60))}
    if image:
        attrs["image"] = image
    return (on, attrs)


# ...and six more the guide has (the `tv_many` state lists twelve: the block shows what its size holds and says "N more")
TV_EXTRA = [("22.1", "Movies", "The Long Road", 40, 120), ("24.1", "Weather", "Local Forecast", 3, 10), ("26.1", "Music", "Top Videos", 15, 60),
            ("28.1", "Cooking", "Weeknight Dinners", 5, 30), ("30.1", "History", "Ancient Seas", 33, 60), ("32.1", "Science", "Deep Space", 10, 60)]
TV_ART.update({"22.1": "/hk/landscapes/19.webp", "24.1": None, "26.1": "/hk/landscapes/23.webp", "28.1": None, "30.1": "/hk/landscapes/35.webp", "32.1": "/hk/landscapes/22.webp"})
for _no, _name, _on, _in, _long in TV + TV_EXTRA:
    _id = _no.replace(".", "_")
    EXTRA[f"camera.channel_{_id}"] = (None, ("idle", {"friendly_name": _name}))
    EXTRA[f"sensor.channel_{_id}_now"] = (None, _tv_now(_no, _name, _on, _in, _long, TV_ART[_no]))
LONG = " and the Long Way Round"       # the `long` pass: every name this much longer

# THE ENERGY FEATURE'S METERS (2026-10-31, the widget blocks: Energy Rings, Battery, Power and Water): Home
# Assistant's Energy settings as energy/get_prefs answers them, and the recorder's statistics for each meter --
# a made-up day by the hour (a morning and an evening, the sun at midday, the battery filling then giving),
# each day a little different, so a usual day, this week and this month all have numbers
ENERGY_PREFS = {"energy_sources": [
    {"type": "grid", "flow_from": [{"stat_energy_from": "sensor.grid_energy_in", "stat_cost": "sensor.grid_energy_cost"}],
     "flow_to": [{"stat_energy_to": "sensor.grid_energy_out"}]},
    {"type": "solar", "stat_energy_from": "sensor.solar_energy"},
    {"type": "battery", "stat_energy_to": "sensor.battery_energy_in", "stat_energy_from": "sensor.battery_energy_out"},
    {"type": "water", "stat_energy_from": "sensor.water_meter"}], "device_consumption": []}
EXTRA["sensor.water_meter"] = (None, ("48211", {"friendly_name": "Water Meter", "unit_of_measurement": "gal", "device_class": "water",
                                                "state_class": "total_increasing"}))


def _hour(at: float) -> dict:
    """What each meter changed by in the hour starting `at` (seconds, UTC: the test server's Home Assistant zone)."""
    import math
    h, day = time.gmtime(at).tm_hour, int(at // 86400)
    bell = lambda mid, w: math.exp(-((h - mid) / w) ** 2)
    k = 0.85 + 0.3 * ((day * 37) % 10) / 10
    use = k * (0.45 + 1.1 * bell(19, 2.5) + 0.6 * bell(8, 1.5))
    sun = (0.8 + 0.4 * ((day * 13) % 5) / 5) * 2.4 * max(0.0, math.sin(math.pi * (h - 6) / 13)) if 6 <= h <= 19 else 0.0
    into, out = (0.5 if 10 <= h <= 14 else 0.0), (0.45 if 18 <= h <= 22 else 0.0)
    grid_in, grid_out = max(0.0, use + into - sun - out), max(0.0, sun + out - use - into)
    return {"sensor.grid_energy_in": grid_in, "sensor.grid_energy_out": grid_out, "sensor.grid_energy_cost": grid_in * 0.21,
            "sensor.solar_energy": sun, "sensor.battery_energy_in": into, "sensor.battery_energy_out": out,
            "sensor.water_meter": k * (1.5 + 16 * bell(7, 1.2) + 12 * bell(19, 1.8)),
            # the plan's devices (the Power block's top users)
            "sensor.laundry_energy": k * 1.3 * bell(10, 1.2), "sensor.dishwasher_energy": k * 0.9 * bell(20, 0.8),
            "sensor.office_energy": 0.12 if 8 <= h <= 18 else 0.02,
            # the means: the house's power in W, the battery's level in %
            "sensor.home_power": 1000 * use, "sensor.house_battery_level": max(20.0, min(100.0, 45 + 9 * max(0, min(h, 15) - 9) - 7 * max(0, h - 17)))}


def stat_rows(msg: dict) -> dict:
    """recorder/statistics_during_period, stood in: every closed bucket from the start asked for to now."""
    from datetime import datetime
    step = {"5minute": 300, "hour": 3600, "day": 86400, "week": 604800, "month": 2678400}[msg.get("period", "hour")]
    t = datetime.fromisoformat(msg["start_time"].replace("Z", "+00:00")).timestamp()
    now, out = time.time(), {i: [] for i in msg["statistic_ids"]}
    # (a day is its closed hours, today's too: Home Assistant sums a day's buckets from its hourly ones)
    while t + (3600 if step == 86400 else step) <= now:
        hours = [t + 3600 * n for n in range(24) if t + 3600 * (n + 1) <= now] if step == 86400 else [t]
        for i in msg["statistic_ids"]:
            vals = [_hour(x).get(i) for x in hours]
            if None in vals:
                continue
            v = sum(vals) * (step / 3600 if step < 3600 else 1)
            mean = i in ("sensor.home_power", "sensor.house_battery_level")
            out[i].append({"start": t * 1000, "end": (t + step) * 1000, "mean" if mean else "change": vals[0] if mean else v})
        t += step
    return out


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
    items = [{"id": f"{key[:3]}{s.lower()}", "card": key, "size": s, "at": PLACES.get(s, [0, 0]),
              **({"opts": {**opts, **SIZED[key](s)}} if key in SIZED else {"opts": opts} if opts else {}),
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
          out.push({ el: n, scroll: /auto|scroll/.test(cs.overflowX + ' ' + cs.overflowY), ellipsis: cs.textOverflow === 'ellipsis' || +cs.webkitLineClamp > 0 || cs.webkitLineClamp !== 'none' && cs.webkitLineClamp !== undefined && cs.webkitLineClamp !== '' }); }
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
          // (a list that scrolls is cut at its edge on purpose -- DESIGN.md "Lists that scroll": what it hides a finger reaches)
          let away = false;           // (scrolled out of its list's view: not an issue, it is a row the list reaches by scrolling)
          for (const k of cl) { const b = k.el.getBoundingClientRect();
            if (k.scroll) { vis = { left: Math.max(vis.left, b.left), top: Math.max(vis.top, b.top), right: Math.min(vis.right, b.right), bottom: Math.min(vis.bottom, b.bottom) };
              if (vis.right - vis.left <= 0.5 || vis.bottom - vis.top <= 0.5) { away = true; break; } continue; }
            const nv = { left: Math.max(vis.left, b.left), top: Math.max(vis.top, b.top), right: Math.min(vis.right, b.right), bottom: Math.min(vis.bottom, b.bottom) };
            const lost = (vis.right - vis.left) - Math.max(0, nv.right - nv.left) + (vis.bottom - vis.top) - Math.max(0, nv.bottom - nv.top);
            if (lost > 1.5 && !k.ellipsis && !cut) cut = name(k.el);
            vis = nv; }
          if (away) continue;
          const txt = t.data.trim().slice(0, 30);
          // a word broken across lines ("Hea / t"): one word, more than one line box
          if (rs.length > 1 && !/\s/.test(t.data.trim()) && new Set(rs.map(q => Math.round(q.top))).size > 1) {
            rec.issues.push('a word broken across lines: "' + txt + '"'); break; }
          // (a line past a -webkit-line-clamp is laid out and clipped on purpose: the clamp's ellipsis ends the text above it)
          if ((vis.right - vis.left <= 0.5 || vis.bottom - vis.top <= 0.5) && !cut && cl.some(k => k.ellipsis && +getComputedStyle(k.el).webkitLineClamp > 0)) continue;
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
        // A transparent ::after (or ::before: House Status's "N more", 2026-11-07) may deliberately extend a visible
        // label's hit target -- by its insets, or by its own size
        for (const pseudo of ['::after', '::before']) {
          const hit = getComputedStyle(el, pseudo);
          if (hit.content === 'none' || hit.content === 'normal' || hit.position !== 'absolute') continue;
          const top = parseFloat(hit.top), bottom = parseFloat(hit.bottom), left = parseFloat(hit.left), right = parseFloat(hit.right);
          if (Number.isFinite(top) && Number.isFinite(bottom)) h = Math.max(h, r.height - top - bottom);
          if (Number.isFinite(left) && Number.isFinite(right)) w = Math.max(w, r.width - left - right);
          if (parseFloat(hit.height) > 0) h = Math.max(h, parseFloat(hit.height));
          if (parseFloat(hit.width) > 0) w = Math.max(w, parseFloat(hit.width));
        }
        // (in the block's own px: the grid is drawn scaled to the screen -- 0.74 on square cells at 1280 x 800 --
        // and a control is laid out at 44 before that, 2026-10-31)
        const gs = view._gridScale || 1;
        if (r.width >= 1 && r.height >= 1 && (w / gs < 43.5 || h / gs < 43.5))
          rec.issues.push('a control under 44 px: ' + name(el) + ' ' + Math.round(r.width / gs) + 'x' + Math.round(r.height / gs)); }
    }
    // NO HIT AREA OVERLAPS ANOTHER (2026-11-08, the owner: the thermostat's "modes get hit while using" its arrows): every control's
    // touchable box -- its own, out to a transparent ::after / ::before's insets or size -- against every other's, where neither holds
    // the other (a control inside a control, a card's name over its plate, is nested on purpose); more than 2 px each way is a clash
    if (window.__hitsCheck) {
      const hits = [];
      for (const el of all) {
        if (!shown(el)) continue; const tag = el.localName, role = el.getAttribute('role');
        if (!(tag === 'button' || role === 'button' || role === 'slider' || tag === 'input' || tag === 'a' || el.hasAttribute('data-ring'))) continue;   // (the dial's ring takes a touch anywhere in its box)
        const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
        let h = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        for (const pseudo of ['::after', '::before']) { const hit = getComputedStyle(el, pseudo);
          if (hit.content === 'none' || hit.content === 'normal' || hit.position !== 'absolute') continue;
          if (getComputedStyle(el).position === 'static') { rec.issues.push('the ::after hit area of ' + name(el) + ' is not anchored to it (it is not positioned: it reaches over the block)'); continue; }
          const f = k => parseFloat(hit[k]); const L = f('left'), R = f('right'), T = f('top'), B = f('bottom');
          if (Number.isFinite(L)) h.left = Math.min(h.left, r.left + L); if (Number.isFinite(R)) h.right = Math.max(h.right, r.right - R);
          if (Number.isFinite(T)) h.top = Math.min(h.top, r.top + T); if (Number.isFinite(B)) h.bottom = Math.max(h.bottom, r.bottom - B); }
        // (a control a list scrolls or clips away is touchable only where its box shows)
        for (const k of clippers(el, cell)) { const b = k.el.getBoundingClientRect();
          h = { left: Math.max(h.left, b.left), top: Math.max(h.top, b.top), right: Math.min(h.right, b.right), bottom: Math.min(h.bottom, b.bottom) }; }
        if (h.right - h.left < 1 || h.bottom - h.top < 1) continue;
        hits.push({ el, h }); }
      const holds = (a, b) => a.contains(b) || b.contains(a);
      for (let i = 0; i < hits.length; i++) for (let j = i + 1; j < hits.length; j++) {
        const A = hits[i], B = hits[j]; if (holds(A.el, B.el)) continue;
        const w = Math.min(A.h.right, B.h.right) - Math.max(A.h.left, B.h.left), t = Math.min(A.h.bottom, B.h.bottom) - Math.max(A.h.top, B.h.top);
        if (w > 2 && t > 2) rec.issues.push('hit areas overlap by ' + Math.round(w) + 'x' + Math.round(t) + ': ' + name(A.el) + ' and ' + name(B.el)); }
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
    // (square cells: HomeView's 34 on the block, as a corner of the scale, and the pills inside following it --
    // --hk-inner-radius, 34 less the block's 18 px inset: 16)
    const SQUARE = view.getAttribute('cell') === 'square', PLATE = SQUARE ? 34 : 23.5;
    const SCALE = [23.5, 22, 20, 12, 8, 0].concat(SQUARE ? [34, 16] : []);
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
    // (the Cameras face too, 2026-11-07: its stills are the block, edge to edge, as one camera's are)
    const media = ['hk-camera-mosaic-card', 'hk-grid-cameras-card', 'hk-scene-card', 'hk-suggested-scene-card', 'hk-now-playing-card'].includes(card.localName);
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


def timers_state(n: int, paused: tuple[int, ...] = ()) -> dict:
    """STATES' entities for n running quick timers (those at the indexes in `paused` held): the sensor the block reads and each
    timer's name, length and finish."""
    names, mins, left = ["Pasta", "Laundry", "Tea", "Oven", "Bread", "Dryer"], [12, 45, 5, 50, 90, 30], [420, 1800, 150, 2400, 3600, 900]
    at = lambda secs: time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(time.time() + secs))
    ents: dict = {}
    run = []
    for i in range(6):
        eid, dur = f"timer.quick_{i + 1}", f"{mins[i] // 60}:{mins[i] % 60:02d}:00"
        if i >= n:
            ents[eid] = ("idle", {"friendly_name": f"Quick Timer {i + 1}", "duration": dur})
        elif i in paused:
            ents[eid] = ("paused", {"friendly_name": names[i], "duration": dur, "remaining": f"0:{left[i] // 60:02d}:{left[i] % 60:02d}"})
            run.append({"name": names[i], "entity_id": eid})
        else:
            ents[eid] = ("active", {"friendly_name": names[i], "duration": dur, "remaining": dur, "finishes_at": at(left[i])})
            run.append({"name": names[i], "entity_id": eid, "finishes_at": at(left[i])})
    ents["sensor.running_quick_timers"] = (str(n), {"friendly_name": "Running Quick Timers", "running": run})
    return ents


# EVERY STATE, NOT ONLY A BUSY HOUSE (2026-11-08, the owner: the Timers block "always shows a timer in your test", and
# with none it "is not good looking at all"). `--state NAME` draws the house in another state: each entry turns the
# stood-in house into it (domain -> state for everything of that domain, then entity -> (state, attributes) over
# that), and `events` / `channels_now` say whether the calendar has events and the channels say what is on. A block
# must look finished in every state: empty and idle as carefully as full. Add the states your blocks have.
STATES: dict[str, dict] = {
    "busy": {},                                   # the default: timers running, music, lights on, events, the guide
    # nothing going on: no timers, every light, fan and switch off, music stopped, locked and closed, nothing on the
    # calendar, the vacuum docked, the alarm disarmed
    "quiet": {"domains": {"light": "off", "fan": "off", "switch": "off", "media_player": "idle", "timer": "idle",
                          "lock": "locked", "cover": "closed", "binary_sensor": "off", "alarm_control_panel": "disarmed",
                          "vacuum": "docked"},
              "entities": {"sensor.running_quick_timers": ("0", {"friendly_name": "Running Quick Timers", "running": []})},
              "events": False},
    # THE TIMELINE'S STATES (2026-11-08, the Recent block): `timeline` names the rows seeded into Mantel's own store
    # (seed_timeline; busy is the default and "quiet" the quiet house's) -- a new house with no rows at all, a quiet
    # night (two rows last evening, nothing since, everything locked), and a busy day with pictures (busy's own)
    "recent_empty": {"timeline": "empty"},
    "recent_quiet": {"domains": {"lock": "locked", "cover": "closed", "binary_sensor": "off", "alarm_control_panel": "armed_night"},
                     "timeline": "quiet"},
    "recent_busy": {"timeline": "busy"},
    # TIMERS (2026-11-08): one running, six (the Extra Large block's most), two with one held
    # THE THERMOSTAT's other modes (2026-11-08): the block's thermostat (`--opts thermostat='{"entity": "climate.office"}'`) on Cool, on Off
    "thermostat_cool": {"entities": {"climate.office": ("cool", {**EXTRA["climate.office"][1][1], "temperature": 72, "hvac_action": "cooling"})}},
    "thermostat_off": {"entities": {"climate.office": ("off", {**EXTRA["climate.office"][1][1], "temperature": None, "hvac_action": "off"})}},
    "timers_one": {"entities": timers_state(1)},
    "timers_many": {"entities": timers_state(6)},
    "timers_paused": {"entities": timers_state(2, paused=(0,))},
    # THE VACUUM (2026-11-08): what it is doing, and the rooms Clean Areas offers (`rooms`: six, the default; `twelve` more than a
    # Large block holds) and which of them are ticked before the shot (`picked`: area ids, the block's rooms to clean)
    "vacuum_cleaning": {"entities": {"vacuum.downstairs": ("cleaning", {"friendly_name": "Downstairs Vacuum", "battery_level": 64, "supported_features": 16383})}},
    "vacuum_paused": {"entities": {"vacuum.downstairs": ("paused", {"friendly_name": "Downstairs Vacuum", "battery_level": 64, "supported_features": 16383})}},
    "vacuum_returning": {"entities": {"vacuum.downstairs": ("returning", {"friendly_name": "Downstairs Vacuum", "battery_level": 31, "supported_features": 16383})}},
    "vacuum_error": {"entities": {"vacuum.downstairs": ("error", {"friendly_name": "Downstairs Vacuum", "battery_level": 12, "supported_features": 16383})}},
    "vacuum_picked": {"entities": {"vacuum.downstairs": ("docked", {"friendly_name": "Downstairs Vacuum", "battery_level": 92, "supported_features": 16383})},
                      "picked": ["kitchen", "office"]},
    "vacuum_picked3": {"picked": ["kitchen", "office", "bedroom"]},
    "vacuum_twelve": {"twelve": True},
    "vacuum_twelve_picked": {"twelve": True, "picked": ["kitchen", "den", "pantry", "garage"]},
}
# THE PLAYER'S STATES (2026-11-08, the Now Playing round): the house plays a song with no cover (the default above), so
# these draw what the owner's tablets show -- a cover, a pause, nothing playing, a very long song. `attrs` merges over an
# entity's attributes (a None drops one); `media_player` sets a state for the whole domain first.
COVER = ("data:image/svg+xml," + __import__("urllib.parse").parse.quote(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640"><defs>'
    '<linearGradient id="g" x2="1" y2="1"><stop stop-color="#1c3f94"/><stop offset=".5" stop-color="#b4467a"/>'
    '<stop offset="1" stop-color="#f4a259"/></linearGradient></defs><rect width="640" height="640" fill="url(#g)"/>'
    '<circle cx="320" cy="320" r="190" fill="none" stroke="#fff" stroke-opacity=".4" stroke-width="3"/>'
    '<circle cx="320" cy="320" r="120" fill="#fff" fill-opacity=".16"/><path d="M250 400V250l150-30v140" fill="none" '
    'stroke="#fff" stroke-width="16" stroke-linejoin="round"/></svg>'))
LONG_SONG = {"media_title": "Blue in Green (Alternate Take, Remastered for the Fortieth Anniversary Edition)",
             "media_artist": "The Fictional Trio with the Fictional Philharmonic Orchestra",
             "media_album_name": "Kind of Fictional: The Complete Studio Sessions"}
LR = "media_player.living_room"
STATES.update({
    "art": {"attrs": {LR: {"entity_picture": COVER}}},                       # playing, with its cover
    "noart": {},                                                              # playing, no cover (the house's default)
    "paused": {"attrs": {LR: {"entity_picture": COVER}}, "entities_state": {LR: "paused"}},
    "pausednoart": {"entities_state": {LR: "paused"}},
    # nothing playing, everything else busy: what a stopped player has (no song, no times, no cover)
    "idle": {"entities_state": {LR: "idle"}, "attrs": {LR: dict.fromkeys(
        ("media_title", "media_artist", "media_album_name", "media_duration", "media_position", "media_position_updated_at"))}},
    "off": {"entities_state": {LR: "off"}, "attrs": {LR: dict.fromkeys(
        ("media_title", "media_artist", "media_album_name", "media_duration", "media_position", "media_position_updated_at"))}},
    "longsong": {"attrs": {LR: dict(LONG_SONG, entity_picture=COVER)}},
    "longsongnoart": {"attrs": {LR: LONG_SONG}},
})
# THE WEATHER'S READINGS (2026-11-08, the owner's notes: the Extra Large's readings): a house whose weather says only the
# temperature and the sky (nothing else to read, the sun down), and one that adds a fifth reading to a row of three
# (humidity and wind, no feels like, no UV)
STATES["wx_few"] = {"entities": {"weather.home": ("cloudy", {"friendly_name": "Home", "temperature": 41, "temperature_unit": "°F"}),
                                 "sun.sun": ("below_horizon", {"friendly_name": "Sun", "elevation": -20.0, "azimuth": 10.0,
                                                               "next_rising": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(time.time() + 9 * 3600))})}}
STATES["wx_five"] = {"entities": {"weather.home": ("rainy", {"friendly_name": "Home", "temperature": 52, "temperature_unit": "°F", "humidity": 88,
                                                             "wind_speed": 14, "wind_speed_unit": "mph", "wind_bearing": 200, "pressure": 29.71,
                                                             "pressure_unit": "inHg"})}}
# LIVE TV'S ART (2026-11-08, the owner: the What's On art behind each channel): every channel with its picture, and none
STATES["tv_art"] = {"entities": {f"sensor.channel_{n.replace('.', '_')}_now": _tv_now(n, name, on, i, l, f"/hk/landscapes/{k:02d}.webp")
                                 for k, (n, name, on, i, l) in zip((3, 15, 19, 42, 39, 22), TV)}}
STATES["tv_many"] = {}
STATES["tv_noart"] = {"entities": {f"sensor.channel_{n.replace('.', '_')}_now": _tv_now(n, name, on, i, l, None) for n, name, on, i, l in TV}}
# SECURITY'S STATES (2026-11-08, the owner: the locks, the garage and the open doors and windows at Large and Extra Large): armed
# with everything locked and closed; triggered with a window open; disarmed with a lock unlocked, the garage open, a door and
# a window open (the strip's "+N open"); and a big house -- six locks, two garage doors, a dozen doors and windows ("N more")
_SECURE = {"domains": {"lock": "locked", "cover": "closed", "binary_sensor": "off"}}
STATES["sec_armed"] = {"domains": dict(_SECURE["domains"], alarm_control_panel="armed_away")}
STATES["sec_trig"] = {"domains": {"alarm_control_panel": "triggered", "lock": "locked", "cover": "closed"}}
STATES["sec_open"] = {"domains": {"cover": "open", "binary_sensor": "on"},
                      "entities": {"lock.front_door": ("unlocked", {"friendly_name": "Front Door"})}}
STATES["sec_many"] = {"entities": {**{f"lock.extra_{i}": ("locked", {"friendly_name": n}) for i, n in enumerate(
    ("Garage Entry", "Side Door", "Patio Door", "Basement Door"))},
    "cover.garage_two": ("closed", {"friendly_name": "Workshop Door", "device_class": "garage"}),
    **{f"binary_sensor.extra_window_{i}": ("off", {"friendly_name": f"Window {i}", "device_class": "window"}) for i in range(8)}}}
# THE CALENDAR, DOORS AND WHO'S HOME (2026-11-08, round three): a calendar with nothing today and the next event tomorrow; doors
# and windows: one window open, two doors open (a door and the garage), many open; a house of one person at home, and of four
STATES["cal_later"] = {"events": "later"}
STATES["doors_window"] = {"domains": {"cover": "closed", "binary_sensor": "off"},
                          "entities": {"binary_sensor.office_window": ("on", {"friendly_name": "Office Window", "device_class": "window"})}}
STATES["doors_two"] = {"domains": {"cover": "closed", "binary_sensor": "off"},
                       "entities": {"cover.garage_door": ("open", {"friendly_name": "Garage Door", "device_class": "garage"}),
                                    "binary_sensor.front_door": ("on", {"friendly_name": "Front Door", "device_class": "door"})}}
STATES["doors_many"] = {"domains": {"cover": "open", "binary_sensor": "on"},
                        "entities": {**{f"binary_sensor.extra_window_{i}": ("on", {"friendly_name": f"Window {i}", "device_class": "window"}) for i in range(8)}}}
STATES["people_home"] = {"domains": {"person": "home"}}
STATES["people_four"] = {"entities": {"person.jo": ("home", {"friendly_name": "Jo"}), "person.kit": ("School", {"friendly_name": "Kit"})}}
STATE = {"name": "busy", "hits": False}
# six more rooms for a house with twelve (the Vacuum block's rooms scroll when they do not fit)
MORE_ROOMS = [("den", "Den", "main"), ("pantry", "Pantry", "main"), ("laundry", "Laundry", "main"), ("hallway", "Hallway", "upstairs"),
              ("nursery", "Nursery", "upstairs"), ("bathroom", "Bathroom", "upstairs")]
# the window (a phone: AUDIT_VIEW=390x844 -- the grid is then drawn as the screen draws it there)
VIEW = tuple(int(x) for x in os.environ.get("AUDIT_VIEW", "1280x800").split("x"))


def seed_timeline(app, kind: str) -> None:
    """The House Timeline's rows for STATES' `timeline` (busy unless a state says): written oldest first into Mantel's
    own store, so the newest have the highest ids as on a house. Busy: a day at the house -- the front door's camera
    saw a person and a ring and a package, the backyard's an animal and a vehicle (each with its pictures: HK's own
    landscapes, as the gallery's cameras' stills), locks, the garage, the alarm, an arrival -- and a night with rows in
    the digest's window. Quiet: the back door locked and the alarm armed before the night, nothing since. Empty: none."""
    from hk_core.timeline import words as W
    from mantel_server.timeline.api import window_of
    from mantel_server.timeline.store import Row
    if kind == "empty":
        return
    tl, pics, now = app["timeline"], app["timeline_pictures"], time.time()
    start, end, _ = window_of(app, "overnight", now)
    rooms = dict((a, n) for a, n, _ in gallery.ROOMS)
    alex = {"actor_name": "Alex", "how": "home"}
    sam_tab = {"actor_name": "Sam", "device_name": "Hallway tablet", "how": "tablet"}
    rows = []

    def row(t, family, kind_, label, entity, area, pictures=0, **who):
        rows.append((t, family, kind_, label, entity, area, pictures, who))
    night = lambda f: start + f * (end - start)               # noqa: E731
    if kind == "quiet":
        row(start - 50 * 60, "lock", "locked", "Back Door", "lock.back_door", "kitchen", **sam_tab)
        row(start - 48 * 60, "alarm", "armed_night", "Home Alarm", "alarm_control_panel.home", None, **sam_tab)
    else:
        row(night(0.12), "lock", "locked", "Back Door", "lock.back_door", "kitchen", **sam_tab)
        row(night(0.13), "alarm", "armed_night", "Home Alarm", "alarm_control_panel.home", None, **sam_tab)
        row(night(0.45), "detection", "animal", "Backyard", "camera.backyard", "backyard", 2)
        row(night(0.8), "detection", "package", "Front Door", "camera.front_door", "porch", 1)
        row(night(0.93), "garage", "opened", "Garage Door", "cover.garage_door", "garage", how="hand_or_automation")
        row(night(0.95), "garage", "closed", "Garage Door", "cover.garage_door", "garage", how="hand_or_automation")
        for mins, family, kind_, label, entity, area, n, who in (
                (330, "door", "opened", "Front Door", "binary_sensor.front_door", "porch", 0, {}),
                (329, "door", "closed", "Front Door", "binary_sensor.front_door", "porch", 0, {}),
                (250, "alarm", "disarmed", "Home Alarm", "alarm_control_panel.home", None, 0, sam_tab),
                (190, "detection", "vehicle", "Backyard", "camera.backyard", "backyard", 2, {}),
                (132, "garage", "opened", "Garage Door", "cover.garage_door", "garage", 0, alex),
                (125, "garage", "closed", "Garage Door", "cover.garage_door", "garage", 0, alex),
                (80, "detection", "package", "Front Door", "camera.front_door", "porch", 1, {}),
                (52, "arrival", "arrived", "Alex", "person.alex", None, 0, {}),
                (41, "lock", "unlocked", "Front Door", "lock.front_door", "porch", 0, alex),
                (18, "doorbell", "ring", "Front Door", "camera.front_door", "porch", 2, {}),
                (3, "detection", "person", "Front Door", "camera.front_door", "porch", 2, {})):
            row(now - mins * 60, family, kind_, label, entity, area, n, **who)
    still = {"camera.front_door": "07.webp", "camera.backyard": "21.webp"}
    real = tl.clock
    for i, (t, family, kind_, label, entity, area, n, who) in enumerate(sorted(rows, key=lambda r: r[0])):
        title = W.title(family, kind_, label, {})
        r = Row(src=f"audit:{i}", at=t, family=family, kind=kind_, title=title, entity=entity, area=area,
                search=W.search_words(family, kind_, label, rooms.get(area), title), detail={"s": kind_},
                actor_name=who.get("actor_name"), device_name=who.get("device_name"), how=who.get("how"))
        tl.rows.write([("row", r)])
        if n:
            from io import BytesIO
            from PIL import Image
            img = Image.open(ROOT / "web/hk/landscapes" / still[entity]).convert("RGB")
            img.thumbnail((640, 640))
            eid = tl.rows.by_src([r.src])[0]["id"]
            for k in range(n):
                out = BytesIO()
                img.crop((k * 24, 0, img.width - (n - 1 - k) * 24, img.height)).save(out, "JPEG", quality=72)
                tl.clock = lambda at=t + 2 + 5 * k: at
                pics.store(eid, entity, out.getvalue())
    tl.clock = real


def apply_state(name: str) -> None:
    """Turn the stood-in house (gallery.HOUSE, EXTRA already in it) into STATES[name]."""
    st = STATES[name]
    STATE["name"] = name
    for eid, (area, (state, attrs)) in list(gallery.HOUSE.items()):
        dom = eid.split(".", 1)[0]
        if dom in st.get("domains", {}):
            gallery.HOUSE[eid] = (area, (st["domains"][dom], attrs))
    for eid, (state, attrs) in st.get("entities", {}).items():
        area = gallery.HOUSE.get(eid, (None,))[0]
        gallery.HOUSE[eid] = (area, (state, attrs))
    for eid, state in st.get("entities_state", {}).items():
        area, (_, attrs) = gallery.HOUSE[eid]
        gallery.HOUSE[eid] = (area, (state, attrs))
    for eid, more in st.get("attrs", {}).items():
        area, (state, attrs) = gallery.HOUSE[eid]
        gallery.HOUSE[eid] = (area, (state, {**{k: v for k, v in attrs.items() if k not in more}, **{k: v for k, v in more.items() if v is not None}}))


def stand_in_reads() -> None:
    """The reads the test server cannot answer: the family calendar's events and Live TV's channels."""
    from client_smoke import OfflineReads

    async def calendar_events(self, entity_id, start, end):
        if STATES[STATE["name"]].get("events") is False:
            return []
        if entity_id != "calendar.family":
            return []
        # ("later": nothing today, the events from tomorrow on -- the Calendar block's "nothing scheduled today, Dentist next")
        return [e for e in _events() if e["start"].get("dateTime", e["start"].get("date", ""))[:10] > time.strftime("%Y-%m-%d")] \
            if STATES[STATE["name"]].get("events") == "later" else _events()
    OfflineReads.get_calendar_events = calendar_events
    ask = OfflineReads.request

    async def request(self, msg):
        if msg.get("type") == "hk_tv/channels":
            return {"configured": True, "channels": [{"number": n, "name": name, "camera": f"camera.channel_{n.replace('.', '_')}",
                                                     "now": f"sensor.channel_{n.replace('.', '_')}_now"} for n, name, *_ in TV + (TV_EXTRA if STATE["name"] == "tv_many" else [])]}
        return await ask(self, msg)
    OfflineReads.request = request


def stand_in_app(app) -> None:
    """The to-do lists' items and Home Assistant's Energy settings and statistics, on the built test server."""
    from mantel_server.connectors import Route

    async def todo_items(ctx, msg):
        eid = msg.get("entity_id")
        name, items = TODO.get(eid, (eid, []))
        return {"entity_id": eid, "name": name, "left": len(items),
                "items": [{"uid": f"{eid}-{i}", "summary": t, "done": False, "due": None} for i, t in enumerate(items)]}
    app["read_routes"]["hk_frontend/todo/items"] = Route(request=todo_items)
    hub = app["hub"]
    hub.readproxy.energy_prefs, hub.readproxy.stat_rows = ENERGY_PREFS, stat_rows


def clean_areas() -> list[str]:
    """The rooms Clean Areas offers in the state: CLEAN_AREAS, or twelve of them."""
    return CLEAN_AREAS + [r[0] for r in MORE_ROOMS] if STATES[STATE["name"]].get("twelve") else CLEAN_AREAS


def feed_script() -> str:
    """THE ENERGY FEATURE, stood in on the page: its plan's house battery is what the `battery` block shows, and the
    test server's settings feed has no Energy feature to send (hkSettings.get answers `added` and `energy` as a house
    with it would) -- its sun, house and grid now, which the Battery and Power blocks read -- and CLEAN AREAS, its
    rooms answered as hk_clean_areas/subscribe would (the Vacuum block's rooms). Run before the page's own scripts."""
    dev = lambda key, name, icon, stat: {"key": key, "kind": "device", "name": name, "icon": icon, "stat": stat, "power": None}
    plan = json.dumps({"sections": [{"id": "appliances", "name": "Appliances", "items": [
        dev("app.laundry", "Laundry", "mdi:washing-machine", "sensor.laundry_energy"),
        dev("app.dishwasher", "Dishwasher", "mdi:dishwasher", "sensor.dishwasher_energy"),
        dev("app.office", "Office", "mdi:power-plug", "sensor.office_energy")]}],
                       "power": {"path": "power", "battery": BATTERY, "home": "sensor.home_power",
                                                 "solar": "sensor.solar_power", "grid": "sensor.grid_power"}})
    return """(() => { let hs;
      Object.defineProperty(window, 'hkSettings', { configurable: true, get() { return hs; }, set(v) {
        hs = v; if (!v || !v.get || v.__audit) return; const get = v.get, sub = v.subscribe; v.__audit = true;
        v.get = function (p, f) { if (p === 'added') return ['energy', 'live_tv', 'clean_areas']; if (p === 'energy') return """ + plan + """;
          return get.apply(this, arguments); };
        v.subscribe = function (conn, msg, on) { if (msg && msg.type === 'hk_clean_areas/subscribe') {
          setTimeout(() => on({ configured: true, areas: """ + json.dumps(clean_areas()) + """ }), 0); return () => {}; }
          return sub.apply(this, arguments); }; } }); })()"""


async def audit(keys: list[str], looks: list[str], shots: Path | None, long: bool, nobar: list[str]) -> dict:
    gallery.HOUSE.update(EXTRA)
    apply_state(STATE["name"])
    if STATES[STATE["name"]].get("twelve"):
        gallery.ROOMS.extend(r for r in MORE_ROOMS if r not in gallery.ROOMS)
        for rid, rname, _ in MORE_ROOMS:        # (the page's registry keeps an area only when something in it is let through)
            gallery.HOUSE[f"sensor.{rid}_temperature"] = (rid, ("68", {"friendly_name": f"{rname} Temperature", "unit_of_measurement": "°F",
                                                                       "device_class": "temperature", "state_class": "measurement"}))
    if long:
        for eid, (area, (state, attrs)) in list(gallery.HOUSE.items()):
            if "friendly_name" in attrs and not eid.startswith("sun."):
                gallery.HOUSE[eid] = (area, (state, dict(attrs, friendly_name=attrs["friendly_name"] + LONG)))
    passes = [(k, lk, True) for lk in looks for k in keys] + [(k, lk, False) for lk in nobar for k in keys]
    gallery.SETTINGS = settings(passes)
    stand_in_reads()
    report: dict = {}
    with tempfile.TemporaryDirectory(prefix="mantel-grid-audit-") as folder:
        app, cookie = await gallery.build(Path(folder))
        hub = app["hub"]
        stand_in_app(app)
        tl_kind = STATES[STATE["name"]].get("timeline", "quiet" if STATE["name"] == "quiet" else "busy")
        seed_timeline(app, tl_kind)
        async with TestServer(app) as server:
            # (Mantel's own start-up row, "Mantel started", is the real clock's: not part of the made-up house)
            app["timeline"].flush()
            with app["timeline"].db:
                app["timeline"].db.execute("DELETE FROM timeline_events WHERE src NOT LIKE 'audit:%'")
            origin = str(server.make_url("")).rstrip("/")
            async with Browser(width=VIEW[0], height=VIEW[1], port=9391) as b:
                await b.restrict_origin(origin)
                # the page has the focus, as a wall tablet's does (cameras rest without it: cameras.focus_pause)
                await b.send("Emulation.setFocusEmulationEnabled", enabled=True)
                await b.send("Page.addScriptToEvaluateOnNewDocument", source=feed_script())
                if STATE["hits"]:
                    await b.send("Page.addScriptToEvaluateOnNewDocument", source="window.__hitsCheck = true")
                sun = None
                for key, look, bar in passes:
                    elev = SUN.get(look, 40.0)
                    if elev != sun:
                        sun = elev
                        hub.store.apply_event({"a": {"sun.sun": {
                            "s": "above_horizon" if elev > 0 else "below_horizon", "lc": gallery.NOW, "lu": gallery.NOW,
                            "a": {"friendly_name": "Sun", "elevation": elev, "azimuth": 180.0, "next_setting": SUNSET}}}})
                    name = screen(key, look, bar)
                    mark = len(b.console)
                    await b.open(f"{origin}/{name}/home", cookie)
                    await b.wait("window.__mantelReady === true", 30)
                    await b.wait("""(() => { const d = (r) => { for (const e of r.querySelectorAll('*')) {
                        if (e.localName === 'hk-home-grid-view') return e; if (e.shadowRoot) { const f = d(e.shadowRoot); if (f) return f; } }
                        return null; }; const v = d(document); return v && v.shadowRoot.querySelectorAll('.cell').length > 0; })()""", 20)
                    await asyncio.sleep(2.0)            # pictures, fonts and the sky settle
                    picked = STATES[STATE["name"]].get("picked")
                    if picked and key == "vacuum":      # the rooms ticked on the Vacuum block (hk-home.js: hkHome.picked, by vacuum)
                        await b.eval("(() => { if (!window.hkHome || !window.hkHome.picked) return; const s = (window.hkHome.picked['vacuum.downstairs'] = window.hkHome.picked['vacuum.downstairs'] || new Set()); s.clear(); %s.forEach(a => s.add(a));"
                                     " window.dispatchEvent(new Event('hk-vacuum-rooms')); })()" % json.dumps(picked))
                        await asyncio.sleep(0.8)
                    got = await b.eval(MEASURE)
                    if STATE.get("stretch"):
                        grew = await b.eval(STRETCH + f"({STRETCH_DELTA})")
                        for cell in got.get("cells", []):
                            cell["issues"] += (grew or {}).get(cell.get("size"), [])
                    if os.environ.get("AUDIT_PROBE"):      # (a probe of one's own, in the page: AUDIT_PROBE='<js expression>', printed)
                        print("probe", await b.eval(os.environ["AUDIT_PROBE"]), flush=True)
                    got["errors"] = [c for c in b.console[mark:] if c.startswith(("EXCEPTION", "error"))][:8]
                    report.setdefault(key, {})[look + ("" if bar else " (no bar)")] = got
                    if shots:
                        tail = ('-long' if long else '') + ('' if STATE["name"] == "busy" else '-' + STATE["name"])
                        await b.screenshot(shots / f"{name}{tail}.png")
    return report


# NOTHING STRETCHES (2026-11-08, the owner: "entities in a card should maintain dimensions ... the vertical and horizontal
# stretching of entities in our cards I just don't like at all"; DESIGN.md "Using the space"). `--stretch` draws each
# block, then makes its cell DELTA px wider and taller and draws it again: a tile, row, pill or button (a painted box
# with words or a glyph in it, holding no such box itself, smaller than the plate) that grew with its block is
# stretched. A box that grew taller by DELTA/4 or more fails; one that grew wider fails unless it spans its column (a
# list row, a full-width key: designed to). Pictures, bars, containers, a picture's stand-in glyph and a block-sized
# button are not counted: they may follow the block.
STRETCH_DELTA = 24
STRETCH = r"""(async (delta) => {
  const view = (function d(r) { for (const e of r.querySelectorAll('*')) { if (e.localName === 'hk-home-grid-view') return e;
    if (e.shadowRoot) { const f = d(e.shadowRoot); if (f) return f; } } return null; })(document);
  if (!view) return {};
  const k = view._gridScale || 1, frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const kids = (n) => [...n.children, ...(n.shadowRoot ? n.shadowRoot.children : [])];
  const isBox = (e, c) => {
      if (/^(style|script|template|slot|link|svg|img|video|canvas|ha-icon|hk-icon)$/.test(e.localName)) return false;
      const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const r = e.getBoundingClientRect();
      // a fill or a whole outline: what the eye reads as a tile, a key or a pill (a hairline between rows is not)
      const bw = ['Top', 'Right', 'Bottom', 'Left'].map((x) => parseFloat(cs['border' + x + 'Width']) || 0);
      const paints = (!/rgba\\(0, 0, 0, 0\\)|transparent/.test(cs.backgroundColor) && cs.backgroundColor !== 'rgba(0, 0, 0, 0)')
                     || cs.backgroundImage !== 'none' || bw.every((x) => x > 0);
      const blockSized = r.width >= c.width * 0.8 && r.height >= c.height * 0.8;      // the plate, a whole-block button
      const text = (e.textContent || '').trim();
      const art = text.length <= 2 && !/[0-9A-Za-z]/.test(text);                     // a stand-in glyph for a picture
      const says = text || (e.querySelector && (e.querySelector('svg,ha-icon,hk-icon') || (e.shadowRoot && e.shadowRoot.querySelector('svg,ha-icon,hk-icon'))));
      return paints && !blockSized && !art && says && r.width >= 20 && r.height >= 16; };
  const boxes = (card, c) => { const out = []; const walk = (e, path) => {
      const kidsOf = kids(e);
      if (isBox(e, c)) {
        // a container of other boxes (a column, a strip of keys) is not judged itself: what it holds is
        const inner = (function has(n) { for (const x of kids(n)) { if (isBox(x, c) || has(x)) return true; } return false; })(e);
        if (!inner) { const r = e.getBoundingClientRect(), par = e.parentElement || (e.getRootNode() && e.getRootNode().host);
          const pr = par ? par.getBoundingClientRect() : r, ps = par ? getComputedStyle(par) : null;
          const pw = ps ? pr.width - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight) - parseFloat(ps.borderLeftWidth) - parseFloat(ps.borderRightWidth) : r.width;
          out.push({ path, w: r.width / k, h: r.height / k, spans: r.width >= pw * 0.95, font: getComputedStyle(e).fontSize,
                     label: e.localName + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.') : '')
                            + ' "' + (e.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 24) + '"' }); } }
      kidsOf.forEach((x, i) => walk(x, path + '/' + i)); };
    walk(card, ''); return out; };
  const res = {};
  for (const cell of view.shadowRoot.querySelectorAll('.cell')) {
    const card = cell.firstElementChild; if (!card) continue;
    const c0 = cell.getBoundingClientRect(), before = boxes(card, c0);
    const pad = parseFloat(getComputedStyle(cell).getPropertyValue('--hk-block-pad')) || 14;
    const keep = cell.getAttribute('style') || '';
    cell.style.width = (c0.width / k + delta) + 'px'; cell.style.height = (c0.height / k + delta) + 'px';
    cell.style.justifySelf = 'start'; cell.style.alignSelf = 'start';
    await frame(); await new Promise((r) => setTimeout(r, 350)); await frame();
    const after = new Map(boxes(card, cell.getBoundingClientRect()).map((b) => [b.path, b]));
    const span = c0.width / k - 2 * pad, bad = [];
    for (const b of before) { const a = after.get(b.path); if (!a || a.label !== b.label) continue;
      if (a.font !== b.font) continue;            // a hero whose type is sized to its block: made to be big
      const dh = a.h - b.h, dw = a.w - b.w;
      if (dh >= delta / 4) bad.push('stretches taller with its block: ' + b.label + ' ' + b.h.toFixed(0) + ' -> ' + a.h.toFixed(0) + ' px');
      else if (dw >= delta / 4 && !b.spans && b.w < span * 0.9) bad.push('stretches wider with its block: ' + b.label + ' ' + b.w.toFixed(0) + ' -> ' + a.w.toFixed(0) + ' px'); }
    cell.setAttribute('style', keep); await frame();
    res[cell.getAttribute('size') || '?'] = [...new Set(bad)].slice(0, 6);
  }
  return res;
})"""


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
    ap.add_argument("--opts", nargs="*", default=[], metavar="KEY=JSON",
                    help="what a block names, over the audit's own (thermostat='{\"entity\": \"climate.office\"}')")
    ap.add_argument("--state", choices=list(STATES), default="busy",
                    help="the house's state (STATES): busy (default) or quiet -- every block must look finished in each")
    ap.add_argument("--hits", action="store_true", help="also fail where one control's touchable box (its ::after too) overlaps another's")
    ap.add_argument("--stretch", action="store_true",
                    help="also fail a tile, row, pill or button that grows with its block (STRETCH: nothing stretches)")
    a = ap.parse_args(argv)
    STATE["name"] = a.state
    STATE["stretch"] = a.stretch
    STATE["hits"] = a.hits
    for o in a.opts:
        k, _, v = o.partition("=")
        OPTS[k] = {**OPTS.get(k, {}), **json.loads(v)}
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
