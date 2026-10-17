"""Architecture lint (PLAN §4): the shared code must not know it is inside Home Assistant."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HA_IMPORT = re.compile(r"^\s*(from\s+homeassistant\b|import\s+homeassistant\b)", re.M)
HASS_REF = re.compile(r"\bhass\.")


def _files(folder: str, suffixes: tuple[str, ...]):
    base = ROOT / folder
    return [p for p in base.rglob("*") if p.is_file() and p.suffix in suffixes and "node_modules" not in p.parts]


def test_hk_core_does_not_import_homeassistant():
    bad = [str(p.relative_to(ROOT)) for p in _files("hk_core", (".py",)) if HA_IMPORT.search(p.read_text())]
    assert not bad, f"hk_core must not import homeassistant: {bad}"


def test_web_does_not_reference_hass():
    bad = [str(p.relative_to(ROOT)) for p in _files("web", (".js", ".mjs", ".html", ".ts", ".css"))
           if HASS_REF.search(p.read_text())]
    assert not bad, f"web/ must talk to HKClient, not hass.: {bad}"


def test_the_lint_itself_catches_violations():
    assert HA_IMPORT.search("from homeassistant.core import HomeAssistant")
    assert HA_IMPORT.search("    import homeassistant")
    assert not HA_IMPORT.search("# we do not import homeassistant here")
    assert HASS_REF.search("const s = hass.states['light.x']")
    assert not HASS_REF.search("const passes = compass.states")
