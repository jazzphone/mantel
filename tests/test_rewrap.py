"""tools/rewrap.py (phase 24, A4): it breaks long lines without changing what the code does, and proves it.

The cases use a narrow width (60) so a sample stays short. Each forbidden break of the plan is refused, each allowed one
is made and proved, and a planted bad split is caught by the proof.
"""
from __future__ import annotations

import ast
import json
import shutil
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "tests"))
import rewrap  # noqa: E402
import test_line_widths  # noqa: E402

W = 60
HAVE_NODE = shutil.which("node") is not None and (ROOT / "tools/typecheck/node_modules/typescript/package.json").is_file()
needs_node = pytest.mark.skipif(not HAVE_NODE, reason="node or TypeScript (tools/typecheck) not installed")


def js(text: str, width: int = W):
    res = rewrap.rewrap_js(text, width)
    assert not res.error, res.error
    if res.text != text:
        ok, why = rewrap.prove_js(text, res.text)
        assert ok, why
    return res


def py(text: str, width: int = W):
    res = rewrap.rewrap_py(text, width)
    assert not res.error, res.error
    if res.text != text:
        ok, why = rewrap.prove_py(text, res.text)
        assert ok, why
    return res


def widest(text: str) -> int:
    return max(len(ln) for ln in text.split("\n"))


# ---------------------------------------------------------------------------------------------------- JavaScript
@needs_node
def test_js_long_call_breaks_after_commas():
    src = "foo(aaaaaaaaaaaaaaaa, bbbbbbbbbbbbbbbbbbbb, cccccccccccccccccccc, dddddddddddddddddd, eeeeeeeeeeeee);\n"
    res = js(src)
    assert res.broken == 1 and not res.left and widest(res.text) <= W
    lines = res.text.rstrip("\n").split("\n")
    assert len(lines) >= 2 and all(ln.rstrip().endswith(",") for ln in lines[:-1])
    assert lines[1].startswith("  ")                 # continuation: the line's indent plus 2


@needs_node
def test_js_return_is_broken_inside_never_right_after_the_keyword():
    src = "function f() {\n  return aaaaaaaaaaaaaaaaaaaa + bbbbbbbbbbbbbbbbbbbbbb + cccccccccccccccccccccc + dddddddddddddd;\n}\n"
    res = js(src)
    lines = res.text.split("\n")
    assert res.broken == 1 and widest(res.text) <= W
    assert not any(ln.rstrip().endswith("return") for ln in lines)
    assert lines[1].startswith("  return aaaa") and lines[1].rstrip().endswith("+")     # after an operator
    paren = "function f() {\n  return (aaaaaaaaaaaaaaaaaaaa(bbbbbbbbbbbbbbbbbbbbbb, cccccccccccccccccccccc), dddddddddddddd);\n}\n"
    res = js(paren)
    assert res.broken == 1 and not any(ln.rstrip().endswith("return") for ln in res.text.split("\n"))


@needs_node
def test_js_template_literal_left_alone_and_reported():
    src = "const t = `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ${x} bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`;\n"
    res = js(src)
    assert res.text == src and res.broken == 0
    assert [(x.line, x.reason) for x in res.left] == [(1, "inside a template literal")]
    multi = "const t = `aaaaaaa\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n`;\n"
    res = js(multi)
    assert res.text == multi and [x.reason for x in res.left] == ["inside a template literal"]


@needs_node
def test_js_regular_expression_left_alone_and_reported():
    src = "const r = /^aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa(bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb|ccccccccccccc)$/;\n"
    res = js(src)
    assert res.text == src and [x.reason for x in res.left] == ["inside a regular expression"]


@needs_node
def test_js_string_that_is_the_object_of_a_dot_is_not_split():
    src = "const parts = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm'.split(' ');\n"
    res = js(src)
    assert res.text == src and [x.reason for x in res.left] == ["no safe break point"]
    assert "' +" not in res.text
    length = "const n = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo'.length;\n"
    assert js(length).text == length


@needs_node
def test_js_postfix_increment_stays_with_its_operand():
    src = "total = aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa + counts[key]++ + bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb;\n"
    res = js(src)
    assert res.broken == 1
    assert not any(ln.lstrip().startswith("++") for ln in res.text.split("\n"))
    assert "counts[key]++" in res.text


@needs_node
def test_js_arrow_and_throw_never_get_a_break_before_or_after():
    src = "const f = (aaaaaaaaaaaaaaaaaaaaaaaa, bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, cccccccccccccccccccc) => aaaaaaaaaaaaaaaaaaaaaaaa + 1;\n"
    res = js(src)
    assert not any(ln.lstrip().startswith("=>") for ln in res.text.split("\n"))
    thr = "function g() {\n  throw new Error('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');\n}\n"
    assert not any(ln.rstrip().endswith("throw") for ln in js(thr).text.split("\n"))


