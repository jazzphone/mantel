# Making Your Files

Five steps from Apple’s downloads to the files in Home Assistant. What each
file is, and where it goes: [Your Files](Your-Files.md).

## Step 1: Set up Python on your Mac

In Terminal, make a Python environment with the three packages the tools need:

```sh
python3 -m venv ~/.venvs/hk-sf
~/.venvs/hk-sf/bin/pip install fonttools brotli svgpathtools
```

Then change to the folder where you unpacked the HK Frontend repository:

```sh
cd ~/Downloads/hk-frontend      # wherever you put it
```

In the steps below, the output goes to a folder called `hk_local` on your Desktop. If you have Home Assistant’s config folder mounted on your Mac (through the Samba share add-on, for example), you can write straight into its `hk_local` folder instead.

## Step 2: The font

1. Download **SF Pro** from Apple: [developer.apple.com/fonts](https://developer.apple.com/fonts/).
2. Open the downloaded disk image and run the installer. It puts the fonts in `/Library/Fonts`.
3. Convert the variable font to a web font:

   ```sh
   ~/.venvs/hk-sf/bin/python tools/font/make_woff2.py /Library/Fonts/SF-Pro.ttf ~/Desktop/hk_local/fonts/SF-Pro.woff2
   ```

   It prints the font’s family and axes, then the size before and after.

Use `SF-Pro.ttf`, the **variable** font. The installer also adds static cuts such as `SF-Pro-Display-Bold.otf`; with one of those every weight would draw the same, so the tool refuses them (*not the variable SF Pro*).

**Skipping the conversion:** you can copy `/Library/Fonts/SF-Pro.ttf` to `fonts/SF-Pro.ttf` instead. It works the same, but every screen downloads a file about two and a half times larger the first time it loads.

### Without a Mac

Apple’s download, `SF-Pro.dmg`, is a Mac disk image with an installer package inside, and the font is inside the package, at `Library/Fonts/SF-Pro.ttf`. An archive tool that reads Mac disk images can usually open all three layers: on Windows, [7-Zip](https://www.7-zip.org) opens the `.dmg`, then the `.pkg` inside it, then the `Payload` inside that. Copy out `SF-Pro.ttf` — only that file; see [the table](Your-Files.md#the-files-by-name).

Then convert it on the same computer. On Windows, in Command Prompt or PowerShell, in the folder where you unpacked the HK Frontend repository:

```bat
py -m venv hk-sf
.\hk-sf\Scripts\pip install fonttools brotli
.\hk-sf\Scripts\python tools\font\make_woff2.py SF-Pro.ttf SF-Pro.woff2
```

Or skip the conversion and use `SF-Pro.ttf` as it is.

## Step 3: The glyphs

1. Install Apple’s **SF Symbols** app from [developer.apple.com/sf-symbols](https://developer.apple.com/sf-symbols/), into `/Applications`.
2. Build the glyph file:

   ```sh
   ~/.venvs/hk-sf/bin/python tools/sf_symbols/build_glyphs.py --out ~/Desktop/hk_local/iconset/hk-glyphs.js
   ```

   For every `hk:` icon, `tools/sf_symbols/manifest.json` names the SF Symbol it is drawn from. The script exports each one with the command-line exporter inside the SF Symbols app and fits it into the icon set’s 24 × 24 box. The weather symbols are kept as they are, in layers, so they can be drawn in color. The first run exports every symbol and takes a while; the exports are kept in `tools/sf_symbols/.sfcache`, so a second run is quick. It ends with `wrote …: N glyphs, M two-tone, W weather`.

**When an update adds glyphs, run it again.** A release can add `hk:` icons to the manifest (1.4.1 adds 78 of Apple’s Home glyphs: ceiling fans, curtains, Roman shades, smoke and CO sensors, appliances…). Until you rebuild, a glyph your file doesn’t have is drawn as the Material Design icon of the same name, so nothing goes blank. The exports already in `.sfcache` are reused, so only the new symbols are exported.

If the script stops:

| Message | What to do |
|---|---|
| `sfsymbols CLI not found` | The script looks for `SF Symbols.app` or `SF Symbols Beta.app` in `/Applications`. Install the app there — a current version, which includes the `sfsymbols` exporter in its `Contents/Executables` folder — or set `SFSYMBOLS_CLI` to the exporter’s full path. |
| `SF symbol not found: <name>` | Your version of SF Symbols doesn’t have that symbol, or has renamed it. Try the current SF Symbols app; if it still fails, [open an issue](https://github.com/jazzphone/hk-frontend/issues) naming the symbol. |
| `No module named 'svgpathtools'` | Run the tool with the environment’s Python (`~/.venvs/hk-sf/bin/python`), as shown. |

### No Python on the Mac

The SF Symbols app has to run on a Mac, but nothing else does. If the Mac you can use has no Python — or it isn’t yours — export the symbols there with a plain script, then build the glyph file on any computer with Python:

1. On the Mac, with the SF Symbols app in `/Applications`, open Terminal in the folder where you unpacked the HK Frontend repository and run:

   ```sh
   sh tools/sf_symbols/export_all.sh ~/Desktop/sf-exports
   ```

   It exports every symbol in `tools/sf_symbols/symbols.txt` as an SVG file into `sf-exports` on the Desktop — 155 files, about three minutes — and ends with `155 symbols in …, 0 not found`. If it stops, run it again: symbols already exported are skipped.
2. Copy the `sf-exports` folder to the computer with Python, and build from it there. On a Mac or Linux:

   ```sh
   python3 -m venv ~/.venvs/hk-sf && ~/.venvs/hk-sf/bin/pip install svgpathtools
   ~/.venvs/hk-sf/bin/python tools/sf_symbols/build_glyphs.py --cache sf-exports --out hk-glyphs.js
   ```

   On Windows, in Command Prompt or PowerShell:

   ```bat
   py -m venv hk-sf
   .\hk-sf\Scripts\pip install svgpathtools
   .\hk-sf\Scripts\python tools\sf_symbols\build_glyphs.py --cache sf-exports --out hk-glyphs.js
   ```

   With every symbol already in the folder, the builder never looks for the SF Symbols app. The file is the same as one built on the Mac.

A later version of HK Frontend may add glyphs. After updating, build the file again from the matching tools; until then, a new glyph is drawn as its Material Design stand-in.

## Step 4: Copy the files to Home Assistant

Copy the `fonts` and `iconset` folders into `/config/hk_local` on your Home Assistant — through the Samba share add-on, the Studio Code Server add-on’s upload, `scp` over SSH, or however you usually copy files there. Keep the folder names exactly as shown: `fonts/SF-Pro.woff2` and `iconset/hk-glyphs.js`.

## Step 5: Reload and check

1. **If you just created the folder**, reload HK Frontend: **Settings** → **Devices & services** → **HK Frontend** → **⋮** on the HK Frontend entry → **Reload** (or restart Home Assistant). HK Frontend looks for the folder when it starts and when you change the folder setting, so a folder created afterwards isn’t served until then. Reloading also clears the two Repairs entries.
2. Open **HK Settings** → **Setup Check**. It should say **SF Pro & the SF Symbols Glyphs — Found.** (HK Settings → **Advanced** → **Your Files** shows *Found* for each as well.)
3. Reload each screen. If a screen still shows Roboto or Material Design icons, reload it once more: the first load after a change can still use the browser’s previous copy. See [A change doesn’t show on a screen](Troubleshooting.md#a-change-doesnt-show-on-a-screen).

No restart of Home Assistant is needed for files you replace later: screens check for a newer copy every time they load.
