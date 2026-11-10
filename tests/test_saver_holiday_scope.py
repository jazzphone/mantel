"""The Holiday slide's stylesheet stays inside its own layer.

Its <style> is placed in the screensaver's shadow root, where it reaches every element -- so each rule must start at
the layer's own class. When the layer was `.hl`, Big Weather's and the Weather slide's high/low lines (also `.hl`)
took its dark background and will-change: a black box over the Forecast on the wall tablets (2026-11-09)."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = (ROOT / "web/hk/modules/hk-saver-holiday.js").read_text()


def _css_rules():
    block = SRC[SRC.index("var CSS = ["):]
    block = block[:block.index("].join(")]
    block = "\n".join(l for l in block.splitlines() if not l.strip().startswith("//"))
    text = "".join(re.findall(r"'((?:[^'\\]|\\.)*)'", block))
    depth, sel, out = 0, "", []
    for ch in text:
        if ch == "{":
            if depth == 0:
                out.append(sel.strip())
            depth += 1
            sel = ""
        elif ch == "}":
            depth -= 1
            sel = ""
        elif depth == 0:
            sel += ch
    return out


def test_every_rule_starts_at_the_layer():
    rules = _css_rules()
    assert len(rules) > 50
    for rule in rules:
        if rule.startswith("@"):
            continue
        for part in rule.split(","):
            assert part.strip().startswith(".hkhol"), part


def test_no_other_saver_piece_is_named_like_the_layer():
    for f in (ROOT / "web/hk").rglob("*.js"):
        if f.name.startswith("hk-saver-holiday"):
            continue
        assert "hkhol'" not in f.read_text().replace(".hkhol", "").replace("contains('hkhol')", ""), f


def _holiday_classes():
    names = set()
    for f in (ROOT / "web/hk/modules").glob("hk-saver-holiday*.js"):
        text = f.read_text()
        for m in re.finditer(r"class=\\?[\"']([\w -]+)", text):
            names.update(m.group(1).split())
        for m in re.finditer(r"className = '([\w -]+)'", text):
            names.update(m.group(1).split())
    return names


def _saver_top_classes():
    """Classes the screensaver's own stylesheet styles wherever they are in its shadow root (a rule's first part)."""
    text = (ROOT / "web/hk/saver/hk-saver-css.js").read_text()
    text = "\n".join(l for l in text.splitlines() if not l.strip().startswith("//"))
    names = set()
    for s in re.findall(r"'((?:[^'\\]|\\.)*)'", text):
        for sel in re.findall(r"([^{}]*)\{", s):
            for part in sel.split(","):
                part = re.sub(r"^\s*:host(\([^()]*(\([^()]*\))?[^()]*\))?\s*", "", part)
                m = re.match(r"\.([\w-]+)", part)
                if m:
                    names.add(m.group(1))
    return names


def test_no_holiday_piece_shares_a_name_with_the_screensavers_layers():
    # (the New Year board's letters were .fc -- the Forecast layer's name, hidden until it is up: 2026-11-09)
    top = _saver_top_classes()
    assert "fc" in top and "ph" in top
    clash = (_holiday_classes() - {"hkhol"}) & top     # (the layer itself the screensaver places: beside the pane)
    assert not clash, sorted(clash)
