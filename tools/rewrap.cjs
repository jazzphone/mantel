'use strict';
// The JavaScript half of tools/rewrap.py (phase 24, A4): it breaks lines over a width WITHOUT changing what the code does,
// using the TypeScript compiler API (the copy pinned in tools/typecheck) so a string, a regular expression or a template
// literal is never cut. A JSON request on stdin, a JSON answer on stdout; not meant to be run by hand.
//
//   {"cmd": "rewrap", "text": "...", "name": "x.js", "width": 200}
//       -> {"ok": true, "text": "...", "broken": n, "left": [{"line": n, "length": n, "reason": "..."}]}
//          or {"ok": false, "error": "..."} when the file does not parse. `line` is the line's number in the NEW text.
//   {"cmd": "proof", "before": "...", "after": "..."}
//       -> {"ok": true|false, "why": "..."}: the two texts' syntax trees, printed without comments, after chains of
//          string literals joined by `+` are folded into one literal, are the same tokens.
//
// WHERE A BREAK MAY GO. Only between two tokens that sit on one line with nothing but blanks between them, never inside
// a template literal, and only where the left token is a comma, an opening bracket, a binary operator, the `?` or `:` of
// a conditional, a `;`, `=`, `=>` or a closing brace, or the right one is a closing bracket or a `.`. That list can not
// meet a place where JavaScript would insert a semicolon (after return, throw, break, continue, yield; before a postfix
// ++ or --; before =>): none of them is on it. A long string literal may be cut at a CSS rule boundary or a space into
// '...' + '...' where its parent is a call argument, an array element, an initializer, a property value, a return or a
// `+` chain (or the right side of an assignment).

const fs = require('fs');
const path = require('path');
const ts = require(path.join(__dirname, 'typecheck/node_modules/typescript'));
const SK = ts.SyntaxKind;

// characters, as Python's len counts them (a pair of UTF-16 units is one)
const cp = (s) => s.length - (s.match(/[\ud800-\udbff]/g) || []).length;

