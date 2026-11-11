#!/usr/bin/env python3
"""Break lines over 200 characters in JavaScript and Python WITHOUT changing what the code does, and prove it
(phase 24, A4; docs/phase24/CLEAN-CODE.md "A4" and "Part C: the width").

    tools/rewrap.py web/hk/cards tests            # break every hand-written .js, .cjs and .py under those folders
    tools/rewrap.py FILE... --check               # prove and report, write nothing
    tools/rewrap.py tests --check --report out.json   # the lines it could not break, as JSON, for line_width_exceptions.json

A PATH is a file, or a folder (every hand-written .js/.cjs/.py under it, by tests/hand_written.py's rules).

WHAT IT BREAKS
  JavaScript (tools/rewrap.cjs, on the pinned TypeScript compiler API): between tokens only, never inside a template literal
  or a regular expression, and only at places no semicolon can be inserted (after a comma, an opening bracket, a binary
  operator, the ? or : of a conditional, `;`, `=`, `=>`, a closing brace; before a closing bracket or a `.`). A long string
  literal is cut at a CSS rule boundary (after `;` or `}`) or a space into '...' + '...' where its parent is a call argument,
  an array element, an initializer, a property value, a return or a `+` chain (or the right side of an assignment).
  Python (tokenize): inside brackets, after a comma or an opening bracket (or before an operator, `for`, `if`, `else`);
  a long string becomes adjacent literals (parenthesized when it stood outside brackets). Never inside a triple-quoted
  string, never an f-string's {...}.
  Comments: a `//` or `#` comment line is reflowed at its own indent; a trailing comment moves to its own line above its code.
  Left alone and reported: a line carrying @ts-expect-error / @ts-ignore (and the line after one), `# noqa`, `# type:` and
  `# pragma` comments, and every line that has no safe break.

THE PROOF, for every file it changes (a file whose proof fails is not written):
  JavaScript: the TypeScript syntax tree printed without comments, after chains of string literals joined by `+` are folded
  into one literal (both sides), gives the same tokens before and after.
  Python: ast.dump(ast.parse(text)) is identical (Python folds adjacent string literals itself).

Idempotent: a second run changes nothing. Node: $NODE, else node on the PATH.
"""
from __future__ import annotations

import argparse
import ast
import bisect
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tokenize
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "tools/rewrap.cjs"
WIDTH = 200

sys.path.insert(0, str(ROOT / "tests"))
import hand_written  # noqa: E402

R_NODE = "no safe break point"
R_TEMPLATE = "inside a template literal"
R_REGEX = "inside a regular expression"
R_MULTI = "inside a multi-line string"
R_DIRECTIVE = "carries a directive comment (@ts-expect-error, @ts-ignore, # noqa, # type:), or follows one"


@dataclass
class Left:
    line: int          # 1-based, in the new text
    length: int
    reason: str


@dataclass
class Result:
    text: str
    broken: int = 0
    left: list[Left] = field(default_factory=list)
    error: str = ""


