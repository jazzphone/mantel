'use strict';
// The TypeScript half of tools/state_owners.py (phase 25, A1): every use of a state object's property (`ST.x`) in each
// file, parsed with the compiler API so a string, a comment or a template never counts. Called with a JSON request on
// stdin ({"files": [...], "object": "ST"}); answers on stdout with one entry per use:
//   {"file", "name", "kind": "write" | "read" | "mutate", "line", "fn", "top"}
// write: `ST.x = v`, `ST.x += v`, `ST.x++`, `delete ST.x`, or ST.x as a destructuring target. mutate: a write into what
// ST.x holds (`ST.x.y = v`, `ST.x[i] = v`, `ST.x.y++`). read: anything else. fn: the nearest named function around it
// ('' at a file's top level: it runs as the file runs); top: no function around it at all but the file's own wrappers.
// A computed use (`ST[k]`) is a name of "[]": the map says so, since a tool cannot say which property it is.
//
// TypeScript is the pinned copy in tools/typecheck/node_modules (phase 18, decision 7).

const fs = require('fs');
const path = require('path');
const ts = require(path.join(__dirname, 'typecheck/node_modules/typescript'));

const ASSIGN = new Set([
  ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken, ts.SyntaxKind.SlashEqualsToken, ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken, ts.SyntaxKind.BarEqualsToken, ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken, ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken, ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

function skipParens(node) {
  let n = node;
  while (n.parent && (ts.isParenthesizedExpression(n.parent) || ts.isNonNullExpression(n.parent)
         || ts.isAsExpression(n.parent) || ts.isTypeAssertionExpression(n.parent))) n = n.parent;
  return n;
}

// is `node` (an expression) written to: the left of an assignment, an update's operand, delete's, or inside a
// destructuring pattern that is
function isTarget(node) {
  const n = skipParens(node);
  const p = n.parent;
  if (!p) return false;
  if (ts.isBinaryExpression(p) && ASSIGN.has(p.operatorToken.kind) && p.left === n) return true;
  if ((ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p))
      && (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)) return true;
  if (ts.isDeleteExpression(p)) return true;
  if (ts.isArrayLiteralExpression(p) || ts.isSpreadElement(p) || ts.isShorthandPropertyAssignment(p)) return isTarget(p);
  if (ts.isPropertyAssignment(p) && p.initializer === n) return isTarget(p.parent);
  if (ts.isObjectLiteralExpression(p)) return isTarget(p);
  if ((ts.isForInStatement(p) || ts.isForOfStatement(p)) && p.initializer === n) return true;
  return false;
}

function fnName(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) return { name: n.name ? n.name.getText() : '', any: true };
    if (ts.isFunctionExpression(n) || ts.isArrowFunction(n)) {
      if (isWrapper(n)) return { name: '', any: false };      // the file's own wrapper is its top level
      if (n.name) return { name: n.name.getText(), any: true };
      const p = n.parent;
      if (p && ts.isVariableDeclaration(p)) return { name: p.name.getText(), any: true };
      if (p && ts.isPropertyAssignment(p)) return { name: p.name.getText(), any: true };
      if (p && ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        return { name: p.left.getText(), any: true };
      }
      // an anonymous function (a callback): the named one around it, but never the file's top level
      return { name: fnName(n).name, any: true };
    }
  }
  return { name: '', any: false };
}

// the file's own wrappers: `(function () { ... })()` and a part's `window.hkSaverParts[...] = function (K) { ... }`
function isWrapper(fn) {
  const p = skipParens(fn).parent;
  if (p && ts.isCallExpression(p) && skipParens(p.expression) === skipParens(fn)) return true;
  if (p && ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.right === fn
      && ts.isElementAccessExpression(p.left)) return true;
  return false;
}

function scan(file, object) {
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const out = [];
  function visit(node) {
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
        && ts.isIdentifier(node.expression) && node.expression.text === object) {
      const name = ts.isPropertyAccessExpression(node) ? node.name.text
        : (ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : '[]');
      let kind = isTarget(node) ? 'write' : 'read';
      if (kind === 'read') {
        // ST.x.y = v / ST.x[i] = v / ST.x.y++: a write into what ST.x holds
        let outer = skipParens(node).parent;
        let inner = skipParens(node);
        while (outer && (ts.isPropertyAccessExpression(outer) || ts.isElementAccessExpression(outer))
               && outer.expression === inner) {
          if (isTarget(outer)) { kind = 'mutate'; break; }
          inner = skipParens(outer);
          outer = inner.parent;
        }
      }
      const f = fnName(node);
      const top = !f.any;
      out.push({ file, name, kind, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
                 fn: top ? '' : f.name, top });
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return out;
}

const req = JSON.parse(fs.readFileSync(0, 'utf8'));
const uses = [];
for (const f of req.files) uses.push(...scan(f, req.object || 'ST'));
process.stdout.write(JSON.stringify(uses));
