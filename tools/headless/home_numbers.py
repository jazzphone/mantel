"""The Home-page proof's numbers and checks, headless at 1280x800 (the Kitchen tablet's CSS size).

    python tools/headless/home_numbers.py --shot docs/proof1/kitchen-home-1280x800.png [--runs 3] [--idle 20]

Per cold load: time to the page being drawn (navigation start -> cards attached), DOMContentLoaded/load,
main-thread script and total task time up to then (CDP Performance metrics), page weight. Then one
steady-state window: script/task time per second and hub traffic while the house changes live.
Also checks the proof's criteria: no hui-*/ha-panel-*/home-assistant element in the DOM, every script
from Mantel's own origin, commands refused (hass.callService and a raw call_service over the hub socket).
"""
import argparse
import asyncio
import json
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from cdp import Browser  # noqa: E402

COOKIE = Path("~/.local/share/mantel/measure.cookie").expanduser()
URL = "http://127.0.0.1:8765/home"
FORBIDDEN = ("home-assistant", "home-assistant-main", "ha-panel-lovelace")

WALK = """(() => { const n = {}; const walk = (r) => { for (const e of r.querySelectorAll('*')) {
  n[e.localName] = (n[e.localName] || 0) + 1; if (e.shadowRoot) walk(e.shadowRoot); } }; walk(document); return n; })()"""


async def metrics(b):
    r = await b.send("Performance.getMetrics")
    return {m["name"]: m["value"] for m in r["metrics"]}


async def one_load(shot=None, idle=0, url=URL):
    out = {}
    async with Browser() as b:
        await b.send("Performance.enable")
        await b.send("Network.setCacheDisabled", cacheDisabled=True)
        await b.open(url, COOKIE.read_text().strip())
        ok = await b.wait("window.__mantelMarks && window.__mantelMarks.rendered !== undefined", 90)
        out["ok"] = ok
        m = await metrics(b)
        marks = await b.eval("window.__mantelMarks")
        out["draw_ms"] = marks["module_start"] + marks["rendered"]
        out["marks"] = marks
        nav = await b.eval("(() => { const n = performance.getEntriesByType('navigation')[0]; return {dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd)}; })()")
        out["nav"] = nav
        out["script_s_at_draw"] = round(m["ScriptDuration"], 3)
        out["task_s_at_draw"] = round(m["TaskDuration"], 3)
        out["layout_s_at_draw"] = round(m["LayoutDuration"] + m["RecalcStyleDuration"], 3)
        out["heap_mb"] = round(m["JSHeapUsedSize"] / 1e6, 1)
        weight = 0
        hosts = set()
        for ev in b.events:
            if ev.get("method") == "Network.loadingFinished":
                weight += ev["params"].get("encodedDataLength", 0)
            if ev.get("method") == "Network.requestWillBeSent":
                u = ev["params"]["request"]["url"]
                hosts.add(u.split("/")[2] if "//" in u else u[:20])
        out["weight_kb"] = round(weight / 1024)
        out["request_hosts"] = sorted(hosts)
        out["scripts_from"] = await b.eval("[...new Set(performance.getEntriesByType('resource').filter(r => r.initiatorType === 'script' || r.name.endsWith('.js')).map(r => new URL(r.name).host))]")
        if idle:
            await asyncio.sleep(6)                       # past the narrowing to this screen's entities
            if "narrow=0" not in url:
                await b.wait("window.__mantelNarrow !== undefined", 30)
            before = await metrics(b)
            hub0 = await b.eval("[window.__mantelHub.msgs, window.__mantelHub.bytes]")
            hass0 = await b.eval("window.__mantel.hass")  and 0
            await b.eval("window.__mantelUpdates = 0; (() => { const h = window.__mantel; const prev = h.onHass; h.onHass = (x) => { window.__mantelUpdates++; prev(x); }; })(); 1")
            await asyncio.sleep(idle)
            after = await metrics(b)
            hub1 = await b.eval("[window.__mantelHub.msgs, window.__mantelHub.bytes]")
            out["steady"] = {
                "seconds": idle,
                "script_s_per_20s": round((after["ScriptDuration"] - before["ScriptDuration"]) * 20 / idle, 3),
                "task_s_per_20s": round((after["TaskDuration"] - before["TaskDuration"]) * 20 / idle, 3),
                "hub_msgs_per_s": round((hub1[0] - hub0[0]) / idle, 2),
                "hub_bytes_per_s": round((hub1[1] - hub0[1]) / idle),
                "hass_updates_applied": await b.eval("window.__mantelUpdates"),
                "states_in_page": await b.eval("Object.keys(window.__mantel._states).length"),
            }
            if shot:                                     # before the refusal tests below raise their toast
                await b.screenshot(shot)
                await b.screenshot(shot.replace(".png", "-full.png"), full=True)
            # live updates working: the page's states move, and the cards follow
            out["narrowed_to"] = await b.eval("window.__mantelNarrow")
            # criteria
            tags = await b.eval(WALK)
            out["forbidden_elements"] = {k: v for k, v in tags.items() if k.startswith("hui-") or k.startswith("ha-panel-") or k in FORBIDDEN}
            out["ha_elements_present"] = sorted(k for k in tags if k.startswith("ha-"))
            out["element_count"] = sum(tags.values())
            refused = await b.eval("""(async () => { let r = 'accepted';
              try { await window.__mantel.hass.callService('light', 'turn_on', { entity_id: 'light.nonexistent' }); } catch (e) { r = e.code; }
              return r; })()""")
            out["callService"] = refused
            ws_err = await b.eval("""new Promise((res) => { const ws = new WebSocket('ws://' + location.host + '/ws');
              ws.onopen = () => ws.send(JSON.stringify({ id: 9, type: 'call_service', domain: 'light', service: 'turn_on' }));
              ws.onmessage = (e) => { res(JSON.parse(e.data).code); ws.close(); }; setTimeout(() => res('no answer'), 4000); })""")
            out["raw_call_service_over_hub"] = ws_err
            out["refused_log"] = await b.eval("window.__mantel.refused")
            out["calls"] = await b.eval("Object.fromEntries(window.__mantel.calls)")
        out["console_errors"] = [c for c in b.console if c.startswith(("error", "EXCEPTION", "warning"))][:20]
    return out


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shot")
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--idle", type=float, default=20)
    ap.add_argument("--all-states", action="store_true", help="steady state with every entity streaming in (no narrowing)")
    a = ap.parse_args()
    url = URL + ("?narrow=0" if a.all_states else "")
    runs = [await one_load(url=url) for _ in range(a.runs)]
    final = await one_load(shot=a.shot, idle=a.idle, url=url)
    for k in ("draw_ms", "script_s_at_draw", "task_s_at_draw", "layout_s_at_draw", "weight_kb"):
        vals = [r[k] for r in runs + [final]]
        print(f"{k}: median {statistics.median(vals)}  runs {vals}")
    print(json.dumps(final, indent=1))


asyncio.run(main())
