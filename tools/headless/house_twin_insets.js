// house_twin.py --insets: each block's drawn content (text, glyphs, pictures, painted boxes) against its plate, in the block's own px:
// [id, size, card, width x height, inset, 'top/right/bottom/left']. A block whose top and bottom, or left and right, differ, or whose
// margins above and below are wider than at its sides, is worth a look (2026-11-08, the owner: 'the margins don't seem to match').
function measure() {
  const kids = (n) => [...n.children, ...(n.shadowRoot ? n.shadowRoot.children : [])];
  const deep = (r, s) => [...r.querySelectorAll('*')].flatMap((e) => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);
  const view = deep(document, 'hk-home-grid-view')[0];
  if (!view) return { error: 'no view' };
  const k = view._gridScale || 1, out = [];
  const shown = (e) => { const cs = getComputedStyle(e); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };
  for (const cell of view.shadowRoot.querySelectorAll('.cell')) {
    const c = cell.getBoundingClientRect(), card = cell.firstElementChild;
    if (!card) continue;
    const pad = parseFloat(getComputedStyle(card).getPropertyValue('--hk-block-pad')) || parseFloat(getComputedStyle(cell).getPropertyValue('--hk-block-pad')) || 14;
    let u = null;
    const add = (r) => {
      const x = [Math.max(r.left, c.left), Math.max(r.top, c.top), Math.min(r.right, c.right), Math.min(r.bottom, c.bottom)];
      if (x[2] - x[0] < 1 || x[3] - x[1] < 1) return;
      u = u ? [Math.min(u[0], x[0]), Math.min(u[1], x[1]), Math.max(u[2], x[2]), Math.max(u[3], x[3])] : x;
    };
    const walk = (e) => {
      if (/^(style|script|template|slot|link)$/.test(e.localName) || !shown(e)) return;
      const r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      // the plate itself and anything as big as the cell are frames, not content
      const frame = r.width >= c.width - 2 && r.height >= c.height - 2;
      const leaf = /^(svg|img|video|canvas|hk-icon|ha-icon|input)$/.test(e.localName);
      if (leaf && !frame) { add(r); return; }
      for (const n of e.childNodes) if (n.nodeType === 3 && n.data.trim()) { const g = document.createRange(); g.selectNodeContents(n); const q = g.getBoundingClientRect(); if (q.width) add(q); }
      const cs = getComputedStyle(e);
      const paints = !frame && (!/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) || cs.backgroundImage !== 'none' || parseFloat(cs.borderTopWidth) > 0);
      if (paints) add(r);
      kids(e).forEach(walk);
    };
    walk(card);
    if (!u) { out.push({ id: cell.getAttribute('data-id'), size: cell.getAttribute('size'), card: card.localName, empty: true }); continue; }
    const ins = [u[1] - c.top, c.right - u[2], c.bottom - u[3], u[0] - c.left].map((x) => Math.round(x / k));
    out.push({ id: cell.getAttribute('data-id'), size: cell.getAttribute('size'), card: card.localName, pad, ins, wh: [Math.round(c.width / k), Math.round(c.height / k)] });
  }
  return { cells: out };
}
const m = measure(); return (m.cells || []).filter(x => !x.empty && !/camera/.test(x.card)).map(x => [x.id, x.size, x.card, x.wh.join('x'), x.pad, x.ins.join('/')].join(' '));