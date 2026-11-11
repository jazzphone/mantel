// (Kept for the record: run on the rejoined hk-saver.js with saver_state_vars.txt and saver_rename_map.json, 2026-11-11.)
// TS=tools/typecheck/node_modules/typescript node shadows.cjs FILE '["on",...]' [MAP OUT]
// List (or rename) the locals that shadow given top-level vars of a file's IIFE, and prove a rename resolves every
// identifier to the same declaration it did. node shadows.cjs FILE NAMES(json) [MAP(json) OUT]
const ts = require(process.env.TS);
const fs = require('fs'), path = require('path');
const [file, namesJson, mapJson, out] = process.argv.slice(2);
const names = new Set(JSON.parse(namesJson));
function prog(f, text) {
  const host = ts.createCompilerHost({ allowJs: true, checkJs: true, noEmit: true });
  const orig = host.getSourceFile;
  host.getSourceFile = (n, l) => (path.resolve(n) === path.resolve(f) && text !== undefined) ? ts.createSourceFile(n, text, l, true) : orig(n, l);
  const p = ts.createProgram([f], { allowJs: true, checkJs: true, noEmit: true, noLib: true }, host);
  return { p, sf: p.getSourceFile(f), ck: p.getTypeChecker() };
}
function iifeBody(sf) {
  for (const s of sf.statements) {
    if (ts.isExpressionStatement(s)) {
      let e = s.expression; if (ts.isCallExpression(e)) e = e.expression; while (ts.isParenthesizedExpression(e)) e = e.expression;
      if (ts.isFunctionExpression(e)) return e.body;
    }
  }
}
function scan(text) {
  const { sf, ck } = prog(file, text);
  const body = iifeBody(sf);
  const top = new Map();
  for (const s of body.statements) if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) top.set(d.name.text, ck.getSymbolAtLocation(d.name));
  const ids = [];   // every identifier: [pos, text, declPos or -1]
  const decls = new Map();  // shadowing symbol -> {name, line, fn}
  const walk = (n) => {
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      const prop = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n) ||
        ((ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p)) && p.name === n);
      if (!prop) {
        const sym = ts.isShorthandPropertyAssignment(p) && p.name === n ? ck.getShorthandAssignmentValueSymbol(p) : ck.getSymbolAtLocation(n);
        const d = sym && sym.declarations && sym.declarations[0];
        ids.push([n.getStart(sf), n.text, d ? d.getStart(sf) : -1, ts.isShorthandPropertyAssignment(p) && p.name === n]);
        if (names.has(n.text) && sym && sym !== top.get(n.text) && d && d.getSourceFile() === sf) {
          if (!decls.has(sym)) {
            let fn = d; while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
            let fname = fn && fn.name ? fn.name.text : '(anon)';
            if (fn && !fn.name && fn.parent && ts.isVariableDeclaration(fn.parent)) fname = fn.parent.name.text;
            if (fn && !fn.name && fn.parent && ts.isPropertyAssignment(fn.parent)) fname = fn.parent.name.getText(sf);
            decls.set(sym, { name: n.text, line: sf.getLineAndCharacterOfPosition(d.getStart(sf)).line + 1, fn: fname, kind: ts.SyntaxKind[d.kind], uses: [] });
          }
          decls.get(sym).uses.push(n.getStart(sf));
        }
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return { sf, ids, decls };
}
const text = fs.readFileSync(file, 'utf8');
const a = scan(text);
if (!mapJson) {
  for (const [, d] of a.decls) console.log(JSON.stringify({ name: d.name, line: d.line, fn: d.fn, kind: d.kind, uses: d.uses.length }));
  process.exit(0);
}
// RENAME: map is {"name@line": "newName"}; every use of that declaration's symbol gets the new name
const map = JSON.parse(fs.readFileSync(mapJson, 'utf8'));
const all = new Set(text.match(/[A-Za-z_$][\w$]*/g));
const edits = [];
for (const [, d] of a.decls) {
  const k = d.name + '@' + d.line;
  if (!map[k]) { console.error('no new name for ' + k + ' (in ' + d.fn + ')'); process.exit(2); }
  if (all.has(map[k])) { console.error(map[k] + ' is already used in the file'); process.exit(2); }
  for (const pos of d.uses) edits.push([pos, d.name, map[k]]);
}
edits.sort((x, y) => y[0] - x[0]);
let t = text;
const shorthand = new Set(a.ids.filter((i) => i[3]).map((i) => i[0]));
for (const [pos, old, nw] of edits) {
  if (t.slice(pos, pos + old.length) !== old) { console.error('not at ' + pos); process.exit(2); }
  t = t.slice(0, pos) + (shorthand.has(pos) ? old + ': ' + nw : nw) + t.slice(pos + old.length);
}
// THE PROOF: every identifier of the original, in order, resolves to the declaration it did (positions mapped through
// the edits), and is spelled as before unless it is one of the renamed declaration's uses
const b = scan(t);
const shift = (pos) => { let s = 0; for (const [p, old, nw] of edits) if (p < pos) s += (shorthand.has(p) ? old.length + 2 + nw.length : nw.length) - old.length; return pos + s; };
const renamed = new Map(edits.map((e) => [e[0], e[2]]));
const bi = b.ids.filter((i) => !(i[3] === false && false));
const bmap = new Map(b.ids.map((i) => [i[0], i]));
let bad = 0;
for (const [pos, txt, decl, sh] of a.ids) {
  const np = shift(pos) + (sh && renamed.has(pos) ? txt.length + 2 : 0);
  const got = bmap.get(np);
  const want = renamed.get(pos) || txt;
  const wantDecl = decl < 0 ? -1 : shift(decl);
  if (!got || got[1] !== want || got[2] !== wantDecl) { if (bad++ < 10) console.error('differs at ' + pos + ' ' + txt + ' -> ' + JSON.stringify(got) + ' want ' + want + '@' + wantDecl); }
}
if (b.decls.size) { console.error('still shadowing: ' + [...b.decls.values()].map((d) => d.name + '@' + d.line).join(', ')); bad++; }
if (b.ids.length !== a.ids.length + [...shorthand].filter((p) => renamed.has(p)).length) { console.error('identifier count ' + a.ids.length + ' -> ' + b.ids.length); bad++; }
if (bad) process.exit(1);
fs.writeFileSync(out, t);
console.log('renamed ' + a.decls.size + ' locals, ' + edits.length + ' uses; every identifier resolves as before');
