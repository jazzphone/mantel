// THE HOMEVIEW-STYLE STARTERS as the editor makes them (hk-grid-editor.js
// SQUARE_STARTERS, squareStarter, squareHouse), for home_grid_visual_check.py
// --homeview: the editor's own code run in Node, with the fictional house the
// check serves. Reads {house: {states, entities, areas}, tablet_room} on stdin;
// prints {screen type: {key: grid}}.
const fs = require('fs'), path = require('path');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const web = path.join(__dirname, '..', '..', 'web', 'hk');
let Editor = null;
global.window = global;
global.HTMLElement = class {};
global.customElements = { define: (n, c) => { if (n === 'hk-grid-editor') Editor = c; }, get: () => null };
global.CustomEvent = function () {}; global.dispatchEvent = () => {};
for (const f of ['cards/hk-grid-catalog.js', 'panels/hk-grid-editor.js']) (0, eval)(fs.readFileSync(path.join(web, f), 'utf8'));
const GE = window.hkGridEditor, out = {};
const FRAMES = { tablet_landscape: [1180, 820], tablet_portrait: [820, 1180], phone_portrait: [390, 844], square: [800, 800] };
for (const kind of Object.keys(GE.SQUARE_STARTERS)) {
  const t = GE.SCREEN_TYPES.find((x) => x[0] === kind);
  const grid = { v: 1, cols: t[2], rows: t[3], band: t[4], frame: FRAMES[kind], items: [], ...(kind === 'square' ? { cell: 'square', screen: 'square', grow: true } : {}) };
  // the editor itself, on a screen whose tablet is in input.tablet_room
  const ed = Object.create(Editor.prototype);
  ed.grid = grid; ed.o = { board: {}, path: 'homeview' };
  ed.panel = { client: input.house, data: { tablets: { t: { screen: 'homeview', room: input.tablet_room } } } };
  out[kind] = {};
  for (const c of ed.squareStarters()) out[kind][c[0]] = GE.squareStarter(c, grid, ed.squareHouse());
}
process.stdout.write(JSON.stringify(out));
