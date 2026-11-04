'use strict';
// Waits until the cards of the files tools/split_js.py cut into parts are defined (phase 18, Part B): a split card file's shell
// registers its elements once its parts have loaded, a beat after window.__mantelReady, so a check that reads a card right
// after ready waits for this too. Playwright checks:  await require('./grid_ready.cjs')(page);  after their ready wait.
// (tools/headless/cdp.py's Browser.wait does the same for the Python checks.)
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function tags() {
  const out = new Set();
  const dir = path.join(ROOT, 'tools/split_manifests');
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
    if (!name.endsWith('.json')) continue;
    const shell = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')).shell || '';
    if (!shell.startsWith('web/hk/cards/')) continue;
    const text = fs.readFileSync(path.join(ROOT, shell), 'utf8');
    for (const m of text.matchAll(/(?:\bregister|customElements\.define)\(\s*['"](hk-[a-z0-9-]+)['"]/g)) out.add(m[1]);
  }
  return [...out].sort();
}

module.exports = async function gridCardsUpgraded(page, timeout = 30000) {
  const list = tags();
  if (!list.length) return;
  await page.waitForFunction((names) => {
    const walk = (root) => {
      for (const e of root.querySelectorAll('*')) {
        if (names.includes(e.localName) && !customElements.get(e.localName)) return false;
        if (e.shadowRoot && !walk(e.shadowRoot)) return false;
      }
      return true;
    };
    return walk(document);
  }, list, { timeout });
};
module.exports.tags = tags;
