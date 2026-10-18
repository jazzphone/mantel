// hk-icons.js -- the hk: iconset LOADER. Registers window.customIconsets.hk
// and repairs icons that rendered before it existed.
//
// THE GLYPHS ARE NOT HERE. They are Apple SF Symbols, which cannot ship with
// the integration, so each home supplies them as iconset/hk-glyphs.js in its
// files folder (see files.py and tools/sf_symbols/). /hk/ answers from that
// folder first, so the import below finds the home's copy at the bundle's URL.
// Without it every hk: icon is drawn as the Material Design icon of the same
// name (see THE MATERIAL FALLBACK below) and Settings -> Repairs says why.
//
// TIMING. The iconset is registered SYNCHRONOUSLY at module evaluation -- that
// is the whole defence against ha-icon's sticky blank (see the repair shim
// below): ha-icon only tests that the set EXISTS at first render. The glyph
// data is fetched from the same evaluation, in parallel, and the getter
// awaits it; ha-icon already awaits the getter, so a first icon can at most
// wait for that one fetch, which starts before any card has loaded.
const HK_GLYPHS = (window.hkGlyphs
  ? Promise.resolve(window.hkGlyphs)
  : import("./hk-glyphs.js").then(() => window.hkGlyphs)
).then((g) => {
  if (!g || !g.icons) throw new Error("hk-glyphs.js did not define window.hkGlyphs");
  const HK_ICONS = g.icons;
  g.twotone = g.twotone || {};
  // ALIASES. One path, two honest names -- not a copy: HK_ICONS is read by
  // reference, so these cost nothing and cannot drift from the entry they point
  // at.
  //
  // `door-closed-lock` IS SF's `door.left.hand.closed` -- verified by exporting
  // the symbol and matching it against the stored path, mean point distance
  // 0.0000. It draws a shut door with a DOORKNOB, and there is no lock anywhere
  // in it. The name came with the MDI key it replaced (keys stay named after
  // the MDI icon they replace), and MDI's door-closed-lock genuinely does have
  // a padlock. Ours does not.
  //
  // So do not read the name as a fact: it is not "the locked door", and a
  // page that treats it as one ends up drawing every door as open.
  //
  // Renaming the key outright would break every config that uses it,
  // so the honest name is added beside it instead -- the same call the glyph
  // vocabulary made for hk:vanity-light and hk:string-lights, which also lie.
  if (HK_ICONS["door-closed-lock"]) HK_ICONS["door-closed"] = HK_ICONS["door-closed-lock"];
  console.info("%c HK-ICONS %c " + Object.keys(HK_ICONS).length + " SF Symbols (filled) ",
    "color:#fff;background:#40C4E8;font-weight:700;border-radius:3px 0 0 3px",
    "color:#40C4E8;background:#333;border-radius:0 3px 3px 0");
  // The WEATHER glyphs are in this file too (its `weather` section), drawn by
  // hk-header.js as inline SVG, not through the iconset -- so no ha-icon asks
  // for them again. A header drawn before this arrived shows the Material
  // stand-in; announcing the data redraws every card (MODULE WAKE, hk-base.js).
  try { window.dispatchEvent(new CustomEvent("hk-module-ready", { detail: "hkGlyphs" })); } catch (e) { /* no DOM */ }
  return g;
}).catch((e) => {
  console.warn("HK-ICONS: no glyph data (" + (e && e.message) + "); Material Design icons stand in. "
    + "Put hk-glyphs.js in your HK Frontend files folder under iconset/ -- see Settings -> Repairs.");
  return { icons: {}, twotone: {} };
});
// THE MATERIAL FALLBACK. Without a home's glyph file -- no Mac to
// build it on -- every hk: icon would draw BLANK, which is the worst first
// impression a new install can make. The glyph names ARE Material Design Icons
// names (each was named after the MDI icon it replaced), so a missing glyph is
// drawn as the Material icon of the same name, read from Home Assistant's own
// icon database: /static/mdi/iconMetadata.json says which chunk holds a name,
// and the chunk (/static/mdi/<file>.json) holds its path -- the files ha-icon
// itself reads, so nothing ships here. Apple's artwork is then an upgrade, not
// a requirement. The names this set made up have a stand-in: nine of the
// first set, and ten of the Home glyphs added 2026-10-01 (Apple draws a desk
// fan, a Roman shade, French doors... Material does not).
const MDI_ALIAS = {
  "air-humidifier-active": "air-humidifier", "apple-tv": "apple", "christmas-tree": "pine-tree",
  "cross-latin": "cross", "homepod": "speaker", "homepod-mini": "speaker", "sparkles": "creation",
  "spigot": "valve", "star-fill": "star",
  "fan-desk": "fan", "fan-floor": "fan", "dehumidifier": "air-humidifier-off",
  "roman-shade": "roller-shade-closed", "roman-shade-open": "roller-shade", "skylight": "window-closed-variant",
  "door-french": "door-closed", "garage-double": "garage-variant", "contact-sensor": "magnet",
  "power-strip": "power-socket-us"
};
let MDI_META = null;
const MDI_CHUNKS = {};
const mdiPath = (name) => {
  const n = MDI_ALIAS[name] || name;
  if (!MDI_META) {
    MDI_META = fetch("/static/mdi/iconMetadata.json")
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
  return MDI_META.then((meta) => {
    if (!meta || !Array.isArray(meta.parts) || !meta.parts.length) return undefined;
    // the parts are in name order; a part holds every name from its `start`
    let file = meta.parts[0].file;
    for (const p of meta.parts) {
      if (p.start && n < p.start) break;
      file = p.file;
    }
    if (!MDI_CHUNKS[file]) {
      MDI_CHUNKS[file] = fetch("/static/mdi/" + file + ".json")
        .then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    }
    return MDI_CHUNKS[file].then((c) => (c && c[n]) || undefined);
  });
};
window.customIconsets = window.customIconsets || {};
window.customIconsets["hk"] = async (name) => {
  const g = await HK_GLYPHS;
  const two = g.twotone[name];
  if (two) return { path: two.path, secondaryPath: two.secondaryPath, viewBox: '0 0 24 24' };
  const path = g.icons[name];
  if (path) return { path, viewBox: '0 0 24 24' };
  const mdi = await mdiPath(name);
  return mdi ? { path: mdi, viewBox: '0 0 24 24' } : undefined;
};
window.hkIcons = { version: "1.1.0", mdiPath, MDI_ALIAS };
// HK's own hk-icon (elements/hk-elements.js) draws an icon asked for before this set existed
// again now; it never caches a miss, so no repair shim is needed for it (the one below is for
// Home Assistant's ha-icon, which other cards on the page may still use with hk: names).
try { window.hkElements && window.hkElements.iconsetAdded && window.hkElements.iconsetAdded(); } catch (e) { /* no elements */ }
// ---------------------------------------------------------------------------
// Self-heal for ha-icon's permanently-cached failure.
//
// Verified against the served frontend, ha-icon._loadIcon():
//
//   if (!BUILTIN_PREFIXES.includes(prefix)) {
//     const set = customIcons[prefix];
//     return set ? this._setCustomPath(set.getIcon(name), icon)
//                : void (this._legacy = true);      // <-- not registered yet
//   }
//   this._legacy = false;                            // <-- built-in path ONLY
//
// Three facts combine into a permanent blank icon:
//   1. Lovelace resources are injected as <script async type="module">, so the
//      "hk" iconset may not exist yet when a card first renders.
//   2. On a miss, ha-icon sets _legacy = true and renders <iron-icon>, which
//      has no "hk" iconset either, so it draws nothing.
//   3. _loadIcon() only re-runs when the `icon` PROPERTY CHANGES, and the
//      custom-icon success path never clears _legacy. So one lost race blanks
//      that element for the life of the page - which is exactly why a reload
//      sometimes fixes it and sometimes does not.
//
// There is no iconset-added event in this frontend (grepped every chunk),
// so nothing tells the already-rendered elements to try again. This does.
//
// _legacy and _loadIcon are private, but both survive minification as class
// members and are guarded below; a rename would make this a no-op, not a break.
(() => {
  const walk = (root, out) => {
    if (!root) return;
    for (const el of root.querySelectorAll("*")) {
      if (el.localName === "ha-icon" && typeof el.icon === "string"
          && el.icon.startsWith("hk:") && el._legacy === true) out.push(el);
      if (el.shadowRoot) walk(el.shadowRoot, out);
    }
  };
  const repair = () => {
    // No hk: icon exists outside the hk cards, which exist only on a Lovelace
    // panel: nothing to repair on Settings, Logs or the Map, so no walk.
    const HS = window.hkSettings;
    if (HS && HS.lovelacePanel && HS.lovelacePanel() === false) return 0;
    const broken = [];
    try { walk(document, broken); } catch (e) { return 0; }
    for (const el of broken) {
      try { el._legacy = false; el._loadIcon?.(); } catch (e) { /* ignore */ }
    }
    if (broken.length) {
      console.info("%c HK-ICONS %c repaired " + broken.length + " blank icon(s) ",
        "color:#fff;background:#FF9F0A;font-weight:700;border-radius:3px 0 0 3px",
        "color:#FF9F0A;background:#333;border-radius:0 3px 3px 0");
    }
    return broken.length;
  };
  // SCHEDULING, AND WHY THE POLL STOPS
  //
  // walk() is a querySelectorAll("*") over the document AND a recursive
  // descent into every shadow root under it. On a room dashboard that is
  // hundreds of cards, each its own shadow root, plus HA's chrome -- tens of
  // thousands of element visits per sweep. A bare setInterval(repair, 60000)
  // for the life of the page would run forever on a wall tablet.
  //
  // It does not need to. `window.customIconsets["hk"]` above is assigned
  // SYNCHRONOUSLY at module evaluation, and ha-icon._loadIcon() only sets
  // _legacy when the set is ABSENT at render time (presence is the test, not
  // the async getIcon resolving). So the failure this repairs can only happen
  // to elements that rendered BEFORE this module evaluated. That is a closed
  // window, not an ongoing risk.
  //
  // So the poll switches itself off: after QUIET_SWEEPS consecutive clean
  // sweeps it stops (a sweep that repairs something resets the counter).
  // A navigation or the screensaver going does NOT re-arm it any more: an
  // element rendered after this module evaluated finds the set, so neither
  // can make a blank icon -- and the walk landed at the tail of every page
  // change (300 ms in, ~8 ms of each at 6x slower, measured headless) and
  // re-armed three more whole-page walks a minute apart.
  const SWEEP_MS = 60000;
  const QUIET_SWEEPS = 3;          // 3 clean minutes and we are done
  let timer = null, quiet = 0;

  const sweep = () => {
    if (repair() > 0) quiet = 0;   // still finding damage: keep watching
    else if (++quiet >= QUIET_SWEEPS) { clearInterval(timer); timer = null; }
  };
  const arm = () => {
    quiet = 0;
    if (!timer) timer = setInterval(sweep, SWEEP_MS);
  };

  // Cards mount over the first few seconds. These six are the real repair;
  // everything after is the safety net.
  [200, 600, 1500, 3000, 6000, 12000].forEach((t) => setTimeout(repair, t));
  arm();

  // manual: hkRepairIcons() in the console. Also re-arms the poll, so it is
  // the right thing to call if you are chasing a blank icon.
  window.hkRepairIcons = () => { arm(); return repair(); };
})();
