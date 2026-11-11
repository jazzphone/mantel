"""No startup waterfall (2026-10-29): home.html preloads the modules web/home.js imports one after another, and
shim/early-cards.js asks for the card list with the page. Preloading only downloads; the order they RUN in is
home.js's awaits, which must stay (hosts/ha/custom_components/hk_frontend/boot.py says why order matters)."""
from __future__ import annotations

import re
from pathlib import Path

from mantel_server import ingress

WEB = Path(__file__).resolve().parents[1] / "web"
PREFIX = "/api/hassio_ingress/Fict1onalToken"


def _home_js_modules() -> list[str]:
    text = (WEB / "home.js").read_text()
    loop = re.search(r"for \(const m of \[(.*?)\]\) await imp\('/hk/' \+ m\);", text, re.S)
    assert loop, "the bootstrap modules are still imported one at a time, in order"
    return re.findall(r"'([^']+)'", loop.group(1))


def test_home_html_preloads_every_module_home_js_imports_in_turn():
    html = (WEB / "home.html").read_text()
    preloaded = re.findall(r'<link rel="modulepreload" href="/hk/([^"]+)">', html)
    assert preloaded == _home_js_modules() and len(preloaded) == 9


def test_the_preloads_are_moved_under_the_ingress_prefix():
    html = ingress.rewrite(ingress.inject_base((WEB / "home.html").read_text(), PREFIX), PREFIX)
    assert f'<link rel="modulepreload" href="{PREFIX}/hk/modules/hk-settings.js">' in html
    assert all(h.startswith(PREFIX + "/hk/") for h in re.findall(r'rel="modulepreload" href="([^"]+)"', html))


def test_the_execution_order_is_still_home_js_s_awaits():
    text = (WEB / "home.js").read_text()
    assert text.index("await imp('/hk/' + m)") < text.index("Promise.all(cards.map((c) => imp('/hk/cards/' + c)))")
    assert text.index("await first;") < text.index("await imp('/hk/' + m)")        # after the house's states, as before


def test_the_card_list_is_asked_for_early_and_taken_by_home_js():
    early = (WEB / "shim/early-cards.js").read_text()
    assert "mantelUrl('/api/hk-cards')" in early and "window.__mantelCardList = list" in early
    assert "rel = 'modulepreload'" in early and "import(" not in early              # downloads only, nothing is run
    assert early.index("window.__mantelCardList") < early.index("modulepreload")
    html = (WEB / "home.html").read_text()
    assert html.index("shim/early-cards.js") < html.index("/web/home.js")
    assert "window.__mantelCardList" in (WEB / "home.js").read_text()
    served = ingress.rewrite(early, PREFIX)
    assert f"link.href = hkV('{PREFIX}/hk/cards/' + c)" in served                  # under Ingress too (hkV: the ?v=)


def test_the_screensaver_alone_skips_the_strategy_and_the_view():
    """Settings' screensaver preview (?hk_preview=saver, 2026-10-31): the card base only, the shell told there is no
    view host, the screensaver shown -- and the page goes no further: no strategy run, no view drawn."""
    text = (WEB / "home.js").read_text()
    assert "new URLSearchParams(location.search).get('hk_preview') === 'saver'" in text
    assert "if (SAVER_ONLY) cards.splice(0, cards.length, ...cards.filter((c) => c === 'hk-base.js'));" in text
    branch = text.index("if (SAVER_ONLY) {")
    body = text[branch:text.index("\n}\n", branch) + 2]
    assert "window.hkMantelShell.saverOnly();" in body and "window.hkSaver.preview(true)" in body
    assert "window.__mantelReady = true;" in body and "await new Promise(() => {});" in body
    assert branch < text.index("await window.hkStrategy.generate(") and branch < text.index("await viewHost.start();")
    shell = (WEB / "shim" / "mantel-shell.js").read_text()
    assert "function saverOnly() { S.use(Object.assign({}, MANTEL, { dashboardConfig: () => ({}) })); }" in shell
    assert "saverOnly," in shell
