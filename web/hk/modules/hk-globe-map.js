// @ts-check
// Accurate, offline land geometry with spherical clipping at the globe's rim.
import { geoOrthographic, geoPath, geoArea } from '/hk/vendor/d3-geo.js';

let land;
function loadLand() {
  if (!land) land = fetch('/hk/data/world-land.json').then(r => {
    if (!r.ok) throw new Error('Globe coastlines could not load');
    return r.json();
  }).then(data => {
    // D3 uses clockwise exterior rings for small spherical polygons.
    for (const coordinates of data.coordinates) {
      if (geoArea({ type: 'Polygon', coordinates }) > Math.PI * 2) coordinates.forEach(ring => ring.reverse());
    }
    return data;
  }).catch(error => { land = null; throw error; });
  return land;
}

export async function landPainter(context) {
  const geometry = await loadLand();
  const projection = geoOrthographic().translate([200, 200]).scale(174).precision(.35);
  const path = geoPath(projection, context);
  return angle => {
    projection.rotate([angle, -20]);
    context.beginPath(); path(geometry);
    context.fillStyle = '#93b1a0'; context.fill();
    context.strokeStyle = '#b4cbb4'; context.lineWidth = .35; context.stroke();
  };
}
