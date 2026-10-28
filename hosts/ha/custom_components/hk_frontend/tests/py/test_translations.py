"""translations/en.json, as hassfest (the Validate workflow on GitHub) reads it -- and hassfest runs nowhere else,
so this is the check before a release. Its translations plugin (script/hassfest/translations.py in
home-assistant/core, validate_translation_value) refuses, in every string: a URL (RE_URL: a scheme or www. followed
by a host with a top-level domain: "please use description placeholders instead"), HTML, a placeholder in single
quotes, a placeholder that is not an identifier, and leading or trailing spaces. The URL rule failed every run of
Validate until the addresses moved out of the strings, so the rule is copied here word for word.

The addresses the "Linked to Mantel" texts show are placeholders (const.LINKED_URL_PLACEHOLDERS), passed by that
step (its errors are filled from them too); the text a person reads is what it always was."""
from __future__ import annotations

import glob
import json
import os
import re
import string
from typing import Any, Iterator

from conftest import COMPONENT, entry

# hassfest's own (script/hassfest/translations.py), copied
RE_URL = re.compile(
    r"(((ftp|ftps|scp|http|https|mqtt|mqtts|socket|socks5):\/\/|www\.)"
    r"[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,5}(:[0-9]{1,5})?(\/.*)?)",
    re.IGNORECASE,
)
RE_HTML = re.compile(r"<[a-z].*?>", re.IGNORECASE)                    # cv.string_with_no_html
RE_QUOTED_PLACEHOLDER = re.compile(r"'{\w+}'")
RE_REFERENCE = re.compile(r"(.+\[%)|(%\].+)")                          # a combined translation
# stricter than hassfest: any scheme at all ("http://local-mantel:8099" has no top-level domain, so RE_URL lets it
# through, and a looser rule in a later Home Assistant would not)
RE_SCHEME = re.compile(r"\b[a-z][a-z0-9+.-]*://", re.IGNORECASE)

EN = os.path.join(COMPONENT, "translations", "en.json")
FRAGMENTS = sorted(glob.glob(os.path.join(COMPONENT, "features", "*", "translations.en.json")))


def _load(path: str) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _strings(node: Any, path: str = "") -> Iterator[tuple[str, str]]:
    if isinstance(node, dict):
        for k, v in node.items():
            yield from _strings(v, f"{path}.{k}" if path else k)
    elif isinstance(node, str):
        yield path, node


def problems(value: str) -> list[str]:
    out = []
    if RE_URL.search(value):
        out.append("a URL (hassfest: please use description placeholders instead)")
    elif RE_SCHEME.search(value):
        out.append("a scheme such as https:// (use a description placeholder)")
    if RE_HTML.search(value):
        out.append("HTML")
    if RE_QUOTED_PLACEHOLDER.search(value):
        out.append("a placeholder in single quotes")
    if RE_REFERENCE.search(value):
        out.append("a combined translation")
    if value != value.strip():
        out.append("leading or trailing spaces")
    for _, field, _, _ in string.Formatter().parse(value):
        if field and not field.isidentifier():
            out.append(f"placeholder {{{field}}} is not an identifier")
    return out


def test_the_rule_is_hassfests_own():
    assert RE_URL.search("For example https://mantel.example.lan, or"), "what 1.14.2 shipped, and hassfest refused"
    assert not RE_URL.search("For example {example_url}, or {app_url} for the Mantel App")
    assert problems("see http://local-mantel:8099"), "no top-level domain: hassfest's rule misses it, ours does not"
    assert problems("<b>bold</b>") and problems("'{url}'") and problems(" padded") and problems("{a.b}")
    assert not problems("starting with {https} (or {http}, {ws}, {wss}), with")


def test_no_string_holds_a_url_or_what_hassfest_refuses():
    bad = {}
    for path in [EN, *FRAGMENTS]:
        for key, value in _strings(_load(path)):
            if found := problems(value):
                bad[f"{os.path.relpath(path, COMPONENT)}: {key}"] = found
    assert not bad, f"hassfest would refuse these: {bad}"


def test_the_linked_texts_read_as_they_always_did():
    """The placeholders are filled in with the addresses the texts showed before they moved out."""
    from custom_components.hk_frontend.const import LINKED_URL_PLACEHOLDERS as P
    o = _load(EN)["options"]
    assert o["step"]["linked"]["data_description"]["url"].format(**P) == \
        "For example https://mantel.example.lan, or http://local-mantel:8099 for the Mantel App on this machine."
    assert o["error"]["mantel_url_invalid"].format(**P) == \
        "Enter Mantel's address, starting with https:// (or http://, ws://, wss://), with no user name or query."
    insecure = o["error"]["mantel_url_insecure"].format(**P)
    assert insecure.startswith("Use https:// (or wss://) for an address on the network")
    assert insecure.endswith("an App on Home Assistant's internal network (http://local-mantel:8099).")
    assert o["error"]["mantel_url_not_internal"].format(**P).endswith("Check the App's hostname, or use https://.")


def test_the_app_address_is_the_one_linked_mode_offers():
    from custom_components.hk_frontend import linked_mode
    from custom_components.hk_frontend.const import LINKED_URL_PLACEHOLDERS as P
    assert P["app_url"] == linked_mode.APP_ADDRESS


def _names(node: Any) -> set[str]:
    return {f for _, v in _strings(node) for _, f, _, _ in string.Formatter().parse(v) if f}


async def test_the_linked_step_hands_over_the_placeholders_its_texts_use(hass, frontend):
    """Home Assistant fills a form's texts, and its errors, from the form's description_placeholders."""
    e = entry(hass)
    flows = hass.config_entries.options
    r = await flows.async_init(e.entry_id)
    r = await flows.async_configure(r["flow_id"], {"next_step_id": "linked"})
    assert r["type"] == "form" and r["step_id"] == "linked"
    options = _load(EN)["options"]
    needed = _names(options["step"]["linked"]) | _names({k: v for k, v in options["error"].items()
                                                         if k.startswith("mantel_")})
    assert needed <= set(r["description_placeholders"]), sorted(needed - set(r["description_placeholders"]))
    # and with an error shown, as the form is again
    r = await flows.async_configure(r["flow_id"], {"enabled": True, "url": "not an address", "token": ""})
    assert r["errors"]["url"] == "mantel_url_invalid"
    assert needed <= set(r["description_placeholders"])
