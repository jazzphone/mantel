'use strict';
// THE EXPORTS OBJECTS' RULE (phase 25, the screensaver): a part may call a later part only through that part's exports
// object (`Run.schedule()`, made empty by the shell's kit and filled by the part as it runs), and only WHEN CALLED,
// never as the parts run: then the object is still empty. tools/split_js.py --check asks this of each part:
//   {"files": [...], "exports": ["Run", ...]}  ->  {"bad": ["file:line: ..."]}
// A statement of the part's own function that runs at once (not a declaration of a function), and every function of
// the same part it calls by name, transitively, must not read `X.name` for an exports object X, but for the part's own
// filling of its object (`X.name = value`). (bind_ahead's check, which this replaces, looked the same way.)
const fs = require('fs');
const path = require('path');
const ts = require(path.join(__dirname, 'typecheck/node_modules/typescript'));
const req = JSON.parse(fs.readFileSync(0, 'utf8'));
const EXPORTS = new Set(req.exports);
const bad = [];

function partBody(sf) {
  let body = null;
  (function find(n) {
    if (body) return;
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isElementAccessExpression(n.left)
        && ts.isFunctionExpression(n.right)) { body = n.right.body; return; }
    ts.forEachChild(n, find);
  })(sf);
  return body;
}

function reads(node, own) {
  // the X.name reads in node, not inside a nested function's own body only when `deep` is false
  const out = [];
  (function walk(n) {
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && EXPORTS.has(n.expression.text)) {
      const p = n.parent;
      const filling = p && ts.isBinaryExpression(p) && p.left === n && p.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && n.expression.text === own;
      if (!filling) out.push(n);
    }
    ts.forEachChild(n, walk);
  })(node);
  return out;
}

function calls(node) {
  const out = new Set();
  (function walk(n) {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) out.add(n.expression.text);
    // a function made here but not called here does not run now
    if (n !== node && (ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isFunctionDeclaration(n))) return;
    ts.forEachChild(n, walk);
  })(node);
  return out;
}

function runsNow(node) {
  // the parts of a statement that run at once: everything but the bodies of the functions it makes
  const out = [];
  (function walk(n) {
    if (n !== node && (ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isFunctionDeclaration(n))) return;
    out.push(n);
    ts.forEachChild(n, walk);
  })(node);
  return out;
}

for (const file of req.files) {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const body = partBody(sf);
  if (!body) continue;
  // the part's own exports object: the one it fills (`var X = K.X; X.a = a;`)
  let own = null;
  const fns = new Map();
  for (const st of body.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) fns.set(st.name.text, st);
    if (ts.isExpressionStatement(st) && ts.isBinaryExpression(st.expression) && ts.isPropertyAccessExpression(st.expression.left)
        && ts.isIdentifier(st.expression.left.expression) && EXPORTS.has(st.expression.left.expression.text)) {
      own = st.expression.left.expression.text;
    }
  }
  const line = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  for (const st of body.statements) {
    if (ts.isFunctionDeclaration(st)) continue;
    const now = runsNow(st);
    for (const n of now) {
      if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && EXPORTS.has(n.expression.text)) {
        const p = n.parent;
        const filling = p && ts.isBinaryExpression(p) && p.left === n && n.expression.text === own;
        if (!filling) bad.push(`${path.basename(file)}:${line(n)}: reads ${n.getText()} as the parts run (it is still empty)`);
      }
    }
    // the functions of this part it calls now, and those they call
    const seen = new Set(), todo = [...calls(st)];
    while (todo.length) {
      const name = todo.pop();
      if (seen.has(name) || !fns.has(name)) continue;
      seen.add(name);
      const fn = fns.get(name);
      for (const r of reads(fn.body, null)) {
        bad.push(`${path.basename(file)}:${line(r)}: ${name}() reads ${r.getText()}, and runs as the parts run (line ${line(st)})`);
      }
      for (const c of calls(fn.body)) todo.push(c);
    }
  }
}
process.stdout.write(JSON.stringify({ bad }));
