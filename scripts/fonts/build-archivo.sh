#!/usr/bin/env bash
# Builds public/fonts/archivo-xb.{json,png}: Archivo Expanded ExtraBold (width 125, weight 800) as a
# UIKit MSDF font (msdf-bmfont JSON plus one PNG page). Archivo is OFL 1.1 (public/fonts/OFL.txt).
# Runs inside a container on the build server (needs network for the font and the tools):
#   scripts/remote.sh ui --pull public/fonts -- bash scripts/fonts/build-archivo.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
# google/fonts pinned to the commit the atlas was built from.
FONTS_COMMIT=6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec
SRC=https://raw.githubusercontent.com/google/fonts/$FONTS_COMMIT/ofl/archivo

apt-get update -qq >/dev/null && apt-get install -y -qq python3-fonttools >/dev/null
curl -fsSL "$SRC/Archivo%5Bwdth,wght%5D.ttf" -o "$WORK/Archivo.ttf"
curl -fsSL "$SRC/OFL.txt" -o "$WORK/OFL.txt"
python3 -m fontTools.varLib.instancer "$WORK/Archivo.ttf" wdth=125 wght=800 -o "$WORK/ArchivoExpanded-ExtraBold.ttf" >/dev/null

# Printable ASCII plus a few typographic characters the copy may use.
python3 - "$WORK/charset.txt" <<'PY'
import sys
chars = "".join(chr(c) for c in range(32, 127)) + "’‘“”×÷•°"
open(sys.argv[1], "w", encoding="utf8").write(chars)
PY

cd "$WORK"
npx --yes msdf-bmfont-xml@2.7.0 -f json -o archivo-xb -m 512,512 -s 48 -r 4 -t msdf -i charset.txt --smart-size ArchivoExpanded-ExtraBold.ttf >/dev/null
cd - >/dev/null
mkdir -p public/fonts
python3 - "$WORK/ArchivoExpanded-ExtraBold.json" public/fonts/archivo-xb.json <<'PY'
import json, sys
f = json.load(open(sys.argv[1]))
assert len(f["pages"]) == 1, f["pages"]
f["pages"] = ["archivo-xb.png"]
f["info"]["face"] = "Archivo Expanded ExtraBold"
json.dump(f, open(sys.argv[2], "w"), separators=(",", ":"))
print("chars", len(f["chars"]), "kernings", len(f["kernings"]), "common", f["common"])
PY
cp "$WORK/archivo-xb.png" public/fonts/archivo-xb.png
cp "$WORK/OFL.txt" public/fonts/OFL.txt
ls -l public/fonts
