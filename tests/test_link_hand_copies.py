"""The hand copies across Mantel Server, the page's shim and the two Home Assistant integrations (2026-11-01, audit 3,
LINK-8). A value that two sides must agree on lives in each of them, because the Home Assistant files import
`homeassistant` and Mantel Server cannot; so these tests read the files as text (ast and regular expressions) and
compare: the live talk rates, the talk-back clip's types, size and path, and Mantel Link's actions (names, fields,
limits) against HK Frontend's, which they alias, and against what Mantel Server forwards."""
from __future__ import annotations

import ast
import re
from pathlib import Path

import yaml

from mantel_server.ha import ha_client as HC
from mantel_server import linked as LK

ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / "hk_core"
ML = ROOT / "hosts/ha/custom_components/mantel"
HKF = ROOT / "hosts/ha/custom_components/hk_frontend"


def _tree(path: Path) -> ast.Module:
    return ast.parse(path.read_text())


def _literal(node: ast.AST, env: dict[str, object]):
    """A module-level constant's value: literals, frozenset(...)/set(...)/tuple(...) of them, re.compile("...") as its
    pattern, names already known, and sums."""
    if isinstance(node, ast.Name) and node.id in env:
        return env[node.id]
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ("frozenset", "set", "tuple") \
            and node.args:
        return {"frozenset": frozenset, "set": set, "tuple": tuple}[node.func.id](_literal(node.args[0], env))
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "compile" and node.args:
        return _literal(node.args[0], env)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        return _literal(node.left, env) + _literal(node.right, env)
    if isinstance(node, (ast.Tuple, ast.List)):
        return tuple(_literal(e, env) for e in node.elts)
    if isinstance(node, ast.Set):
        return {_literal(e, env) for e in node.elts}
    return ast.literal_eval(node)


def constants(path: Path) -> dict[str, object]:
    """Every top-level NAME = <constant> of a Python file (also ``A, B = 1, 2``); what is not a constant is skipped."""
    env: dict[str, object] = {}
    for node in _tree(path).body:
        if not (isinstance(node, ast.Assign) and len(node.targets) == 1):
            continue
        target = node.targets[0]
        try:
            if isinstance(target, ast.Name):
                env[target.id] = _literal(node.value, env)
            elif isinstance(target, ast.Tuple) and isinstance(node.value, ast.Tuple) \
                    and len(target.elts) == len(node.value.elts):
                for t, v in zip(target.elts, node.value.elts):
                    env[t.id] = _literal(v, env)
        except (ValueError, TypeError, SyntaxError, KeyError):
            continue
    return env


# ------------------------------------------------------------------------------------------ live talk: the rates
def test_the_live_talk_rates_are_the_same_in_the_gateway_and_in_home_assistant():
    rates = constants(CORE / "talk/core.py")["RATES"]             # live talk's core (2026-11-02)
    assert tuple(HC.TALK_RATES) == tuple(rates), "ha_client.TALK_RATES and hk_core/talk/core.py RATES differ"
    for side in (ML, HKF):                                        # both integrations only re-export the shared file
        assert "RATES" in (side / "talk_live.py").read_text()


# ------------------------------------------------------------------------------- the talk-back clip: types, size, path
JS = (ROOT / "web/shim/mantel-client.js").read_text()


def test_the_talk_back_clip_types_are_the_same_in_the_gateway_the_shim_and_home_assistant():
    types = constants(CORE / "link/talk.py")["AUDIO_TYPES"]
    assert HC.UPLOAD_TYPES == types, "ha_client.UPLOAD_TYPES and hk_core/link/talk.py AUDIO_TYPES differ"
    m = re.search(r"var TALK_TYPE = /\^audio\\/\(([^)]*)\)", JS)
    assert m, "web/shim/mantel-client.js no longer has TALK_TYPE in the form this test reads"
    assert {"audio/" + t for t in m.group(1).split("|")} == set(types), "the shim's TALK_TYPE differs"


def test_the_talk_back_clip_size_is_the_same_in_the_gateway_and_the_shim_and_fits_home_assistants_limit():
    m = re.search(r"var TALK_MAX = (\d+);", JS)
    assert m and int(m.group(1)) == HC.UPLOAD_MAX_BYTES, "the shim's TALK_MAX and ha_client.UPLOAD_MAX_BYTES differ"
    assert HC.UPLOAD_MAX_BYTES <= constants(CORE / "link/talk.py")["MAX_BYTES"], "Home Assistant would refuse a clip"


