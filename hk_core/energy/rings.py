"""TODAY'S ENERGY RINGS for the iPhone's Energy Rings widget (2026-11-24, the owner: "Any options for the rings with
energy? Would love to see this!").

The Energy Rings block (web/hk/energy/hk-energy-rings.js, its sums in hk-energy-sums.js) draws Energy, Cost, Solar, Water
and Gas, the Activity rings' way: each ring today so far against a usual day, a second lap past it, and a white dot
where a usual day would be by now. A widget cannot run the page's statistics, so the host reads the same hourly
statistics once and this works the rings out, the page's way kept simple:

    a usual day      the mean of the last DAYS days that have any reading (each whole day's total)
    by now           the mean of those days up to the same hour of the day, as a share of a usual day
    today            today's completed hours (Home Assistant compiles an hour's statistics after it ends)

Plain values only; no host in it.
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

DAYS = 14                     # how many days before today make a usual one
MAX_RINGS = 4                 # as the block: four at most
ORDER = ("energy", "cost", "solar", "water", "gas")
NAMES = {"energy": "Energy", "cost": "Cost", "solar": "Solar", "water": "Water", "gas": "Gas"}


def stats_of(plan: Mapping[str, Any] | None, prefs: Mapping[str, Any] | None) -> dict[str, list[str]]:
    """Each ring's statistics: the whole home's meter and its cost (the Energy page's plan), and the solar, water and
    gas sources in Home Assistant's Energy settings. A ring with none is left out."""
    total = (plan or {}).get("total") if isinstance((plan or {}).get("total"), Mapping) else {}
    out: dict[str, list[str]] = {"energy": [], "cost": [], "solar": [], "water": [], "gas": []}
    if isinstance(total.get("stat"), str) and total["stat"]:
        out["energy"].append(total["stat"])
    if isinstance(total.get("cost"), str) and total["cost"]:
        out["cost"].append(total["cost"])
    for src in (prefs or {}).get("energy_sources") or []:
        if isinstance(src, Mapping) and src.get("type") in ("solar", "water", "gas"):
            sid = src.get("stat_energy_from")
            if isinstance(sid, str) and sid and sid not in out[src["type"]]:
                out[src["type"]].append(sid)
    return {k: v for k, v in out.items() if v}


def _hours(rows: Iterable[Any], start_of: Any) -> dict[float, float]:
    out: dict[float, float] = {}
    for r in rows or []:
        if not isinstance(r, Mapping) or not isinstance(r.get("change"), (int, float)):
            continue
        t = start_of(r)
        if t is not None:
            out[t] = out.get(t, 0.0) + float(r["change"])
    return out


def rings(stats: Mapping[str, list[str]], rows: Mapping[str, Any], midnight: float, now: float, start_of: Any,
          units: Mapping[str, str | None] | None = None) -> list[dict[str, Any]]:
    """[{key, name, value, usual, by_now, unit}]: today so far, a usual day, and the share of a usual day by now (the
    white dot). `rows` is recorder/statistics_during_period's answer (hourly, types change) from DAYS days before
    `midnight` (the house's) to `now`; `start_of(row)` is a row's start in epoch seconds."""
    done = max(0, int((now - midnight) // 3600))       # today's completed hours
    out = []
    for key in ORDER:
        ids = stats.get(key) or []
        if not ids:
            continue
        hours: dict[float, float] = {}
        for sid in ids:
            for t, v in _hours(rows.get(sid) or [], start_of).items():
                hours[t] = hours.get(t, 0.0) + v
        today = sum(v for t, v in hours.items() if t >= midnight)
        totals, by = [], []
        for d in range(1, DAYS + 1):
            day0 = midnight - d * 86400
            day = [(t, v) for t, v in hours.items() if day0 <= t < day0 + 86400]
            if not day:
                continue
            totals.append(sum(v for _, v in day))
            by.append(sum(v for t, v in day if t < day0 + done * 3600))
        usual = sum(totals) / len(totals) if totals else 0.0
        if usual <= 0 and today <= 0:
            continue
        share = (sum(by) / len(by)) / usual if usual > 0 and by else None
        out.append({"key": key, "name": NAMES[key], "value": round(today, 3), "usual": round(usual, 3),
                    "by_now": None if share is None else round(max(0.0, min(1.0, share)), 4),
                    "unit": "" if key == "cost" else "kWh" if key in ("energy", "solar") else (units or {}).get(key) or ""})
        if len(out) >= MAX_RINGS:
            break
    return out
