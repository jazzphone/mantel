'use strict';
// The TypeScript half of tools/split_js.py (phase 18, Part B): it parses with the compiler API, so a string, a regular
// expression or a template can never fool a brace match, and it answers in JSON on stdout. Called by split_js.py with a
// JSON request on stdin; not meant to be run by hand.
//
//   {"cmd": "analyze", "file": "...", "mode": "shell" | "part", "run_in": "whenBase" | null, "globals": ["...d.ts"],
//    "class_name": "HkSettingsPanel" | null, "class_expr": true | false, "kit_name": "K"}
//       The statements of each scope (the IIFE's body, the body of the function that runs in it, or a part's function),
//       each with its lines, the names it declares, what it refers to in the other statements of its scope or the
//       scope's parameters, and what it assigns to. Names are resolved by the checker (symbols), never by text.
//       CLASS-METHOD MODE: `class_name` (a shell) names a class declaration of the IIFE, `class_expr` (a part) says its
//       methods are in a `var X = class { ... }`; either adds a scope called "class" whose statements are the class's
//       members (kind "method"; `method` the name, `msub` method/get/set/constructor), each with the same facts, plus
//       `usesSuper`, `isStatic`, `computed`, `priv` and `thisProps` (the names read off `this`).
//   {"cmd": "diagnostics", "files": ["..."], "globals": ["...d.ts"]}
//       tsc's view of each file with checkJs on: its syntax errors, the names it cannot find (TS2304 and TS2552: for
//       a part, exactly the kit it needs), and the number of errors in all.
//
// TypeScript is the pinned copy in tools/typecheck/node_modules (decision 7), found beside this file.

const fs = require('fs');
const path = require('path');
const ts = require(path.join(__dirname, 'typecheck/node_modules/typescript'));

const UNRESOLVED = new Set([2304, 2552]);

function options(checkJs) {
  return {
    allowJs: true, checkJs, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    skipLibCheck: true, types: [],
  };
}

function program(files, globals, checkJs) {
  return ts.createProgram([...files, ...(globals || [])], options(checkJs));
}

// ---------------------------------------------------------------------------------------------------- scopes
function stripParens(e) {
  while (e && ts.isParenthesizedExpression(e)) e = e.expression;
  return e;
}

function isFn(e) {
  return !!e && (ts.isFunctionExpression(e) || ts.isArrowFunction(e));
}

// The function the file's one IIFE wraps: (function () { ... })();
function iifeOf(sf) {
  for (const s of sf.statements) {
    if (!ts.isExpressionStatement(s)) continue;
    const call = stripParens(s.expression);
    if (ts.isCallExpression(call) && isFn(stripParens(call.expression))) return stripParens(call.expression);
  }
  return null;
}

// A part: (window.x = window.x || {})['name'] = function (K) { ... };  inside its IIFE
function partFn(iife) {
  for (const s of iife.body.statements) {
    if (!ts.isExpressionStatement(s)) continue;
    const e = s.expression;
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken && isFn(stripParens(e.right))) {
      return stripParens(e.right);
    }
  }
  return null;
}

