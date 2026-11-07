// Prints the characters a font is built with, from the language tables (src/i18n/charset.ts): "latin" for the
// Inter and Josefin Sans atlases and the Latin WOFF2s, "ja" for the Japanese atlas and canvas font. No newline at the end (every character
// printed is one the font gets). Used by scripts/fonts/build-fonts.sh:
//   npx vite-node --config vitest.config.ts scripts/fonts/charset.ts latin
import { japaneseBuildSet, latinBuildSet } from "../../src/i18n/charset";

const which = process.argv.at(-1);
const set = which === "latin" ? latinBuildSet() : which === "ja" ? japaneseBuildSet() : null;
if (!set) {
  console.error("usage: charset.ts latin|ja");
  process.exit(2);
}
process.stdout.write(set.join(""));
