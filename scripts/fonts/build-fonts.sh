#!/usr/bin/env bash
# Builds the fonts the game draws text with, for every language it speaks, into dist/fonts-build/ (then copied to
# public/fonts/ by hand):
#   inter-md, inter-bd    Inter Medium and Bold (OFL 1.1): the panels' body text, as UIKit MSDF atlases
#   noto-jp              Noto Sans JP Bold (OFL 1.1): Japanese on the panels (a single-channel SDF atlas: kanji
#                         need no sharp corners and it is a third the size) and, as noto-jp.woff2, on canvases
#   noto-serif-bd, -it    Noto Serif Bold and Italic (OFL 1.1), WOFF2: the canvas lettering in the Latin languages
#                         (plate, keys, coach line, story card), so every device draws and measures the same letters
#   limelight             Limelight (OFL 1.1, renamed Shadow Locks Display), the look pick's display face: the
#                         menus' wordmark and numerals (MSDF atlas, printable ASCII) and the landing page's (WOFF2)
#   josefin-bd            Josefin Sans Bold (OFL 1.1, renamed Shadow Locks Sans), the look pick's interface face:
#                         the menus' titles and key legends (MSDF atlas) and the landing page's button and facts (WOFF2)
# The Latin atlases carry printable ASCII, all of Latin-1 and what the tables use; Japanese is subset to exactly
# the characters the Japanese table, its dates and numbers, and the Language row use (src/i18n/charset.ts), so a
# new Japanese line needs this run again (tests/unit/i18n-fonts.test.ts fails until it is).
# Runs on the build server (network for the fonts and tools; Python without pip, so fontTools comes as a wheel):
#   scripts/remote.sh i18n --pull dist -- bash scripts/fonts/build-fonts.sh
#
# Adding a font, OFL or alike only (a font with a Reserved Font Name is renamed first, as the brand faces are):
#   1. Fetch it into $WORK from a pinned source (the google/fonts commit below, or a release URL checked by sha256)
#      and its licence into $OUT/OFL-<name>.txt; make one static instance with `instance` if it is variable.
#   2. For canvas lettering: `subset <ttf> "$WORK/latin.txt" "$OUT/<name>.woff2" --flavor=woff2`, then a row in
#      FACES (src/ui/fonts.ts, loaded by loadCanvasFonts) and its family in labelFont (src/render/label.ts).
#   3. For UIKit panels: `subset <ttf> "$WORK/latin.txt" "$WORK/<name>.ttf" --layout-features=kern`,
#      `atlas <name> <px> msdf 1024,1024 latin.txt`, and `<name>:latin.txt` on the finish-atlas line; then a family in
#      FONT_FAMILIES (src/ui/fonts.ts). Japanese keeps Noto Sans JP for every family (a Latin face has no kana).
#   4. A row in THIRD_PARTY_NOTICES.md, and the glyph checks in tests/unit/i18n-fonts.test.ts cover it (latin.txt
#      already holds every character the Latin languages show, so a face subset to it can draw them all).
# Outputs are copied to public/fonts/ with cp (binary); a rebuild that changes only the WOFF2 build time stamp
# (head.modified) need not be committed.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=dist/fonts-build
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
rm -rf "$OUT"
mkdir -p "$OUT" "$WORK/py"

# google/fonts pinned to one commit, so a rebuild makes the same glyphs.
FONTS_COMMIT=6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec
SRC=https://raw.githubusercontent.com/google/fonts/$FONTS_COMMIT/ofl

wheel() { # url sha256
  local f
  f="$WORK/$(basename "$1")"
  curl -fsSL "$1" -o "$f"
  echo "$2  $f" | sha256sum -c --quiet
  python3 -m zipfile -e "$f" "$WORK/py"
}
wheel https://files.pythonhosted.org/packages/99/3b/406d17b1f63e04a82aa621936e6e1c53a8c05458abd66300ac85ea7f9ae9/fonttools-4.55.3-py3-none-any.whl \
  f412604ccbeee81b091b420272841e5ec5ef68967a9790e80bffd0e30b8e2977
wheel https://files.pythonhosted.org/packages/b3/e7/ca2993c7682d8629b62630ebf0d1f3bb3d579e667ce8e7ca03a0a0576a2d/Brotli-1.1.0-cp311-cp311-manylinux_2_17_x86_64.manylinux2014_x86_64.whl \
  a469274ad18dc0e4d316eefa616d1d0c2ff9da369af19fa6f3daa4f09671fd61
export PYTHONPATH=$WORK/py

curl -fsSL "$SRC/inter/Inter%5Bopsz,wght%5D.ttf" -o "$WORK/Inter.ttf"
curl -fsSL "$SRC/notosansjp/NotoSansJP%5Bwght%5D.ttf" -o "$WORK/NotoSansJP.ttf"
curl -fsSL "$SRC/notoserif/NotoSerif%5Bwdth,wght%5D.ttf" -o "$WORK/NotoSerif.ttf"
curl -fsSL "$SRC/notoserif/NotoSerif-Italic%5Bwdth,wght%5D.ttf" -o "$WORK/NotoSerif-Italic.ttf"
# The brand faces (the owner's look pick): Limelight for the wordmark and numerals, Josefin Sans Bold for the
# interface's legends.
curl -fsSL "$SRC/limelight/Limelight-Regular.ttf" -o "$WORK/limelight-var.ttf"
curl -fsSL "$SRC/josefinsans/JosefinSans%5Bwght%5D.ttf" -o "$WORK/JosefinSans.ttf"
for f in inter notosansjp notoserif limelight josefinsans; do curl -fsSL "$SRC/$f/OFL.txt" -o "$OUT/OFL-$f.txt"; done

