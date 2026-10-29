// parse_check.mjs ROOT -- every .js file under ROOT parses, as a module when it uses module syntax, else as a
// classic script (tests/test_minify.py: the minified build). Prints {"checked": n, "modules": m, "moduleFiles": [...], "failed": [...]}.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const root = process.argv[2];
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p); else if (n.endsWith('.js')) files.push(p);
  }
})(root);
const failed = [], moduleFiles = [];
let modules = 0;
for (const f of files) {
  const code = readFileSync(f, 'utf8');
  try {
    new vm.Script(code, { filename: f });
  } catch (e) {
    // import/export or a top-level await: a module. vm.SourceTextModule needs --experimental-vm-modules.
    try { new vm.SourceTextModule(code, { identifier: f }); modules++; moduleFiles.push(f.slice(root.length + 1)); }
    catch (e2) { failed.push(f.slice(root.length) + ': ' + String(e2 && e2.message || e2)); }
  }
}
console.log(JSON.stringify({ checked: files.length, modules, moduleFiles, failed }));
