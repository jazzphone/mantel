"""manifest.json names every integration the code reaches into, as hassfest
(the Validate workflow on GitHub) requires -- and hassfest runs nowhere else,
so this is the check before a release. 1.5.0 went out with the Energy feature
reading homeassistant.components.energy and no `energy` in the manifest."""
import json
import os
import re

from conftest import COMPONENT

# hassfest's ALLOWED_USED_COMPONENTS that this code uses: entity platforms and
# the internal integrations any integration may use without declaring them
ALLOWED = {"alarm_control_panel", "binary_sensor", "camera", "diagnostics", "media_player",
           "sensor", "switch", "media_source", "persistent_notification"}
IMPORT = re.compile(r"^\s*(?:from\s+homeassistant\.components\.(\w+)|"
                    r"from\s+homeassistant\.components\s+import\s+([\w, ]+)|"
                    r"import\s+homeassistant\.components\.(\w+))", re.M)


def _used() -> dict[str, str]:
    out: dict[str, str] = {}
    for d, dirs, files in os.walk(COMPONENT):
        dirs[:] = [x for x in dirs if x not in ("tests", "tools", "__pycache__")]
        for f in files:
            if not f.endswith(".py"):
                continue
            path = os.path.join(d, f)
            for m in IMPORT.finditer(open(path, encoding="utf-8").read()):
                names = [m.group(1) or m.group(3)] if not m.group(2) else \
                    [n.strip().split(" as ")[0] for n in m.group(2).split(",")]
                for n in names:
                    out.setdefault(n, os.path.relpath(path, COMPONENT))
    return out


def test_every_integration_used_is_in_the_manifest():
    m = json.load(open(os.path.join(COMPONENT, "manifest.json"), encoding="utf-8"))
    declared = set(m.get("dependencies", [])) | set(m.get("after_dependencies", [])) | ALLOWED
    missing = {n: where for n, where in _used().items() if n not in declared and n != m["domain"]}
    assert not missing, f"add to manifest.json after_dependencies (or dependencies): {missing}"


def test_the_check_sees_the_energy_import():
    assert "energy" in _used()


def test_every_subentry_has_its_step_strings():
    # hassfest refuses a config subentry without `step` (1.8.0: the wall
    # tablet's, whose flow only leads to HK Settings, had none)
    t = json.load(open(os.path.join(COMPONENT, "translations", "en.json"), encoding="utf-8"))
    missing = [k for k, v in t.get("config_subentries", {}).items() if not (v.get("step") or {}).get("user")]
    assert not missing, f"translations/en.json config_subentries without step.user: {missing}"