npx vite-node --config vitest.config.ts scripts/fonts/charset.ts latin > "$WORK/latin.txt"
npx vite-node --config vitest.config.ts scripts/fonts/charset.ts ja > "$WORK/ja.txt"
# Limelight sets only the wordmark and numerals (names and digits, the same in every language): printable ASCII.
python3 -c 'print("".join(chr(c) for c in range(32, 127)), end="")' > "$WORK/ascii.txt"
echo "charsets: latin $(python3 -c 'import sys; print(len(open(sys.argv[1], encoding="utf8").read()))' "$WORK/latin.txt"), ja $(python3 -c 'import sys; print(len(open(sys.argv[1], encoding="utf8").read()))' "$WORK/ja.txt")"

# One static instance of each variable font, then only the characters it needs.
instance() { # in out axis=value...
  python3 -m fontTools.varLib.instancer "$1" "${@:3}" -o "$2" >/dev/null
}
instance "$WORK/Inter.ttf" "$WORK/inter-md-var.ttf" wght=500 opsz=14
instance "$WORK/Inter.ttf" "$WORK/inter-bd-var.ttf" wght=700 opsz=14
instance "$WORK/NotoSansJP.ttf" "$WORK/noto-jp-var.ttf" wght=700
instance "$WORK/NotoSerif.ttf" "$WORK/noto-serif-bd-var.ttf" wght=700 wdth=100
instance "$WORK/NotoSerif-Italic.ttf" "$WORK/noto-serif-it-var.ttf" wght=400 wdth=100
instance "$WORK/JosefinSans.ttf" "$WORK/josefin-bd-var.ttf" wght=700
# Limelight and Josefin Sans reserve their names (OFL-limelight.txt, OFL-josefinsans.txt): a cut-down copy is a
# Modified Version and must not be called by them, so ours are renamed before anything is cut from them (the
# copyright, version and licence entries stay).
rename() { # ttf family style
  python3 -c '
import sys
from fontTools.ttLib import TTFont
path, family, style = sys.argv[1:4]
font = TTFont(path)
full = family if style == "Regular" else f"{family} {style}"
ps = family.replace(" ", "") + "-" + style
new = {1: family, 2: style, 3: "%s;%.3f" % (ps, font["head"].fontRevision), 4: full, 6: ps, 16: family, 17: style}
names = font["name"]
for r in names.names:
    if r.nameID in new: r.string = new[r.nameID]
names.names = [r for r in names.names if r.nameID not in (18, 21, 22, 25)]
font.save(path)
' "$1" "$2" "$3"
}
rename "$WORK/limelight-var.ttf" "Shadow Locks Display" Regular
rename "$WORK/josefin-bd-var.ttf" "Shadow Locks Sans" Bold
subset() { # in charset out [options]
  python3 -m fontTools.subset "$1" --text-file="$2" --output-file="$3" --no-hinting "${@:4}"
}
for f in inter-md inter-bd josefin-bd; do subset "$WORK/$f-var.ttf" "$WORK/latin.txt" "$WORK/$f.ttf" --layout-features=kern; done
subset "$WORK/limelight-var.ttf" "$WORK/ascii.txt" "$WORK/limelight.ttf" --layout-features=kern
# The brand faces for the landing page's CSS too.
subset "$WORK/limelight-var.ttf" "$WORK/ascii.txt" "$OUT/limelight.woff2" --flavor=woff2
subset "$WORK/josefin-bd-var.ttf" "$WORK/latin.txt" "$OUT/josefin-bd.woff2" --flavor=woff2
subset "$WORK/noto-jp-var.ttf" "$WORK/ja.txt" "$WORK/noto-jp.ttf" --layout-features=kern
subset "$WORK/noto-jp-var.ttf" "$WORK/ja.txt" "$OUT/noto-jp.woff2" --flavor=woff2
for f in noto-serif-bd noto-serif-it; do subset "$WORK/$f-var.ttf" "$WORK/latin.txt" "$OUT/$f.woff2" --flavor=woff2; done

atlas() { # name size field-type max-texture charset
  (cd "$WORK" && npx --yes msdf-bmfont-xml@2.7.0 -f json -o "$1" -s "$2" -r 4 -t "$3" -m "$4" -i "$5" --smart-size "$1.ttf" >/dev/null)
}
atlas inter-md 44 msdf 1024,1024 latin.txt
atlas inter-bd 44 msdf 1024,1024 latin.txt
atlas limelight 48 msdf 1024,1024 ascii.txt
atlas josefin-bd 44 msdf 1024,1024 latin.txt
atlas noto-jp 40 sdf 2048,2048 ja.txt
node scripts/fonts/finish-atlas.mjs "$WORK" "$OUT" inter-md:latin.txt inter-bd:latin.txt limelight:ascii.txt josefin-bd:latin.txt noto-jp:ja.txt:zws
ls -l "$OUT"