@needs_node
def test_js_long_css_string_in_an_array_is_split_at_a_rule_boundary():
    css = ".a{color:red;margin:0}.b{padding:1px;border:0}.c{display:flex;gap:2px}.d{width:10px;height:10px}"
    src = f"const rules = [\n  '{css}',\n];\n"
    res = js(src)
    assert res.broken == 1 and widest(res.text) <= W and not res.left
    lines = res.text.split("\n")
    assert lines[1].startswith("  '.a{") and lines[1].endswith("' +")
    assert all(ln.rstrip("' +").endswith((";", "}")) for ln in lines[1:-2] if ln.endswith("' +"))     # cut after ; or }
    assert "".join(ln.strip().rstrip("+").strip().strip("',") for ln in lines[1:-2]) == css


@needs_node
def test_js_string_split_keeps_the_quote_style_and_never_a_directive():
    src = 'const a = foo("aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo");\n'
    res = js(src)
    assert res.broken == 1 and '"' in res.text and "'" not in res.text
    directive = "'use strict aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo';\n"
    assert js(directive).text == directive


@needs_node
def test_js_comment_is_reflowed_and_a_trailing_comment_moves_above_its_code():
    src = "function f() {\n  // aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo pppp\n  x = 1;\n}\n"
    res = js(src)
    assert res.broken == 1 and widest(res.text) <= W
    assert all(ln.startswith("  // ") for ln in res.text.split("\n")[1:3]) and res.text.endswith("  x = 1;\n}\n")
    trail = "function f() {\n  x = 1; // aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn\n}\n"
    res = js(trail)
    lines = res.text.split("\n")
    assert lines[1].startswith("  // aaaa") and "  x = 1;" in lines
    assert lines.index("  x = 1;") > 1 and widest(res.text) <= W


@needs_node
def test_js_ts_directive_lines_are_never_split():
    src = ("// @ts-expect-error\nfoo(aaaaaaaaaaaaaaaaaaaa, bbbbbbbbbbbbbbbbbbbb, cccccccccccccccccccc, dddddddddddddd);\n"
           "x(aaaaaaaaaaaaaaaaaaaa, bbbbbbbbbbbbbbbbbbbb, cccccccccccccccccccc, ddddddddddddd); // @ts-ignore\n")
    res = js(src)
    assert res.text == src and len(res.left) == 2 and res.broken == 0


@needs_node
def test_js_is_idempotent_and_leaves_short_lines_alone():
    src = ("function f(a) {\n  const s = 1;\n  foo(aaaaaaaaaaaaaaaaaaaa, bbbbbbbbbbbbbbbbbbbb, cccccccccccccccccccc, dddddddddddddd);\n"
           "  return s + 2;\n}\n")
    once = js(src)
    twice = js(once.text)
    assert twice.text == once.text and twice.broken == 0
    kept = [ln for ln in src.split("\n") if len(ln) <= W]
    assert all(ln in once.text.split("\n") for ln in kept)


@needs_node
def test_js_proof_catches_a_planted_bad_split():
    good = "x('abcdef ghi' + y);\n"
    assert rewrap.prove_js(good, "x('abcdef ' +\n  'ghi' + y);\n")[0]                      # a clean string split
    assert rewrap.prove_js("x(y + 'abcdef');\n", "x(y + 'abc' +\n  'def');\n")[0]          # folded into the chain
    ok, why = rewrap.prove_js(good, "x('abcdef ' +\n  'hi' + y);\n")                        # drops a character
    assert not ok and why
    assert not rewrap.prove_js("function f() { return a; }\n", "function f() { return\n a; }\n")[0]    # a semicolon appears
    assert not rewrap.prove_js("a = b\n++c;\n", "a = b ++\nc;\n")[0]
    assert not rewrap.prove_js("x(a, b);\n", "x(a);\n")[0]
    assert rewrap.prove_js("x(a /* one */, b);\n", "x(a,\n  b); // two\n")[0]             # comments do not count


# ---------------------------------------------------------------------------------------------------- Python
def test_py_long_call_is_broken_after_commas():
    src = "result = compute(aaaaaaaaaaaaaaaa, bbbbbbbbbbbbbbbbbbbb, cccccccccccccccccccc, dddddddddddddddddd, eeeeeeeeeeeee)\n"
    res = py(src)
    assert res.broken == 1 and not res.left and widest(res.text) <= W
    lines = res.text.rstrip("\n").split("\n")
    assert lines[0].endswith(",") and lines[1].startswith("    ")


def test_py_long_string_in_a_call_becomes_adjacent_literals():
    src = 'print("aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo pppp")\n'
    res = py(src)
    assert res.broken == 1 and widest(res.text) <= W and res.text.count('"') >= 4