def line_hash(text: str) -> str:
    """The same as tests/test_line_widths.py's."""
    return hashlib.sha256(text.encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------------------------------- JavaScript
def node_available() -> bool:
    return bool((os.environ.get("NODE") or shutil.which("node")) and (ROOT / "tools/typecheck/node_modules/typescript/package.json").is_file())


def ask_node(req: dict) -> dict:
    node = os.environ.get("NODE") or shutil.which("node")
    if not node:
        raise SystemExit("no node: set NODE or put node on the PATH")
    run = subprocess.run([node, str(HELPER)], input=json.dumps(req), capture_output=True, text=True, cwd=ROOT)
    if run.returncode != 0:
        raise SystemExit(f"rewrap.cjs failed:\n{run.stderr[-3000:]}")
    return json.loads(run.stdout)


def rewrap_js(text: str, width: int = WIDTH, name: str = "x.js") -> Result:
    r = ask_node({"cmd": "rewrap", "text": text, "name": name, "width": width})
    if not r.get("ok"):
        return Result(text, error=r.get("error", "failed"))
    return Result(r["text"], r["broken"], [Left(x["line"], x["length"], x["reason"]) for x in r["left"]])


def prove_js(before: str, after: str) -> tuple[bool, str]:
    r = ask_node({"cmd": "proof", "before": before, "after": after})
    return bool(r.get("ok")), r.get("why", "")


# ---------------------------------------------------------------------------------------------------- shared
DIRECTIVE_JS = re.compile(r"@ts-(expect-error|ignore|nocheck|check)")
DIRECTIVE_PY = re.compile(r"#\s*(noqa|type:|pragma|pylint|fmt:|ruff:|mypy|isort)")
KEEP_PY = re.compile(r"^\s*(noqa|type:|pragma|pylint|fmt:|ruff:|mypy|isort|!|-\*-)")


def cp_reflow(prefix: str, words: list[str], width: int) -> list[str] | None:
    lines, cur, n = [], prefix, 0
    for w in words:
        if len(prefix) + len(w) > width:
            return None
        if n and len(cur) + 1 + len(w) > width:
            lines.append(cur)
            cur, n = prefix, 0
        cur += (" " if n else "") + w
        n += 1
    lines.append(cur)
    return lines


def choose_breaks(text: str, ls: int, end: int, gaps: list[dict], ind: str, width: int) -> list[dict] | None:
    """Pick the gaps to break at so that every piece fits in `width`; None when no choice does. A gap: pos (where the left
    piece ends), next (where the right one starts), left / right (text added to each side), tier (1 best), depth, str, id."""
    failed: set[int] = set()

    def solve(frm: dict | None):
        st = frm["next"] if frm else ls
        pre = len(ind) + len(frm["right"]) if frm else 0
        if pre + len(text[st:end]) <= width:
            return []
        key = frm["id"] if frm else -1
        if key in failed:
            return None
        cands = []
        for g in gaps:
            if g["pos"] <= st:
                continue
            ln = pre + len(text[st:g["pos"]]) + len(g["left"])
            if ln > width:
                break
            cands.append((g.get("str", False), ln < width * 0.4, g["tier"], g["depth"], -g["pos"], g))
        cands.sort(key=lambda c: c[:5])
        for c in cands[:6]:
            rest = solve(c[5])
            if rest is not None:
                return [c[5]] + rest
        failed.add(key)
        return None
    return solve(None)


def build_pieces(text: str, ls: int, end: int, chosen: list[dict], ind: str) -> list[str]:
    out, st, pre = [], ls, ""
    for g in chosen:
        out.append(pre + text[st:g["pos"]] + g["left"])
        st, pre = g["next"], ind + g["right"]
    out.append(pre + text[st:end])
    return out


# ---------------------------------------------------------------------------------------------------- Python
_PREFIX = re.compile(r"""^([A-Za-z]*)('''|\"\"\"|'|")""")
_FSTART = getattr(tokenize, "FSTRING_START", -1)
_FEND = getattr(tokenize, "FSTRING_END", -2)
_SKIP = {tokenize.NL, tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT, tokenize.ENDMARKER}
_OPEN, _CLOSE = "([{", ")]}"
_BINARY = {"+", "-", "*", "/", "//", "%", "**", "|", "&", "^", "==", "!=", "<", ">", "<=", ">=", "<<", ">>", "@"}
_KW_BEFORE = {"for", "if", "else", "and", "or"}
_HEADER = re.compile(r"^\s*(def|class|if|elif|while|for|with|try|except|else|async\s+(def|for|with))\b")


class PyState:
    def __init__(self, text: str):
        self.text = text
        self.lines = text.split("\n")
        self.starts, o = [], 0
        for ln in self.lines:
            self.starts.append(o)
            o += len(ln) + 1
        self.units: list[dict] = []
        self.comments: list[tuple[int, int]] = []
        self.prot = bytearray(len(text) + 2)
        toks = list(tokenize.generate_tokens(io.StringIO(text).readline))
        i, depth = 0, 0
        while i < len(toks):
            t = toks[i]
            s, e = self.off(t.start), self.off(t.end)
            if t.type == tokenize.COMMENT:
                self.comments.append((s, e))
            elif t.type in _SKIP:
                pass
            else:
                atom = None
                if t.type == _FSTART:
                    nest, j = 1, i + 1
                    while nest:
                        nest += (toks[j].type == _FSTART) - (toks[j].type == _FEND)
                        j += 1
                    i = j - 1
                    e = self.off(toks[i].end)
                    atom = self.atom(s, e)
                elif t.type == tokenize.STRING:
                    atom = self.atom(s, e)
                if t.type == tokenize.OP and t.string in _OPEN:
                    depth += 1
                elif t.type == tokenize.OP and t.string in _CLOSE:
                    depth -= 1
                self.units.append({"s": t.string if atom is None else "", "start": s, "end": e, "depth": depth, "type": t.type, "atom": atom})
            i += 1
        self.ustarts = [u["start"] for u in self.units]

    def off(self, rc: tuple[int, int]) -> int:
        return self.starts[rc[0] - 1] + rc[1]

    def atom(self, s: int, e: int) -> dict:
        raw = self.text[s:e]
        m = _PREFIX.match(raw)
        prefix, quote = (m.group(1), m.group(2)) if m else ("", raw[:1])
        a = {"prefix": prefix, "quote": quote, "triple": len(quote) == 3, "multi": "\n" in raw}
        if a["triple"] or a["multi"]:
            for k in range(s + 1, e - 1):
                self.prot[k] = 1
        return a


def _string_candidates(raw: str, atom: dict) -> list[int]:
    """Offsets inside `raw` (after the char) where a string may be cut: after a space, `;` or `}`, outside an escape and an f-string's braces."""
    pl, ql = len(atom["prefix"]), len(atom["quote"])
    body = raw[pl + ql:-ql]
    isf = "f" in atom["prefix"].lower()
    isr = "r" in atom["prefix"].lower()
    out, i, depth = [], 0, 0
    while i < len(body):
        c = body[i]
        if c == "\\":
            if not isr and body[i + 1:i + 2] == "N" and body[i + 2:i + 3] == "{":
                j = body.find("}", i)
                i = len(body) if j < 0 else j + 1
            else:
                i += {"x": 4, "u": 6, "U": 10}.get(body[i + 1:i + 2], 2) if not isr else 2
            continue
        if isf and c in "{}":
            if body[i + 1:i + 2] == c and depth == 0:
                i += 2
                continue
            depth += 1 if c == "{" else -1
            i += 1
            continue
        if isf and depth and c in "'\"#":
            return []
        if c in " ;}" and depth == 0 and i < len(body) - 1:
            out.append(pl + ql + i + 1)
        i += 1
    return out


def _py_tier(u: dict, v: dict) -> int:
    us, vs = u["s"], v["s"]
    if u["type"] == tokenize.OP:
        if us == "," or us in _OPEN:
            return 1
        if us == "." or us == "~":
            return 0
    if v["type"] == tokenize.OP:
        if vs in _BINARY:
            return 2
        if vs in _CLOSE or vs == ".":
            return 3
        if vs in "([" and u["type"] != tokenize.OP:
            return 0                                       # a call or a subscript stays with its callee
    if v["type"] == tokenize.NAME and vs in _KW_BEFORE:
        return 2
    if u["type"] == tokenize.OP and us in (":", "="):
        return 3
    return 0


def _py_gaps(S: PyState, ls: int, ce: int, wrap: bool) -> list[dict]:
    text, units = S.text, S.units
    gaps: list[dict] = []
    k = max(0, bisect.bisect_left(S.ustarts, ls) - 1)
    while k < len(units) and units[k]["start"] < ce:
        u = units[k]
        v = units[k + 1] if k + 1 < len(units) else None
        a = u["atom"]
        if a and not a["triple"] and not a["multi"] and u["start"] >= ls and u["end"] <= ce:
            if u["depth"] >= 1 or wrap:
                raw = text[u["start"]:u["end"]]
                if "\\\n" not in raw:
                    for p in _string_candidates(raw, a):
                        gaps.append({"pos": u["start"] + p, "next": u["start"] + p, "left": a["quote"], "right": a["prefix"] + a["quote"],
                                     "tier": 4 if raw[p - 1] != " " else 5, "depth": max(u["depth"], 1), "str": True})
        if v and v["start"] <= ce and u["end"] >= ls and u["depth"] >= 1 and S.prot[u["end"]] == 0 and re.fullmatch(r"[ \t]*", text[u["end"]:v["start"]]):
            tier = _py_tier(u, v)
            if tier:
                gaps.append({"pos": u["end"], "next": v["start"], "left": "", "right": "", "tier": tier, "depth": u["depth"]})
        k += 1
    gaps.sort(key=lambda g: g["pos"])
    for n, g in enumerate(gaps):
        g["id"] = n
    return gaps


def _wrap_runs(S: PyState, ls: int, ce: int) -> list[tuple[int, int]]:
    """The runs of adjacent string literals on this line that stand outside any bracket."""
    runs, cur = [], None
    for u in S.units:
        if u["start"] < ls or u["start"] >= ce:
            continue
        a = u["atom"]
        if a and not a["triple"] and not a["multi"] and u["depth"] == 0:
            if cur and re.fullmatch(r"[ \t]*", S.text[cur[1]:u["start"]]):
                cur = (cur[0], u["end"])
                runs[-1] = cur
            else:
                cur = (u["start"], u["end"])
                runs.append(cur)
        else:
            cur = None
    return runs


def rewrap_py(text: str, width: int = WIDTH, name: str = "x.py") -> Result:
    try:
        S = PyState(text)
    except (tokenize.TokenError, SyntaxError, IndentationError) as exc:
        return Result(text, error=f"does not tokenize: {exc}")
    out: list[str] = []
    left: list[Left] = []
    broken = 0
    for li, line in enumerate(S.lines):
        if len(line) <= width:
            out.append(line)
            continue
        ls = S.starts[li]
        le = ls + len(line)

        def keep(reason: str, line=line):
            out.append(line)
            left.append(Left(len(out), len(line), reason))
        if DIRECTIVE_PY.search(line):
            keep(R_DIRECTIVE)
            continue
        col = min(le - 1, ls + width)
        why = R_MULTI if S.prot[col] else R_NODE
        indent = re.match(r"[ \t]*", line).group(0)
        cm = next(((s, e) for s, e in S.comments if ls <= s < le), None)
        if cm and not line[:cm[0] - ls].strip():                      # a whole-line comment
            m = re.match(r"^(\s*#+[ \t]*)(.*)$", line)
            r = m and not KEEP_PY.match(m.group(2)) and cp_reflow(m.group(1), m.group(2).split(), width)
            if not r:
                keep(R_NODE)
                continue
            broken += 1
            out.extend(r)
            continue
        code_start_ok = not S.prot[ls]                                 # False: the line starts inside a multi-line string
        code_end = ls + len(line[:cm[0] - ls].rstrip()) if cm else le
        move = None
        if cm and code_start_ok and not (li and S.lines[li - 1].endswith("\\")):
            m = re.match(r"^(#+[ \t]*)(.*)$", line[cm[0] - ls:])
            if m and not KEEP_PY.match(m.group(2)):
                move = cp_reflow(indent + m.group(1), m.group(2).split(), width)
        end = code_end if (move or not cm) else le
        ind = indent + " " * (8 if _HEADER.match(line) and line.rstrip().endswith(":") else 4)
        src, s_ls, s_end = S.text, ls, end
        plan = choose_breaks(src, s_ls, s_end, _py_gaps(S, ls, code_end, False), ind, width)
        if plan is None and code_start_ok and "\\" not in line.rstrip()[-1:]:
            runs = _wrap_runs(S, ls, code_end)
            if runs:
                T = _wrap_text(S, ls, line, runs)
                if T is not None:
                    shift = 2 * len(runs)
                    plan = choose_breaks(T.text, ls, end + shift, _py_gaps(T, ls, code_end + shift, True), ind, width)
                    src, s_end = T.text, end + shift
        if plan is None:
            keep(why)
            continue
        broken += 1
        out.extend((move or []) + build_pieces(src, ls, s_end, plan, ind))
    return Result("\n".join(out), broken, left)


def _wrap_text(S: PyState, ls: int, line: str, runs: list[tuple[int, int]]) -> PyState | None:
    """The state of the text with each run of the line in parentheses (the line count unchanged)."""
    new, last = [], ls
    for s, e in runs:
        new.append(S.text[last:s] + "(" + S.text[s:e] + ")")
        last = e
    t = S.text[:ls] + "".join(new) + S.text[last:]
    try:
        return PyState(t)
    except (tokenize.TokenError, SyntaxError, IndentationError):
        return None


def prove_py(before: str, after: str) -> tuple[bool, str]:
    try:
        a = ast.dump(ast.parse(before))
        b = ast.dump(ast.parse(after))
    except SyntaxError as exc:
        return False, f"does not parse: {exc}"
    if a == b:
        return True, ""
    i = 0
    while i < min(len(a), len(b)) and a[i] == b[i]:
        i += 1
    return False, f"the syntax trees differ near: {a[max(0, i - 50):i + 50]!r} / {b[max(0, i - 50):i + 50]!r}"


# ---------------------------------------------------------------------------------------------------- the driver
def kind_of(path: Path) -> str:
    return "py" if path.suffix == ".py" else "js"


def rewrap_text(kind: str, text: str, width: int = WIDTH, name: str = "x") -> Result:
    return rewrap_js(text, width, name) if kind == "js" else rewrap_py(text, width, name)


def prove(kind: str, before: str, after: str) -> tuple[bool, str]:
    return prove_js(before, after) if kind == "js" else prove_py(before, after)


def expand(paths: list[str]) -> list[Path]:
    out: list[Path] = []
    for p in paths:
        path = Path(p).resolve()
        if path.is_dir():
            rel = path.relative_to(ROOT).as_posix() + "/" if path != ROOT else ""
            for kind in ("js", "py"):
                out += [f for f in hand_written.files(kind) if hand_written.rel(f).startswith(rel)]
        elif path.is_file():
            out.append(path)
        else:
            raise SystemExit(f"no such file or folder: {p}")
    return sorted(dict.fromkeys(out))


def rel(path: Path) -> str:
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="+", metavar="PATH")
    ap.add_argument("--check", action="store_true", help="prove and report, write nothing")
    ap.add_argument("--width", type=int, default=WIDTH)
    ap.add_argument("--report", metavar="FILE", help="write the lines it could not break, as JSON")
    args = ap.parse_args(argv)
    files = expand(args.paths)
    total_broken = total_left = refused = 0
    by_reason: dict[str, int] = {}
    report: list[dict] = []
    for path in files:
        data = path.read_bytes()
        text = data.decode("utf-8", errors="replace")
        if not any(len(ln) > args.width for ln in text.split("\n")):
            continue
        shown = rel(path)
        if "\r" in text:
            print(f"{shown}: CRLF line endings, left alone")
            continue
        kind = kind_of(path)
        res = rewrap_text(kind, text, args.width, path.name)
        if res.error:
            print(f"{shown}: {res.error}")
            continue
        if res.text != text:
            ok, why = prove(kind, text, res.text)
            if not ok:
                refused += 1
                print(f"{shown}: PROOF FAILED, not written: {why}")
                continue
            if not args.check:
                path.write_bytes(res.text.encode("utf-8"))
        total_broken += res.broken
        total_left += len(res.left)
        lines = res.text.split("\n")
        print(f"{shown}: broke {res.broken}, could not break {len(res.left)}")
        for lf in res.left:
            by_reason[lf.reason] = by_reason.get(lf.reason, 0) + 1
            print(f"    {shown}:{lf.line}: {lf.length} characters, {lf.reason}")
            report.append({"file": shown, "line": lf.line, "hash": line_hash(lines[lf.line - 1]), "why": lf.reason})
    print(f"\n{len(files)} files looked at: broke {total_broken} long lines, could not break {total_left}"
          + (f", {refused} files refused (proof failed)" if refused else "") + ("  [--check: nothing written]" if args.check else ""))
    for reason, n in sorted(by_reason.items()):
        print(f"    {n:4d}  {reason}")
    if args.report:
        Path(args.report).write_text(json.dumps(report, indent=1) + "\n")
        print(f"wrote {args.report}")
    return 1 if refused else 0


if __name__ == "__main__":
    sys.exit(main())