def test_the_talk_paths_and_the_speaker_pattern_are_the_same():
    # the gateway's path allows both integrations' views; the shim sends HK Frontend's, and the gateway picks
    assert HC.TALK_PATHS == ("/api/mantel/talk", "/api/hk_frontend/talk")
    assert HC.TALK_PATH.match("/api/hk_frontend/talk?entity_id=media_player.hall") and \
        HC.TALK_PATH.match("/api/mantel/talk?entity_id=media_player.hall")
    speaker = HC.TALK_ENTITY.pattern
    assert speaker == r"^media_player\.[a-z0-9_]+$"
    assert re.search(r"var SPEAKER = /\^media_player\\\.\[a-z0-9_\]\+\$/;", JS), "the shim's SPEAKER differs"
    assert r"media_player\.[a-z0-9_]+$/;" in re.search(r"var TALK_PATH = .*", JS).group(0), "the shim's TALK_PATH differs"
    for view in (ML / "talk.py", HKF / "talk.py"):
        assert "from .hk_core.link.talk import" in view.read_text(), f"{view} is not the shared view any more"


# ---------------------------------------------------------------------------------- Mantel Link's actions vs HK Frontend's
def _schema_fields(path: Path) -> dict[str, set[str]]:
    """{service: field names} of services.py's POPUP_SCHEMA / NOTIFY_SCHEMA / MORE_SCHEMAS, from the vol.Required and
    vol.Optional keys of each schema (the text: the file imports homeassistant)."""
    tree = _tree(path)

    def keys(schema: ast.AST) -> set[str]:
        out: set[str] = set()
        for n in ast.walk(schema):
            if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr in ("Required", "Optional")
                    and isinstance(n.func.value, ast.Name) and n.func.value.id == "vol"
                    and n.args and isinstance(n.args[0], ast.Constant) and isinstance(n.args[0].value, str)):
                out.add(n.args[0].value)
        return out

    named: dict[str, ast.AST] = {}
    more: dict[str, ast.AST] = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
            named[node.targets[0].id] = node.value
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.value is not None:
            named[node.target.id] = node.value
    more_node = named["MORE_SCHEMAS"]
    assert isinstance(more_node, ast.Dict)
    for k, v in zip(more_node.keys, more_node.values):
        more[k.value] = v
    out = {"show_popup": keys(named["POPUP_SCHEMA"]), "close_popup": keys(named["POPUP_SCHEMA"]),
           "notify": keys(named["NOTIFY_SCHEMA"])}
    out.update({name: keys(node) for name, node in more.items()})
    return out


def _yaml_fields(path: Path) -> dict[str, set[str]]:
    return {name: set((spec or {}).get("fields") or {}) for name, spec in yaml.safe_load(path.read_text()).items()}


def test_mantel_links_action_schemas_have_the_fields_hk_frontend_has():
    ours = _schema_fields(ML / "services.py")
    hk_yaml, ml_yaml = _yaml_fields(HKF / "services.yaml"), _yaml_fields(ML / "services.yaml")
    assert set(ours) <= set(hk_yaml), "an action Mantel Link has and HK Frontend never did"
    for name, fields in ours.items():
        assert fields == hk_yaml[name], f"{name}: services.py schema {sorted(fields)} vs HK Frontend {sorted(hk_yaml[name])}"
        assert fields == ml_yaml[name], f"{name}: services.py schema vs Mantel Link's own services.yaml"
    assert ml_yaml.keys() == hk_yaml.keys()


def test_mantel_links_action_limits_are_hk_frontends():
    ml, notif = constants(ML / "services.py"), constants(CORE / "notifications/const.py")
    hk = constants(HKF / "features/notifications/__init__.py")
    music = constants(CORE / "music/const.py")
    assert (ml["TITLE_MAX"], ml["MESSAGE_MAX"]) == (notif["TITLE_MAX"], notif["MESSAGE_MAX"])
    assert ml["STAY_MAX"] == hk["STAY_ACTION_MAX"]
    assert tuple(ml["TAPS"]) == tuple(notif["TAPS"])
    assert ml["_PAGE"] == notif["PAGE_RE"]
    assert ml["_ICON"] == hk["ICON"], "the icon pattern"
    assert tuple(ml["TRANSPORT"]) == tuple(music["COMMANDS"])


def test_the_action_names_agree_across_mantel_link_hk_frontend_and_mantel_server():
    ours = set(_schema_fields(ML / "services.py")) | {"set_black_screen"}
    assert set(LK.SERVICES_2) == ours, "Mantel Server forwards other actions than Mantel Link registers"
    assert set(constants(ML / "const.py")["SERVICES"]) == set(LK.SERVICES)
    hk = constants(HKF / "linked_mode.py")["FORWARDED"]
    assert set(hk) | set(LK.SERVICES) == set(LK.SERVICES_2), "HK Frontend's linked mode forwards other actions"
    popup = _schema_fields(ML / "services.py")["show_popup"]
    assert popup == set(LK._POPUP_KEYS), "the pop-up fields Mantel Server accepts"
