"""The Side Pane clock's Beside the Time (2026-11-01, the owner: "give the user the choice"): None, the weather Large,
Quiet, a Chip, or on the Date Line -- kept by hk_core's check, offered by HK Settings in the same words, drawn by the
pane in each (web/hk/modules/hk-sidepane.js)."""
import re
from pathlib import Path

from hk_core.settings import model as S
import web_sources  # (a file cut into parts is read whole: tools/split_js.py)

ROOT = Path(__file__).resolve().parents[1]
LOOKS = ("none", "weather", "quiet", "chip", "date")


def test_every_look_is_kept_and_nothing_else():
    assert S.PANE_CHOICES["clock"]["beside"] == LOOKS
    for look in LOOKS:
        got = S.pane_section({"kind": "clock", "size": "less", "beside": look}, strict=True)
        assert got is not None and got.get("beside", "none") == look, look
    assert S.pane_section({"kind": "clock", "beside": "big"}, strict=True) is None


def test_hk_settings_offers_exactly_hk_cores_looks():
    text = web_sources.read("web/hk/panels/hk-settings-model.js")
    line = re.search(r"var CLOCK_BESIDE = (\[.*?\]);\n", text).group(1)
    assert tuple(re.findall(r"\['([a-z]+)', '", line)) == LOOKS


def test_the_pane_draws_each_look():
    js = web_sources.read("web/hk/modules/hk-sidepane.js")
    for look in ("quiet", "chip", "date"):
        assert f"look === '{look}'" in js, look
    assert ".ckx b{font-weight:inherit}" in js, "the figures in the clock's weight, never a step bolder"