def test_py_long_string_outside_brackets_is_parenthesized():
    src = 'MESSAGE = "aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo pppp"\n'
    res = py(src)
    assert res.broken == 1 and widest(res.text) <= W
    assert ast.dump(ast.parse(res.text)) == ast.dump(ast.parse(src)) and "(" in res.text


def test_py_fstring_braces_are_never_cut():
    src = 'print(f"aaaa {value + other} bbbb {value:>10} cccc dddd {a} eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn")\n'
    res = py(src)
    assert res.broken == 1
    for ln in res.text.split("\n"):
        assert ln.count("{") == ln.count("}")


def test_py_triple_quoted_string_left_alone_and_reported():
    src = 'TEXT = """\naaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo pppp qqqq\n"""\n'
    res = py(src)
    assert res.text == src and [(x.line, x.reason) for x in res.left] == [(2, "inside a multi-line string")]


def test_py_comment_is_reflowed_and_noqa_is_kept():
    src = "def f():\n    # aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo pppp\n    return 1\n"
    res = py(src)
    assert res.broken == 1 and widest(res.text) <= W
    assert all(ln.startswith("    # ") for ln in res.text.split("\n")[1:3])
    keep = "from x import aaaaaaaaaaaaaaaaaaaa, bbbbbbbbbbbbbbbbbbbbb, ccccccccccccccccccc, ddddddddddddd  # noqa: E402\n"
    res = py(keep)
    assert res.text == keep and len(res.left) == 1
    trail = "x = foo(1)  # aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo pppp\n"
    res = py(trail)
    lines = res.text.split("\n")
    assert lines[0].startswith("# aaaa") and "x = foo(1)" in lines and lines.index("x = foo(1)") > 0 and widest(res.text) <= W


def test_py_no_bracket_means_no_safe_break_and_it_is_idempotent():
    src = "from . import aaaaaaaaaaaaaaaaaaaa, bbbbbbbbbbbbbbbbbbbbb, ccccccccccccccccccc, dddddddddddddddd, eeeeeeeeeeeeeee\n"
    res = py(src)
    assert res.text == src and [x.reason for x in res.left] == ["no safe break point"]
    call = "x = f(aaaaaaaaaaaaaaaaaaaa, bbbbbbbbbbbbbbbbbbbbb, ccccccccccccccccccc, dddddddddddddddd, eeeeeeeeeeeeeee)\n"
    once = py(call)
    assert py(once.text).text == once.text


def test_py_proof_catches_a_planted_bad_split():
    good = 'x = ("abc def"\n     " ghi")\n'
    assert rewrap.prove_py('x = "abc def ghi"\n', good)[0]                      # adjacent literals fold
    ok, why = rewrap.prove_py('x = "abc def ghi"\n', 'x = ("abc de"\n     " ghi")\n')     # drops a character
    assert not ok and why
    assert not rewrap.prove_py("f(a, b)\n", "f(a)\n")[0]
    assert not rewrap.prove_py("f(a, b)\n", "f(a, b\n")[0]


# ---------------------------------------------------------------------------------------------------- the command line
@needs_node
def test_cli_check_writes_nothing_and_report_hashes_match_the_ratchet(tmp_path, capsys):
    long_tpl = "const t = `" + "a" * 70 + "`;\n"
    jsf = tmp_path / "a.js"
    pyf = tmp_path / "b.py"
    jsf.write_text("foo(aaaaaaaaaaaaaaaaaaaa, bbbbbbbbbbbbbbbbbbbb, cccccccccccccccccccc, dddddddddddddd);\n" + long_tpl)
    pyf.write_text('TEXT = """\n' + "a " * 40 + '\n"""\n')
    before = (jsf.read_text(), pyf.read_text())
    report = tmp_path / "r.json"
    assert rewrap.main([str(jsf), str(pyf), "--check", "--width", str(W), "--report", str(report)]) == 0
    assert (jsf.read_text(), pyf.read_text()) == before
    rows = json.loads(report.read_text())
    assert sorted(r["why"] for r in rows) == ["inside a multi-line string", "inside a template literal"]
    final = rewrap.rewrap_js(before[0], W).text.split("\n")
    row = next(r for r in rows if r["file"].endswith("a.js"))
    assert row["hash"] == test_line_widths.line_hash(final[row["line"] - 1]) and row["line"] == 3
    assert "broke 1" in capsys.readouterr().out
    assert rewrap.main([str(jsf), "--width", str(W)]) == 0                       # now write it
    assert jsf.read_text() != before[0] and rewrap.main([str(jsf), "--check", "--width", str(W)]) == 0
    assert "broke 0" in capsys.readouterr().out.split("a.js:")[-1]
