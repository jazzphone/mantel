#!/bin/sh
# Export every SF Symbol the glyph file needs, on a Mac with the SF Symbols
# app -- no Python needed. The folder it fills can be copied to any computer
# with Python, where build_glyphs.py builds the glyph file from it:
#
#     sh export_all.sh [folder]        (default: .sfcache beside this script,
#                                       where build_glyphs.py looks by itself)
#     python3 build_glyphs.py --cache <folder> --out hk-glyphs.js
#
# The symbols are the ones in symbols.txt. One already in the folder is
# skipped, so a stopped run can be resumed. About three minutes for all.
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HERE/.sfcache}"
CLI="${SFSYMBOLS_CLI:-}"
for c in "/Applications/SF Symbols.app/Contents/Executables/sfsymbols" \
         "/Applications/SF Symbols Beta.app/Contents/Executables/sfsymbols"; do
  [ -z "$CLI" ] && [ -x "$c" ] && CLI="$c"
done
if [ -z "$CLI" ]; then
  echo "sfsymbols CLI not found: install the SF Symbols app (developer.apple.com/sf-symbols) or set SFSYMBOLS_CLI"
  exit 1
fi
mkdir -p "$OUT" || exit 1
failed=0
while IFS= read -r s; do
  [ -z "$s" ] && continue
  [ -f "$OUT/$s.svg" ] && continue
  if ! "$CLI" export "$s" --format svg --output "$OUT/$s.svg" >/dev/null 2>&1; then
    echo "SF symbol not found: $s"
    failed=$((failed + 1))
  fi
done < "$HERE/symbols.txt"
echo "$(ls "$OUT" | grep -c '\.svg$') symbols in $OUT, $failed not found"
[ "$failed" -eq 0 ]
