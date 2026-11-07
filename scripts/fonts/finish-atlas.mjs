#!/usr/bin/env node
// Finishes atlases msdf-bmfont-xml made: the page as lossless WebP (much smaller than its PNG, and UIKit loads it
// the same way), the JSON pointing at it, a no-break space where the font's cmap had none for the generator (a
// copy of the space: same advance, nothing drawn), and a check that every character of its charset is there.
// With ":zws" after a charset (the Japanese atlas): the no-break space keeps the space's width and the plain space
// gets none, so UIKit, which breaks lines only at a plain space, can be given places to break Japanese without a
// gap showing (src/ui/panel-ui.ts puts one wherever a line may break).
// Usage (scripts/fonts/build-fonts.sh): node scripts/fonts/finish-atlas.mjs <work dir> <out dir> <name>:<charset>[:zws]...
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const [work, out, ...specs] = process.argv.slice(2);
if (!work || !out || specs.length === 0) {
  console.error("usage: finish-atlas.mjs <work> <out> <name>:<charset file>...");
  process.exit(2);
}
const FACES = {
  "inter-md": "Inter Medium",
  "inter-bd": "Inter Bold",
  "archivo-xb": "Archivo Expanded ExtraBold",
  "noto-jp": "Noto Sans JP Bold",
};
fs.mkdirSync(out, { recursive: true });
let failed = false;
for (const spec of specs) {
  const [name, charset, mode] = spec.split(":");
  const font = JSON.parse(fs.readFileSync(path.join(work, `${name}.json`), "utf8"));
  if (font.pages.length !== 1) throw new Error(`${name}: ${font.pages.length} pages (UIKit takes exactly one): raise the texture size`);
  const png = fs.readFileSync(path.join(work, font.pages[0]));
  const webp = await sharp(png).webp({ lossless: true, effort: 6 }).toBuffer();
  fs.writeFileSync(path.join(out, `${name}.webp`), webp);
  font.pages = [`${name}.webp`];
  font.info.face = FACES[name] ?? name;
  const have = new Set(font.chars.map((c) => c.char));
  const space = font.chars.find((c) => c.char === " ");
  if (!space) throw new Error(`${name}: no space glyph`);
  if (mode === "zws") font.chars = font.chars.filter((c) => c.char !== " ");
  if (mode === "zws" || !have.has(" ")) {
    font.chars.push({ ...space, id: 0xa0, char: " " });
    have.add(" ");
  }
  if (mode === "zws") Object.assign(space, { xadvance: 0, width: 0 });
  const want = [...fs.readFileSync(path.join(work, charset), "utf8")];
  const missing = want.filter((ch) => !have.has(ch));
  if (missing.length) {
    failed = true;
    console.error(`${name}: missing ${missing.map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase()}`).join(" ")}`);
  }
  fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(font));
  const { scaleW, scaleH } = font.common;
  console.log(`${name}: ${font.chars.length} glyphs, ${font.kernings.length} kernings, ${scaleW}x${scaleH}, png ${png.length} B, webp ${webp.length} B`);
}
process.exit(failed ? 1 : 0);
