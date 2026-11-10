"""Write web/mdi/ -- every Material Design Icon (Apache-2.0) -- from the @mdi/js and @mdi/svg packages.

HK's `mdi:` icons, and its `hk:` set's stand-ins, are read from /static/mdi/ as Home Assistant serves them:
iconMetadata.json lists the chunk files in name order (each part's `start` is the first name it holds), each chunk is
{name: path}, and iconList.json is [{name, keywords}] -- what an icon picker searches (Home Assistant's own picker reads
the same file; the detail sheet's Icon search does here). In Home Assistant the frontend serves its own; Mantel serves
these. Every icon, not the names HK happens to use (until 2026-11-10 it was a 662-icon subset: an accessory or scene
wearing any other icon in Home Assistant -- the owner's Relax, mdi:bed-clock -- drew blank in Mantel, and the picker
found none of them).

    npm pack @mdi/js@7.4.47 @mdi/svg@7.4.47     # then untar each
    python hosts/server/tools/gen_mdi.py <@mdi/js package folder> <@mdi/svg package folder>
"""
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CHUNK = 256 * 1024     # bytes of JSON a chunk holds at most: a page fetches only the chunks its icons are in

js, svg = Path(sys.argv[1]), Path(sys.argv[2])
version = json.loads((js / "package.json").read_text())["version"]
exports = dict(re.findall(r'export var (mdi\w+) = "([^"]+)"', (js / "mdi.js").read_text()))
meta = json.loads((svg / "meta.json").read_text())


def ident(name: str) -> str:
    return "mdi" + "".join(part[:1].upper() + part[1:] for part in name.split("-"))


icons = {m["name"]: exports[ident(m["name"])] for m in meta if ident(m["name"]) in exports}
missing = [m["name"] for m in meta if ident(m["name"]) not in exports]
if missing:
    sys.exit(f"no path in @mdi/js for {len(missing)} icon(s): {missing[:10]}")

out = ROOT / "web" / "mdi"
out.mkdir(parents=True, exist_ok=True)
for old in out.glob("icons*.json"):
    old.unlink()
parts, chunk, size = [], {}, 0
names = sorted(icons)


def flush():
    global chunk, size
    if not chunk:
        return
    file = f"icons-{len(parts):02d}"
    (out / f"{file}.json").write_text(json.dumps(chunk, separators=(",", ":")))
    first = next(iter(chunk))
    parts.append({"file": file} if not parts else {"start": first, "file": file})
    chunk, size = {}, 0


for n in names:
    add = len(n) + len(icons[n]) + 6
    if size + add > CHUNK:
        flush()
    chunk[n] = icons[n]
    size += add
flush()
(out / "iconMetadata.json").write_text(json.dumps({"version": version, "parts": parts}, separators=(",", ":")))
# the picker's list: a deprecated icon still draws (a house may wear one) but is not offered
listing = [{"name": m["name"], "keywords": [k.lower() for k in m.get("aliases", []) + m.get("tags", [])]}
           for m in sorted(meta, key=lambda m: m["name"]) if not m.get("deprecated")]
(out / "iconList.json").write_text(json.dumps(listing, separators=(",", ":")))
shutil.copy(js / "LICENSE", out / "LICENSE")
total = sum(p.stat().st_size for p in out.glob("icons-*.json"))
print(f"{len(icons)} icons in {len(parts)} chunks ({total:,} bytes), {len(listing)} in iconList.json -> web/mdi")
