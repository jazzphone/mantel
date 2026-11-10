# Your Files

Apple's SF Pro font and the SF Symbols glyphs give the screens Apple's look. Apple's license doesn't let Mantel ship them, so each home adds its own copy once, in **Mantel Settings → Your Files**. Owners and Admins see it. The same page holds the screensavers' [Photos](Photos.md).

Without the font and glyphs, every screen still works: text uses the system font, and icons are drawn as the Material Design icon of the same name. **Setup Check** (Mantel Settings → **Overview**) says whether each one is in place.

## The three files

| Row | File | What it is |
|---|---|---|
| **SF Pro (woff2)** | `SF-Pro.woff2` | The font every screen uses |
| **SF Pro (ttf)** | `SF-Pro.ttf` | The same font; only needed if you have no woff2 |
| **HK Glyphs** | `hk-glyphs.js` | Every `hk:` icon, and the multicolor weather symbols |

Choose **Upload** on a row to add its file, **Replace** to swap in a newer one, or **Remove** to go back to the plain look. The files are kept in Mantel's data and its encrypted [backups](Backups.md), and they are only ever read as data, never run.

From the command line, `mantel files import-assets <folder>` picks all three out of a folder in one go.

If HK Frontend is linked to Mantel, it takes copies of these files over the link, so you upload them here only once.

## Making the files

You make both on a Mac, once. HK Frontend's [Making Your Files](https://github.com/jazzphone/hk-frontend/wiki/Making-Your-Files) has the steps. In short, for the glyphs:

1. Install Apple's **SF Symbols** app from [developer.apple.com/sf-symbols](https://developer.apple.com/sf-symbols/). Installing it just for yourself, in your home folder's Applications, works too and needs no administrator password.
2. In a copy of the HK Frontend repository, run:

   ```sh
   python3 -m venv ~/.venvs/hk-sf && ~/.venvs/hk-sf/bin/pip install svgpathtools
   ~/.venvs/hk-sf/bin/python tools/sf_symbols/build_glyphs.py --out ~/Desktop/hk-glyphs.js
   ```

   The first run exports every symbol and takes about six minutes. It ends with `wrote …: N glyphs, M two-tone, W weather`.
3. Upload `hk-glyphs.js` on the **HK Glyphs** row.

[Glyph Names](https://github.com/jazzphone/hk-frontend/wiki/Glyph-Names) lists every `hk:` icon and the SF Symbol it is drawn from.

## When to make the glyphs again

The glyph file holds the icons that existed when you built it. Build it again and replace it when:

- **An update adds `hk:` icons.** The release notes say so. Until you replace the file, the new icons aren't in the Icon picker.
- **Apple redraws its symbols.** A newer SF Symbols app draws some icons differently (in SF Symbols 27, the windows, the dryer and the battery, for example). A new build gives you Apple's current drawings.

Replacing the file is safe: an icon a screen already uses keeps its name.
