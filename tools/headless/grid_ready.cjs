'use strict';
// Waits until the files tools/split_js.py cut into parts have finished starting (phase 18, Part B): a split shell runs its parts
// a beat after the file itself (and, for a card file, after window.__mantelReady), and only then defines its elements or sets
// its global (window.hkSaver), so a check that reads either right after ready waits for this too. Playwright checks:
//   await require('./grid_ready.cjs')(page);  after their ready wait; and, for a page that has the screensaver,
//   await require('./grid_ready.cjs').saver(page);  (tools/headless/cdp.py's Browser.wait does the same for the Python checks.)
// Two things are waited for: every shell that STARTED (the loader sets window.__hkSplitStarted[label] when it begins and
// window.__hkSplitDone[label] when its parts have run) is done, and every element of the card files cut into parts is defined.
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
  await page.waitForFunction(() => {
    const started = window.__hkSplitStarted || {}, done = window.__hkSplitDone || {};
    return Object.keys(started).every((k) => done[k]);
  }, null, { timeout });
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
// a page that has the screensaver (a screen with one, or a harness that loaded hk-saver.js): window.hkSaver is set once its parts have run
module.exports.saver = async function saverReady(page, timeout = 30000) {
  await page.waitForFunction(() => !!(window.hkSaver && window.hkSaver.preview), null, { timeout });
  await module.exports(page, timeout);
};
