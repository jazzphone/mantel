// STAND-IN glyph data for the loader tests. Not artwork: each path is a
// distinct rectangle, which is all the loader tests need -- a home's real
// Apple glyphs are tested by pointing tests/run at its files folder
// (HK_FILES=/config/<folder> tests/run doors).
(typeof window !== "undefined" ? window : globalThis).hkGlyphs = {
  icons: {
    "door-open": "M 2 2 L 10 2 L 10 22 L 2 22 Z",
    "door-closed-lock": "M 4 2 L 20 2 L 20 22 L 4 22 Z",
    "window-open-variant": "M 2 4 L 22 4 L 22 12 L 2 12 Z",
    "window-closed-variant": "M 2 4 L 22 4 L 22 20 L 2 20 Z",
    "garage": "M 1 8 L 23 8 L 23 22 L 1 22 Z",
    "garage-open": "M 1 8 L 23 8 L 23 12 L 1 12 Z",
    "lamp": "M 8 2 L 16 2 L 16 14 L 8 14 Z"
  },
  twotone: {
    "homepod": { path: "M 9 3 L 15 3 L 15 6 L 9 6 Z", secondaryPath: "M 6 6 L 18 6 L 18 22 L 6 22 Z" }
  }
};