function runFn(iife, name) {
  for (const s of iife.body.statements) {
    if (!ts.isExpressionStatement(s) || !ts.isCallExpression(s.expression)) continue;
    const c = s.expression;
    if (ts.isIdentifier(c.expression) && c.expression.text === name) {
      const fn = c.arguments.find(isFn);
      if (fn) return { stmt: s, fn };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------- facts
function bindingNames(name, out) {
  if (ts.isIdentifier(name)) out.push(name.text);
  else for (const el of name.elements) if (!ts.isOmittedExpression(el)) bindingNames(el.name, out);
  return out;
}

function declaredNames(s) {
  if (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) return s.name ? [s.name.text] : [];
  if (ts.isVariableStatement(s)) {
    const out = [];
    for (const d of s.declarationList.declarations) bindingNames(d.name, out);
    return out;
  }
  return [];
}

// for a var statement: has it any initializer; is it only `x = K.x` (a part's takes); is it only names (a shell's take-backs)
function varFacts(s, kit) {
  if (!ts.isVariableStatement(s)) return { init: false, bare: false, takes: false };
  const ds = s.declarationList.declarations;
  return {
    init: ds.some((d) => d.initializer),
    bare: ds.every((d) => !d.initializer),
    takes: ds.every((d) => d.initializer && ts.isPropertyAccessExpression(d.initializer) &&
                           ts.isIdentifier(d.initializer.expression) && d.initializer.expression.text === kit),
  };
}

// what a class member is: its name, whether it is a getter or setter, and the things that stop a move (`super`,
// `static`, a #private or computed name) and the names it reads off `this`
function memberFacts(s, sf) {
  const isMember = ts.isMethodDeclaration(s) || ts.isGetAccessor(s) || ts.isSetAccessor(s) || ts.isConstructorDeclaration(s) ||
                   ts.isPropertyDeclaration(s) || ts.isClassStaticBlockDeclaration(s);
  if (!isMember) return {};
  const nm = s.name;
  const computed = !!nm && ts.isComputedPropertyName(nm);
  const priv = !!nm && ts.isPrivateIdentifier(nm);
  const method = ts.isConstructorDeclaration(s) ? 'constructor' : nm && (ts.isIdentifier(nm) || ts.isStringLiteral(nm)) ? nm.text : null;
  const msub = ts.isConstructorDeclaration(s) ? 'constructor' : ts.isGetAccessor(s) ? 'get' : ts.isSetAccessor(s) ? 'set' :
               ts.isMethodDeclaration(s) ? 'method' : 'other';
  let usesSuper = false;
  const thisProps = new Set();
  const walk = (n) => {
    if (n.kind === ts.SyntaxKind.SuperKeyword) usesSuper = true;
    if (ts.isPropertyAccessExpression(n) && n.expression.kind === ts.SyntaxKind.ThisKeyword) thisProps.add(n.name.text);
    ts.forEachChild(n, walk);
  };
  walk(s);
  const isStatic = !!(s.modifiers && s.modifiers.some((m) => m.kind === ts.SyntaxKind.StaticKeyword));
  return { method, msub, usesSuper, isStatic, computed, priv, thisProps: [...thisProps] };
}

function kindOf(s) {
  if (ts.isMethodDeclaration(s) || ts.isGetAccessor(s) || ts.isSetAccessor(s) || ts.isConstructorDeclaration(s)) return 'method';
  if (ts.isFunctionDeclaration(s)) return 'function';
  if (ts.isClassDeclaration(s)) return 'class';
  if (ts.isVariableStatement(s)) return 'var';
  if (ts.isExpressionStatement(s)) return ts.isStringLiteral(s.expression) ? 'directive' : 'expr';
  return 'other';
}

function isWrite(id) {
  let n = id, p = n.parent;
  while (p && (ts.isArrayLiteralExpression(p) || ts.isObjectLiteralExpression(p) || ts.isSpreadElement(p) ||
               ts.isParenthesizedExpression(p) || ts.isShorthandPropertyAssignment(p) ||
               (ts.isPropertyAssignment(p) && p.initializer === n))) {
    n = p; p = n.parent;
  }
  if (!p) return false;
  if (ts.isBinaryExpression(p) && p.left === n) {
    const k = p.operatorToken.kind;
    return k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment;
  }
  if ((ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) && p.operand === n) {
    return p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken;
  }
  if ((ts.isForInStatement(p) || ts.isForOfStatement(p)) && p.initializer === n) return true;
  return false;
}

// lines (1-based) that begin inside a token spanning lines: a template, a string continued with a backslash
function protectedLines(sf, node, out) {
  const walk = (n) => {
    const k = n.kind;
    if (k === ts.SyntaxKind.NoSubstitutionTemplateLiteral || k === ts.SyntaxKind.TemplateHead ||
        k === ts.SyntaxKind.TemplateMiddle || k === ts.SyntaxKind.TemplateTail || k === ts.SyntaxKind.StringLiteral ||
        k === ts.SyntaxKind.RegularExpressionLiteral) {
      const a = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
      const b = sf.getLineAndCharacterOfPosition(n.end).line + 1;
      for (let l = a + 1; l <= b; l++) out.add(l);
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
}

// is the identifier inside a function (or method) of its statement, so read when that is called, not when it is evaluated
function deferred(node, stmt) {
  for (let n = node; n; n = n.parent) {
    if (ts.isFunctionLike(n) && !ts.isFunctionTypeNode(n)) return true;
    if (n === stmt) break;
  }
  return false;
}

function lineOf(sf, pos) {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

function analyze(req) {
  const file = path.resolve(req.file);
  const prog = program([file], req.globals, false);
  const sf = prog.getSourceFile(file);
  const checker = prog.getTypeChecker();
  const text = sf.text;
  const lines = text.split('\n');
  const iife = iifeOf(sf);
  if (!iife) throw new Error('no IIFE at the top of ' + req.file);

  const scopes = [];   // {name, fn, body, list, host}: `list` the nodes that are the scope's members
  const classMembers = new Set();
  const pushClass = (cls) => {
    scopes.push({ name: 'class', fn: null, body: cls, list: cls.members });
    cls.members.forEach((m) => classMembers.add(m));
  };
  if (req.mode === 'part') {
    const fn = partFn(iife);
    if (!fn) throw new Error('no part function in ' + req.file);
    scopes.push({ name: 'part', fn, body: fn.body, list: fn.body.statements });
    if (req.class_expr) {
      for (const s of fn.body.statements) {
        if (!ts.isVariableStatement(s)) continue;
        const d = s.declarationList.declarations[0];
        if (d && d.initializer && ts.isClassExpression(stripParens(d.initializer))) { pushClass(stripParens(d.initializer)); break; }
      }
    }
  } else {
    scopes.push({ name: 'iife', fn: iife, body: iife.body, list: iife.body.statements });
    if (req.run_in) {
      const run = runFn(iife, req.run_in);
      if (!run) throw new Error('no ' + req.run_in + '(function ...) call in the IIFE of ' + req.file);
      scopes.push({ name: 'run', fn: run.fn, body: run.fn.body, list: run.fn.body.statements, host: run.stmt });
    }
    // the function the shell hands to its loader: loadParts(function () { ... }); the statements that wait for the parts
    if (req.cont_call) {
      const home = scopes[scopes.length - 1];
      for (const s of home.body.statements) {
        if (ts.isExpressionStatement(s) && ts.isCallExpression(s.expression) && ts.isIdentifier(s.expression.expression) &&
            s.expression.expression.text === req.cont_call) {
          const fn = s.expression.arguments.find(isFn);
          if (fn) { scopes.push({ name: 'cont', fn, body: fn.body, list: fn.body.statements, host: s }); break; }
        }
      }
    }
    if (req.class_name) {
      const cls = scopes.filter((x) => x.name === 'iife' || x.name === 'run').pop().list.find((s) => ts.isClassDeclaration(s) && s.name && s.name.text === req.class_name);
      if (!cls) throw new Error('no class ' + req.class_name + ' in ' + req.file);
      pushClass(cls);
    }
  }

  // which scope-level member (scope index, statement index) a declaration node belongs to
  const bodyOf = new Map(scopes.map((s, i) => [s.body, i]));
  const memberOfNode = (node) => {
    let n = node;
    while (n && n.parent) {
      if (bodyOf.has(n.parent)) {
        const si = bodyOf.get(n.parent);
        return { scope: si, index: scopes[si].list.indexOf(n), direct: n };
      }
      n = n.parent;
    }
    return null;
  };
  // a parameter of a scope's function is that scope's own name (the C of whenBase(function (C) {...}))
  const paramScope = (decl) => {
    for (let i = 0; i < scopes.length; i++) if (scopes[i].fn && decl.parent === scopes[i].fn) return i;
    return -1;
  };

  const out = { scopes: [], indents: {} };
  for (let si = 0; si < scopes.length; si++) {
    const sc = scopes[si];
    const stmts = [];
    for (let idx = 0; idx < sc.list.length; idx++) {
      const s = sc.list[idx];
      const start = s.getStart(sf);
      const comments = ts.getLeadingCommentRanges(text, s.pos) || [];
      const first = comments.length ? comments[0].pos : start;
      const firstLine = lineOf(sf, first), lastLine = lineOf(sf, s.end);
      const firstText = lines[firstLine - 1], lastText = lines[lastLine - 1];
      const before = firstText.slice(0, sf.getLineAndCharacterOfPosition(first).character);
      const afterCol = sf.getLineAndCharacterOfPosition(s.end).character;
      const after = lastText.slice(afterCol);
      // what else shares the statement's lines: nothing but a trailing comment
      let shared = null;
      if (before.trim() !== '') shared = 'code before it on its first line';
      else if (after.trim() !== '' && !/^\s*(\/\/.*|\/\*.*\*\/\s*)$/.test(after)) shared = 'code after it on its last line';
      const prot = new Set();
      protectedLines(sf, s, prot);
      const norm = [];
      for (let l = firstLine; l <= lastLine; l++) {
        const raw = lines[l - 1].replace(/\r$/, '');
        norm.push(prot.has(l) ? raw : raw.replace(/^[ \t]+/, ''));
      }
      stmts.push({
        scope: si, index: idx, kind: kindOf(s), names: declaredNames(s), first: firstLine, last: lastLine, shared,
        protected: [...prot].filter((l) => l >= firstLine && l <= lastLine),
        indent: firstText.length - firstText.trimStart().length,
        text: norm.join('\n'), head: lines[lineOf(sf, start) - 1].trim().slice(0, 120),
        refs: [], writes: [], ...varFacts(s, req.kit_name || 'K'), ...memberFacts(s, sf),
      });
    }
    out.scopes.push({
      name: sc.name, open: lineOf(sf, sc.body.getStart(sf)), close: lineOf(sf, sc.body.end),
      params: sc.fn ? sc.fn.parameters.map((p) => p.name.getText(sf)) : [], stmts,
      host: sc.host ? { first: lineOf(sf, sc.host.getStart(sf)), last: lineOf(sf, sc.host.end) } : null,
    });
  }

  // references and writes, by symbol
  const seen = new Set();
  const visit = (node, from) => {
    if (ts.isIdentifier(node)) {
      let sym = null;
      const p = node.parent;
      if (p && ts.isShorthandPropertyAssignment(p) && p.name === node) sym = checker.getShorthandAssignmentValueSymbol(p);
      else sym = checker.getSymbolAtLocation(node);
      if (sym && sym.declarations && sym.declarations.length) {
        const d = sym.declarations[0];
        const isBinding = ts.isFunctionDeclaration(d) || ts.isClassDeclaration(d) || ts.isVariableDeclaration(d) ||
                          ts.isParameter(d);
        if (isBinding) {
          let target = null;
          if (ts.isParameter(d)) {
            const pi = paramScope(d);
            if (pi >= 0) target = { param: node.text, scope: pi };
          } else {
            const m = memberOfNode(d);
            if (m && m.direct) {
              const decl = declaredNames(m.direct);
              if (decl.includes(node.text)) target = { name: node.text, scope: m.scope, index: m.index };
              else if (ts.isVariableDeclaration(d)) {
                target = { name: node.text, scope: m.scope, index: m.index, hoisted: true };
              }
            }
          }
          if (target && !(target.index === from.index && target.scope === from.scope)) {
            const key = JSON.stringify(['r', from.scope, from.index, target]);
            const now = !deferred(node, scopes[from.scope].list[from.index]);
            if (!seen.has(key)) { seen.add(key); target.now = now; from.refs.push(target); }
            else if (now) from.refs.find((r) => JSON.stringify([r.name, r.param, r.scope, r.index, r.hoisted]) ===
              JSON.stringify([target.name, target.param, target.scope, target.index, target.hoisted])).now = true;
          }
          if (target) {
            const reassigned = isWrite(node) || (ts.isVariableDeclaration(d) &&
              sym.declarations.filter((x) => ts.isVariableDeclaration(x) && x.initializer).length > 1 &&
              sym.declarations.slice(1).includes(node.parent));
            if (reassigned) {
              const key = JSON.stringify(['w', from.scope, from.index, target]);
              if (!seen.has(key)) { seen.add(key); from.writes.push(target); }
            }
          }
        }
      }
    }
    // the function a host statement hands on is another scope: its statements are visited as members of their own
    ts.forEachChild(node, (c) => { if (!innerFns.has(c) && !classMembers.has(c)) visit(c, from); });
  };
  const innerFns = new Set(scopes.filter((x) => x.host).map((x) => x.fn));
  for (let si = 0; si < scopes.length; si++) {
    scopes[si].list.forEach((s, idx) => visit(s, out.scopes[si].stmts[idx]));
  }
  // a name declared in two scopes (the inner one hides the outer for the code inside it)
  const byName = {};
  out.scopes.forEach((sc) => sc.stmts.forEach((st) => st.names.forEach((n) => { (byName[n] = byName[n] || []).push([st.scope, st.index]); })));
  out.duplicates = Object.entries(byName).filter(([, v]) => v.length > 1).map(([n, v]) => ({ name: n, at: v }));
  out.lineCount = lines.length;
  return out;
}

function diagnostics(req) {
  const files = req.files.map((f) => path.resolve(f));
  const prog = program(files, req.globals, true);
  const res = {};
  for (const f of files) {
    const sf = prog.getSourceFile(f);
    const syntax = prog.getSyntacticDiagnostics(sf).map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
    const sem = prog.getSemanticDiagnostics(sf);
    const unresolved = [];
    for (const d of sem) {
      if (!UNRESOLVED.has(d.code)) continue;
      const m = /'([^']+)'/.exec(ts.flattenDiagnosticMessageText(d.messageText, ' '));
      if (m) unresolved.push({ name: m[1], line: lineOf(sf, d.start) });
    }
    res[f] = { syntax, unresolved, total: sem.length, optedIn: false };
  }
  return res;
}

let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  try {
    const req = JSON.parse(input);
    const out = req.cmd === 'analyze' ? analyze(req) : req.cmd === 'diagnostics' ? diagnostics(req) : null;
    if (!out) throw new Error('unknown command ' + req.cmd);
    process.stdout.write(JSON.stringify(out));
  } catch (err) {
    process.stderr.write(String(err && err.stack || err) + '\n');
    process.exit(2);
  }
});
