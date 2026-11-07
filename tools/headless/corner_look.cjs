// Measure the leftmost bright pixels of the time, date and weather, rather than their padded DOM boxes.
const {execFileSync} = require('child_process');
module.exports = async (page, selector, python) => {
  const stack = page.locator(selector);
  const rows = await stack.evaluate(el => {
    const r = el.getBoundingClientRect();
    el.dataset.cornerLookStyle = el.getAttribute('style') || '';
    return [...el.children].filter(e => e.getBoundingClientRect().width > 0).map(e => {
      for (const n of [e, ...e.querySelectorAll('svg')]) {
        n.dataset.cornerLookStyle = n.getAttribute('style') || '';
        n.style.setProperty('color', '#fff', 'important');
        n.style.setProperty('text-shadow', 'none', 'important');
      }
      const b = e.getBoundingClientRect();
      return {name: e.className, left: r.left, top: b.top, bottom: b.bottom, boxLeft:b.left, offset:e.style.marginLeft, font:getComputedStyle(e).fontSize};
    });
  });
  try {
    const png = await page.screenshot({scale: 'css'});
    await stack.evaluate(el => { el.style.visibility = 'hidden'; });
    const background = await page.screenshot({scale: 'css'});
    return JSON.parse(execFileSync(python, ['-c', `
import sys,json,io,math,base64
from PIL import Image
data=json.loads(sys.stdin.readline())
im=Image.open(io.BytesIO(base64.b64decode(data['before']))).convert('RGB')
bg=Image.open(io.BytesIO(base64.b64decode(data['after']))).convert('RGB')
out=[]
for r in data['rows']:
    xs=[x for x in range(max(0,math.floor(r['left']-40)),min(im.width,math.ceil(r['left']+120)))
        for y in range(max(0,math.floor(r['top'])),min(im.height,math.ceil(r['bottom']))) if max(abs(a-b) for a,b in zip(im.getpixel((x,y)),bg.getpixel((x,y))))>64]
    out.append({'name':r['name'],'left':min(xs) if xs else None,'target':r['left'],'box':r['boxLeft'],'offset':r['offset'],'font':r['font']})
print(json.dumps(out))
`], {input: JSON.stringify({rows, before: png.toString('base64'), after: background.toString('base64')}) + '\n', timeout: 15000, maxBuffer: 1024 * 1024}).toString());
  } finally {
    await stack.evaluate(el => {
      for (const n of [el, ...el.querySelectorAll('[data-corner-look-style]')]) {
        n.setAttribute('style', n.dataset.cornerLookStyle || ''); delete n.dataset.cornerLookStyle;
      }
    });
  }
};
