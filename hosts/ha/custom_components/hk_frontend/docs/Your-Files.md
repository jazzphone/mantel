# Your Files

HK Frontend is designed around Apple’s **SF Pro** font and **SF Symbols**
glyphs. Apple’s license doesn’t allow passing them on, so they can’t be bundled
with the integration. Instead, you put your own copies in a folder under
`/config`, and HK Frontend serves them to your screens.

This is optional. Everything works without them. Making the files, step by
step: [Making Your Files](Making-Your-Files.md).

## What you get without them

- **Text** on an iPhone, iPad or Mac is still SF, the system’s own font. Elsewhere it is Home Assistant’s own font, Roboto: sizes and spacing were measured against SF Pro, so text sits a little differently, but little is cut off and nothing is missing.
- **Icons** are drawn as the [Material Design Icons](https://pictogrammers.com/library/mdi/) of the same name, read from Home Assistant’s own icon set. The few glyph names that Material Design doesn’t have use a close stand-in (a HomePod is drawn as a speaker, for example).
- **Weather** shows Material Design’s weather icons, in white (the sun in yellow), instead of the multicolor SF Symbols the Weather app uses.
- **Settings** → **Repairs** shows *SF Pro font not installed* and *SF Symbols glyphs not installed*, and Setup Check shows a note. Neither is an error.

## What you need

- A **Mac**, once, for the glyphs: they are exported from Apple’s SF Symbols app, which runs only on macOS. The font can be had without one — see [Without a Mac](Making-Your-Files.md#without-a-mac). After that, the files live in Home Assistant.
- **Python 3** (`python3 --version` in Terminal). The tools run on Windows and Linux too; only the SF Symbols export needs the Mac, and that part needs no Python — see [No Python on the Mac](Making-Your-Files.md#no-python-on-the-mac).
- The HK Frontend **tools**. They are in the GitHub repository, not in what HACS installs. Download the repository from [github.com/jazzphone/hk-frontend](https://github.com/jazzphone/hk-frontend) — **Code** → **Download ZIP**, or `git clone` — preferably the release that matches the version you have installed.

Whether and how you may use Apple’s font and symbols is governed by Apple’s license terms, which you accept when you download them.

## Where the files go

The files folder is `hk_local` by default — `/config/hk_local`. It doesn’t exist until you create it. The layout:

```
/config/hk_local/
├── fonts/
│   └── SF-Pro.woff2       (or SF-Pro.ttf)
└── iconset/
    └── hk-glyphs.js
```

| File | What it is | Where it comes from |
|---|---|---|
| `fonts/SF-Pro.woff2` | SF Pro as a web font, about 8 MB instead of 21 | Made from Apple’s `SF-Pro.ttf` with `tools/font/make_woff2.py` |
| `fonts/SF-Pro.ttf` | Apple’s variable SF Pro, as Apple ships it | Works as-is instead of the woff2. Screens use the woff2 when both are there. |
| `iconset/hk-glyphs.js` | The glyph data for every `hk:` icon, and the multicolor weather symbols | Built from 155 SF Symbols with `tools/sf_symbols/build_glyphs.py` |

The names must be exactly these, capitals included.

### Using a different folder

You can choose another folder under `/config` in either place:

- **HK Settings** → **Advanced** → **Your Files** → **Folder**, or
- **Settings** → **Devices & services** → **HK Frontend** → **Configure** → **Your files**.

Both show whether the font and glyphs were found. `hk_local`, `/hk_local` and `/config/hk_local` all mean the same folder. The folder must be inside `/config`, can’t be `/config` itself, and can’t be a folder holding Home Assistant’s own files (one with `secrets.yaml`, `.storage` or `configuration.yaml` in it) — see [Security](#security).

## The files, by name

**The font.** Apple’s SF Pro download installs 46 font files. HK Frontend uses exactly one of them:

| File from Apple | Use it? | Why |
|---|---|---|
| `SF-Pro.ttf` | **Yes — this one** | The upright SF Pro as one *variable* font: every weight from 1 to 1000, and optical sizes from Text (small labels) to Display (large numbers), about 21 MB. Its family name is *SF Pro*. |
| `SF-Pro-Italic.ttf` | No | The italic. It would slant every screen; the font tool refuses it. |
| `SF-Pro-Display-*.otf`, `SF-Pro-Text-*.otf` (36 files) | No | One fixed weight each: every weight on the screens would draw the same. The font tool refuses them. |
| `SF-Pro-Rounded-*.otf` (9 files) | No | The rounded design, not the one the screens are measured against. |

On a Mac the installer puts them all in `/Library/Fonts`. In Apple’s installer package they sit at `Library/Fonts/`.

**The glyphs.** Every `hk:` icon is drawn from one SF Symbol, 155 in all. [Glyph names](Glyph-Names.md) lists each icon with its symbol’s name, and `tools/sf_symbols/symbols.txt` lists the symbols one per line. You don’t need either to build the file, but they tell you what to look for in the SF Symbols app.

The folder lives outside the integration’s own folder on purpose: an HK Frontend update from HACS replaces the integration’s folder, and your files survive it.

## Other files in the folder

Anything else you put in the folder is served too, at the same address under `/hk/`, and a file at the same path as one of HK Frontend’s own takes its place. For example, `hk_local/sky/clouds-a.webp` replaces the bundled cloud texture (before 1.4.6 the clouds were `clouds-a.png`; a copy under that name is no longer used). Your copy stays in place after updates, so if an update changes that file, you keep the old one until you remove yours.

## Security

The files folder is served **without signing in**, exactly like `/config/www` (`/local/`): browsers fetch fonts and scripts without Home Assistant’s credentials, so it has to be. Anyone who can reach your Home Assistant’s address can download any file in the folder, by its path under `/hk/`.

- Use a folder that holds only these files. **Never put secrets, backups, camera snapshots or anything private in it.**
- HK Frontend refuses to serve `/config` itself, any folder outside `/config`, and any folder that contains `secrets.yaml`, `.storage` or `configuration.yaml`.
- Nothing outside the folder is served: a path or link that leads out of it is ignored.
- If your Home Assistant is reachable from the internet, so is this folder.
