# Your hk: glyphs, from your SF Symbols

The hk: icons are Apple SF Symbols. Apple's licence does not let them ship with
the integration, so each home builds its own `hk-glyphs.js` — once, on a Mac —
and drops it in its HK Frontend files folder.

```sh
# 1. Install the SF Symbols app (developer.apple.com/sf-symbols).
# 2. One Python package:
python3 -m venv ~/.venvs/hk-sf && ~/.venvs/hk-sf/bin/pip install svgpathtools
# 3. Build straight into your files folder (default hk_local):
~/.venvs/hk-sf/bin/python build_glyphs.py --out /config/hk_local/iconset/hk-glyphs.js
```

No Python on the Mac? `sh export_all.sh <folder>` exports every symbol with
nothing but the SF Symbols app, and `build_glyphs.py --cache <folder> --out …`
then builds the file on any computer with Python (docs/Making-Your-Files.md).

No restart: the next page load picks it up, and the Repairs entry
"SF Symbols glyphs not installed" clears at the next start of the integration.

| File | What |
|---|---|
| `manifest.json` | every hk: glyph → the SF symbol it is drawn from (plus the few scaled, split or cut ones, and the Material Design Icons paths, which are Apache-2.0 and ship here); `weather` lists the symbols the header draws in multicolor |
| `sfsvg.py` | export via the SF Symbols CLI, and the fit into the 24×24 box every glyph shares |
| `symbols.txt` | the 155 SF symbol names the manifest uses, one per line (generated) |
| `export_all.sh` | exports every symbol in `symbols.txt` as SVG, on a Mac, with no Python |
| `names.py` | regenerates `symbols.txt` and `docs/Glyph-Names.md` from the manifest; a test fails when they fall behind |
| `build_glyphs.py` | writes `hk-glyphs.js` (the icons, then a `weather` section: each symbol's layers with their multicolor role); `--check <file>` compares a build with an existing file instead |

`--check` proves the manifest: rebuilt from it, every glyph of the original
hand-made set comes out as the same drawing (see the manifest's `_verified`).
A newer SF Symbols that renames a symbol fails loudly with its name; fix that
one line in the manifest.