const DIRECTIVE = /@ts-(expect-error|ignore|nocheck|check)/;
const COMMENT_KEEP = /^\s*(@ts-|eslint|prettier|istanbul|c8 |#|\/|global |jshint|jslint|webpack)/;

function parse(text, name) {
  return ts.createSourceFile(name || 'x.js', text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
}

// ------------------------------------------------------------------------------------------------ tokens
function collectTokens(sf) {
  const out = [];
  (function walk(n) {
    if (n.kind >= SK.FirstJSDocNode && n.kind <= SK.LastJSDocNode) return;
    const ch = n.getChildren(sf);
    if (ch.length || n.kind === SK.SyntaxList) {
      for (const c of ch) walk(c);
      return;
    }
    const start = n.getStart(sf);
    if (n.end > start || n.kind === SK.EndOfFileToken) out.push({ kind: n.kind, node: n, start, end: n.end });
  })(sf);
  out.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}

function scanTrivia(text, a, b, into) {
  let i = a;
  while (i < b) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') i++;
    else if (text.startsWith('//', i) || (i === 0 && text.startsWith('#!'))) {
      let e = text.indexOf('\n', i);
      if (e < 0 || e > b) e = b;
      into.push({ block: false, start: i, end: e });
      i = e;
    } else if (text.startsWith('/*', i)) {
      let e = text.indexOf('*/', i + 2);
      e = e < 0 ? b : Math.min(e + 2, b);
      into.push({ block: true, start: i, end: e });
      i = e;
    } else i++;
  }
}

// ------------------------------------------------------------------------------------------------ the file's facts
function facts(text, name) {
  const sf = parse(text, name);
  if (sf.parseDiagnostics.length) {
    const d = sf.parseDiagnostics[0];
    const lc = sf.getLineAndCharacterOfPosition(d.start || 0);
    return { error: 'does not parse: line ' + (lc.line + 1) + ': ' + ts.flattenDiagnosticMessageText(d.messageText, ' ') };
  }
  const toks = collectTokens(sf);
  const comments = [];
  let prev = 0;
  for (const t of toks) {
    scanTrivia(text, prev, t.start, comments);
    prev = t.end;
  }
  // prot: 1 inside a template literal, 2 inside a regular expression, 3 inside a block comment (the positions strictly inside)
  const prot = new Uint8Array(text.length + 2);
  const mark = (s, e, v) => {
    for (let i = s + 1; i < e; i++) prot[i] = v;
  };
  (function walk(n) {
    if (n.kind === SK.TemplateExpression || n.kind === SK.NoSubstitutionTemplateLiteral) {
      mark(n.getStart(sf), n.end, 1);
      if (n.kind === SK.NoSubstitutionTemplateLiteral) return;
    }
    if (n.kind === SK.RegularExpressionLiteral) mark(n.getStart(sf), n.end, 2);
    ts.forEachChild(n, walk);
  })(sf);
  for (const c of comments) if (c.block) mark(c.start, c.end, 3);
  const depthAfter = new Int32Array(toks.length);
  let d = 0;
  toks.forEach((t, i) => {
    if (t.kind === SK.OpenParenToken || t.kind === SK.OpenBracketToken || t.kind === SK.OpenBraceToken) d++;
    else if (t.kind === SK.CloseParenToken || t.kind === SK.CloseBracketToken || t.kind === SK.CloseBraceToken) d--;
    depthAfter[i] = d;
  });
  return { sf, toks, comments, prot, depthAfter };
}

function indentUnit(lines) {
  let any = false;
  for (const l of lines) {
    const m = /^( +)[^\s*]/.exec(l);
    if (!m) continue;
    any = true;
    if (m[1].length % 4 === 2) return 2;
  }
  return any ? 4 : 2;
}

// ------------------------------------------------------------------------------------------------ break places
const BINARY_TIER1 = (k) => !(k >= SK.FirstAssignment && k <= SK.LastAssignment);

function gapTier(a, b) {
  const p = a.node.parent;
  switch (a.kind) {
    case SK.CommaToken:
    case SK.OpenParenToken:
    case SK.OpenBracketToken:
    case SK.OpenBraceToken:
    case SK.SemicolonToken:
      return 1;
    case SK.QuestionToken:
    case SK.ColonToken:
      if (p && p.kind === SK.ConditionalExpression) return 1;
      return a.kind === SK.ColonToken && p && p.kind === SK.PropertyAssignment ? 2 : 0;
    case SK.EqualsGreaterThanToken:
      return 2;
    case SK.CloseBraceToken:
      return 3;
    default:
  }
  if (p && p.kind === SK.BinaryExpression && p.operatorToken === a.node) return BINARY_TIER1(a.kind) ? 1 : 2;
  if (a.kind === SK.EqualsToken && p && p.kind === SK.VariableDeclaration) return 2;
  if (b.kind === SK.CloseParenToken || b.kind === SK.CloseBracketToken || b.kind === SK.CloseBraceToken) return 3;
  if ((b.kind === SK.DotToken || b.kind === SK.QuestionDotToken) && a.kind !== SK.NumericLiteral) return 3;
  return 0;
}

function stringParentOk(n) {
  const p = n.parent;
  if (!p) return false;
  if (p.kind === SK.CallExpression || p.kind === SK.NewExpression) return !!p.arguments && p.arguments.indexOf(n) >= 0;
  if (p.kind === SK.ArrayLiteralExpression) return p.elements.indexOf(n) >= 0;
  if (p.kind === SK.VariableDeclaration || p.kind === SK.PropertyAssignment || p.kind === SK.PropertyDeclaration) return p.initializer === n;
  if (p.kind === SK.ReturnStatement) return p.expression === n;
  // a branch of a conditional (`c ? 'a' : 'b'`): `+` binds tighter than `?:`, so 'a' + 'b' is the same branch
  if (p.kind === SK.ConditionalExpression) return p.whenTrue === n || p.whenFalse === n;
  if (p.kind === SK.BinaryExpression) {
    const k = p.operatorToken.kind;
    return k === SK.PlusToken || ((k === SK.EqualsToken || k === SK.PlusEqualsToken) && p.right === n);
  }
  return false;
}

function stringGaps(text, t, depth, out) {
  const raw = text.slice(t.start, t.end);
  const q = raw[0];
  if ((q !== "'" && q !== '"') || /\\\r?\n/.test(raw) || !stringParentOk(t.node)) return;
  const body = raw.slice(1, -1);
  for (let i = 0; i < body.length; ) {
    const c = body[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if ((c === ' ' || c === ';' || c === '}' || c === ',') && i < body.length - 1) {
      // (a comma last: a selector list or embedded code with no space; 'a,' + 'b' folds back to the same string)
      out.push({ pos: t.start + 2 + i, next: t.start + 2 + i, left: q + ' +', right: q, tier: c === ' ' ? 5 : c === ',' ? 6 : 4, depth, str: true });
    }
    i++;
  }
}

function lineGaps(F, text, ls, ce, firstTok) {
  const { toks, prot, depthAfter } = F;
  const gaps = [];
  for (let i = firstTok; i < toks.length && toks[i].start < ce; i++) {
    const a = toks[i];
    const b = toks[i + 1];
    if (a.kind === SK.StringLiteral && a.start >= ls && a.end <= ce && prot[a.start] !== 1) stringGaps(text, a, depthAfter[i], gaps);
    if (!b || b.start > ce || a.end < ls || b.kind === SK.EndOfFileToken) continue;
    if (prot[a.end] === 1 || !/^[ \t]*$/.test(text.slice(a.end, b.start))) continue;
    const tier = gapTier(a, b);
    if (tier) gaps.push({ pos: a.end, next: b.start, left: '', right: '', tier, depth: depthAfter[i] });
  }
  gaps.sort((x, y) => x.pos - y.pos);
  gaps.forEach((g, k) => {
    g.id = k;
  });
  return gaps;
}

// choose the gaps to break at so every piece fits; null when none do
function chooseBreaks(text, ls, endPos, gaps, ind, width) {
  const failed = new Set();
  function solve(from) {
    const st = from ? from.next : ls;
    const pre = from ? ind.length + cp(from.right) : 0;
    if (pre + cp(text.slice(st, endPos)) <= width) return [];
    const key = from ? from.id : -1;
    if (failed.has(key)) return null;
    const cands = [];
    for (const g of gaps) {
      if (g.pos <= st) continue;
      const len = pre + cp(text.slice(st, g.pos)) + cp(g.left);
      if (len > width) break;
      cands.push({ g, len });
    }
    const rank = (c) => [c.g.str ? 1 : 0, c.len >= width * 0.4 ? 0 : 1, c.g.tier, c.g.depth, -c.g.pos];
    cands.sort((x, y) => {
      const a = rank(x);
      const b = rank(y);
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
      return 0;
    });
    for (const c of cands.slice(0, 6)) {
      const r = solve(c.g);
      if (r) return [c.g, ...r];
    }
    failed.add(key);
    return null;
  }
  return solve(null);
}

function pieces(text, ls, endPos, chosen, ind) {
  const out = [];
  let st = ls;
  let pre = '';
  for (const g of chosen) {
    out.push(pre + text.slice(st, g.pos) + g.left);
    st = g.next;
    pre = ind + g.right;
  }
  out.push(pre + text.slice(st, endPos));
  return out;
}

function reflow(prefix, words, width) {
  const lines = [];
  let cur = prefix;
  let n = 0;
  for (const w of words) {
    if (n && cp(cur) + 1 + cp(w) > width) {
      lines.push(cur);
      cur = prefix;
      n = 0;
    }
    cur += (n ? ' ' : '') + w;
    n++;
    if (cp(prefix) + cp(w) > width) return null;
  }
  lines.push(cur);
  return lines;
}

// ------------------------------------------------------------------------------------------------ the rewrap
function rewrap(text, name, width) {
  const F = facts(text, name);
  if (F.error) return { ok: false, error: F.error };
  const { toks, comments, prot } = F;
  const lines = text.split('\n');
  const starts = [];
  let o = 0;
  for (const l of lines) {
    starts.push(o);
    o += l.length + 1;
  }
  const unit = ' '.repeat(indentUnit(lines));
  const out = [];
  const left = [];
  let broken = 0;
  let ti = 0;
  let ci = 0;
  const noteLeft = (line, reason) => left.push({ line: out.length, length: cp(line), reason });
  lines.forEach((line, li) => {
    if (cp(line) <= width) {
      out.push(line);
      return;
    }
    const ls = starts[li];
    const le = ls + line.length;
    const keep = (reason) => {
      out.push(line);
      noteLeft(line, reason);
    };
    if (DIRECTIVE.test(line) || (li > 0 && DIRECTIVE.test(lines[li - 1]))) return keep('carries @ts-expect-error / @ts-ignore, or follows a line that does');
    const col = Math.min(le - 1, ls + width);
    const why = () => (prot[col] === 1 ? 'inside a template literal' : prot[col] === 2 ? 'inside a regular expression'
      : prot[col] === 3 ? 'inside a block comment' : 'no safe break point');
    while (ci < comments.length && comments[ci].end <= ls) ci++;
    const here = comments.filter((c) => c.start >= ls && c.start < le && !c.block);
    const lc = here.length ? here[0] : null;
    const indentStr = /^[ \t]*/.exec(line)[0];
    if (prot[ls] === 3) { // a line inside a block comment: reflow a ` * text` line
      const m = /^(\s*\*(?!\/)[ \t]*)(.*)$/.exec(line);
      const r = m && reflow(m[1], m[2].split(/[ \t]+/).filter(Boolean), width);
      if (!r) return keep('inside a block comment');
      broken++;
      out.push(...r);
      return;
    }
    if (lc && line.slice(0, lc.start - ls).trim() === '') { // a whole-line // comment: reflow it
      const m = /^(\s*\/\/+[ \t]*)(.*)$/.exec(line);
      if (!m || COMMENT_KEEP.test(m[2])) return keep('no safe break point');
      const r = reflow(m[1], m[2].split(/[ \t]+/).filter(Boolean), width);
      if (!r) return keep('no safe break point');
      broken++;
      out.push(...r);
      return;
    }
    while (ti < toks.length && toks[ti].end <= ls) ti++;
    const codeEnd = lc ? ls + line.slice(0, lc.start - ls).trimEnd().length : le;
    let move = null;
    if (lc && prot[ls] === 0 && !DIRECTIVE.test(line)) {
      const m = /^(\/\/+[ \t]*)(.*)$/.exec(line.slice(lc.start - ls));
      if (m && !COMMENT_KEEP.test(m[2])) move = reflow(indentStr + m[1], m[2].split(/[ \t]+/).filter(Boolean), width);
    }
    const endPos = move || !lc ? codeEnd : le;
    const ind = indentStr + unit;
    const gaps = lineGaps(F, text, ls, codeEnd, ti);
    const chosen = chooseBreaks(text, ls, endPos, gaps, ind, width);
    if (!chosen) return keep(why());
    broken++;
    out.push(...(move || []), ...pieces(text, ls, endPos, chosen, ind));
  });
  return { ok: true, text: out.join('\n'), broken, left };
}

// ------------------------------------------------------------------------------------------------ the proof
function canonical(text) {
  const sf = parse(text, 'x.js');
  if (sf.parseDiagnostics.length) throw new Error('does not parse');
  const lit = (f, s) => f.createStringLiteral(s, true);
  const result = ts.transform(sf, [(ctx) => {
    const f = ctx.factory;
    const visit = (node) => {
      const n = ts.visitEachChild(node, visit, ctx);
      if (ts.isStringLiteral(n)) return lit(f, n.text);
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === SK.PlusToken && ts.isStringLiteral(n.right)) {
        if (ts.isStringLiteral(n.left)) return lit(f, n.left.text + n.right.text);
        const l = n.left;
        if (ts.isBinaryExpression(l) && l.operatorToken.kind === SK.PlusToken && ts.isStringLiteral(l.right)) {
          return f.createBinaryExpression(l.left, n.operatorToken, lit(f, l.right.text + n.right.text));
        }
      }
      return n;
    };
    return (root) => ts.visitNode(root, visit);
  }]);
  const printed = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed }).printFile(result.transformed[0]);
  // the printer's blanks and line breaks follow the source's lines; the tokens are what is compared
  const again = parse(printed, 'x.js');
  if (again.parseDiagnostics.length) throw new Error('the printed tree does not parse');
  return collectTokens(again).map((t) => printed.slice(t.start, t.end)).join(' ');
}

function proof(before, after) {
  let a;
  let b;
  try {
    a = canonical(before);
  } catch (e) {
    return { ok: false, why: 'before: ' + e.message };
  }
  try {
    b = canonical(after);
  } catch (e) {
    return { ok: false, why: 'after: ' + e.message };
  }
  if (a === b) return { ok: true, why: '' };
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return { ok: false, why: 'the syntax trees differ near: ' + JSON.stringify(a.slice(Math.max(0, i - 40), i + 40)) + ' / ' + JSON.stringify(b.slice(Math.max(0, i - 40), i + 40)) };
}

function main() {
  const req = JSON.parse(fs.readFileSync(0, 'utf8'));
  let res;
  if (req.cmd === 'rewrap') res = rewrap(req.text, req.name, req.width || 200);
  else if (req.cmd === 'proof') res = proof(req.before, req.after);
  else res = { ok: false, error: 'unknown cmd ' + req.cmd };
  process.stdout.write(JSON.stringify(res));
}

main();
