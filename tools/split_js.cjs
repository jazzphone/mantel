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
//   {"cmd": "code", "texts": ["..."]}
//       Each text, a class member as Function.prototype.toString gives it, as codeOf() prints it (no comments, no cast
//       parentheses): the text itself when it will not parse as a member. For tests/test_settings_prototype.py.
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

// The function an IIFE of the file wraps: (function () { ... })(); the first one, or the k-th (0-based: a manifest's "iife")
function iifeOf(sf, k) {
  let seen = 0;
  for (const s of sf.statements) {
    if (!ts.isExpressionStatement(s)) continue;
    const call = stripParens(s.expression);
    if (ts.isCallExpression(call) && isFn(stripParens(call.expression))) {
      if (seen === (k || 0)) return stripParens(call.expression);
      seen++;
    }
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

// a function DECLARED in the IIFE (hk-base.js's `function initialize() { ... }`): its body is the scope; the declaration is its host
function declFn(iife, name) {
  for (const s of iife.body.statements) {
    if (ts.isFunctionDeclaration(s) && s.name && s.name.text === name && s.body) return { stmt: s, fn: s };
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

// A member's code without its comments: the statement printed with no comments, and without the parentheses a JSDoc cast
// (`/** @type {T} */ (x)`) puts round an expression (phase 18, C1). Two members that differ only in comments and casts
// print the same, so a part's annotations are not an edit; any other change to a token is.
const printer = ts.createPrinter({ removeComments: true });
function codeOf(sf, node) {
  const unwrap = (ctx) => (root) => {
    const visit = (n) => (ts.isParenthesizedExpression(n) ? ts.visitNode(n.expression, visit) : ts.visitEachChild(n, visit, ctx));
    return ts.visitNode(root, visit);
  };
  const out = ts.transform(node, [unwrap]);
  try { return printer.printNode(ts.EmitHint.Unspecified, out.transformed[0], sf); } finally { out.dispose(); }
}

function analyze(req) {
  const file = path.resolve(req.file);
  const prog = program([file], req.globals, false);
  const sf = prog.getSourceFile(file);
  const checker = prog.getTypeChecker();
  const text = sf.text;
  const lines = text.split('\n');
  const iife = iifeOf(sf, req.mode === 'part' ? 0 : req.iife);
  if (!iife) throw new Error('no IIFE' + (req.iife ? ' number ' + (req.iife + 1) : '') + ' at the top of ' + req.file);

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
      const run = req.run_in_decl ? declFn(iife, req.run_in) : runFn(iife, req.run_in);
      if (!run) throw new Error('no ' + (req.run_in_decl ? 'function ' + req.run_in + '() {...} declared' : req.run_in + '(function ...) call') + ' in the IIFE of ' + req.file);
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
        text: norm.join('\n'), code: codeOf(sf, s), head: lines[lineOf(sf, start) - 1].trim().slice(0, 120),
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
  const innerFns = new Set(scopes.filter((x) => x.host).map((x) => x.fn === x.host ? x.fn.body : x.fn));
  for (let si = 0; si < scopes.length; si++) {
    scopes[si].list.forEach((s, idx) => visit(s, out.scopes[si].stmts[idx]));
  }
  // a name declared in two scopes (the inner one hides the outer for the code inside it)
  const byName = Object.create(null);
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

function codes(req) {
  return req.texts.map((text) => {
    const sf = ts.createSourceFile('member.js', 'class X {\n' + text + '\n}', ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    const cls = sf.statements[0];
    if (sf.parseDiagnostics.length || !cls || !ts.isClassDeclaration(cls) || cls.members.length !== 1) return text;
    return codeOf(sf, cls.members[0]);
  });
}

// ---------------------------------------------------------------------------------------------------- the state rewrite
// {"cmd": "state", "file": "...", "vars": ["a", ...], "run_in": null, "run_in_decl": false, "iife": 0, "avoid": ["...text"]}
//   Each listed top-level `var` of the scope becomes a property of one object (its name chosen here: never an identifier
//   or property name of the file or of `avoid`), every reference resolved by the checker's symbol. A declaration with a
//   value stays where it was, as an assignment; a `var` of several names becomes one statement per name, in order; a bare
//   `var x;` of a listed name becomes nothing (the object starts with every property undefined, as hoisting left the var).
//   Refuses: a listed name shadowed anywhere (a parameter, a local, a function's own name), or used under typeof or
//   delete, in a `with`, or in a loop header. Answers {text, obj, markers, refusals}.
// {"cmd": "state_back", "original": "...", "rewritten": "...", "obj": "ST", "vars": [...], "markers": {...}, ...}
//   THE PROOF, the rewrite run backwards: each `OBJ.x` becomes `x`, each assignment a declaration became is a `var`
//   again, the bare `var x;` are put back and the object's declaration taken out. Both texts are then normalized the same
//   way (a `var` of several names as one statement per name, `{ x }` as `{ x: x }`) and printed without comments; they
//   must be equal. Answers {equal, a, b} (a, b: the two printed texts when they differ, cut short).
function scopeOf(sf, req) {
  const iife = iifeOf(sf, req.iife);
  if (!iife) throw new Error('no IIFE');
  if (!req.run_in) return iife.body;
  const run = req.run_in_decl ? declFn(iife, req.run_in) : runFn(iife, req.run_in);
  if (!run) throw new Error('no ' + req.run_in);
  return run.fn.body;
}

function allNames(sf) {
  const out = new Set();
  const walk = (n) => { if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) out.add(n.text); ts.forEachChild(n, walk); };
  walk(sf);
  return out;
}

function applyEdits(text, from, to, edits) {
  const mine = edits.filter((e) => e.start >= from && e.end <= to).sort((a, b) => b.start - a.start);
  let s = text.slice(from, to);
  for (const e of mine) s = s.slice(0, e.start - from) + e.text + s.slice(e.end - from);
  return s;
}

function stateRewrite(req) {
  const P = '\u0000HKSTATE\u0000';       // (the object's place in the text until its name is chosen)
  const file = path.resolve(req.file);
  const prog = program([file], req.globals, false);
  const sf = prog.getSourceFile(file);
  const checker = prog.getTypeChecker();
  const text = sf.text;
  const body = scopeOf(sf, req);
  const want = new Set(req.vars);
  const refusals = [];
  const symOf = new Map();               // name -> its symbol (the scope's own var)
  for (const s of body.statements) {
    if (!ts.isVariableStatement(s)) continue;
    if (s.declarationList.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) {
      for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name) && want.has(d.name.text)) refusals.push('`' + d.name.text + '` is a let or const, not a var');
      continue;
    }
    for (const d of s.declarationList.declarations) {
      if (!ts.isIdentifier(d.name)) { bindingNames(d.name, []).forEach((n) => { if (want.has(n)) refusals.push('`' + n + '` is declared by a destructuring pattern'); }); continue; }
      if (want.has(d.name.text)) {
        if (symOf.has(d.name.text)) refusals.push('`' + d.name.text + '` is declared twice');
        symOf.set(d.name.text, checker.getSymbolAtLocation(d.name));
      }
    }
  }
  for (const n of want) if (!symOf.has(n)) refusals.push('`' + n + '` is not a top-level var of the scope');
  const lineOfPos = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const edits = [];
  const declNames = new Set();
  const walk = (n) => {
    if (ts.isIdentifier(n) && want.has(n.text)) {
      const p = n.parent;
      const isPropName = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n) ||
        ((ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p) ||
          ts.isPropertySignature(p) || ts.isMethodSignature(p)) && p.name === n) || ts.isLabeledStatement(p) ||
        ((ts.isBreakStatement(p) || ts.isContinueStatement(p)) && p.label === n) || ts.isJSDoc(p) || ts.isJSDocMemberName(p);
      if (!isPropName) {
        let sym = ts.isShorthandPropertyAssignment(p) && p.name === n ? checker.getShorthandAssignmentValueSymbol(p) : checker.getSymbolAtLocation(n);
        const mine = symOf.get(n.text);
        if (!sym || sym !== mine) {
          refusals.push('`' + n.text + '` at line ' + lineOfPos(n.getStart(sf)) + ' is another name (a parameter, a local or a global of the same name): it shadows the listed var');
        } else if (ts.isVariableDeclaration(p) && p.name === n) {
          declNames.add(n);
        } else {
          let up = p;
          while (up && ts.isParenthesizedExpression(up)) up = up.parent;
          if (ts.isTypeOfExpression(up) || ts.isDeleteExpression(up)) refusals.push('`' + n.text + '` is used under ' + (ts.isTypeOfExpression(up) ? 'typeof' : 'delete') + ' at line ' + lineOfPos(n.getStart(sf)));
          for (let q = n; q && q !== sf; q = q.parent) {
            if (ts.isWithStatement(q)) refusals.push('`' + n.text + '` is used in a `with` at line ' + lineOfPos(n.getStart(sf)));
            const hdr = q.parent && ((ts.isForStatement(q.parent) && (q.parent.initializer === q || q.parent.incrementor === q || q.parent.condition === q)) ||
                        ((ts.isForInStatement(q.parent) || ts.isForOfStatement(q.parent)) && q.parent.initializer === q));
            if (hdr) { refusals.push('`' + n.text + '` is in a loop header at line ' + lineOfPos(n.getStart(sf))); break; }
            if (ts.isFunctionLike(q)) break;
          }
          if (ts.isShorthandPropertyAssignment(p)) edits.push({ start: p.getStart(sf), end: p.end, text: n.text + ': ' + P + '.' + n.text });
          else edits.push({ start: n.getStart(sf), end: n.end, text: P + '.' + n.text });
        }
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  // the object's name: one the file (and the files in `avoid`) never use, as an identifier or a property name
  const used = allNames(sf);
  for (const extra of req.avoid || []) for (const m of extra.match(/[A-Za-z_$][\w$]*/g) || []) used.add(m);
  for (const m of text.match(/[A-Za-z_$][\w$]*/g) || []) used.add(m);     // (comments and strings too: never confusing)
  const obj = ['ST', 'SV', 'SS', 'VS', 'SST', 'STATE', 'shared'].find((c) => !used.has(c)) || ('ST' + Math.floor(Math.random() * 1e6));
  // the declarations
  const markers = {};
  const idx = new Map(body.statements.map((s, i) => [s, i]));
  for (const s of body.statements) {
    if (!ts.isVariableStatement(s) || !s.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && want.has(d.name.text))) continue;
    const parts = [], mark = [];
    for (const d of s.declarationList.declarations) {
      const name = d.name.getText(sf);
      const init = d.initializer ? applyEdits(text, d.initializer.getStart(sf), d.initializer.end, edits) : null;
      if (ts.isIdentifier(d.name) && want.has(name)) {
        if (init !== null) { parts.push(P + '.' + name + ' = ' + init + ';'); mark.push(['assign', name]); }
        else mark.push(['bare', name]);
      } else {
        parts.push('var ' + (init !== null ? name + ' = ' + init : name) + ';');
        mark.push(['keep', name]);
      }
    }
    const start = s.getStart(sf);
    const multi = lineOfPos(start) !== lineOfPos(s.end);
    const indent = ' '.repeat(sf.getLineAndCharacterOfPosition(start).character);
    // the declaration's own trailing text on its line (a comment) stays after it
    let rep = parts.join(multi ? '\n' + indent : ' ');
    if (!parts.length) rep = '// (' + mark.map((m) => m[1]).join(', ') + ': on ' + P + ', tools/split_js.py state)';
    markers[idx.get(s)] = mark;
    for (let i = edits.length - 1; i >= 0; i--) if (edits[i].start >= start && edits[i].end <= s.end) edits.splice(i, 1);
    edits.push({ start, end: s.end, text: rep });
  }
  // the object, first in the scope (after a 'use strict')
  const first = body.statements.find((s) => !(ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression)));
  const at = first ? first.getFullStart() : body.getStart(sf) + 1;
  const ind = first ? ' '.repeat(sf.getLineAndCharacterOfPosition(first.getStart(sf)).character) : '  ';
  const declText = '\n' + ind + '// THE SHARED STATE (tools/split_js.py state): the variables these functions set again and again, as properties of one\n' +
                   ind + '// object, so the code that sets one can live in another file. ' + P + '.x is what was the variable x.\n' +
                   ind + 'var ' + P + ' = /** @type {Record<string, any>} */ ({});';
  edits.push({ start: at, end: at, text: declText });
  let out = text;
  for (const e of edits.sort((a, b) => b.start - a.start || b.end - a.end)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { text: out.split(P).join(obj), obj, markers, count: body.statements.length, refusals: [...new Set(refusals)] };
}

// both texts the same way: one statement per declarator, shorthand properties written out, printed without comments
function normalized(text, name) {
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const tf = (ctx) => (root) => {
    const visit = (n) => {
      if (ts.isShorthandPropertyAssignment(n) && !n.objectAssignmentInitializer) {
        return ts.factory.createPropertyAssignment(ts.factory.createIdentifier(n.name.text), ts.factory.createIdentifier(n.name.text));
      }
      if ((ts.isBlock(n) || ts.isSourceFile(n) || ts.isModuleBlock(n) || ts.isCaseClause(n) || ts.isDefaultClause(n))) {
        const v = ts.visitEachChild(n, visit, ctx);
        const stmts = [];
        for (const s of v.statements) {
          if (ts.isVariableStatement(s) && s.declarationList.declarations.length > 1 && !(s.declarationList.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const))) {
            for (const d of s.declarationList.declarations) stmts.push(ts.factory.createVariableStatement(s.modifiers, ts.factory.createVariableDeclarationList([d], s.declarationList.flags)));
          } else stmts.push(s);
        }
        if (ts.isSourceFile(v)) return ts.factory.updateSourceFile(v, stmts);
        if (ts.isBlock(v)) return ts.factory.updateBlock(v, stmts);
        if (ts.isModuleBlock(v)) return ts.factory.updateModuleBlock(v, stmts);
        if (ts.isCaseClause(v)) return ts.factory.updateCaseClause(v, v.expression, stmts);
        return ts.factory.updateDefaultClause(v, stmts);
      }
      return ts.visitEachChild(n, visit, ctx);
    };
    return ts.visitNode(root, visit);
  };
  const res = ts.transform(sf, [tf]);
  try { return ts.createPrinter({ removeComments: true }).printFile(res.transformed[0]); } finally { res.dispose(); }
}

function stateBack(req) {
  // the rewritten text, backwards, by its own syntax tree
  const sf = ts.createSourceFile('rewritten.js', req.rewritten, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const want = new Set(req.vars), obj = req.obj, text = sf.text;
  const body = scopeOf(sf, req);
  const edits = [];
  const walk = (n) => {
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === obj && want.has(n.name.text)) {
      edits.push({ start: n.getStart(sf), end: n.end, text: n.name.text });
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  // the scope's statements: the object's declaration first, then each original statement (a marked declaration as the
  // statements it became)
  const stmts = body.statements.filter((s) => !(ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression)));
  const objDecl = stmts[0];
  if (!objDecl || !ts.isVariableStatement(objDecl) || objDecl.declarationList.declarations[0].name.getText(sf) !== obj) {
    return { equal: false, a: '', b: 'the object\'s declaration is not the first statement of the scope' };
  }
  edits.push({ start: objDecl.getFullStart(), end: objDecl.end, text: '' });
  const directives = body.statements.length - stmts.length;
  let k = 1;
  const nOrig = req.count;
  for (let i = 0; i < nOrig - directives; i++) {
    const mark = req.markers[String(i + directives)];
    if (!mark) { k++; continue; }
    const emitted = mark.filter((m) => m[0] !== 'bare').length;
    const bare = mark.filter((m) => m[0] === 'bare').map((m) => 'var ' + m[1] + ';').join(' ');
    if (!emitted) {
      // the bare ones became a comment-only line: put them back before the next statement
      const next = stmts[k];
      const at = next ? next.getFullStart() : body.end - 1;
      edits.push({ start: at, end: at, text: '\n' + bare + '\n' });
      continue;
    }
    for (let j = 0; j < emitted; j++) {
      const s = stmts[k++];
      const m = mark.filter((x) => x[0] !== 'bare')[j];
      if (m[0] === 'assign') {
        // `OBJ.x = e;` -> `var x = e;`: the property access is already turned back by the edit above; add the `var`
        edits.push({ start: s.getStart(sf), end: s.getStart(sf), text: 'var ' });
      }
    }
    if (bare) edits.push({ start: stmts[k - 1].end, end: stmts[k - 1].end, text: ' ' + bare });
  }
  let back = text;
  for (const e of edits.sort((a, b) => b.start - a.start || b.end - a.end)) back = back.slice(0, e.start) + e.text + back.slice(e.end);
  const a = normalized(req.original, 'a.js'), b = normalized(back, 'b.js');
  if (a === b) return { equal: true };
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return { equal: false, a: a.slice(Math.max(0, i - 200), i + 300), b: b.slice(Math.max(0, i - 200), i + 300) };
}

// {"cmd": "lib_globals", "names": [...], "globals": [...]}: which names a file that declares nothing still finds (the
// browser's own globals and the declaration files'): a part that takes one of them from the kit shadows it, as the shell's
// own declaration did, so tsc does not report it missing (`CSS`, `Image`, `name`, ...)
function libGlobals(req) {
  const file = path.join(require('os').tmpdir(), 'split_js-empty-' + process.pid + '.js');
  fs.writeFileSync(file, '');
  try {
    const prog = program([file], req.globals, false);
    const sf = prog.getSourceFile(file);
    const checker = prog.getTypeChecker();
    const found = new Set(checker.getSymbolsInScope(sf, ts.SymbolFlags.Value).map((s) => s.name));
    // (and what the global object inherits from Object.prototype: valueOf, toString, ...)
    for (const n of Object.getOwnPropertyNames(Object.prototype)) found.add(n);
    const resolves = (n) => found.has(n);
    return { names: req.names.filter(resolves) };
  } finally { fs.unlinkSync(file); }
}

let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  try {
    const req = JSON.parse(input);
    const out = req.cmd === 'analyze' ? analyze(req) : req.cmd === 'diagnostics' ? diagnostics(req)
      : req.cmd === 'code' ? { codes: codes(req) } : req.cmd === 'state' ? stateRewrite(req)
      : req.cmd === 'state_back' ? stateBack(req) : req.cmd === 'lib_globals' ? libGlobals(req) : null;
    if (!out) throw new Error('unknown command ' + req.cmd);
    process.stdout.write(JSON.stringify(out));
  } catch (err) {
    process.stderr.write(String(err && err.stack || err) + '\n');
    process.exit(2);
  }
});
