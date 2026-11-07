// Reads the code points a WOFF2 font maps (its cmap) and its names (its name table), for the font tests. Just
// enough of the format: the header, the table directory, the one Brotli stream, cmap formats 4 and 12, and the name
// table's records (neither table is ever transformed).
import { brotliDecompressSync } from "node:zlib";

const KNOWN_CMAP = 0;
const KNOWN_NAME = 5;
const GLYF = 10;
const LOCA = 11;

function base128(b: Buffer, at: { i: number }): number {
  let v = 0;
  for (let n = 0; n < 5; n++) {
    const byte = b[at.i++] as number;
    v = v * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return v;
  }
  throw new Error("bad UIntBase128");
}

/** One untransformed table of a WOFF2 font, by its index in the format's known tags. */
function woff2Table(file: Buffer, knownTag: number, name: string): Buffer {
  if (file.readUInt32BE(0) !== 0x774f4632) throw new Error("not a WOFF2 file");
  const numTables = file.readUInt16BE(12);
  const compressed = file.readUInt32BE(20);
  const at = { i: 48 };
  let offset = 0;
  let table: { offset: number; length: number } | null = null;
  for (let t = 0; t < numTables; t++) {
    const flags = file[at.i++] as number;
    const known = flags & 0x3f;
    const version = flags >> 6;
    if (known === 63) at.i += 4;
    const orig = base128(file, at);
    const transformed = known === GLYF || known === LOCA ? version !== 3 : version !== 0;
    const length = transformed ? base128(file, at) : orig;
    if (known === knownTag) table = { offset, length };
    offset += length;
  }
  if (!table) throw new Error(`no ${name}`);
  const data = brotliDecompressSync(file.subarray(at.i, at.i + compressed));
  return data.subarray(table.offset, table.offset + table.length);
}

/** The code points (with a glyph other than .notdef) a WOFF2 font's cmap maps. */
export function woff2CodePoints(file: Buffer): Set<number> {
  return cmapCodePoints(woff2Table(file, KNOWN_CMAP, "cmap"));
}

/** A WOFF2 font's names by name ID (every platform's record: Windows ones are UTF-16, Mac Roman ones read as Latin-1). */
export function woff2Names(file: Buffer): Map<number, string[]> {
  const n = woff2Table(file, KNOWN_NAME, "name");
  const count = n.readUInt16BE(2), strings = n.readUInt16BE(4);
  const out = new Map<number, string[]>();
  for (let r = 0; r < count; r++) {
    const p = 6 + r * 12;
    const platform = n.readUInt16BE(p), id = n.readUInt16BE(p + 6), len = n.readUInt16BE(p + 8), off = n.readUInt16BE(p + 10);
    const raw = n.subarray(strings + off, strings + off + len);
    const s = platform === 1 ? raw.toString("latin1") : Buffer.from(raw).swap16().toString("utf16le");
    out.set(id, [...(out.get(id) ?? []), s]);
  }
  return out;
}

function cmapCodePoints(c: Buffer): Set<number> {
  const out = new Set<number>();
  const n = c.readUInt16BE(2);
  let f4 = -1, f12 = -1;
  for (let i = 0; i < n; i++) {
    const platform = c.readUInt16BE(4 + i * 8), encoding = c.readUInt16BE(6 + i * 8), off = c.readUInt32BE(8 + i * 8);
    const format = c.readUInt16BE(off);
    if (format === 12 && (platform === 3 || platform === 0)) f12 = off;
    if (format === 4 && ((platform === 3 && encoding === 1) || platform === 0)) f4 = off;
  }
  if (f12 >= 0) {
    const groups = c.readUInt32BE(f12 + 12);
    for (let g = 0; g < groups; g++) {
      const p = f12 + 16 + g * 12;
      const start = c.readUInt32BE(p), end = c.readUInt32BE(p + 4), glyph = c.readUInt32BE(p + 8);
      for (let cp = start; cp <= end; cp++) if (glyph + (cp - start) !== 0) out.add(cp);
    }
    return out;
  }
  if (f4 < 0) throw new Error("no cmap format 4 or 12");
  const segX2 = c.readUInt16BE(f4 + 6);
  const ends = f4 + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
  for (let s = 0; s < segX2 / 2; s++) {
    const end = c.readUInt16BE(ends + s * 2), start = c.readUInt16BE(starts + s * 2);
    const delta = c.readInt16BE(deltas + s * 2), range = c.readUInt16BE(ranges + s * 2);
    for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
      let glyph: number;
      if (range === 0) glyph = (cp + delta) & 0xffff;
      else {
        const g = c.readUInt16BE(ranges + s * 2 + range + (cp - start) * 2);
        glyph = g === 0 ? 0 : (g + delta) & 0xffff;
      }
      if (glyph !== 0) out.add(cp);
    }
  }
  return out;
}
