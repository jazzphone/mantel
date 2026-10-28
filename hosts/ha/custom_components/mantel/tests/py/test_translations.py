"""strings.json and translations/en.json, as hassfest (the Validate workflow on GitHub) reads them -- and hassfest
runs nowhere else, so this is the check before a release. Its translations plugin (script/hassfest/translations.py
in home-assistant/core, validate_translation_value) refuses, in every string: a URL (RE_URL: a scheme or www.
followed by a host with a top-level domain: "please use description placeholders instead"), HTML, a placeholder
in single quotes, a placeholder that is not an identifier, and leading or trailing spaces. The URL rule went
unseen until the first run of Validate, so the rule is copied here word for word.

The addresses these texts show are placeholders (const.URL_PLACEHOLDERS), passed by every form of the config flow;
the text a person reads is what it always was."""
from __future__ import annotations

import json
import os
import re
import string
from typing import Any, Iterator

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers.service_info.hassio import HassioServiceInfo
from homeassistant.helpers.service_info.zeroconf import ZeroconfServiceInfo
from ipaddress import ip_address

from conftest import COMPONENT, linked

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

FILES = ("strings.json", os.path.join("translations", "en.json"))


def _load(name: str) -> dict[str, Any]:
    with open(os.path.join(COMPONENT, name), encoding="utf-8") as f:
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
    assert RE_URL.search("Enter an address like https://mantel.example.com"), "what 0.1.6 shipped, and hassfest refused"
    assert not RE_URL.search("Mantel's address is {https}, or {http} only for the App ({app_url})")
    assert problems("see http://local-mantel:8099"), "no top-level domain: hassfest's rule misses it, ours does not"
    assert problems("<b>bold</b>") and problems("'{url}'") and problems(" padded") and problems("{a.b}")
    assert not problems("Use {https}. Plain {http} is only for this machine.")


def test_no_string_holds_a_url_or_what_hassfest_refuses():
    bad = {}
    for name in FILES:
        for path, value in _strings(_load(name)):
            if found := problems(value):
                bad[f"{name}: {path}"] = found
    assert not bad, f"hassfest would refuse these: {bad}"


def test_strings_json_and_the_english_translation_are_one_file():
    assert _load("strings.json") == _load(os.path.join("translations", "en.json"))


def test_the_flow_texts_read_as_they_always_did():
    """The placeholders are filled in with the addresses the texts showed before they moved out."""
    from custom_components.mantel.const import URL_PLACEHOLDERS as P
    t = _load("strings.json")["config"]
    assert t["step"]["user"]["description"].format(**P).startswith(
        "Link Home Assistant to Mantel. Mantel's address is https://, or http:// only for the Mantel App on this "
        "machine (http://local-mantel:8099). Then a pairing code")
    assert t["error"]["url_invalid"].format(**P) == "Enter an address like https://mantel.example.com"
    assert t["error"]["url_insecure"].format(**P) == \
        "Use https://. Plain http:// is only for Mantel on this machine (the Mantel App)."
    assert t["error"]["url_not_internal"].format(**P) == \
        "That name doesn't lead to this machine's App network, so http:// isn't allowed. Use https://."


def _names(node: Any) -> set[str]:
    return {f for _, v in _strings(node) for _, f, _, _ in string.Formatter().parse(v) if f}


async def test_every_form_hands_over_the_placeholders_its_texts_use(hass, mantel):
    """Home Assistant fills a form's texts, and its errors, from the form's description_placeholders."""
    config = _load("strings.json")["config"]
    own = {"addon", "url"}                              # the two a form fills from what it found
    flows = hass.config_entries.flow
    forms = {}

    r = await flows.async_init("mantel", context={"source": config_entries.SOURCE_USER})
    forms["user"] = r
    r = await flows.async_init("mantel", context={"source": config_entries.SOURCE_HASSIO},
                               data=HassioServiceInfo(config={"url": mantel.url, "token": "msvc_x",
                                                              "instance": "a" * 32},
                                                      name="Mantel", slug="local_mantel", uuid="0123"))
    forms["hassio_confirm"] = r
    r = await flows.async_init("mantel", context={"source": config_entries.SOURCE_ZEROCONF},
                               data=ZeroconfServiceInfo(
                                   ip_address=ip_address("192.0.2.20"), ip_addresses=[ip_address("192.0.2.20")],
                                   port=443, hostname="mantel.local.", type="_mantel._tcp.local.",
                                   name="Mantel bbbbbb._mantel._tcp.local.",
                                   properties={"instance": "b" * 32, "url": "https://mantel.example.com",
                                               "path": "/linked/ws", "version": ""}))
    forms["zeroconf_confirm"] = r
    for step, form in forms.items():
        assert form["type"] is FlowResultType.FORM and form["step_id"] == step, step
        # a form is shown with every error it could have: the placeholders come with all of them
        needed = _names(config["step"][step]) | _names(config["error"])
        given = set(form["description_placeholders"] or {}) | own
        assert needed <= given, f"{step}: texts use {sorted(needed - given)} that the form does not pass"
        flows.async_abort(form["flow_id"])

    e = await linked(hass, mantel)
    r = await e.start_reconfigure_flow(hass)
    needed = _names(config["step"]["reconfigure"]) | _names(config["error"])
    assert r["step_id"] == "reconfigure" and needed <= set(r["description_placeholders"] or {}) | own
